/**
 * Ёмкость команды на периоды (FR-17, US-04, ADR-001 §F2).
 *
 * Ёмкость — знаменатель загрузки, и от неё зависит, найдётся ли перегруз
 * вообще. Поэтому запись здесь адресная и заменяющая, а не добавляющая:
 * повторный PUT с теми же границами приводит к тому же состоянию.
 * Складывает часы только применение сценария — «дать ещё 40 часов» и
 * «у команды 40 часов» разные события, и путать их нельзя.
 *
 * Периоды намеренно произвольны и могут пересекаться: движок берёт из
 * каждой записи долю, пропорциональную пересечению с окном релиза
 * (`teamCapacityHours`). Требовать «ровно один период на релиз» значило бы
 * заставить менеджера переписывать квартальный план под каждую дату.
 */

import {
  badJson,
  BAD_JSON,
  forbidden,
  fromPostgres,
  invalid,
  isUuid,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { toApiCapacity, toCapacityInsert } from '@/lib/api/team';
import { createClient } from '@/lib/supabase/server';
import { capacityPutSchema, capacityQuerySchema } from '@/lib/validation/team';

type Context = RouteContext<'/api/teams/[id]/capacity'>;

/** Команда видна — значит, она своя: выборка идёт от лица пользователя. */
async function loadTeam(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  return supabase.from('teams').select('id, org_id').eq('id', id).maybeSingle();
}

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = capacityQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);
  const { from, to } = parsed.data;

  const { data: team, error: teamError } = await loadTeam(supabase, id);
  if (teamError) return fromPostgres(teamError);
  if (!team) return notFound();

  /*
    Рамки отбирают пересекающиеся записи, а не вложенные.

    Запись «1–30 сентября» отвечает на вопрос про 10–15 сентября, хотя ни
    одна её граница в этот отрезок не попадает, — и именно из неё расчёт
    берёт часы. Условие на вложение отсеяло бы ровно ту запись, которая
    объясняет загрузку, и экран показал бы «ёмкость не задана» там, где
    она задана шире спрошенного.
  */
  let query = supabase
    .from('team_capacity')
    .select('*')
    .eq('team_id', id)
    .order('period_start', { ascending: false });
  if (from) query = query.gte('period_end', from);
  if (to) query = query.lte('period_start', to);

  const { data, error } = await query;
  if (error) return fromPostgres(error);

  return ok(data.map(toApiCapacity));
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = capacityPutSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  // Организация берётся из команды, а не из тела: иначе появился бы
  // запрос, в котором команда принадлежит одной организации, а запись о
  // её ёмкости создаётся в другой.
  const { data: team, error: teamError } = await loadTeam(supabase, id);
  if (teamError) return fromPostgres(teamError);
  if (!team) return notFound();

  const { data, error } = await supabase
    .from('team_capacity')
    .upsert(toCapacityInsert(parsed.data, team.id, team.org_id), {
      onConflict: 'team_id,period_start,period_end',
    })
    .select('*')
    .single();

  // Команду пользователь видит — значит, отказ политики означает нехватку
  // роли, а не чужие данные, и скрывать его за 404 незачем.
  if (error?.code === '42501') {
    return forbidden('Задавать ёмкость может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);

  return ok(toApiCapacity(data));
}
