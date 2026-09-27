/**
 * Коллекция релизов: выборка и создание.
 *
 * Как и у задач, ни один обработчик не фильтрует по организации ради
 * доступа: клиент ходит от лица пользователя, и разграничивает доступ
 * RLS. Условие `org_id = …` здесь — ответ на вопрос «релизы какой
 * организации», а не защита.
 *
 * Сама выборка оставлена в обработчике, а не вынесена в `lib/data`, как
 * у задач. Разница не в стиле: фильтры задач нужны и API, и экрану
 * задач, и одна копия там существует ровно для того, чтобы они не
 * разошлись. У релизов второго потребителя нет — кокпит берёт их вместе
 * со снимками через `loadOrgReleases`, и это другой запрос. Вынести
 * стоит, когда появится второй, а не заранее.
 */

import {
  badJson,
  BAD_JSON,
  created,
  fail,
  fromPostgres,
  invalid,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiRelease, toReleaseInsert } from '@/lib/api/release';
import { createClient } from '@/lib/supabase/server';
import { releaseCreateSchema, releaseQuerySchema } from '@/lib/validation/release';

/**
 * Список релизов.
 *
 * Порядок — по плановой дате: ближайший срок первым. Это тот порядок, в
 * котором релизы читают, а `created_at` отражал бы, в каком порядке их
 * заводили в систему, — сведение бесполезное для того, кто решает, чем
 * заняться сегодня.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = releaseQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return invalid(parsed.error);
  const q = parsed.data;

  let query = supabase.from('releases').select('*', { count: 'exact' });

  if (q.orgId) query = query.eq('org_id', q.orgId);
  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.status) query = query.eq('status', q.status);
  // Поиск по названию, без учёта регистра. Экранируется `%`: иначе
  // запрос `?q=%` означал бы «любой релиз» вместо поиска знака процента.
  if (q.q) query = query.ilike('name', `%${q.q.replace(/[%_]/g, '\\$&')}%`);

  const { data, count, error } = await query
    .order('planned_date', { ascending: true })
    .range(q.offset, q.offset + q.limit - 1);

  if (error) return fromPostgres(error);

  // Общее число — вместе со страницей: без него клиент не нарисует ни
  // навигацию, ни «показано 20 из 74», а отдельный запрос посчитал бы
  // ту же выборку дважды.
  return ok((data ?? []).map(toApiRelease), {
    headers: { 'x-total-count': String(count ?? 0) },
  });
}

/** Создание релиза. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = releaseCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  /*
    Организация берётся из проекта — та же причина, что и у задачи.
    Приняв `orgId` от клиента, мы допустили бы запрос, в котором проект
    лежит в одной организации, а релиз создаётся в другой; выводя её из
    проекта, делаем такое расхождение невыразимым.

    Чужой проект при этом не найдётся: выборка идёт от лица
    пользователя, и RLS отдаёт чужую строку как пустой результат.
  */
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', input.projectId)
    .maybeSingle();

  if (projectError) return fromPostgres(projectError);
  if (!project) return fail(422, 'invalid_reference', 'Проект не найден');

  const { data, error } = await supabase
    .from('releases')
    .insert(toReleaseInsert(input, project.org_id, new Date().toISOString()))
    .select('*')
    .single();

  if (error) return fromPostgres(error);
  return created(toApiRelease(data));
}
