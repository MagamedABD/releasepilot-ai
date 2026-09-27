import { describe, expect, it } from 'vitest';

import { dateAfterWorkingDays, remainingWorkingDays } from './calendar';
import { RISK_CONFIG } from './config';
import { forecastRelease, teamDailyRates } from './forecast';
import { blocks, canonicalScenario, capacity, snapshot, task } from './fixtures';
import type { ReleaseSnapshot } from './types';

/**
 * Числа в этом файле не подобраны «чтобы сошлось», а выведены из фикстуры:
 *
 * `now` — воскресенье 20 сентября, плановая дата — четверг 24-го, то есть
 * до срока четыре рабочих дня. Запись ёмкости покрывает 21–25 сентября (пять
 * рабочих дней), в окно попадают четыре из них. Отсюда полезная ёмкость
 * frontend при записи в 100 часов: `100 × 4/5 × 0.65 = 52` часа, то есть
 * ровно 13 часов в день. Backend при 80 часах — 10.4 в день.
 */
const FE_RATE = 13;
const BE_RATE = 10.4;

const HISTORY = { completedReleases: RISK_CONFIG.minReleasesForMonteCarlo };

function withCapacity(over: Partial<ReleaseSnapshot> = {}): ReleaseSnapshot {
  return snapshot({
    capacity: [capacity('team-fe', 100), capacity('team-be', 80)],
    ...over,
  });
}

describe('ставка команды в часах на день', () => {
  it('выводится из той же ёмкости, что и факторы риска', () => {
    const rates = teamDailyRates(withCapacity());
    expect(rates.get('team-fe')).toBeCloseTo(FE_RATE, 6);
    expect(rates.get('team-be')).toBeCloseTo(BE_RATE, 6);
  });

  it('у команды без записи ёмкости равна нулю', () => {
    expect(teamDailyRates(withCapacity()).get('team-qa')).toBe(0);
  });

  /**
   * Просроченный релиз — не экзотика, а как раз тот случай, когда прогноз
   * и спрашивают. Если плановая дата прошла, в окне нет ни одного рабочего
   * дня, и ставку из него вывести нельзя: делить пришлось бы на ноль.
   */
  it('у просроченного релиза берётся из записей ёмкости, а не из окна', () => {
    const overdue = withCapacity({
      now: '2026-09-28T09:00:00.000Z',
      release: {
        id: 'rel-1',
        name: 'Просрочен',
        plannedDate: '2026-09-24',
        startedAt: '2026-09-07T00:00:00.000Z',
      },
    });

    const rates = teamDailyRates(overdue);
    // 100 часов на пять рабочих дней, фокус-фактор 0.65 — те же 13 в день.
    expect(rates.get('team-fe')).toBeCloseTo(FE_RATE, 6);
    expect(Number.isFinite(rates.get('team-fe')!)).toBe(true);
  });
});

/**
 * Фолбэк при недостатке истории (FR-22, US-16).
 *
 * Здесь важнее всего то, чего в ответе нет: вероятности. Расчёт «остаток
 * делённый на ёмкость» даёт одну дату, и назвать её результат вероятностью
 * значило бы приписать модели уверенность, которой в ней нет.
 */
