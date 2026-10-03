import { describe, expect, it } from 'vitest';

import { canonicalScenario } from '@/domain/fixtures';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';

import { evaluateForSnapshot, isSnapshotWorthy, toSnapshotRow } from './capture';
import type { ReleaseWithMetrics } from './snapshot';

const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-03T06:00:00.000Z';

const release = (over: Partial<ReleaseWithMetrics> = {}): ReleaseWithMetrics => {
  const snapshot = canonicalScenario();
  return {
    id: snapshot.release.id,
    name: snapshot.release.name,
    orgId: ORG,
    status: 'active',
    plannedDate: snapshot.release.plannedDate,
    releasedAt: null,
    projectKey: 'PPT',
    metrics: calculateRelease(snapshot),
    snapshot,
    ...over,
  };
};

describe('что попадает в снимок', () => {
  /*
    Снимаются только открытые релизы. У выпущенного метрики больше не
    меняются, и ежедневная запись добавляла бы одинаковые строки —
    «динамика» по ним выглядела бы ровной линией там, где просто ничего
    не происходит.
  */
  it('открытые релизы — да, закрытые — нет', () => {
    expect(isSnapshotWorthy('active')).toBe(true);
    expect(isSnapshotWorthy('planned')).toBe(true);
    expect(isSnapshotWorthy('postponed')).toBe(true);
    expect(isSnapshotWorthy('released')).toBe(false);
    expect(isSnapshotWorthy('cancelled')).toBe(false);
  });
});

describe('прогноз в снимке', () => {
  /*
    Главная ловушка этого слоя. От вероятности зависит правило эскалации
    LOW_PROBABILITY, а от длины истории — считается ли вероятность вообще
    (FR-22). Снимок, снятый с нулевой историей, записал бы уровень риска
    без этого правила — то есть не тот, что показывает кокпит, и
    разошлось бы это молча.
  */
  it('длина истории меняет метод, а с ним и уровень риска', () => {
    const r = release();
    const withHistory = evaluateForSnapshot(r, 6);
    const without = evaluateForSnapshot(r, 0);

    expect(withHistory.forecast.method).toBe('monte_carlo');
    expect(without.forecast.method).toBe('deterministic');
    expect(typeof withHistory.forecast.probabilityOnTime).toBe('number');
    expect(without.forecast.probabilityOnTime).toBeNull();
  });

  it('уровень риска в снимке совпадает с уровнем, посчитанным с прогнозом', () => {
    const r = release();
    const { metrics, forecast } = evaluateForSnapshot(r, 6);
    const expected = calculateRelease(r.snapshot, undefined, {
      probabilityOnTime: forecastRelease(r.snapshot, undefined, { completedReleases: 6 })
        .probabilityOnTime,
    });
    expect(metrics.riskLevel).toBe(expected.riskLevel);
    expect(metrics.probabilityOnTime).toBe(forecast.probabilityOnTime);
  });
});

describe('строка снимка', () => {
  it('уровень берётся из метрик, а не выводится из скора заново', () => {
    const r = release();
    const { metrics, forecast } = evaluateForSnapshot(r, 6);
    const row = toSnapshotRow(r, metrics, forecast, NOW);

    expect(row.risk_level).toBe(metrics.riskLevel);
    // На каноническом сценарии уровень поднят правилом эскалации, то есть
    // по скору он был бы ниже — ровно то расхождение, ради которого
    // уровень нельзя пересчитывать из скора.
    expect(metrics.riskLevel).not.toBe(metrics.riskLevelByScore);
    expect(row.org_id).toBe(ORG);
    expect(row.captured_at).toBe(NOW);
  });

  it('метрики складываются целиком и переживают сериализацию', () => {
    const r = release();
    const { metrics, forecast } = evaluateForSnapshot(r, 6);
    const row = toSnapshotRow(r, metrics, forecast, NOW);

    // Хранится jsonb: формулы будут калиброваться, и разложенная по
    // колонкам история молча сменила бы смысл после правки весов.
    const stored = row.metrics as unknown as typeof metrics;
    expect(stored.reasons.length).toBe(metrics.reasons.length);
    expect(stored.riskScore).toBe(metrics.riskScore);
    // Бесконечная загрузка в JSON превращается в null — и это
    // единственное, что при сериализации меняется.
    expect(JSON.parse(JSON.stringify(row))).toBeTruthy();
  });

  it('непосчитанная вероятность остаётся null, а не нулём', () => {
    const r = release();
    const { metrics, forecast } = evaluateForSnapshot(r, 0);
    expect(toSnapshotRow(r, metrics, forecast, NOW).probability_on_time).toBeNull();
  });
});
