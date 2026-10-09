/**
 * Команды организации (FR-17, US-04).
 *
 * Только чтение. Команды и их состав заводятся при настройке организации
 * и меняются редко, а экран загрузки читает их постоянно — поэтому
 * эндпоинт есть, а создания и переименования здесь нет: понадобятся они
 * вместе с экраном настроек, и делать их раньше значит угадывать форму
 * запроса по несуществующей форме ввода.
 *
 * По организации не фильтруется ради доступа: доступ держит RLS, клиент
 * ходит от лица пользователя. Параметр `orgId` — сужение выборки.
 */

import {
  badJson,
  BAD_JSON,
  created,
  fail,
  forbidden,
  fromPostgres,
  invalid,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiTeam } from '@/lib/api/team';
import { createClient } from '@/lib/supabase/server';
import { teamCreateSchema, teamQuerySchema } from '@/lib/validation/team';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = teamQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);
  const { orgId, kind } = parsed.data;

  let query = supabase.from('teams').select('*').order('name');
  if (orgId) query = query.eq('org_id', orgId);
  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) return fromPostgres(error);

  return ok(data.map(toApiTeam));
}

/** Создание команды (FR-10). Права — manager и выше, их проверяет RLS. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = teamCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data, error } = await supabase
    .from('teams')
    .insert({ org_id: parsed.data.orgId, name: parsed.data.name, kind: parsed.data.kind })
    .select('*')
    .single();

  if (error?.code === '23505') {
    return invalid409('Команда с таким названием уже есть');
  }
  if (error?.code === '42501') {
    return forbidden('Создавать команды может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);
  return created(toApiTeam(data));
}

function invalid409(message: string) {
  return fail(409, 'conflict', message, { name: [message] });
}
