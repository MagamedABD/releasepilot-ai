/**
 * Метрики релиза: результат движка ↔ представление в API.
 *
 * Перевод почти тождественный, и это не повод его убрать. Причина та же, что
 * у прогноза: `JSON.stringify(Infinity)` возвращает `null` молча, без
 * исключения, — и без перевода «ёмкости нет вовсе» стало бы в ответе
 * неотличимо от «эту величину не считали». Это противоположные вещи: во
 * втором случае делать нечего, в первом — надо снимать работу или искать
 * людей.
 *
 * Бесконечность приходит из двух мест, и второе я поначалу не заметил:
 *
 *   • `TeamLoad.load` — при нулевой ёмкости и непустом остатке работ;
 *   • `RiskReason.facts` — там лежат те же отношения (`load` у
 *     `TEAM_OVERLOAD`, `demandRatio` у `TIME_DEFICIT`), и они бесконечны
 *     ровно в тех же случаях.
 *
 * Поэтому числа в `facts` просеиваются целиком, по типу значения, а не по
 * списку имён полей. Список пришлось бы пополнять при каждой новой причине,
 * и забытое поле не сломало бы ни один тест: ответ остался бы валидным
 * JSON, просто с `null` вместо величины. Проверка по типу такого долга не
 * создаёт.
 *
 * Наружу при этом идёт не число с особым значением, а признак
 * `hasCapacity` у команды. Клиент по нему рисует «нет ёмкости» вместо
 * «135%», не зная, чем в этой системе принято обозначать бесконечность. У
 * `facts` своего признака нет и не нужно: там есть `teamId`, и
 * окончательный ответ про эту команду лежит в `teamLoad`.
 *
 * Остальные доли бесконечными быть не могут: `qaFunnel.share` зажата в
 * 0..1, `scopeDrift.share` считается от общего объёма, а факторы F1…F6
 * нормированы движком до попадания в скор.
 */

import type { ReleaseMetrics, RiskReason, TeamLoad } from '@/domain/types';

export type ApiTeamLoad = Omit<TeamLoad, 'load'> & {
  /** `null`, если у команды нет ёмкости на остаток работ. */
  load: number | null;
  /**
   * `false` означает, что ёмкости нет вовсе при непустом остатке: не
   * «перегружена», а «работать некому».
   */
  hasCapacity: boolean;
};

export type ApiRiskReason = Omit<RiskReason, 'facts'> & {
  /** `null` у величины, которая не выражается конечным числом. */
  facts: Record<string, number | string | null>;
};

export type ApiReleaseMetrics = Omit<ReleaseMetrics, 'teamLoad' | 'reasons'> & {
  teamLoad: ApiTeamLoad[];
  reasons: ApiRiskReason[];
};

export function toApiTeamLoad(load: TeamLoad): ApiTeamLoad {
  const finite = Number.isFinite(load.load);
  return {
    ...load,
    load: finite ? load.load : null,
    hasCapacity: finite,
  };
}

export function toApiReason(reason: RiskReason): ApiRiskReason {
  const facts: Record<string, number | string | null> = {};
  for (const [key, value] of Object.entries(reason.facts)) {
    facts[key] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  return { ...reason, facts };
}

export function toApiMetrics(metrics: ReleaseMetrics): ApiReleaseMetrics {
  return {
    ...metrics,
    teamLoad: metrics.teamLoad.map(toApiTeamLoad),
    reasons: metrics.reasons.map(toApiReason),
  };
}
