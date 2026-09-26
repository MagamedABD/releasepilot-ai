/**
 * Одна задача: чтение, изменение, удаление.
 *
 * Все три обработчика отвечают «не найдено» и на отсутствующую задачу,
 * и на чужую. Так выходит само собой: запрос идёт от лица пользователя,
 * политика RLS отдаёт чужую строку как пустой результат. Отдельного
 * ответа «нет доступа» здесь нет намеренно — он подтверждал бы, что
 * задача с таким идентификатором существует.
 */

import {
  badJson,
  BAD_JSON,
  fromPostgres,
  invalid,
  isUuid,
  noContent,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiTask, toUpdate } from '@/lib/api/task';
import { createClient } from '@/lib/supabase/server';
import { taskUpdateSchema } from '@/lib/validation/task';

export async function GET(_request: Request, { params }: RouteContext<'/api/tasks/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { data, error } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle();
  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiTask(data));
}

/**
 * Частичное изменение.
 *
 * PATCH, а не PUT: задачу правят по одному-двум полям — сменили статус,
 * подняли приоритет. PUT потребовал бы присылать её целиком, а значит
 * два параллельных редактирования гарантированно затирали бы друг друга.
 */
export async function PATCH(request: Request, { params }: RouteContext<'/api/tasks/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  /*
    Текущая строка читается перед записью, потому что отметки времени
    ставятся по переходу состояния, а не по самому состоянию: чтобы
    понять, началась ли блокировка сейчас или идёт с прошлой недели,
    нужно знать прежнее значение.

    Гонку это оставляет: между чтением и записью строку может изменить
    кто-то ещё. Для отметок она безобидна — худшее следствие в том, что
    возраст блокера не обновится, — а лечится оптимистической
    блокировкой по `updated_at`, и делать её имеет смысл вместе с
    совместным редактированием, а не раньше.
  */
  const { data: current, error: readError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError) return fromPostgres(readError);
  if (!current) return notFound();

  const patch = toUpdate(parsed.data, current, new Date().toISOString());

  // Присланные значения совпали с текущими — писать нечего. Пустой
  // update в PostgREST обновил бы все строки, до которых дотянется.
  if (Object.keys(patch).length === 0) return ok(toApiTask(current));

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiTask(data));
}

/**
 * Удаление.
 *
 * Возвращает 204 и в том случае, когда задача уже удалена: повтор того
 * же DELETE не должен отличаться по результату от первого вызова.
 * Иначе клиент, не получивший ответ из-за обрыва связи, при повторе
 * увидит ошибку там, где всё в порядке.
 *
 * А вот несуществующую и чужую задачу различать нельзя — и здесь это
 * выходит бесплатно: RLS не даст удалить чужую, и ответ будет тем же.
 */
export async function DELETE(_request: Request, { params }: RouteContext<'/api/tasks/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) return fromPostgres(error);

  return noContent();
}
