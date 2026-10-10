/**
 * Ежедневные снимки метрик (FR-39).
 *
 * Зачем они нужны, видно по тому, на что без них нельзя ответить. Вопрос
 * «какие причины риска повторяются из релиза в релиз» (FR-37) требует
 * знать, что система думала о релизе **тогда**: сейчас задачи закрыты,
 * блокеры сняты, загрузка обнулилась, и пересчёт по текущему состоянию
 * выдал бы «в прошлом всё было гладко» — историю, которой не было.
 *
 * Отсюда и формат хранения: метрики целиком в `jsonb`, а не разложенные
 * по колонкам. Формулы будут калиброваться, и разложенная по колонкам
 * история молча сменила бы смысл после первой же правки весов. Снимок
 * фиксирует и числа, и то, как они тогда считались.
 *
 * Пишет только сервер: у `release_snapshots` нет политики на вставку ни
 * для одной роли (миграция 0001), и это не упущение — снимок не должен
 * зависеть от того, зашёл ли кто-нибудь на экран.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import type { ReleaseForecast, ReleaseMetrics } from '@/domain/types';
import type { Database } from '@/lib/database.types';

import { loadOrgReleases, type ReleaseWithMetrics } from './snapshot';

type Client = SupabaseClient<Database>;
type SnapshotInsert = Database['public']['Tables']['release_snapshots']['Insert'];

/**
 * Снимаются только открытые релизы.
 *
 * У выпущенного и отменённого метрики больше не меняются: ежедневная
 * запись добавляла бы к истории одинаковые строки, и «динамика» по ним
 * выглядела бы ровной линией там, где просто ничего не происходит.
 * Последний снимок перед выпуском сохраняется сам — он сделан, пока
 * релиз был активен, и именно он отвечает на вопрос «что было видно
 * накануне».
 */
const OPEN_STATUSES: Database['public']['Enums']['release_status'][] = [
  'planned',
  'active',
  'postponed',
];

export function isSnapshotWorthy(status: string): boolean {
  return OPEN_STATUSES.includes(status as (typeof OPEN_STATUSES)[number]);
}

/**
 * Строка снимка.
 *
 * Чистая функция: принимает посчитанное, ничего не считает сама. Уровень
 * риска берётся из метрик, а не выводится из скора заново — иначе снимок
 * записал бы уровень без правил эскалации, и история разошлась бы с тем,
 * что показывал кокпит.
 */
export function toSnapshotRow(
  release: { id: string; orgId: string },
  metrics: ReleaseMetrics,
  forecast: ReleaseForecast,
  capturedAt: string,
): SnapshotInsert {
  return {
    org_id: release.orgId,
    release_id: release.id,
    captured_at: capturedAt,
    readiness_pct: metrics.readinessPct,
    risk_score: metrics.riskScore,
    risk_level: metrics.riskLevel,
    // Вероятность может не считаться вовсе — при недостатке истории
    // прогноз детерминированный (FR-22). Тогда это null, а не ноль:
    // «не считали» и «ноль процентов» — разные сведения.
    probability_on_time: forecast.probabilityOnTime,
    metrics: JSON.parse(JSON.stringify(metrics)) as SnapshotInsert['metrics'],
  };
}

/**
 * Метрики с прогнозом — в том же порядке, что в эндпоинте метрик.
 *
 * Прогноз считается первым, потому что от вероятности зависит правило
 * эскалации `LOW_PROBABILITY`. Снимок без прогноза записал бы уровень
 * риска ниже настоящего у самого опасного релиза — и сделал бы это тихо.
 */
export function evaluateForSnapshot(
  release: ReleaseWithMetrics,
  /**
   * Длина истории организации. Передаётся, а не берётся нулём: от неё
   * зависит метод прогноза (FR-22), и с нулём снимок записал бы
   * детерминированный остаток без вероятности — а значит, и уровень
   * риска без правила `LOW_PROBABILITY`, то есть не тот, что в кокпите.
   */
  completedReleases: number,
): {
  metrics: ReleaseMetrics;
  forecast: ReleaseForecast;
} {
  const forecast = forecastRelease(release.snapshot, RISK_CONFIG, { completedReleases });
  return {
    forecast,
    metrics: calculateRelease(release.snapshot, RISK_CONFIG, {
      probabilityOnTime: forecast.probabilityOnTime,
    }),
  };
}

