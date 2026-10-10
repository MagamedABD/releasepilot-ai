/**
 * Прошлый уровень риска — для уведомления в интерфейсе (FR-44).
 *
 * «Прошлый» — последний снимок до начала сегодняшнего дня. Сегодняшний не
 * годится: он записан утром по тем же данным, и сравнение с ним сказало
 * бы «не вырос» про то, что выросло вчера вечером и уже попало в снимок.
 */

import type { RiskLevel } from '@/domain/types';
import type { createClient } from '@/lib/supabase/server';

type Client = Awaited<ReturnType<typeof createClient>>;

export type PreviousRisk = { level: RiskLevel; score: number; capturedAt: string };

function startOfToday(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** По одному релизу. */
export async function loadPreviousRisk(
  supabase: Client,
  releaseId: string,
  now: Date = new Date(),
): Promise<PreviousRisk | null> {
  const { data } = await supabase
    .from('release_snapshots')
    .select('risk_level, risk_score, captured_at')
    .eq('release_id', releaseId)
    .lt('captured_at', startOfToday(now))
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data
    ? { level: data.risk_level, score: Number(data.risk_score), capturedAt: data.captured_at }
    : null;
}

/** По всем релизам организации одним запросом — для списка. */
export async function loadPreviousRiskByRelease(
  supabase: Client,
  orgId: string,
  now: Date = new Date(),
): Promise<Map<string, PreviousRisk>> {
  const { data } = await supabase
    .from('release_snapshots')
    .select('release_id, risk_level, risk_score, captured_at')
    .eq('org_id', orgId)
    .lt('captured_at', startOfToday(now))
    .order('captured_at', { ascending: false })
    .limit(500);

  const result = new Map<string, PreviousRisk>();
  for (const row of data ?? []) {
    if (result.has(row.release_id)) continue;
    result.set(row.release_id, {
      level: row.risk_level,
      score: Number(row.risk_score),
      capturedAt: row.captured_at,
    });
  }
  return result;
}
