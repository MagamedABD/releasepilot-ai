/**
 * Прогноз даты выпуска (ADR-001 §6, FR-21…FR-23).
 *
 * Зачем вообще вероятность. Оценка трудозатрат — не факт, а предположение,
 * и любая единственная дата выпуска врёт с неизвестной величиной. «Успеем»
 * и «не успеем» — ответы, за которые нельзя отвечать; «успеем с
 * вероятностью 62%» — ответ, по которому можно принять решение о переносе.
 *
 * Как считается. Для каждой незавершённой задачи берётся распределение
 * Beta-PERT вокруг её оценки, задачи расставляются по времени с учётом
 * зависимостей и ёмкости команд, и так 5000 раз. Доля итераций, уложившихся
 * в плановую дату, и есть вероятность.
 *
 * Чего эта модель не умеет — важнее того, что умеет:
 *
 * 1. Задачи сэмплируются независимо. В жизни промахи коррелируют: если
 *    команда тонет, она тонет во всём сразу. Независимость занижает разброс
 *    и тем самым завышает уверенность в крайних вероятностях на больших
 *    релизах. Общий множитель на итерацию это бы исправил, но его величина
 *    берётся из истории, которой пока нет, — поэтому в «дальнейшее
 *    развитие», а не в выдуманную константу.
 * 2. Ёмкость команды — единый поток часов в день, а не набор людей. Для
 *    релиза без зависимостей это даёт тот же ответ, что и честное
 *    распараллеливание; с зависимостями модель чуть пессимистична.
 * 3. `spentH` не учитывается: начатая задача считается целиком. Так же
 *    поступает `effortTotals`, и расхождение между прогнозом и готовностью
 *    было бы хуже, чем общая пессимистичность обоих.
 */

import {
  dateAfterWorkingDays,
  remainingWorkingDays,
  startOfDay,
  workingDaysInclusive,
} from './calendar';
import { RISK_CONFIG, type RiskConfig } from './config';
import { isOpen, teamCapacityHours } from './metrics';
import { betaVariate, mulberry32, pertShape, seedFromString, type Random } from './random';
import type {
  ForecastPoint,
  IsoDate,
  ReleaseForecast,
  ReleaseSnapshot,
  Task,
} from './types';

export type ForecastOptions = {
  /** Дата вопроса «успеем ли к …». По умолчанию плановая дата релиза. */
  targetDate?: IsoDate;
  /**
   * Сколько завершённых релизов есть в истории. От этого зависит метод:
   * меньше `minReleasesForMonteCarlo` — детерминированный фолбэк (FR-22).
   * Значение приходит снаружи, потому что в снимке одного релиза истории
   * нет и быть не может.
   */
  completedReleases?: number;
  /**
   * Коэффициент занижения оценок, посчитанный по истории. Без него берётся
   * `estimatePessimism` из конфига.
   */
  pessimismFactor?: number;
  iterations?: number;
  /** Зерно. По умолчанию выводится из идентификатора релиза. */
  seed?: number;
};

/** Ключ ведра ёмкости. Задачи без команды считаются общими для организации. */
const UNASSIGNED = '';

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Полезные часы в день по каждой команде.
 *
 * Основной способ — ёмкость в окне до плановой даты, делённая на число
 * рабочих дней в этом окне. Он выбран не за простоту, а за согласованность:
 * ровно ту же `teamCapacityHours` использует движок риска, поэтому прогноз
 * и факторы F1/F2 не могут разойтись в том, сколько у команды времени.
 *
 * Запасной способ нужен для просроченного релиза: если плановая дата уже
 * прошла, в окне нет ни одного рабочего дня, делить не на что, — а прогноз
 * именно тогда и спрашивают («когда же теперь?»). Тогда ставка берётся как
 * средняя по всем записям ёмкости. При равномерной недельной ёмкости оба
 * способа дают одно и то же число.
 */