describe('детерминированный прогноз', () => {
  it('выбирается, когда завершённых релизов меньше порога', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 't1', estimateH: 52 })] }),
      RISK_CONFIG,
      { completedReleases: RISK_CONFIG.minReleasesForMonteCarlo - 1 },
    );

    expect(forecast.method).toBe('deterministic');
    expect(forecast.probabilityOnTime).toBeNull();
    expect(forecast.percentiles).toEqual([]);
    expect(forecast.iterations).toBe(0);
    expect(forecast.degraded).toEqual({
      reason: 'insufficient_history',
      completedReleases: RISK_CONFIG.minReleasesForMonteCarlo - 1,
      requiredReleases: RISK_CONFIG.minReleasesForMonteCarlo,
    });
  });

  // Осторожное умолчание: не передали историю — считаем, что её нет.
  // Ошибка в сторону меньшей уверенности безопаснее обратной.
  it('выбирается и тогда, когда историю не передали вовсе', () => {
    const forecast = forecastRelease(withCapacity({ tasks: [task({ id: 't1' })] }));
    expect(forecast.method).toBe('deterministic');
  });

  it('52 часа при ставке 13 в день — это четыре рабочих дня', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 't1', estimateH: 52 })] }),
    );

    expect(forecast.expectedWorkingDays).toBe(4);
    expect(forecast.expectedDate).toBe('2026-09-24');
    expect(forecast.targetWorkingDays).toBe(4);
  });

  /**
   * Зависимость между командами — единственный случай, где порядок задач
   * меняет срок. Внутри одной команды часы всё равно суммируются, сколько бы
   * связей между задачами ни было; а вот backend, держащий frontend, честно
   * сдвигает начало frontend-работы.
   */
  it('зависимость между командами удлиняет срок', () => {
    const tasks = [
      task({ id: 'be', estimateH: 26, teamId: 'team-be' }),
      task({ id: 'fe', estimateH: 26, teamId: 'team-fe' }),
    ];

    const parallel = forecastRelease(withCapacity({ tasks }));
    // Обе команды работают одновременно: 26/10.4 = 2.5 и 26/13 = 2.
    expect(parallel.expectedWorkingDays).toBe(2.5);

    const chained = forecastRelease(
      withCapacity({ tasks, dependencies: [blocks('be', 'fe')] }),
    );
    // Frontend ждёт backend: 2.5 + 2 = 4.5.
    expect(chained.expectedWorkingDays).toBe(4.5);
  });

  it('завершённые и отменённые задачи в прогноз не входят', () => {
    const forecast = forecastRelease(
      withCapacity({
        tasks: [
          task({ id: 'done', estimateH: 1000, status: 'done' }),
          task({ id: 'cancelled', estimateH: 1000, status: 'cancelled' }),
          task({ id: 'open', estimateH: 13 }),
        ],
      }),
    );

    expect(forecast.expectedWorkingDays).toBe(1);
  });

  it('релиз без незавершённых задач готов сегодня', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 'done', status: 'done' })] }),
    );

    expect(forecast.expectedWorkingDays).toBe(0);
    expect(forecast.expectedDate).toBe('2026-09-20');
  });

  /**
   * Команда без выделенного времени — не «быстрая», а неспособная закончить.
   * Ноль в знаменателе здесь мог бы дать `NaN` и превратить прогноз в пустое
   * место на экране; вместо этого честно говорится, что даты нет.
   */
  it('работа у команды без ёмкости не заканчивается никогда', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 'qa', estimateH: 8, teamId: 'team-qa' })] }),
    );

    expect(forecast.expectedWorkingDays).toBe(Infinity);
    expect(forecast.expectedDate).toBeNull();
  });

  // Задача без команды достанется кому-то из организации, поэтому считается
  // по суммарной ставке — так же, как её считает фактор дефицита времени.
  it('задача без команды считается по ёмкости всей организации', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 'free', estimateH: 23.4, teamId: null })] }),
    );

    expect(forecast.expectedWorkingDays).toBe(1);
  });
});

