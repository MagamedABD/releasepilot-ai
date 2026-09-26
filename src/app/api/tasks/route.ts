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
import { selectTasks } from '@/lib/data/tasks';
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

  // Сама выборка — в lib/data/tasks: те же фильтры нужны экрану задач,
  // и держать их в обработчике значит однажды развести две копии.
  const { rows, total, error } = await selectTasks(supabase, parsed.data);
  if (error) return fromPostgres(error);

  return ok(rows.map(toApiTask), {
    headers: { 'x-total-count': String(total) },
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
