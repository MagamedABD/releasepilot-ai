/**
 * Перевод строк базы в снимок для движка риска.
 *
 * Движок (src/domain) намеренно ничего не знает о базе: на вход ему подаётся
 * ReleaseSnapshot, на выход идут метрики (ADR-001). Значит, кто-то должен
 * перевести одно в другое, и этот кто-то — здесь. Держать перевод в домене
 * нельзя — тогда домен узнает про Postgres; держать в компоненте страницы
 * тоже нельзя — тогда перевод будет переписан заново на каждом экране.
 *
 * Разбор отделён от запроса умышленно: `toSnapshot` — чистая функция, её
 * можно проверить без базы, сети и сессии. Запрос сверху — тонкий.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateRelease } from '@/domain/risk';
import type { Database, TeamKind as DbTeamKind } from '@/lib/database.types';
import type {
  Dependency,
  ReleaseMetrics,
  ReleaseSnapshot,
  Task,
  Team,
  TeamCapacity,
  TeamKind,
} from '@/domain/types';

type Client = SupabaseClient<Database>;

type TeamRow = Database['public']['Tables']['teams']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];
type DependencyRow = Database['public']['Tables']['task_dependencies']['Row'];
type CapacityRow = Database['public']['Tables']['team_capacity']['Row'];
type ReleaseRow = Database['public']['Tables']['releases']['Row'];

/**
 * Виды команд базы → виды команд домена.
 *
 * Перечисления разной ширины, и это не оплошность. База описывает
 * оргструктуру: «фронтенд», «аналитика» и «дизайн» — разные команды, и
 * пользователь вправе их различать. Движку же важен ровно один вопрос:
 * тестирование это или нет, потому что у тестирования особая роль в
 * воронке (FR-21, воронка QA). Остальные различия на расчёт не влияют.
 *
 * Поэтому сужение происходит здесь, а не правкой одной из сторон.
 * Расширить домен до шести значений — засорить расчёт различиями, которые
 * он не использует. Сузить базу до трёх — потерять данные, которые нужны
 * экранам и отчётам. Отображение неполно по построению, и это осознанно.
 */
const TEAM_KIND: Record<DbTeamKind, TeamKind> = {
  frontend: 'dev',
  backend: 'dev',
  qa: 'qa',
  analytics: 'other',
  design: 'other',
  other: 'other',
};

export function toTeamKind(kind: DbTeamKind): TeamKind {
  return TEAM_KIND[kind] ?? 'other';
}

export type SnapshotRows = {
  release: Pick<ReleaseRow, 'id' | 'name' | 'planned_date' | 'started_at'>;
  teams: Pick<TeamRow, 'id' | 'name' | 'kind'>[];
  tasks: TaskRow[];
  dependencies: Pick<DependencyRow, 'blocker_task_id' | 'blocked_task_id' | 'type'>[];
  capacity: Pick<CapacityRow, 'team_id' | 'period_start' | 'period_end' | 'available_hours'>[];
  /** Нерабочие дни сверх обычных выходных. Таблицы под них пока нет. */
  holidays?: string[];
};

/**
 * Чистое преобразование. `now` передаётся снаружи по той же причине, по
 * которой его требует движок: иначе результат зависит от момента вызова,
 * и воспроизводимого теста не получится.
 */
export function toSnapshot(rows: SnapshotRows, now: string): ReleaseSnapshot {
  const teams: Team[] = rows.teams.map((t) => ({
    id: t.id,
    name: t.name,
    kind: toTeamKind(t.kind),
  }));

  const tasks: Task[] = rows.tasks.map((t) => ({
    id: t.id,
    key: t.external_key ?? undefined,
    title: t.title,
    status: t.status,
    priority: t.priority,
    estimateH: Number(t.estimate_h),
    spentH: Number(t.spent_h),
    teamId: t.team_id,
    assigneeId: t.assignee_id,
    addedToReleaseAt: t.added_to_release_at,
    blockedSince: t.blocked_since,
  }));

  const dependencies: Dependency[] = rows.dependencies.map((d) => ({
    blockerTaskId: d.blocker_task_id,
    blockedTaskId: d.blocked_task_id,
    type: d.type,
  }));

  const capacity: TeamCapacity[] = rows.capacity.map((c) => ({
    teamId: c.team_id,
    periodStart: c.period_start,
    periodEnd: c.period_end,
    availableHours: Number(c.available_hours),
  }));

  return {
    now,
    release: {
      id: rows.release.id,
      name: rows.release.name,
      plannedDate: rows.release.planned_date,
      startedAt: rows.release.started_at,
    },
    teams,
    tasks,
    dependencies,
    capacity,
    calendar: { holidays: rows.holidays ?? [] },
  };
}

/**
 * Собрать снимок релиза из базы.
 *
 * Клиент передаётся, а не создаётся внутри: вызов из серверного компонента
 * идёт от лица пользователя и режется RLS, а фоновой задаче понадобится
 * другой клиент. Фильтра по org_id здесь нет намеренно — политики уже
 * ограничивают выдачу организациями пользователя, и дублировать их
 * условием в запросе значило бы изображать защиту, а не строить её.
 *
 * Возвращает null, если релиз не найден или не виден: для вызывающего это
 * одно и то же, и различать эти случаи в ответе — значит подтверждать
 * существование чужих данных.
 */
