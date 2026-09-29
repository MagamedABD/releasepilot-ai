/**
 * What-if симуляция (FR-31, FR-33, US-23).
 *
 * Сценарий не пишет в базу и не знает о ней: он накладывается на снимок, и
 * по двум снимкам — исходному и изменённому — движок считает метрики и
 * прогноз ровно так же, как для карточки релиза. Своих формул здесь нет:
 * будь они, «после» считалось бы иначе, чем «до», и дельта мерила бы
 * разницу между двумя расчётами, а не эффект сценария.
 *
 * Разность тоже считается здесь, а не у клиента и не у модели. Агенту
 * запрещено вычислять (docs/07-api-and-agent.md, принцип 1): «риск снизится
 * на 12 пунктов» он обязан взять из ответа, а не получить вычитанием.
 */

import { RISK_CONFIG, type RiskConfig } from './config';
import { addDays, remainingWorkingDays, startOfDay, toIsoDate } from './calendar';
import { forecastRelease } from './forecast';
import { isOpen } from './metrics';
import { calculateRelease } from './risk';
import type {
  IsoDate,
  ReleaseForecast,
  ReleaseMetrics,
  ReleaseSnapshot,
  RiskLevel,
} from './types';

export type Scenario = {
  /** Задачи, которые уходят из релиза (перенос или исключение — для расчёта одно и то же). */
  excludeTaskIds: string[];
  /**
   * Дополнительные часы команде до плановой даты. Номинальные, как и вся
   * ёмкость в базе: фокус-фактор к ним применит движок. Иначе 40 часов
   * «сверху» оказались бы полезнее 40 часов своей команды.
   */
  extraCapacity: { teamId: string; hours: number }[];
};

/**
 * Почему сценарий нельзя посчитать. Это не ошибки ввода, а отказы по
 * существу: запрос синтаксически верен, но ответ на него был бы неправдой.
 */
export type ScenarioProblem =
  | { code: 'UNKNOWN_TASK'; taskIds: string[] }
  | { code: 'TASK_CLOSED'; taskIds: string[] }
  /**
   * FR-33. Задача держит другие, остающиеся в релизе. Исключить её из
   * расчёта можно, но результат был бы ложью: вместе с задачей пропала бы и
   * связь, и зависимые задачи выглядели бы свободными, хотя ждать им
   * теперь нечего — блокер ушёл в другой релиз.
   */
  | { code: 'BLOCKS_REMAINING'; taskIds: string[]; blockedTaskIds: string[] }
  | { code: 'UNKNOWN_TEAM'; teamIds: string[] }
  /**
   * Плановая дата прошла — окна для дополнительных часов нет. Растянуть
   * их на один завтрашний день значило бы получить команду, которая за
   * сутки делает недельную работу.
   */
  | { code: 'NO_WINDOW_FOR_CAPACITY' };

export type ScenarioSide = {
  metrics: ReleaseMetrics;
  forecast: ReleaseForecast;
};

export type ScenarioDelta = {
  /** Отрицательное значение — риск снизился. */
  riskScore: number;
  riskLevel: { from: RiskLevel; to: RiskLevel };
  /** `null`, если вероятность не считалась хотя бы с одной стороны. */
  probabilityOnTime: number | null;
  /** `null`, если хотя бы одна из дат недостижима. */
  expectedWorkingDays: number | null;
  remainingH: number;
  criticalChainDays: number;
  readinessPct: number;
};

export type SimulationResult =
  | { kind: 'ok'; before: ScenarioSide; after: ScenarioSide; delta: ScenarioDelta }
  | { kind: 'rejected'; problems: ScenarioProblem[] };

