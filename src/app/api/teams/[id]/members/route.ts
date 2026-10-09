import {
  badJson,
  BAD_JSON,
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
import { createClient } from '@/lib/supabase/server';
import { memberDeleteSchema, memberPutSchema } from '@/lib/validation/team';

type Context = RouteContext<'/api/teams/[id]/members'>;

/**
 * Участник команды: добавить или поменять долю (FR-10).
 *
 * PUT, а не POST: пара «команда — человек» уникальна, и повторный вызов с
 * другой долей — это правка, а не вторая запись.
 *
 * Человек обязан состоять в организации команды. Внешний ключ этого не
 * проверяет (он ведёт на профиль, без оглядки на организацию), а без
 * проверки в команду можно было бы добавить постороннего, чей профиль
 * видно по общей организации.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = memberPutSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (teamError) return fromPostgres(teamError);
  if (!team) return notFound();

  const { data: membership } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', team.org_id)
    .eq('user_id', parsed.data.profileId)
    .maybeSingle();
  if (!membership) {
    return fail(422, 'invalid_reference', 'Человек не состоит в организации', {
      profileId: ['Человек не состоит в организации'],
    });
  }

  const { data, error } = await supabase
    .from('team_members')
    .upsert(
      {
        org_id: team.org_id,
        team_id: team.id,
        profile_id: parsed.data.profileId,
        allocation_pct: parsed.data.allocationPct,
      },
      { onConflict: 'team_id,profile_id' },
    )
    .select('team_id, profile_id, allocation_pct')
    .single();

  if (error?.code === '42501') {
    return forbidden('Менять состав команд может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);
  return ok({ teamId: data.team_id, profileId: data.profile_id, allocationPct: data.allocation_pct });
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = memberDeleteSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', id)
    .eq('profile_id', parsed.data.profileId);
  if (error) return fromPostgres(error);
  return noContent();
}