export async function loadReleaseSnapshot(
  supabase: Client,
  releaseId: string,
  now: string = new Date().toISOString(),
): Promise<ReleaseSnapshot | null> {
  const { data: release } = await supabase
    .from('releases')
    .select('id, org_id, name, planned_date, started_at')
    .eq('id', releaseId)
    .maybeSingle();

  if (!release) return null;

  // Задачи, зависимости и ёмкость независимы друг от друга — берём разом.
  const [tasksRes, teamsRes, capacityRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('release_id', releaseId),
    supabase.from('teams').select('id, name, kind').eq('org_id', release.org_id),
    supabase
      .from('team_capacity')
      .select('team_id, period_start, period_end, available_hours')
      .eq('org_id', release.org_id),
  ]);

  const tasks = tasksRes.data ?? [];

  // Зависимости берутся только между задачами этого релиза. Запрос по
  // списку идентификаторов, а не по org_id: иначе в снимок попали бы связи
  // соседних релизов, и критическая цепочка посчиталась бы длиннее.
  const ids = tasks.map((t) => t.id);
  const depsRes = ids.length
    ? await supabase
        .from('task_dependencies')
        .select('blocker_task_id, blocked_task_id, type')
        .in('blocker_task_id', ids)
        .in('blocked_task_id', ids)
    : { data: [] };

  return toSnapshot(
    {
      release,
      teams: teamsRes.data ?? [],
      tasks,
      dependencies: depsRes.data ?? [],
      capacity: capacityRes.data ?? [],
    },
    now,
  );
}

/** Релиз вместе с посчитанными по нему метриками. */
export type ReleaseWithMetrics = {
  id: string;
  name: string;
  orgId: string;
  status: Database['public']['Enums']['release_status'];
  plannedDate: string;
  releasedAt: string | null;
  projectKey: string;
  metrics: ReleaseMetrics;
  /**
   * Снимок, по которому посчитаны метрики.
   *
   * Отдаётся наружу ради одного вызывающего — записи ежедневных снимков
   * метрик (FR-39). Ей нужен прогноз, а прогноз считается по снимку, и
   * без него пришлось бы или собирать те же пять запросов второй раз, или
   * записывать уровень риска, посчитанный без вероятности, — то есть
   * отличающийся от того, что видно в кокпите.
   *
   * Экран списка релизов это поле не читает: Монте-Карло на каждый релиз
   * при открытии списка никому не нужен.
   */
  snapshot: ReleaseSnapshot;
};

/**
 * Все релизы организации с метриками.
 *
 * Очевидный способ — пройтись по релизам и на каждом вызвать
 * loadReleaseSnapshot — даёт четыре запроса на релиз. На демо с четырьмя
 * релизами это незаметно, на полусотне — уже нет, и переписывать пришлось
 * бы ровно тогда, когда некогда. Поэтому здесь пять запросов независимо от
 * числа релизов, а группировка делается в памяти.
 *
 * Фильтра по org_id в выдаче достаточно: RLS уже ограничивает её
 * организациями пользователя, и org_id здесь — выбор нужной из доступных,
 * а не проверка доступа.
 */
export async function loadOrgReleases(
  supabase: Client,
  orgId: string,
  now: string = new Date().toISOString(),
): Promise<ReleaseWithMetrics[]> {
  const [releasesRes, teamsRes, capacityRes, tasksRes, depsRes] = await Promise.all([
    supabase
      .from('releases')
      .select('id, name, status, planned_date, started_at, released_at, projects(key)')
      .eq('org_id', orgId)
      .order('planned_date'),
    supabase.from('teams').select('id, name, kind').eq('org_id', orgId),
    supabase
      .from('team_capacity')
      .select('team_id, period_start, period_end, available_hours')
      .eq('org_id', orgId),
    supabase.from('tasks').select('*').eq('org_id', orgId).not('release_id', 'is', null),
    supabase
      .from('task_dependencies')
      .select('blocker_task_id, blocked_task_id, type')
      .eq('org_id', orgId),
  ]);

  const releases = releasesRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const capacity = capacityRes.data ?? [];

  const tasksByRelease = new Map<string, TaskRow[]>();
  for (const task of tasksRes.data ?? []) {
    if (!task.release_id) continue;
    const bucket = tasksByRelease.get(task.release_id);
    if (bucket) bucket.push(task);
    else tasksByRelease.set(task.release_id, [task]);
  }

  return releases.map((r) => {
    const tasks = tasksByRelease.get(r.id) ?? [];
    const ids = new Set(tasks.map((t) => t.id));

    // Связи соседних релизов сюда попасть не должны: иначе критическая
    // цепочка посчиталась бы длиннее, чем есть на самом деле.
    const dependencies = (depsRes.data ?? []).filter(
      (d) => ids.has(d.blocker_task_id) && ids.has(d.blocked_task_id),
    );

    const snapshot = toSnapshot(
      {
        release: {
          id: r.id,
          name: r.name,
          planned_date: r.planned_date,
          // Момент старта обязателен: от него отсчитывается дрейф объёма.
          // Передать сюда null — получить нулевой дрейф в списке при
          // ненулевом в карточке релиза, то есть два разных ответа на
          // один вопрос.
          started_at: r.started_at,
        },
        teams,
        tasks,
        dependencies,
        capacity,
      },
      now,
    );

    return {
      id: r.id,
      name: r.name,
      orgId,
      status: r.status,
      plannedDate: r.planned_date,
      releasedAt: r.released_at,
      projectKey: (r.projects as { key: string } | null)?.key ?? '—',
      metrics: calculateRelease(snapshot),
      snapshot,
    };
  });
}