export type SimulateOptions = {
  completedReleases?: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Проверка сценария против снимка. Пустой список — сценарий исполним. */
export function validateScenario(
  snapshot: ReleaseSnapshot,
  scenario: Scenario,
): ScenarioProblem[] {
  const problems: ScenarioProblem[] = [];
  const tasks = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const excluded = new Set(scenario.excludeTaskIds);

  const unknown = [...excluded].filter((id) => !tasks.has(id));
  if (unknown.length) problems.push({ code: 'UNKNOWN_TASK', taskIds: unknown });

  // Закрытая задача уже не тратит ничьё время; «перенести» её — значит
  // вычесть сделанную работу из готовности и назвать это улучшением.
  const closed = [...excluded].filter((id) => {
    const task = tasks.get(id);
    return task !== undefined && !isOpen(task);
  });
  if (closed.length) problems.push({ code: 'TASK_CLOSED', taskIds: closed });

  const holders = new Set<string>();
  const held = new Set<string>();
  for (const dep of snapshot.dependencies) {
    if (dep.type !== 'blocks') continue;
    if (!excluded.has(dep.blockerTaskId) || excluded.has(dep.blockedTaskId)) continue;
    const blocked = tasks.get(dep.blockedTaskId);
    if (!blocked || !isOpen(blocked)) continue;
    holders.add(dep.blockerTaskId);
    held.add(dep.blockedTaskId);
  }
  if (holders.size) {
    problems.push({
      code: 'BLOCKS_REMAINING',
      taskIds: [...holders],
      blockedTaskIds: [...held],
    });
  }

  const teams = new Set(snapshot.teams.map((t) => t.id));
  const unknownTeams = scenario.extraCapacity
    .map((c) => c.teamId)
    .filter((id) => !teams.has(id));
  if (unknownTeams.length) problems.push({ code: 'UNKNOWN_TEAM', teamIds: unknownTeams });

  const holidays = new Set<IsoDate>(snapshot.calendar.holidays);
  const window = remainingWorkingDays(snapshot.now, snapshot.release.plannedDate, holidays);
  if (scenario.extraCapacity.some((c) => c.hours > 0) && window === 0) {
    problems.push({ code: 'NO_WINDOW_FOR_CAPACITY' });
  }

  return problems;
}

/**
 * Наложить сценарий на снимок. Исходный снимок не меняется.
 *
 * Дополнительные часы оформляются записью ёмкости на окно «завтра —
 * плановая дата», то есть ровно на тот интервал, который движок и так
 * считает оставшимся. Поэтому и риск, и прогноз видят их без единой правки
 * в своих формулах.
 */
export function applyScenario(snapshot: ReleaseSnapshot, scenario: Scenario): ReleaseSnapshot {
  const excluded = new Set(scenario.excludeTaskIds);
  const windowStart = toIsoDate(addDays(startOfDay(snapshot.now), 1));

  return {
    ...snapshot,
    tasks: snapshot.tasks.filter((t) => !excluded.has(t.id)),
    dependencies: snapshot.dependencies.filter(
      (d) => !excluded.has(d.blockerTaskId) && !excluded.has(d.blockedTaskId),
    ),
    capacity: [
      ...snapshot.capacity,
      ...scenario.extraCapacity
        .filter((c) => c.hours > 0)
        .map((c) => ({
          teamId: c.teamId,
          periodStart: windowStart,
          periodEnd: snapshot.release.plannedDate,
          availableHours: c.hours,
        })),
    ],
  };
}

function evaluate(
  snapshot: ReleaseSnapshot,
  config: RiskConfig,
  options: SimulateOptions,
): ScenarioSide {
  // Зерно выводится из идентификатора релиза, он у обеих сторон один.
  // Значит, «до» и «после» проходят одни и те же случайные числа, и дельта
  // вероятности — эффект сценария, а не шум двух независимых прогонов.
  const forecast = forecastRelease(snapshot, config, {
    completedReleases: options.completedReleases,
  });
  const metrics = calculateRelease(snapshot, config, {
    probabilityOnTime: forecast.probabilityOnTime,
  });
  return { metrics, forecast };
}

function diff(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null;
  if (!Number.isFinite(after) || !Number.isFinite(before)) return null;
  return round(after - before);
}

export function simulate(
  snapshot: ReleaseSnapshot,
  scenario: Scenario,
  config: RiskConfig = RISK_CONFIG,
  options: SimulateOptions = {},
): SimulationResult {
  const problems = validateScenario(snapshot, scenario);
  if (problems.length) return { kind: 'rejected', problems };

  const before = evaluate(snapshot, config, options);
  const after = evaluate(applyScenario(snapshot, scenario), config, options);

  return {
    kind: 'ok',
    before,
    after,
    delta: {
      riskScore: round(after.metrics.riskScore - before.metrics.riskScore),
      riskLevel: { from: before.metrics.riskLevel, to: after.metrics.riskLevel },
      probabilityOnTime: diff(
        after.forecast.probabilityOnTime,
        before.forecast.probabilityOnTime,
      ),
      expectedWorkingDays: diff(
        after.forecast.expectedWorkingDays,
        before.forecast.expectedWorkingDays,
      ),
      remainingH: round(after.metrics.effort.remainingH - before.metrics.effort.remainingH),
      criticalChainDays: round(
        after.metrics.criticalChain.days - before.metrics.criticalChain.days,
      ),
      readinessPct: round(after.metrics.readinessPct - before.metrics.readinessPct),
    },
  };
}