describe('Монте-Карло', () => {
  const justFits = () =>
    withCapacity({ tasks: [task({ id: 't1', estimateH: 52 })] });

  it('выбирается при достаточной истории', () => {
    const forecast = forecastRelease(justFits(), RISK_CONFIG, HISTORY);

    expect(forecast.method).toBe('monte_carlo');
    expect(forecast.degraded).toBeNull();
    expect(forecast.iterations).toBe(RISK_CONFIG.monteCarloIterations);
    expect(forecast.pessimismFactor).toBe(RISK_CONFIG.estimatePessimism);
  });

  /**
   * Главный результат всей затеи.
   *
   * По детерминированному расчёту релиз укладывается ровно в срок: 52 часа,
   * 13 часов в день, четыре дня — и четыре дня до плановой даты. Обычный
   * план сказал бы «успеваем». Монте-Карло говорит, что успеваем с
   * вероятностью около трети: оценки занижают, и «ровно хватает» означает
   * «скорее не хватит».
   *
   * Если этот тест когда-нибудь начнёт показывать вероятность выше половины,
   * это будет значить, что распределение потеряло асимметрию, и прогноз
   * снова стал пересказом оценки.
   */
  it('релиз, укладывающийся «ровно в срок», в срок скорее не уложится', () => {
    const deterministic = forecastRelease(justFits());
    const forecast = forecastRelease(justFits(), RISK_CONFIG, HISTORY);

    expect(deterministic.expectedWorkingDays).toBe(4);
    expect(deterministic.targetWorkingDays).toBe(4);

    expect(forecast.probabilityOnTime).toBeLessThan(0.5);
    expect(forecast.probabilityOnTime).toBeGreaterThan(0.15);
    // Медиана прогноза позже оценки — то самое добавленное знание.
    expect(forecast.expectedWorkingDays).toBeGreaterThan(4);
  });

  it('даёт тот же ответ при повторном вызове', () => {
    const first = forecastRelease(canonicalScenario(), RISK_CONFIG, HISTORY);
    const second = forecastRelease(canonicalScenario(), RISK_CONFIG, HISTORY);
    expect(first).toEqual(second);
  });

  it('другое зерно — другая выборка', () => {
    const a = forecastRelease(canonicalScenario(), RISK_CONFIG, { ...HISTORY, seed: 1 });
    const b = forecastRelease(canonicalScenario(), RISK_CONFIG, { ...HISTORY, seed: 2 });

    const shape = (f: typeof a) => [
      f.probabilityOnTime,
      ...f.percentiles.map((p) => p.workingDays),
    ];
    expect(shape(a)).not.toEqual(shape(b));
  });

  it('перцентили не убывают', () => {
    const forecast = forecastRelease(canonicalScenario(), RISK_CONFIG, HISTORY);
    const days = forecast.percentiles.map((point) => point.workingDays);

    expect(forecast.percentiles.map((p) => p.probability)).toEqual(
      RISK_CONFIG.forecastPercentiles,
    );
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  /**
   * Согласованность вероятности и названной даты.
   *
   * Обе величины считаются из одной выборки, но по-разному: вероятность —
   * долей итераций, дата — перцентилем. Если округление в этих двух местах
   * разойдётся, система сможет сказать «успеваем с вероятностью 60%» и тут
   * же назвать медианную дату позже плановой. Тест фиксирует, что такого
   * противоречия быть не может.
   */
  it('медиана не позже плановой даты тогда и только тогда, когда вероятность не ниже половины', () => {
    for (const estimateH of [13, 26, 39, 52, 65, 78]) {
      const forecast = forecastRelease(
        withCapacity({ tasks: [task({ id: 't1', estimateH })] }),
        RISK_CONFIG,
        HISTORY,
      );

      const inTime = forecast.expectedDate !== null && forecast.expectedDate <= forecast.targetDate;
      expect(inTime).toBe(forecast.probabilityOnTime! >= 0.5);
    }
  });

  /**
   * FR-23: вопрос про произвольную дату. Перенос срока вперёд не может
   * уменьшить вероятность — свойство, которое легко потерять, если
   * вероятность и дата считаются не из одной выборки.
   */
  it('чем позже дата, тем выше вероятность', () => {
    const base = canonicalScenario();
    const dates = ['2026-09-22', '2026-09-24', '2026-09-30', '2026-10-15'];

    const probabilities = dates.map(
      (targetDate) =>
        forecastRelease(base, RISK_CONFIG, { ...HISTORY, targetDate }).probabilityOnTime!,
    );

    expect(probabilities).toEqual([...probabilities].sort((a, b) => a - b));
    expect(probabilities.at(-1)).toBeGreaterThan(probabilities[0]);
  });

  it('вероятность лежит в границах от нуля до единицы', () => {
    const forecast = forecastRelease(canonicalScenario(), RISK_CONFIG, HISTORY);
    expect(forecast.probabilityOnTime).toBeGreaterThanOrEqual(0);
    expect(forecast.probabilityOnTime).toBeLessThanOrEqual(1);
  });

  it('неисполнимый релиз получает нулевую вероятность и пустые даты', () => {
    const forecast = forecastRelease(
      withCapacity({ tasks: [task({ id: 'qa', estimateH: 8, teamId: 'team-qa' })] }),
      RISK_CONFIG,
      HISTORY,
    );

    expect(forecast.probabilityOnTime).toBe(0);
    expect(forecast.expectedDate).toBeNull();
    expect(forecast.percentiles.every((point) => point.date === null)).toBe(true);
  });

  // NFR-04: полный прогноз — не дольше секунды. Порог с большим запасом:
  // тест должен ловить потерю подготовленного плана, а не дрожание машины.
  it('5000 итераций укладываются в секунду', () => {
    const started = performance.now();
    forecastRelease(canonicalScenario(), RISK_CONFIG, HISTORY);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

/**
 * Обратимость календаря. Прогноз переводит дни в дату, а вероятность считает
 * в днях; если эти два счёта расходятся хотя бы на день, P80 может оказаться
 * раньше даты, к которой «успеваем с вероятностью 80%».
 */
describe('дни и даты обратимы', () => {
  const holidays = new Set<string>();

  it.each([0, 1, 4, 5, 10, 23])('через %s рабочих дней — и обратно', (days) => {
    const date = dateAfterWorkingDays('2026-09-20T09:00:00.000Z', days, holidays);
    expect(remainingWorkingDays('2026-09-20T09:00:00.000Z', date, holidays)).toBe(days);
  });

  it('дробный день округляется вверх: работа занимает весь день', () => {
    expect(dateAfterWorkingDays('2026-09-20T09:00:00.000Z', 2.1, holidays)).toBe(
      '2026-09-23',
    );
    expect(dateAfterWorkingDays('2026-09-20T09:00:00.000Z', 3, holidays)).toBe('2026-09-23');
  });

  // Воскресенье 20-е: два рабочих дня — это понедельник и вторник. Праздник
  // во вторник не отменяет работу, а переносит её на среду.
  it('праздник сдвигает дату', () => {
    const now = '2026-09-20T09:00:00.000Z';
    expect(dateAfterWorkingDays(now, 2, holidays)).toBe('2026-09-22');
    expect(dateAfterWorkingDays(now, 2, new Set(['2026-09-22']))).toBe('2026-09-23');
  });

  it('не уходит в бесконечность', () => {
    expect(() => dateAfterWorkingDays('2026-09-20T09:00:00.000Z', Infinity, holidays)).toThrow(
      /Не число рабочих дней/,
    );
  });
});