export function teamDailyRates(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
): Map<string, number> {
  const holidays = new Set<IsoDate>(snapshot.calendar.holidays);
  const windowDays = remainingWorkingDays(
    snapshot.now,
    snapshot.release.plannedDate,
    holidays,
  );

  const rates = new Map<string, number>();

  for (const team of snapshot.teams) {
    let rate = 0;

    if (windowDays > 0) {
      rate = teamCapacityHours(snapshot, team.id, config) / windowDays;
    } else {
      let hours = 0;
      let days = 0;
      for (const record of snapshot.capacity) {
        if (record.teamId !== team.id) continue;
        const periodDays = workingDaysInclusive(
          startOfDay(record.periodStart),
          startOfDay(record.periodEnd),
          holidays,
        );
        if (periodDays === 0) continue;
        hours += record.availableHours;
        days += periodDays;
      }
      rate = days > 0 ? (hours / days) * config.defaultFocusFactor : 0;
    }

    rates.set(team.id, rate);
  }

  // Задача без команды всё равно кем-то делается. Её списываем на
  // организацию целиком — так же, как это делает фактор дефицита времени,
  // где остаток работ делится на суммарную ёмкость всех команд.
  const total = [...rates.values()].reduce((sum, rate) => sum + rate, 0);
  rates.set(UNASSIGNED, total);

  return rates;
}

/**
 * Порядок обхода: блокирующая задача раньше заблокированной (алгоритм Кана).
 *
 * Задачи, оставшиеся в цикле, дописываются в конец в исходном порядке.
 * Циклы запрещены триггером в базе, но прогноз обязан вернуть число на
 * любом входе: упасть на испорченных данных — значит лишить менеджера
 * ответа как раз тогда, когда с данными что-то не так.
 */
function topologicalOrder(tasks: Task[], blockers: Map<string, string[]>): Task[] {
  const present = new Set(tasks.map((task) => task.id));
  const pending = new Map<string, number>();
  const unlocks = new Map<string, string[]>();

  for (const task of tasks) {
    const own = (blockers.get(task.id) ?? []).filter((id) => present.has(id));
    pending.set(task.id, own.length);
    for (const blockerId of own) {
      const list = unlocks.get(blockerId);
      if (list) list.push(task.id);
      else unlocks.set(blockerId, [task.id]);
    }
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  // Очередь заполняется в исходном порядке задач: при равных правах
  // выигрывает тот, кто раньше в снимке, и результат не зависит от
  // порядка обхода хеш-таблицы.
  const queue = tasks.filter((task) => pending.get(task.id) === 0).map((task) => task.id);
  const ordered: Task[] = [];

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    ordered.push(byId.get(id)!);
    for (const nextId of unlocks.get(id) ?? []) {
      const left = (pending.get(nextId) ?? 0) - 1;
      pending.set(nextId, left);
      if (left === 0) queue.push(nextId);
    }
  }

  if (ordered.length < tasks.length) {
    const placed = new Set(ordered.map((task) => task.id));
    for (const task of tasks) if (!placed.has(task.id)) ordered.push(task);
  }

  return ordered;
}

/** Обратная связь зависимостей: для задачи — список тех, кто её держит. */
function blockersByTask(snapshot: ReleaseSnapshot): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dep of snapshot.dependencies) {
    if (dep.type !== 'blocks') continue;
    const list = map.get(dep.blockedTaskId);
    if (list) list.push(dep.blockerTaskId);
    else map.set(dep.blockedTaskId, [dep.blockerTaskId]);
  }
  return map;
}

/**
 * План задач, подготовленный к многократной симуляции.
 *
 * Всё переведено в индексы и типизированные массивы заранее: одна итерация
 * не должна ни искать по строковому ключу, ни выделять память. Пять тысяч
 * итераций укладываются в секунду (NFR-04) именно за счёт этого.
 */
type Plan = {
  count: number;
  /** Оценка задачи, часы. */
  estimate: Float64Array;
  /** Индекс ведра ёмкости. */
  bucket: Int32Array;
  /** Часы в день по ведру. */
  bucketRate: Float64Array;
  /** Индексы блокирующих задач. */
  blockedBy: Int32Array[];
};

