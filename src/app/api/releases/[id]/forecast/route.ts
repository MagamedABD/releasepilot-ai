/**
 * Прогноз даты выпуска одного релиза (FR-21…FR-23, US-16, US-17).
 *
 * Обработчик тонкий по устройству: собрать снимок, узнать длину истории,
 * позвать движок. Ни одной формулы здесь нет и быть не должно — расчёт живёт
 * в `src/domain/forecast.ts` и проверяется без базы, сети и сессии.
 *
 * Как и остальные маршруты, отвечает «не найдено» и на отсутствующий релиз,
 * и на чужой: запрос идёт от лица пользователя, и RLS отдаёт чужую строку
 * пустым результатом (ADR-003).
 */

import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { toApiForecast } from '@/lib/api/forecast';
import { fromPostgres, invalid, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';
import { forecastQuerySchema } from '@/lib/validation/release';

export async function GET(
  request: Request,
  { params }: RouteContext<'/api/releases/[id]/forecast'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = forecastQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);

  // Снимок и длина истории — общая подготовка расчётных эндпоинтов, и
  // правило «что считать историей» живёт там же, в одном месте на всех.
  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();

  const forecast = forecastRelease(result.context.snapshot, RISK_CONFIG, {
    targetDate: parsed.data.targetDate,
    completedReleases: result.context.completedReleases,
  });

  return ok(toApiForecast(forecast));
}
