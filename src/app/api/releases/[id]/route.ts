/**
 * Один релиз: чтение, изменение, удаление.
 *
 * Все обработчики отвечают «не найдено» и на отсутствующий релиз, и на
 * чужой: запрос идёт от лица пользователя, RLS отдаёт чужую строку
 * пустым результатом. Отдельного «нет доступа» нет намеренно — он
 * подтверждал бы, что релиз с таким идентификатором существует.
 */

import {
  badJson,
  BAD_JSON,
  fail,
  fromPostgres,
  invalid,
  isUuid,
  noContent,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiRelease, toReleaseUpdate } from '@/lib/api/release';
import { createClient } from '@/lib/supabase/server';
import { releaseUpdateSchema } from '@/lib/validation/release';

export async function GET(_request: Request, { params }: RouteContext<'/api/releases/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { data, error } = await supabase.from('releases').select('*').eq('id', id).maybeSingle();
  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiRelease(data));
}

/**
 * Частичное изменение.
 *
 * Текущая строка читается перед записью, потому что обе отметки времени
 * ставятся по переходу статуса, а не по самому статусу: чтобы понять,
 * началась ли работа сейчас или идёт с прошлого месяца, нужно прежнее
 * значение. Подробности перехода — в `toReleaseUpdate`.
 */
export async function PATCH(request: Request, { params }: RouteContext<'/api/releases/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = releaseUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data: current, error: readError } = await supabase
    .from('releases')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError) return fromPostgres(readError);
  if (!current) return notFound();

  const patch = toReleaseUpdate(parsed.data, current, new Date().toISOString());

  // Присланное совпало с текущим — писать нечего. Настоящий UPDATE здесь
  // сдвинул бы `updated_at` по запросу, который ничего не изменил.
  if (Object.keys(patch).length === 0) return ok(toApiRelease(current));

  const { data, error } = await supabase
    .from('releases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiRelease(data));
}

/**
 * Удаление — только пустого релиза.
 *
 * В базе у задачи стоит `release_id … on delete set null`: удалив релиз
 * с задачами, мы не удалим задачи, а молча оторвём их от релиза. Для
 * вызывающего это выглядит как успех, а на деле сорок задач теряют
 * принадлежность, и вернуть её нечем — прежнего `release_id` больше
 * никто не знает.
 *
 * Поэтому релиз с задачами не удаляется, а отклоняется с подсказкой.
 * Отменённый релиз — это статус `cancelled`, и он лучше удаления: релиз
 * остаётся в истории, по которой считается аналитика, а решение «мы это
 * не выпустили» само по себе сведение, которое стоит хранить.
 *
 * Пустой релиз удалить можно: за ним ничего не стоит, и заводят такие
 * чаще всего по ошибке — опечатка в названии, дубль.
 */
export async function DELETE(_request: Request, { params }: RouteContext<'/api/releases/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  // Считаем задачи, а не выбираем их: нужно только «есть или нет».
  const { count, error: countError } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('release_id', id);

  if (countError) return fromPostgres(countError);

  if ((count ?? 0) > 0) {
    /*
      Число стоит после слова, а не перед ним, и это не стилистика.
      «В релизе 1 задач» — то, что выходит из подстановки числа в
      готовую фразу, и склонять его здесь пришлось бы так же, как в
      интерфейсе. Но `plural` живёт в слое интерфейса, и тянуть его в
      API значило бы связать формат ответа с оформлением экрана. Порядок
      «задач — 1» верен при любом числе и не требует ни того, ни другого.
    */
    return fail(
      409,
      'not_empty',
      `Релиз не пуст: задач — ${count}. Удаление оторвало бы их от релиза. Перенесите задачи или смените статус релиза на «отменён»`,
    );
  }

  /*
    Идемпотентность: повторный DELETE отвечает так же, как первый.
    Клиент, не получивший ответ из-за обрыва связи, при повторе не должен
    увидеть ошибку там, где всё в порядке.

    Несуществующий и чужой релиз при этом неразличимы, и здесь это выходит
    само: RLS не даст удалить чужой, ответ будет тем же 204.
  */
  const { error } = await supabase.from('releases').delete().eq('id', id);
  if (error) return fromPostgres(error);

  return noContent();
}
