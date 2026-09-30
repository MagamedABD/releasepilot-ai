/**
 * Сценарии релиза: список и сохранение (FR-35, US-25).
 *
 * Сохранение — первая половина применения. Сценарий сначала считается и
 * записывается вместе с обещанным эффектом, и только потом человек
 * нажимает «Применить» (`POST /api/scenarios/:id/apply`). Так применяется
 * ровно то, что было показано, а не то, что пересчиталось в момент
 * нажатия. Через этот же путь сохраняет сценарии агент (`propose_scenario`):
 * применять он не может, предлагать — может.
 *
 * Эффект считается здесь, на сервере, а не принимается от клиента. Иначе в
 * `result` можно было бы записать любые числа, и кнопка «Применить»
 * показывала бы эффект, которого никто не считал.
 */

import { RISK_CONFIG } from '@/domain/config';
import { simulate } from '@/domain/scenario';
import {
  BAD_JSON,
  badJson,
  created,
  fail,
  forbidden,
  fromPostgres,
  invalid,
  isUuid,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { problemFields, toApiSimulation, toScenarioResult } from '@/lib/api/scenario';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';
import { scenarioCreateSchema } from '@/lib/validation/release';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/releases/[id]/scenarios'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const { data: release, error: releaseError } = await supabase
    .from('releases')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (releaseError) return fromPostgres(releaseError);
  if (!release) return notFound();

  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('release_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return fromPostgres(error);

  return ok(data);
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/releases/[id]/scenarios'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = scenarioCreateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();
  const { snapshot, orgId, completedReleases } = result.context;

  if (input.moveToReleaseId) {
    if (input.moveToReleaseId === id) {
      return fail(422, 'scenario_rejected', 'Сценарий нельзя посчитать честно', {
        moveToReleaseId: ['Задачи переносятся в тот же релиз, из которого уходят'],
      });
    }
    // Та же организация и открытый статус — иначе применение упадёт позже,
    // когда пользователь уже поверит в сохранённый эффект.
    const { data: target, error } = await supabase
      .from('releases')
      .select('id')
      .eq('id', input.moveToReleaseId)
      .eq('org_id', orgId)
      .in('status', ['planned', 'active'])
      .maybeSingle();
    if (error) return fromPostgres(error);
    if (!target) {
      return fail(422, 'scenario_rejected', 'Сценарий нельзя посчитать честно', {
        moveToReleaseId: ['Релиз назначения не найден или уже закрыт'],
      });
    }
  }

  const simulation = simulate(
    snapshot,
    { excludeTaskIds: input.excludeTaskIds, extraCapacity: input.extraCapacity },
    RISK_CONFIG,
    { completedReleases },
  );
  if (simulation.kind === 'rejected') {
    return fail(
      422,
      'scenario_rejected',
      'Сценарий нельзя посчитать честно',
      problemFields(simulation.problems),
    );
  }

  const { data: scenario, error } = await supabase
    .from('scenarios')
    .insert({
      org_id: orgId,
      release_id: id,
      created_by: auth.claims.sub,
      title: input.title,
      payload: {
        excludeTaskIds: input.excludeTaskIds,
        extraCapacity: input.extraCapacity,
        moveToReleaseId: input.moveToReleaseId,
      },
      result: toScenarioResult(simulation),
    })
    .select('*')
    .single();

  // Релиз пользователь видит — значит, отказ политики здесь означает
  // нехватку роли, а не чужие данные, и скрывать его за 404 незачем.
  if (error?.code === '42501') {
    return forbidden('Сохранять сценарии может менеджер, администратор или владелец');
  }
  if (error) return fromPostgres(error);

  return created({ scenario, simulation: toApiSimulation(simulation) });
}