function buildPlan(snapshot: ReleaseSnapshot, config: RiskConfig): Plan {
  const open = snapshot.tasks.filter(isOpen);
  const blockers = blockersByTask(snapshot);
  const ordered = topologicalOrder(open, blockers);

  const indexOf = new Map<string, number>(ordered.map((task, i) => [task.id, i]));
  const rates = teamDailyRates(snapshot, config);
  const bucketKeys = [...rates.keys()];
  const bucketIndex = new Map(bucketKeys.map((key, i) => [key, i]));

  const count = ordered.length;
  const plan: Plan = {
    count,
    estimate: new Float64Array(count),
    bucket: new Int32Array(count),
    bucketRate: Float64Array.from(bucketKeys.map((key) => rates.get(key) ?? 0)),
    blockedBy: [],
  };

  for (let i = 0; i < count; i++) {
    const task = ordered[i];
    plan.estimate[i] = task.estimateH;
    // Задача, ссылающаяся на команду, которой нет в снимке, попадает в общее
    // ведро — туда же, где задачи вообще без команды. Молча обнулить её
    // ёмкость было бы хуже: одна битая ссылка делала бы релиз неисполнимым.
    plan.bucket[i] = bucketIndex.get(task.teamId ?? UNASSIGNED) ?? bucketIndex.get(UNASSIGNED)!;
    plan.blockedBy.push(
      Int32Array.from(
        (blockers.get(task.id) ?? [])
          .map((id) => indexOf.get(id))
          .filter((index): index is number => index !== undefined),
      ),
    );
  }

  return plan;
}

/**
 * Одна итерация: расстановка задач по времени.
 *
 * Задача начинается, когда освободились её блокеры и когда до неё дошла
 * очередь у команды. Возвращается момент, когда закончена последняя задача,
 * в рабочих днях от сегодня.
 *
 * Буферы `finish` и `busy` передаются снаружи и переиспользуются: пять тысяч
 * итераций — это пять тысяч выделений памяти, если этого не делать.
 */
function runIteration(
  plan: Plan,
  hours: Float64Array,
  finish: Float64Array,
  busy: Float64Array,
): number {
  busy.fill(0);
  let last = 0;

  for (let i = 0; i < plan.count; i++) {
    let ready = 0;
    const blockers = plan.blockedBy[i];
    for (let b = 0; b < blockers.length; b++) {
      const blockerFinish = finish[blockers[b]];
      if (blockerFinish > ready) ready = blockerFinish;
    }

    const bucket = plan.bucket[i];
    const rate = plan.bucketRate[bucket];

    // Нулевая ёмкость при наличии работ — не «быстро», а никогда. Та же
    // логика, что у загрузки команд, где это даёт бесконечную загрузку.
    if (!(rate > 0)) {
      finish[i] = Infinity;
      last = Infinity;
      continue;
    }

    const start = Math.max(ready, busy[bucket]);
    const end = start + hours[i] / rate;
    finish[i] = end;
    busy[bucket] = end;
    if (end > last) last = end;
  }

  return last;
}

/**
 * Нужное число рабочих дней при оценках «как есть», без разброса.
 *
 * ADR-001 §6 описывает фолбэк формулой `remainingEffort / capacity`. Здесь
 * тот же расчёт выполнен планировщиком, и при отсутствии зависимостей он в
 * эту формулу и сворачивается — сумма часов ведра, делённая на его ставку.
 * Разница появляется на зависимостях: планировщик их учитывает, формула нет.
 * Считать двумя разными способами было бы хуже, чем считать одним: тогда
 * детерминированная ветка и Монте-Карло разошлись бы в понимании ёмкости, и
 * переход от фолбэка к полному прогнозу сдвигал бы дату сам по себе.
 */
function deterministicWorkingDays(plan: Plan): number {
  const finish = new Float64Array(plan.count);
  const busy = new Float64Array(plan.bucketRate.length);
  return runIteration(plan, plan.estimate, finish, busy);
}

