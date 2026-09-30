/**
 * What-if: результат движка ↔ представление в API.
 *
 * Обе стороны сценария проходят те же переводы, что метрики и прогноз
 * карточки релиза. Своего перевода «до» и «после» здесь нет намеренно:
 * иначе бесконечность в загрузке команды превращалась бы в `null` по одним
 * правилам в карточке и по другим в симуляции.
 *
 * Отказы по существу переводятся в текст для человека здесь же. Код
 * отказа остаётся в ответе рядом с текстом: по нему ветвится клиент и
 * агент, а текст показывается пользователю.
 */

import type { ScenarioDelta, ScenarioProblem, ScenarioSide } from '@/domain/scenario';

import { toApiForecast, type ApiForecast } from './forecast';
import { toApiMetrics, type ApiReleaseMetrics } from './metrics';

export type ApiScenarioSide = {
  metrics: ApiReleaseMetrics;
  forecast: ApiForecast;
};

export type ApiSimulation = {
  before: ApiScenarioSide;
  after: ApiScenarioSide;
  delta: ScenarioDelta;
};

/**
 * Итог симуляции для хранения в `scenarios.result`.
 *
 * Хранится сводка, а не весь расчёт. Полный ответ — это две копии метрик с
 * причинами и распределением прогноза, и через месяц он всё равно
 * устареет: формулы калибруются, а сохранённые метрики пересчитывать никто
 * не будет. Сводка же отвечает на единственный вопрос, ради которого её
 * хранят: что обещал этот сценарий в момент, когда его предложили.
 */
export type ScenarioResultSummary = {
  computedAt: string;
  before: SideSummary;
  after: SideSummary;
  delta: ScenarioDelta;
};

type SideSummary = {
  riskScore: number;
  riskLevel: string;
  readinessPct: number;
  probabilityOnTime: number | null;
  expectedDate: string | null;
};

function summarize(side: ScenarioSide): SideSummary {
  return {
    riskScore: side.metrics.riskScore,
    riskLevel: side.metrics.riskLevel,
    readinessPct: side.metrics.readinessPct,
    probabilityOnTime: side.forecast.probabilityOnTime,
    expectedDate: side.forecast.expectedDate,
  };
}

export function toScenarioResult(result: {
  before: ScenarioSide;
  after: ScenarioSide;
  delta: ScenarioDelta;
}): ScenarioResultSummary {
  return {
    computedAt: result.before.metrics.computedAt,
    before: summarize(result.before),
    after: summarize(result.after),
    delta: result.delta,
  };
}

export function toApiSide(side: ScenarioSide): ApiScenarioSide {
  return { metrics: toApiMetrics(side.metrics), forecast: toApiForecast(side.forecast) };
}

export function toApiSimulation(result: {
  before: ScenarioSide;
  after: ScenarioSide;
  delta: ScenarioDelta;
}): ApiSimulation {
  return {
    before: toApiSide(result.before),
    after: toApiSide(result.after),
    delta: result.delta,
  };
}

/**
 * Отказ → поля ошибки в едином формате API (`fields`).
 *
 * Ключи повторяют поля запроса, чтобы форма на клиенте подсветила ровно
 * то, что пользователь ввёл: список задач или список команд.
 */
export function problemFields(problems: ScenarioProblem[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  const add = (key: string, message: string) => (fields[key] ??= []).push(message);

  for (const problem of problems) {
    switch (problem.code) {
      case 'UNKNOWN_TASK':
        add('excludeTaskIds', `Задачи нет в этом релизе: ${problem.taskIds.join(', ')}`);
        break;
      case 'TASK_CLOSED':
        add('excludeTaskIds', `Задача уже закрыта, перенос ничего не даст: ${problem.taskIds.join(', ')}`);
        break;
      case 'BLOCKS_REMAINING':
        add(
          'excludeTaskIds',
          `Задача держит остающиеся в релизе (${problem.blockedTaskIds.join(', ')}); ` +
            `перенесите их вместе или не переносите её: ${problem.taskIds.join(', ')}`,
        );
        break;
      case 'UNKNOWN_TEAM':
        add('extraCapacity', `Команды нет в организации релиза: ${problem.teamIds.join(', ')}`);
        break;
      case 'NO_WINDOW_FOR_CAPACITY':
        add('extraCapacity', 'Плановая дата уже прошла — часы добавить не к чему');
        break;
    }
  }

  return fields;
}
