/**
 * Коллекция проектов: выборка и создание.
 *
 * Проект — единственная запись, у которой организацию присылает клиент.
 * У задачи и релиза есть родитель, из которого её видно; у проекта
 * родителя нет. Безопасно это ровно потому, что проверяет организацию не
 * этот код: политика RLS требует `is_org_member(org_id)`, и вставка в
 * чужую организацию не проходит на уровне базы. Ответ при отказе — «не
 * найдено», а не «запрещено»: см. `fromPostgres`.
 */

import {
  badJson,
  BAD_JSON,
  created,
  fromPostgres,
  invalid,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiProject, toProjectInsert } from '@/lib/api/project';
import { createClient } from '@/lib/supabase/server';
import { projectCreateSchema, projectQuerySchema } from '@/lib/validation/release';

/** Список проектов. Порядок — по ключу: он короткий, и по нему их зовут. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = projectQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return invalid(parsed.error);
  const q = parsed.data;

  let query = supabase.from('projects').select('*', { count: 'exact' });

  if (q.orgId) query = query.eq('org_id', q.orgId);
  // Ищем и по названию, и по ключу: «PAY» пользователь набирает так же
  // охотно, как «Платежи», и ответ «ничего не найдено» на верный ключ
  // выглядел бы поломкой.
  if (q.q) {
    const term = q.q.replace(/[%_]/g, '\\$&');
    query = query.or(`name.ilike.%${term}%,key.ilike.%${term}%`);
  }

  const { data, count, error } = await query
    .order('key', { ascending: true })
    .range(q.offset, q.offset + q.limit - 1);

  if (error) return fromPostgres(error);

  return ok((data ?? []).map(toApiProject), {
    headers: { 'x-total-count': String(count ?? 0) },
  });
}

/**
 * Создание проекта.
 *
 * Ключ уникален внутри организации (`unique (org_id, key)`), и повтор
 * отдаётся как 409 — это делает `fromPostgres` по коду 23505. Проверять
 * занятость ключа заранее отдельным запросом было бы и лишним, и
 * неверным: между проверкой и вставкой ключ может занять кто-то ещё, и
 * настоящей защитой всё равно остаётся ограничение в базе.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data, error } = await supabase
    .from('projects')
    .insert(toProjectInsert(parsed.data))
    .select('*')
    .single();

  if (error) return fromPostgres(error);
  return created(toApiProject(data));
}
