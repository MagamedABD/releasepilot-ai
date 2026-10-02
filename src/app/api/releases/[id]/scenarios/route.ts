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
import { problemFields, toApiSimulation } from '@/lib/api/scenario';
import { loadReleaseContext } from '@/lib/data/context';
import { saveScenario } from '@/lib/data/scenario';
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

  /*
    Сохранение — в слое данных, потому что сценарии сохраняет не только
    человек: агент делает то же самое инструментом `propose_scenario`.
    Порядок действий у них обязан быть один, и самое важное в нём —
    что эффект считается на сервере из снимка. Будь это написано
    дважды, агенту достаточно было бы прислать `result` самому, и кнопка
    «Применить» показывала бы эффект, которого никто не считал.
  */
  const saved = await saveScenario(supabase, id, result.context, auth.claims.sub as string, {
    title: input.title,
    excludeTaskIds: input.excludeTaskIds,
    extraCapacity: input.extraCapacity,
    moveToReleaseId: input.moveToReleaseId,
  });

  switch (saved.kind) {
    case 'bad_target':
      return fail(422, 'scenario_rejected', 'Сценарий нельзя посчитать честно', {
        moveToReleaseId: [saved.message],
      });
    case 'rejected':
      return fail(
        422,
        'scenario_rejected',
        'Сценарий нельзя посчитать честно',
        problemFields(saved.problems),
      );
    case 'forbidden':
      return forbidden('Сохранять сценарии может менеджер, администратор или владелец');
    case 'error':
      return fromPostgres(saved.error);
    case 'ok':
      return created({
        scenario: saved.scenario,
        simulation: toApiSimulation(saved),
      });
  }
}
