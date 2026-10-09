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
import { toApiTeam } from '@/lib/api/team';
import { createClient } from '@/lib/supabase/server';
import { teamUpdateSchema } from '@/lib/validation/team';

type Context = RouteContext<'/api/teams/[id]'>;

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = teamUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data, error } = await supabase
    .from('teams')
    .update(parsed.data)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error?.code === '23505') {
    return fail(409, 'conflict', 'Команда с таким названием уже есть', {
      name: ['Команда с таким названием уже есть'],
    });
  }
  if (error) return fromPostgres(error);
  // Пусто — либо команды нет, либо RLS не дал её изменить. Для
  // вызывающего это одно и то же: по этому адресу ему править нечего.
  if (!data) return notFound();
  return ok(toApiTeam(data));
}

/**
 * Удаление команды.
 *
 * Ёмкость и состав уходят каскадом, а задачи остаются — без команды
 * (`on delete set null`). Это осознанно мягче, чем у релиза: задача без
 * команды — понятное и видимое состояние («без команды» в списке), а
 * задача без релиза выпала бы из всех расчётов молча.
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) return fromPostgres(error);
  return noContent();
}
