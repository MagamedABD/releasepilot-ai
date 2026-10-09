/**
 * Данные для панели задачи: сама задача, её связи и справочники формы.
 *
 * Всё читается от лица пользователя, поэтому чужое не попадёт ни в
 * задачу, ни в списки выбора — их ограничивает RLS, а `org_id` в каждом
 * запросе сужает выборку до организации из адреса (см. taskQuerySchema).
 */

import type { EditableTask, Option, TaskLink } from '@/components/task-editor';
import type { createClient } from '@/lib/supabase/server';

type Client = Awaited<ReturnType<typeof createClient>>;

export type TaskEditorData = {
  task: EditableTask | null;
  projects: Option[];
  releases: Option[];
  teams: Option[];
  members: Option[];
  candidates: Option[];
  blocks: TaskLink[];
  waitsFor: TaskLink[];
};

/** Подпись задачи в списках: ключ, если есть, иначе только название. */
const label = (t: { external_key: string | null; title: string }) =>
  t.external_key ? `${t.external_key} — ${t.title}` : t.title;

/**
 * `taskId` — идентификатор или `new`. Для несуществующей задачи
 * возвращается `null`: панель просто не откроется, как не открылась бы
 * по ссылке на удалённую задачу.
 */
export async function loadTaskEditor(
  supabase: Client,
  orgId: string,
  taskId: string,
): Promise<TaskEditorData | null> {
  const isNew = taskId === 'new';

  const taskRes = isNew
    ? { data: null }
    : await supabase.from('tasks').select('*').eq('id', taskId).eq('org_id', orgId).maybeSingle();
  const row = taskRes.data;
  if (!isNew && !row) return null;

  const [projects, releases, teams, members, deps] = await Promise.all([
    supabase.from('projects').select('id, name, key').eq('org_id', orgId).order('name'),
    supabase
      .from('releases')
      .select('id, name, status')
      .eq('org_id', orgId)
      .order('planned_date', { ascending: false }),
    supabase.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    supabase.from('memberships').select('user_id, profiles(full_name)').eq('org_id', orgId),
    row
      ? supabase
          .from('task_dependencies')
          .select('blocker_task_id, blocked_task_id')
          .or(`blocker_task_id.eq.${row.id},blocked_task_id.eq.${row.id}`)
      : Promise.resolve({ data: [] as { blocker_task_id: string; blocked_task_id: string }[] }),
  ]);

  /*
    Кандидаты в связи — задачи того же релиза: зависимость между релизами
    редкость, а список всех задач организации превратил бы выбор в
    прокрутку сотен строк. Задача без релиза выбирает из задач без релиза.
  */
  const candidatesQuery = supabase
    .from('tasks')
    .select('id, external_key, title')
    .eq('org_id', orgId)
    .order('external_key')
    .limit(300);
  const candidatesRes = row?.release_id
    ? await candidatesQuery.eq('release_id', row.release_id)
    : await candidatesQuery.is('release_id', null);
  const candidates = candidatesRes.data ?? [];

  // Связанные задачи могут лежать вне списка кандидатов (другой релиз),
  // поэтому их подписи добираются отдельно.
  const linkIds = (deps.data ?? []).flatMap((d) => [d.blocker_task_id, d.blocked_task_id]);
  const known = new Map(candidates.map((c) => [c.id, label(c)]));
  const missing = [...new Set(linkIds)].filter((id) => id !== row?.id && !known.has(id));
  if (missing.length) {
    const { data } = await supabase.from('tasks').select('id, external_key, title').in('id', missing);
    for (const t of data ?? []) known.set(t.id, label(t));
  }
  const link = (id: string): TaskLink => ({ taskId: id, label: known.get(id) ?? 'Задача' });

  return {
    task: row
      ? {
          id: row.id,
          projectId: row.project_id,
          releaseId: row.release_id,
          externalKey: row.external_key,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          estimateH: Number(row.estimate_h),
          spentH: Number(row.spent_h),
          teamId: row.team_id,
          assigneeId: row.assignee_id,
          blocked: row.blocked_since !== null,
        }
      : null,
    projects: (projects.data ?? []).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
    releases: (releases.data ?? []).map((r) => ({ value: r.id, label: r.name })),
    teams: (teams.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    members: (members.data ?? [])
      .map((m) => ({
        value: m.user_id,
        label: (m.profiles as { full_name: string | null } | null)?.full_name || 'Без имени',
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    candidates: candidates.map((c) => ({ value: c.id, label: label(c) })),
    blocks: (deps.data ?? []).filter((d) => d.blocker_task_id === row?.id).map((d) => link(d.blocked_task_id)),
    waitsFor: (deps.data ?? []).filter((d) => d.blocked_task_id === row?.id).map((d) => link(d.blocker_task_id)),
  };
}
