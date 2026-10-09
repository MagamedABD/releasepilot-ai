import {
  badJson,
  BAD_JSON,
  created,
  fail,
  forbidden,
  fromPostgres,
  invalid,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { createClient } from '@/lib/supabase/server';
import { absenceCreateSchema } from '@/lib/validation/team';

/**
 * Отсутствие участника (FR-11): отпуск, больничный, конференция.
 *
 * Из ёмкости оно вычитается при расчёте (`domain/capacity`), а не здесь:
 * запись хранит факт, а сколько часов он снимает, зависит от состава
 * команд и доли каждого — и меняется вместе с ними.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = absenceCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  // Та же проверка, что у состава команды: внешний ключ ведёт на профиль
  // и не знает про организацию.
  const { data: membership } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', input.orgId)
    .eq('user_id', input.profileId)
    .maybeSingle();
  if (!membership) {
    return fail(422, 'invalid_reference', 'Человек не состоит в организации', {
      profileId: ['Человек не состоит в организации'],
    });
  }

  const { data, error } = await supabase
    .from('absences')
    .insert({
      org_id: input.orgId,
      profile_id: input.profileId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason ?? null,
    })
    .select('id, profile_id, start_date, end_date, reason')
    .single();

  if (error?.code === '42501') {
    return forbidden('Отмечать отсутствия может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);
  return created({
    id: data.id,
    profileId: data.profile_id,
    startDate: data.start_date,
    endDate: data.end_date,
    reason: data.reason,
  });
}
