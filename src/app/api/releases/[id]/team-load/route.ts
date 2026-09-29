/**
 * Загрузка команд по одному релизу (FR-18, US-04).
 *
 * Те же числа, что и в `/metrics`, но без остального: экрану загрузки не
 * нужны ни причины, ни блокеры, ни факторы. Прогноз здесь не считается —
 * на загрузку команд вероятность не влияет, и платить за 5000 итераций
 * незачем.
 *
 * Отвечает «не найдено» и на отсутствующий релиз, и на чужой: RLS отдаёт
 * чужую строку пустым результатом (ADR-003).
 */

import { calculateRelease } from '@/domain/risk';
import { fromPostgres, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { toApiTeamLoadView } from '@/lib/api/insight';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/releases/[id]/team-load'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();

  return ok(toApiTeamLoadView(calculateRelease(result.context.snapshot)));
}
