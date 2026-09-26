/**
 * Коллекция задач: выборка и создание.
 *
 * Ни один из обработчиков не фильтрует по организации ради доступа.
 * Доступ разграничивают политики RLS, и клиент здесь ходит от лица
 * пользователя (anon-ключ плюс его сессия), а не от лица сервиса.
 * Условие `org_id = …` в запросе выглядело бы защитой, но ею не было
 * бы: забудь его кто-нибудь в следующем маршруте — и данные потекли
 * бы. Настоящая защита обязана быть там, где её нельзя забыть.
 */

import { badJson, BAD_JSON, created, fail, fromPostgres, invalid, ok, readJson, unauthorized } from '@/lib/api/http';
import { toApiTask, toInsert } from '@/lib/api/task';
import { createClient } from '@/lib/supabase/server';
import { taskCreateSchema, taskQuerySchema } from '@/lib/validation/task';

/**
 * Список задач.
 *
 * Отдаёт вместе с общим числом: без него клиент не может нарисовать
 * ни постраничную навигацию, ни «показано 50 из 380», а выяснить
 * количество отдельным запросом значит посчитать выборку дважды.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = taskQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);
  const q = parsed.data;

  let query = supabase.from('tasks').select('*', { count: 'exact' });

  if (q.releaseId) query = query.eq('release_id', q.releaseId);
  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.teamId) query = query.eq('team_id', q.teamId);
  if (q.status) query = query.eq('status', q.status);
  if (q.priority) query = query.eq('priority', q.priority);
  // Блокировка — не статус, а отдельная ось: задача бывает заблокирована
  // в любом статусе, кроме завершённых. Признак хранится отметкой времени,
  // поэтому фильтр идёт по её наличию.
  if (q.blocked !== undefined) {
    query = q.blocked ? query.not('blocked_since', 'is', null) : query.is('blocked_since', null);
  }
  if (q.q) {
    // Экранируем запятую и скобки: в синтаксисе PostgREST они разделяют
    // условия, и строка поиска с запятой иначе сломала бы разбор фильтра.
    const safe = q.q.replace(/[,()\\]/g, ' ');
    query = query.ilike('title', `%${safe}%`);
  }

  const { data, error, count } = await query
    .order('priority')
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);

  if (error) return fromPostgres(error);

  return ok(data.map(toApiTask), {
    headers: { 'x-total-count': String(count ?? 0) },
  });
}

/** Создание задачи. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  /*
    Организация берётся из проекта, а не из тела запроса.

    Колонка `org_id` обязательна, и напрашивается принять её от клиента.
    Но тогда появляется запрос, в котором проект принадлежит одной
    организации, а задача создаётся в другой, — и дальше всё зависит от
    того, покрывает ли политика RLS именно эту комбинацию. Выводя
    организацию из проекта, мы делаем такое расхождение невыразимым.

    Проект при этом виден только свой: выборка идёт от лица пользователя,
    и для чужого проекта вернётся пусто — то есть «не найдено», а не
    «запрещено».
  */
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', input.projectId)
    .maybeSingle();

  if (projectError) return fromPostgres(projectError);
  if (!project) return fail(422, 'invalid_reference', 'Проект не найден');

  const { data, error } = await supabase
    .from('tasks')
    .insert(toInsert(input, project.org_id, new Date().toISOString()))
    .select('*')
    .single();

  if (error) return fromPostgres(error);
  return created(toApiTask(data));
}
