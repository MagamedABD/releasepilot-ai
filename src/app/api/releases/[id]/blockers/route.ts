/**
 * Блокеры и критическая цепочка по одному релизу (FR-18, US-03).
 *
 * Отличие от `/metrics` не в объёме, а в том, что задачи здесь названы:
 * движок оперирует идентификаторами, а экран блокеров по списку UUID
 * нечитаем. Обогащение делает слой представления из того же снимка, из
 * которого посчитаны блокеры, — второго запроса это не требует.
 *
 * Прогноз не считается: ни блокеры, ни длина цепочки от вероятности не
 * зависят.
 */

import { calculateRelease } from '@/domain/risk';
import { fromPostgres, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { toApiBlockersView } from '@/lib/api/insight';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/releases/[id]/blockers'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();

  const { snapshot } = result.context;
  return ok(toApiBlockersView(calculateRelease(snapshot), snapshot));
}