/** Выборочный перцентиль по методу ближайшего ранга. */
function percentileOf(sorted: Float64Array, probability: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(probability * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function pointAt(
  snapshot: ReleaseSnapshot,
  holidays: ReadonlySet<IsoDate>,
  probability: number,
  workingDays: number,
): ForecastPoint {
  return {
    probability,
    workingDays: round(workingDays),
    date: Number.isFinite(workingDays)
      ? dateAfterWorkingDays(snapshot.now, workingDays, holidays)
      : null,
  };
}

/**
 * Главная функция прогноза. Чистая: тот же снимок и то же зерно дают тот же
 * результат — как и весь доменный слой (FR-19).
 */
export function forecastRelease(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
  options: ForecastOptions = {},
): ReleaseForecast {
  const holidays = new Set<IsoDate>(snapshot.calendar.holidays);
  const targetDate = options.targetDate ?? snapshot.release.plannedDate;
  const targetWorkingDays = remainingWorkingDays(snapshot.now, targetDate, holidays);

  const pessimismFactor = options.pessimismFactor ?? config.estimatePessimism;
  const completedReleases = options.completedReleases ?? 0;
  const plan = buildPlan(snapshot, config);

  // ── Фолбэк при недостатке истории (FR-22, US-16) ────────────────────────
  // Пессимистичная ветка Beta-PERT опирается на коэффициент занижения
  // оценок, а он берётся из завершённых релизов. Без истории этот
  // коэффициент — догадка, и распределение вокруг догадки создаёт только
  // видимость точности: доверительный интервал был бы нарисован, но ничем
  // не обоснован. Поэтому вместо вероятности отдаётся одна дата и прямое
  // указание, что точность снижена.
  if (completedReleases < config.minReleasesForMonteCarlo) {
    const days = deterministicWorkingDays(plan);
    return {
      releaseId: snapshot.release.id,
      computedAt: snapshot.now,
      method: 'deterministic',
      targetDate,
      targetWorkingDays,
      probabilityOnTime: null,
      expectedWorkingDays: round(days),
      expectedDate: Number.isFinite(days)
        ? dateAfterWorkingDays(snapshot.now, days, holidays)
        : null,
      percentiles: [],
      iterations: 0,
      pessimismFactor,
      degraded: {
        reason: 'insufficient_history',
        completedReleases,
        requiredReleases: config.minReleasesForMonteCarlo,
      },
    };
  }

  // ── Монте-Карло (FR-21) ─────────────────────────────────────────────────
  const iterations = Math.max(1, options.iterations ?? config.monteCarloIterations);
  const random: Random = mulberry32(options.seed ?? seedFromString(snapshot.release.id));

  /*
    Форма распределения считается один раз, а не для каждой задачи, и это
    не оптимизация, а следствие модели: все три точки заданы долями от
    оценки (0.8 · e, e, k · e), поэтому α и β от размера задачи не зависят.
    От задачи зависит только масштаб.
  */
  const { alpha, beta } = pertShape(
    config.estimateOptimism,
    1,
    pessimismFactor,
    config.pertLambda,
  );
  const span = pessimismFactor - config.estimateOptimism;

  const samples = new Float64Array(iterations);
  const finish = new Float64Array(plan.count);
  const busy = new Float64Array(plan.bucketRate.length);
  const hours = new Float64Array(plan.count);

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < plan.count; i++) {
      const factor = config.estimateOptimism + betaVariate(random, alpha, beta) * span;
      hours[i] = plan.estimate[i] * factor;
    }
    samples[iteration] = runIteration(plan, hours, finish, busy);
  }

  /*
    Успех итерации считается в рабочих днях, а не сравнением дат, и округление
    вверх здесь обязательно. `dateAfterWorkingDays` округляет так же, поэтому
    «уложился по дням» и «дата не позже плановой» — одно и то же утверждение.
    Без округления вероятность и названная дата расходились бы на дробный
    хвост, и P80 мог бы оказаться раньше даты, к которой «успеваем с 80%».
  */
  let onTime = 0;
  for (let i = 0; i < iterations; i++) {
    if (Math.ceil(samples[i]) <= targetWorkingDays) onTime++;
  }

  // `Float64Array.sort` сортирует по величине, а не по строковому виду, —
  // в отличие от `Array.prototype.sort`, где пришлось бы передавать компаратор.
  const sorted = samples.slice().sort();
  const median = pointAt(snapshot, holidays, 0.5, percentileOf(sorted, 0.5));

  return {
    releaseId: snapshot.release.id,
    computedAt: snapshot.now,
    method: 'monte_carlo',
    targetDate,
    targetWorkingDays,
    probabilityOnTime: round(onTime / iterations, 4),
    expectedWorkingDays: median.workingDays,
    expectedDate: median.date,
    percentiles: config.forecastPercentiles.map((probability) =>
      pointAt(snapshot, holidays, probability, percentileOf(sorted, probability)),
    ),
    iterations,
    pessimismFactor,
    degraded: null,
  };
}
