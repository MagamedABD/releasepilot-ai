/**
 * Данные для аналитики поставки.
 *
 * Запрос здесь узкий намеренно. Рядом уже есть `loadOrgReleases`, которая
 * отдаёт релизы вместе с посчитанными метриками, — и она не годится:
 * метрики считаются по текущему состоянию задач, а история поставки
 * спрашивает про факт выпуска. Для десяти релизов разница в цене
 * незаметна, для сотни — это сто расчётов Монте-Карло ради двух дат.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { ReasonObservation, ReleaseFact } from '@/domain/analytics';
import type { Database } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

export type ReleaseFactsResult = {
  facts: ReleaseFact[];
  error: PostgrestError | null;
};

/**
 * Факты о релизах организации.
 *
 * `org_id` здесь — выбор нужной организации из доступных, а не проверка
 * доступа: доступ держит RLS. Разница видна на пользователе, состоящем в
 * двух организациях: без этого условия он получил бы историю обеих,
 * сложенную в одну, — ответ, который не описывает ни одну из них.
 */
export async function loadReleaseFacts(
  supabase: Client,
  orgId: string,
): Promise<ReleaseFactsResult> {
  const { data, error } = await supabase
    .from('releases')
    .select('id, name, status, planned_date, released_at, projects(key)')
    .eq('org_id', orgId)
    .order('planned_date');

  if (error) return { facts: [], error };

  return {
    facts: (data ?? []).map((r) => ({
      releaseId: r.id,
      name: r.name,
      projectKey: (r.projects as { key: string } | null)?.key ?? '—',
      status: r.status,
      plannedDate: r.planned_date,
      releasedAt: r.released_at,
    })),
    error: null,
  };
}

export type SnapshotCoverage = {
  count: number;
  from: string | null;
  to: string | null;
};

/**
 * Охват снимков метрик.
 *
 * Отдаётся вместе с историей, и не для полноты. По снимкам считается то,
 * что по текущему состоянию не восстановить: какие причины риска
 * повторялись из релиза в релиз (FR-37). Пока снимков нет, честный ответ
 * — «их нет», а не пустой список причин: пустой список читается как «все
 * релизы выходили гладко».
 */
export async function loadSnapshotCoverage(
  supabase: Client,
  orgId: string,
): Promise<{ coverage: SnapshotCoverage; error: PostgrestError | null }> {
  const [countRes, firstRes, lastRes] = await Promise.all([
    supabase
      .from('release_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId),
    supabase
      .from('release_snapshots')
      .select('captured_at')
      .eq('org_id', orgId)
      .order('captured_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('release_snapshots')
      .select('captured_at')
      .eq('org_id', orgId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const error = countRes.error ?? firstRes.error ?? lastRes.error ?? null;
  if (error) return { coverage: { count: 0, from: null, to: null }, error };

  return {
    coverage: {
      count: countRes.count ?? 0,
      from: firstRes.data?.captured_at ?? null,
      to: lastRes.data?.captured_at ?? null,
    },
    error: null,
  };
}

/** Потолок выборки: год ежедневных снимков по десятку релизов. */
const MAX_OBSERVATIONS = 4000;

/**
 * Причины риска по дням — сырьё для ранжирования (FR-37).
 *
 * Из снимка берётся только список причин, а не весь `metrics`: полный
 * снимок весит килобайты, а нужны из него код и имя команды. Содержимое
 * разбирается с недоверием — это jsonb, записанный прошлыми версиями
 * расчёта, и форма у старых снимков может отличаться; непонятная запись
 * пропускается, а не роняет экран.
 */
export async function loadReasonObservations(
  supabase: Client,
  orgId: string,
): Promise<{ observations: ReasonObservation[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('release_snapshots')
    .select('release_id, reasons:metrics->reasons')
    .eq('org_id', orgId)
    .order('captured_at', { ascending: false })
    .limit(MAX_OBSERVATIONS);

  if (error) return { observations: [], error };

  const observations: ReasonObservation[] = (data ?? []).map((row) => {
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const codes: string[] = [];
    const teams: string[] = [];
    for (const r of reasons) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      const { code, facts } = r as { code?: unknown; facts?: unknown };
      if (typeof code !== 'string') continue;
      codes.push(code);
      const team = (facts as { team?: unknown } | null)?.team;
      if (typeof team === 'string' && code.startsWith('TEAM_OVERLOAD')) teams.push(team);
    }
    return { releaseId: row.release_id, codes, teams };
  });

  return { observations, error: null };
}
