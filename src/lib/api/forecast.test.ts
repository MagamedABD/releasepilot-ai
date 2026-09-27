import { describe, expect, it } from 'vitest';

import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { capacity, snapshot, task } from '@/domain/fixtures';

import { toApiForecast } from './forecast';

const HISTORY = { completedReleases: RISK_CONFIG.minReleasesForMonteCarlo };

/** Релиз с ёмкостью: 52 часа при 13 часах в день — ровно четыре дня. */
const feasible = () =>
  snapshot({
    capacity: [capacity('team-fe', 100)],
    tasks: [task({ id: 't1', estimateH: 52 })],
  });

/** Работа есть, ёмкости нет: срок недостижим, а не далёк. */
const hopeless = () => snapshot({ capacity: [], tasks: [task({ id: 't1', estimateH: 52 })] });

describe('перевод прогноза в ответ API', () => {
  it('сохраняет вероятность и метод', () => {
    const api = toApiForecast(forecastRelease(feasible(), RISK_CONFIG, HISTORY));

    expect(api.method).toBe('monte_carlo');
    expect(api.probabilityOnTime).toBeGreaterThan(0);
    expect(api.reachable).toBe(true);
    expect(api.expectedWorkingDays).toBeGreaterThan(0);
    expect(api.percentiles).toHaveLength(RISK_CONFIG.forecastPercentiles.length);
  });

  it('у детерминированного метода вероятности нет, и это не потеря данных', () => {
    const api = toApiForecast(forecastRelease(feasible()));

    expect(api.method).toBe('deterministic');
    expect(api.probabilityOnTime).toBeNull();
    expect(api.degraded).toEqual({
      reason: 'insufficient_history',
      completedReleases: 0,
      requiredReleases: RISK_CONFIG.minReleasesForMonteCarlo,
    });
  });
});

/**
 * Причина, по которой этот слой вообще существует.
 *
 * `JSON.stringify(Infinity)` возвращает `null` — молча, без исключения.
 * Отдай движковый прогноз напрямую, и релиз, который не выйдет никогда,
 * выглядел бы в ответе так же, как релиз, для которого поле не посчитали.
 */
describe('бесконечность выражается признаком, а не числом', () => {
  it('недостижимый срок отмечается reachable, а дни становятся null', () => {
    const forecast = forecastRelease(hopeless(), RISK_CONFIG, HISTORY);
    expect(forecast.expectedWorkingDays).toBe(Infinity);

    const api = toApiForecast(forecast);
    expect(api.reachable).toBe(false);
    expect(api.expectedWorkingDays).toBeNull();
    expect(api.expectedDate).toBeNull();
    expect(api.percentiles.every((p) => p.workingDays === null && p.date === null)).toBe(true);
  });

  it('ответ переживает сериализацию без потери смысла', () => {
    const api = toApiForecast(forecastRelease(hopeless(), RISK_CONFIG, HISTORY));
    const revived = JSON.parse(JSON.stringify(api)) as typeof api;

    // Признак проходит через JSON, а бесконечность — нет. Ровно поэтому
    // смысл несёт он, а не число.
    expect(revived).toEqual(api);
    expect(revived.reachable).toBe(false);
  });

  it('у выполнимого релиза все дни — конечные числа', () => {
    const api = toApiForecast(forecastRelease(feasible(), RISK_CONFIG, HISTORY));
    const revived = JSON.parse(JSON.stringify(api)) as typeof api;

    expect(revived).toEqual(api);
    expect(revived.percentiles.every((p) => typeof p.workingDays === 'number')).toBe(true);
  });
});
