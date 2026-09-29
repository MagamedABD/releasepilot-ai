/**
 * What-if расчёт по релизу (FR-31, FR-33, US-23).
 *
 * POST, хотя ничего не пишет: сценарий — структура со списками, и в строку
 * запроса он не помещается без самодельного формата. Идемпотентность при
 * этом сохранена — тот же сценарий на том же снимке даёт тот же ответ.
 *
 * Роль — любой участник, как и у метрик: симуляция ничего не меняет, а
 * значит, ничего нового о релизе не раскрывает. Применение сценария — другой
 * эндпоинт и другая роль (`POST /api/scenarios/:id/apply`, manager+).
 *
 * Как и остальные маршруты, отвечает «не найдено» и на отсутствующий релиз,
 * и на чужой (ADR-003).
 */

import { RISK_CONFIG } from '@/domain/config';
import { simulate } from '@/domain/scenario';
import {
  BAD_JSON,
  badJson,
  fail,
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
import { createClient } from '@/lib/supabase/server';
import { simulateSchema } from '@/lib/validation/release';

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/releases/[id]/simulate'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = simulateSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);

  // Та же подготовка, что у метрик и прогноза: иначе «до» в симуляции
  // могло бы разойтись с тем, что показывает карточка релиза.
  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();

  const simulation = simulate(result.context.snapshot, parsed.data, RISK_CONFIG, {
    completedReleases: result.context.completedReleases,
  });

  /*
    422 с отдельным кодом, а не общий `validation_failed`: запрос по форме
    верен, отказ — по существу. Агенту это различие нужно, чтобы не
    переспрашивать пользователя о формате, а выбрать другие задачи.
  */
  if (simulation.kind === 'rejected') {
    return fail(
      422,
      'scenario_rejected',
      'Сценарий нельзя посчитать честно',
      problemFields(simulation.problems),
    );
  }

  return ok(toApiSimulation(simulation));
}
