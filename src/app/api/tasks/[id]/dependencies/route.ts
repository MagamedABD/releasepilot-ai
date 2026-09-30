/**
 * Связи одной задачи: список, добавление, удаление (FR-13, US-08).
 *
 * Ресурс один, а обработчиков три, потому что связями пользуются вместе:
 * в карточке задачи их показывают, добавляют и снимают, и эндпоинт,
 * умеющий только добавлять, оставил бы ошибочную связь навсегда.
 *
 * Запрет циклов живёт в базе (триггер `prevent_dependency_cycle`,
 * миграция 0001), а не здесь, и это не перестраховка. Проверка в
 * приложении читает граф до вставки, и между чтением и вставкой успевает
 * пройти чужая — два одновременных запроса, каждый сам по себе честный,
 * вместе замыкают кольцо. В базе проверка идёт внутри той же транзакции,
 * что и вставка, и разойтись с ней не может.
 *
 * Организация берётся из задачи в адресе — по той же причине, по которой
 * она берётся из проекта при создании задачи: `org_id` из тела запроса
 * позволил бы связать задачи разных организаций и дальше зависеть от
 * того, покрывает ли политика именно эту комбинацию.
 */

import {
  badJson,
  BAD_JSON,
  created,
  fail,
  forbidden,
  fromPostgres,
  invalid,
  isUuid,
  noContent,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiDependency } from '@/lib/api/task';
import { createClient } from '@/lib/supabase/server';
import { dependencyCreateSchema } from '@/lib/validation/task';

type Context = RouteContext<'/api/tasks/[id]/dependencies'>;

/** Задача видна — значит, она своя: выборка идёт от лица пользователя. */
async function loadTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
) {
  return supabase.from('tasks').select('id, org_id').eq('id', id).maybeSingle();
}

/**
 * Связи, в которых задача участвует любой из сторон.
 *
 * Обеими, а не только одной: в карточке нужно и «ждёт», и «держит», а два
 * запроса за этим — способ показать половину связей, забыв второй.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { data: task, error: taskError } = await loadTask(supabase, id);
  if (taskError) return fromPostgres(taskError);
  if (!task) return notFound();

  const { data, error } = await supabase
    .from('task_dependencies')
    .select('*')
    .or(`blocker_task_id.eq.${id},blocked_task_id.eq.${id}`)
    .order('created_at', { ascending: true });
  if (error) return fromPostgres(error);

  return ok(data.map(toApiDependency));
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = dependencyCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { otherTaskId, pathTaskBlocks } = parsed.data;
  if (otherTaskId === id) {
    // В базе это тоже запрещено (`check (blocker_task_id <> blocked_task_id)`),
    // но оттуда вернулся бы отказ проверки без объяснения, какого поля он
    // касается. Ответ на неверно заполненную форму должен называть поле.
    return fail(422, 'validation_failed', 'Проверьте заполнение полей', {
      [pathTaskBlocks ? 'blocksTaskId' : 'blockedByTaskId']: [
        'Задача не может зависеть от себя',
      ],
    });
  }

  const { data: task, error: taskError } = await loadTask(supabase, id);
  if (taskError) return fromPostgres(taskError);
  if (!task) return notFound();

  /*
    Вторая задача проверяется отдельно, и проверок две, а не одна.

    Видимость даёт RLS: чужую задачу выборка вернёт пустым результатом.
    Но пользователь может состоять в двух организациях, и тогда обе
    задачи видны, а связь между ними бессмысленна — у зависимости одна
    колонка `org_id`, и какую из двух в неё ни записать, ответ будет
    неверным. Внешние ключи этого не ловят: они ведут на `tasks(id)`,
    без оглядки на организацию.
  */
  const { data: otherTask, error: otherError } = await loadTask(supabase, otherTaskId);
  if (otherError) return fromPostgres(otherError);
  if (!otherTask || otherTask.org_id !== task.org_id) {
    return fail(422, 'invalid_reference', 'Связанная задача не найдена');
  }

  const { data, error } = await supabase
    .from('task_dependencies')
    .insert({
      org_id: task.org_id,
      blocker_task_id: pathTaskBlocks ? id : otherTaskId,
      blocked_task_id: pathTaskBlocks ? otherTaskId : id,
      type: parsed.data.type,
    })
    .select('*')
    .single();

  if (error?.code === '23505') {
    return fail(409, 'conflict', 'Такая связь между задачами уже есть');
  }
  /*
    23514 здесь означает цикл.

    Формально этот код отдают две проверки: запрет самоблокировки и
    триггер циклов. Первая до базы не доходит — её отклоняет схема выше,
    с указанием поля, — поэтому на этом маршруте остаётся вторая.

    Ответ 409, а не 422: с формой запроса всё в порядке, и другого способа
    заполнить его правильно нет. Мешает состояние графа, а не поле.
  */
  if (error?.code === '23514') {
    return fail(
      409,
      'conflict',
      'Связь замкнула бы цикл: связанная задача уже ждёт эту, напрямую или через другие',
    );
  }
  // Задачу пользователь видит — значит, отказ политики означает нехватку
  // роли, а не чужие данные, и скрывать его за 404 незачем.
  if (error?.code === '42501') {
    return forbidden('Менять связи задач может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);

  return created(toApiDependency(data));
}

/**
 * Снятие связи.
 *
 * Пара задаётся так же, как при добавлении, но в адресе: у связи есть
 * собственный идентификатор, однако клиент его не хранит — он знает две
 * задачи, между которыми связь видит. Пара уникальна (ограничение в
 * миграции 0001), так что этого достаточно.
 *
 * 204 и тогда, когда связи уже нет: повтор того же DELETE не должен
 * отличаться по результату от первого вызова.
 */
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = dependencyCreateSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);
  const { otherTaskId, pathTaskBlocks } = parsed.data;

  // Тип связи в условие не входит: пара задач уникальна независимо от
  // него, и требовать угадать тип, чтобы снять связь, значило бы
  // оставлять её висеть при расхождении.
  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('blocker_task_id', pathTaskBlocks ? id : otherTaskId)
    .eq('blocked_task_id', pathTaskBlocks ? otherTaskId : id);

  if (error) return fromPostgres(error);
  return noContent();
}
