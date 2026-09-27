/**
 * Один проект: чтение, изменение, удаление.
 *
 * «Не найдено» и на отсутствующий проект, и на чужой — по той же
 * причине, что и везде: RLS отдаёт чужую строку пустым результатом, а
 * отдельный ответ «нет доступа» подтверждал бы существование записи.
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
import { toApiProject, toProjectUpdate } from '@/lib/api/project';
import { createClient } from '@/lib/supabase/server';
import { projectUpdateSchema } from '@/lib/validation/release';

export async function GET(_request: Request, { params }: RouteContext<'/api/projects/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiProject(data));
}

/**
 * Частичное изменение.
 *
 * Организация не меняется: переноса проекта между организациями в схеме
 * нет, и появись он — это была бы отдельная операция с переносом всех
 * задач и релизов, а не правка одного поля. Молча сменить `org_id`
 * значило бы оставить задачи в прежней организации, то есть развалить
 * проект надвое.
 */
export async function PATCH(request: Request, { params }: RouteContext<'/api/projects/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = projectUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data: current, error: readError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError) return fromPostgres(readError);
  if (!current) return notFound();

  const patch = toProjectUpdate(parsed.data, current);
  if (Object.keys(patch).length === 0) return ok(toApiProject(current));

  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return fromPostgres(error);
  if (!data) return notFound();

  return ok(toApiProject(data));
}

/**
 * Удаление — только пустого проекта.
 *
 * Здесь запрет строже, чем у релиза, и по более серьёзной причине. У
 * релиза удаление оторвало бы задачи (`on delete set null`), у проекта —
 * удалит: и релизы, и задачи стоят на `on delete cascade`. То есть
 * удаление одной записи бесшумно уносит всю историю поставки: снимки,
 * зависимости, оценки, по которым считается аналитика.
 *
 * Отказ предупреждает о том, чего вызывающий не видит: в ответе на
 * DELETE одного проекта никак не следует, что вместе с ним исчезнут
 * четыре релиза и триста задач.
 *
 * Пустой проект удалить можно — за ним ничего не стоит, и заводят такие
 * обычно по ошибке в ключе.
 */
export async function DELETE(_request: Request, { params }: RouteContext<'/api/projects/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  // Два счётчика разом: релизы и задачи независимы, и последовательные
  // запросы здесь только удвоили бы задержку. Нужно лишь «есть или нет»,
  // поэтому head-запрос без данных.
  const [releases, tasks] = await Promise.all([
    supabase.from('releases').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', id),
  ]);

  if (releases.error) return fromPostgres(releases.error);
  if (tasks.error) return fromPostgres(tasks.error);

  const releaseCount = releases.count ?? 0;
  const taskCount = tasks.count ?? 0;

  if (releaseCount > 0 || taskCount > 0) {
    // Числа после слов — по той же причине, что и у релиза: иначе фраза
    // требует склонения, а склонение живёт в слое интерфейса.
    return fail(
      409,
      'not_empty',
      `Проект не пуст: релизов — ${releaseCount}, задач — ${taskCount}. Удаление проекта удалит и их. Удалите содержимое явно, если это действительно нужно`,
    );
  }

  // Идемпотентно: повторный DELETE отвечает так же, как первый.
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) return fromPostgres(error);

  return noContent();
}
