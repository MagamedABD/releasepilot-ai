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

import { fromPostgres, invalid, ok, unauthorized } from '@/lib/api/http';
import { toApiTeam } from '@/lib/api/team';
import { createClient } from '@/lib/supabase/server';
import { teamQuerySchema } from '@/lib/validation/team';

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
