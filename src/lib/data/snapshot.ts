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

import type { Database, TeamKind as DbTeamKind } from '@/lib/database.types';
import type {
  Dependency,
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
