/**
 * Прогноз: результат движка ↔ представление в API.
 *
 * Слой здесь не ради симметрии с релизом и задачей — у прогноза есть своя
 * причина, и она в JSON. Движок отдаёт `Infinity`, когда работа неисполнима:
 * у команды нет ёмкости, и дата готовности не «далёкая», а несуществующая.
 * `JSON.stringify(Infinity)` возвращает `null`, молча и без ошибки. То есть
 * без этого перевода API отдал бы `"expectedWorkingDays": null` и клиент не
 * смог бы отличить «недостижимо» от «не посчитали» — а это ровно тот случай,
 * который важнее всех остальных: релиз, который не выйдет никогда.
 *
 * Поэтому наружу идёт не число с особым значением, а признак `reachable`.
 * Флаг избыточен ровно настолько, насколько нужен: по нему клиент ветвится
 * без знания о том, как в этой системе принято обозначать бесконечность.
 */

import type { ReleaseForecast } from '@/domain/types';

export type ApiForecastPoint = {
  probability: number;
  /** `null`, если при текущей ёмкости срок недостижим. */
  workingDays: number | null;
  date: string | null;
};

export type ApiForecast = {
  releaseId: string;
  computedAt: string;
  method: ReleaseForecast['method'];
  targetDate: string;
  targetWorkingDays: number;
  /** `null` у детерминированного метода — он даёт дату, а не распределение. */
  probabilityOnTime: number | null;
  /**
   * Достижима ли дата готовности хоть когда-нибудь. `false` означает, что у
   * команд нет ёмкости на остаток работ: не «очень поздно», а «никогда».
   */
  reachable: boolean;
  expectedDate: string | null;
  expectedWorkingDays: number | null;
  percentiles: ApiForecastPoint[];
  iterations: number;
  pessimismFactor: number;
  degraded: ReleaseForecast['degraded'];
};

/** Число для JSON: бесконечность — это `null`, и сказано это явно. */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function toApiForecast(forecast: ReleaseForecast): ApiForecast {
  return {
    releaseId: forecast.releaseId,
    computedAt: forecast.computedAt,
    method: forecast.method,
    targetDate: forecast.targetDate,
    targetWorkingDays: forecast.targetWorkingDays,
    probabilityOnTime: forecast.probabilityOnTime,
    reachable: Number.isFinite(forecast.expectedWorkingDays),
    expectedDate: forecast.expectedDate,
    expectedWorkingDays: finiteOrNull(forecast.expectedWorkingDays),
    percentiles: forecast.percentiles.map((p) => ({
      probability: p.probability,
      workingDays: finiteOrNull(p.workingDays),
      date: p.date,
    })),
    iterations: forecast.iterations,
    pessimismFactor: forecast.pessimismFactor,
    degraded: forecast.degraded,
  };
}