export type CaptureReport = {
  organizations: number;
  releases: number;
  written: number;
  /** Закрытые релизы: их метрики больше не меняются. */
  skipped: number;
  errors: string[];
};

/**
 * Снять метрики по всем организациям.
 *
 * Клиент — административный: он обходит RLS, и здесь это единственный
 * способ обойти всех арендаторов. Поэтому у функции нет и не должно быть
 * ни одного параметра, приходящего из запроса: перечень организаций она
 * берёт сама, и подменить его извне нельзя.
 */
/**
 * Что посчитано по организации за один прогон — для уведомлений.
 *
 * Отдаётся обратным вызовом, а не в отчёте: отчёт уходит ответом
 * планировщику, и класть в него метрики всех релизов незачем. Прошлый
 * уровень читается до записи нового снимка — после неё «прошлым» стал бы
 * только что записанный.
 */
export type OrgCapture = {
  orgId: string;
  releases: {
    release: ReleaseWithMetrics;
    metrics: ReleaseMetrics;
    forecast: ReleaseForecast;
    /** Уровень из предыдущего снимка; `null` — снимков ещё не было. */
    previousLevel: ReleaseMetrics['riskLevel'] | null;
  }[];
};

export async function captureSnapshots(
  admin: Client,
  capturedAt: string = new Date().toISOString(),
  onOrg?: (capture: OrgCapture) => void,
): Promise<CaptureReport> {
  const report: CaptureReport = {
    organizations: 0,
    releases: 0,
    written: 0,
    skipped: 0,
    errors: [],
  };

  const { data: orgs, error } = await admin.from('organizations').select('id');
  if (error) {
    report.errors.push(`организации: ${error.message}`);
    return report;
  }

  for (const org of orgs ?? []) {
    report.organizations += 1;

    let releases: ReleaseWithMetrics[];
    try {
      releases = await loadOrgReleases(admin, org.id, capturedAt);
    } catch (e) {
      /*
        Падение на одной организации не должно останавливать остальные:
        иначе один релиз со сломанными данными лишил бы истории всех
        арендаторов сразу, и обнаружилось бы это через месяц — когда
        истории за месяц не окажется.
      */
      report.errors.push(`${org.id}: ${e instanceof Error ? e.message : 'ошибка расчёта'}`);
      continue;
    }

    /*
      История считается один раз на организацию, а не на релиз. Снимаются
      только открытые релизы, поэтому вычитать из счётчика самого себя не
      приходится: выпущенный релиз в снимок не попадает.
    */
    const completedReleases = releases.filter((r) => r.status === 'released').length;

    const rows: SnapshotInsert[] = [];
    const evaluated: Omit<OrgCapture['releases'][number], 'previousLevel'>[] = [];
    for (const release of releases) {
      report.releases += 1;
      if (!isSnapshotWorthy(release.status)) {
        report.skipped += 1;
        continue;
      }
      const { metrics, forecast } = evaluateForSnapshot(release, completedReleases);
      rows.push(toSnapshotRow(release, metrics, forecast, capturedAt));
      evaluated.push({ release, metrics, forecast });
    }

    if (rows.length === 0) continue;

    // Последний снимок каждого релиза — пока новый ещё не записан.
    const previous = new Map<string, ReleaseMetrics['riskLevel']>();
    if (onOrg) {
      const { data: last } = await admin
        .from('release_snapshots')
        .select('release_id, risk_level')
        .eq('org_id', org.id)
        .in('release_id', evaluated.map((e) => e.release.id))
        .order('captured_at', { ascending: false })
        .limit(500);
      for (const row of last ?? []) {
        if (!previous.has(row.release_id)) previous.set(row.release_id, row.risk_level);
      }
    }

    const { error: writeError } = await admin.from('release_snapshots').insert(rows);
    if (writeError) {
      report.errors.push(`${org.id}: ${writeError.message}`);
      continue;
    }
    report.written += rows.length;

    onOrg?.({
      orgId: org.id,
      releases: evaluated.map((e) => ({
        ...e,
        previousLevel: previous.get(e.release.id) ?? null,
      })),
    });
  }

  return report;
}
