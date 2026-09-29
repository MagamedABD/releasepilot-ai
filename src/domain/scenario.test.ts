import { describe, expect, it } from 'vitest';

import { RISK_CONFIG } from './config';
import { canonicalScenario, snapshot, task } from './fixtures';
import { forecastRelease } from './forecast';
import { calculateRelease } from './risk';
import { applyScenario, simulate, validateScenario, type Scenario } from './scenario';

const NONE: Scenario = { excludeTaskIds: [], extraCapacity: [] };
const HISTORY = { completedReleases: 6 };

function ok(result: ReturnType<typeof simulate>) {
  if (result.kind !== 'ok') throw new Error(`сценарий отклонён: ${JSON.stringify(result)}`);
  return result;
}

describe('наложение сценария на снимок', () => {
  it('не меняет исходный снимок: симуляция ничего не пишет (FR-31)', () => {
    const base = canonicalScenario();
    const copy = structuredClone(base);
    applyScenario(base, {
      excludeTaskIds: ['late-1'],
      extraCapacity: [{ teamId: 'team-qa', hours: 20 }],
    });
    expect(base).toEqual(copy);
  });

  it('уносит задачу вместе с её связями', () => {
    const after = applyScenario(canonicalScenario(), { ...NONE, excludeTaskIds: ['fe-1'] });
    expect(after.tasks.some((t) => t.id === 'fe-1')).toBe(false);
    expect(after.dependencies.some((d) => d.blockedTaskId === 'fe-1')).toBe(false);
    expect(after.dependencies).toHaveLength(2);
  });

  it('дополнительные часы ложатся на окно «завтра — плановая дата»', () => {
    const after = applyScenario(canonicalScenario(), {
      ...NONE,
      extraCapacity: [{ teamId: 'team-qa', hours: 20 }],
    });
    expect(after.capacity.at(-1)).toEqual({
      teamId: 'team-qa',
      periodStart: '2026-09-21',
      periodEnd: '2026-09-24',
      availableHours: 20,
    });
  });
});

describe('симуляция', () => {
  it('пустой сценарий даёт нулевую дельту: «до» и «после» считаются одинаково', () => {
    const result = ok(simulate(canonicalScenario(), NONE, RISK_CONFIG, HISTORY));
    expect(result.after).toEqual(result.before);
    expect(result.delta.riskScore).toBe(0);
    expect(result.delta.probabilityOnTime).toBe(0);
  });

  it('«до» совпадает с тем, что отдают метрики и прогноз карточки релиза', () => {
    const base = canonicalScenario();
    const result = ok(simulate(base, NONE, RISK_CONFIG, HISTORY));
    const forecast = forecastRelease(base, RISK_CONFIG, HISTORY);
    const metrics = calculateRelease(base, RISK_CONFIG, {
      probabilityOnTime: forecast.probabilityOnTime,
    });
    expect(result.before.forecast).toEqual(forecast);
    expect(result.before.metrics).toEqual(metrics);
  });

  it('часы для QA снимают перегрузку тестирования', () => {
    const result = ok(
      simulate(
        canonicalScenario(),
        { ...NONE, extraCapacity: [{ teamId: 'team-qa', hours: 30 }] },
        RISK_CONFIG,
        HISTORY,
      ),
    );
    const qa = (side: typeof result.before) =>
      side.metrics.teamLoad.find((t) => t.teamId === 'team-qa')!.load;
    expect(qa(result.before)).toBeCloseTo(1.35, 2);
    expect(qa(result.after)).toBeLessThan(1);
    expect(result.delta.riskScore).toBeLessThan(0);
    expect(result.delta.remainingH).toBe(0);
  });

  it('перенос задачи уменьшает остаток ровно на её оценку и снимает дрейф скоупа', () => {
    const result = ok(
      simulate(canonicalScenario(), { ...NONE, excludeTaskIds: ['late-1'] }, RISK_CONFIG, HISTORY),
    );
    const f6 = (side: typeof result.before) =>
      side.metrics.factors.find((f) => f.code === 'F6')!.value;
    expect(result.delta.remainingH).toBe(-10);
    expect(f6(result.before)).toBeGreaterThan(0);
    expect(f6(result.after)).toBe(0);
  });

  /*
    Неочевидное свойство движка, и тест держит его на виду, а не прячет.

    F3 — доля заблокированных часов в остатке работ. Уберите из релиза
    свободную задачу, и доля блокеров вырастет, хотя самих блокеров не
    прибавилось. На каноническом сценарии это перевешивает ушедший дрейф:
    перенос поздней задачи поднимает скор, а не снижает.

    Для симуляции это не ошибка — она честно показывает, что посчитал бы
    движок. Но подбор сценария (FR-32) обязан это учитывать: «перенести
    что-нибудь» не всегда снижает риск, и жадный перебор должен проверять
    каждый шаг симуляцией, а не считать его выигрышным заранее.
  */
  it('перенос свободной задачи может поднять скор: F3 — доля, а не объём', () => {
    const result = ok(
      simulate(canonicalScenario(), { ...NONE, excludeTaskIds: ['late-1'] }, RISK_CONFIG, HISTORY),
    );
    const f3 = (side: typeof result.before) =>
      side.metrics.factors.find((f) => f.code === 'F3')!.value;
    expect(f3(result.after)).toBeGreaterThan(f3(result.before));
    expect(result.delta.riskScore).toBeGreaterThan(0);
  });

  it('без истории вероятности нет, и дельта вероятности — null, а не ноль', () => {
    const result = ok(
      simulate(canonicalScenario(), {
        ...NONE,
        extraCapacity: [{ teamId: 'team-qa', hours: 30 }],
      }),
    );
    expect(result.before.forecast.method).toBe('deterministic');
    expect(result.delta.probabilityOnTime).toBeNull();
    expect(result.delta.expectedWorkingDays).toBeLessThan(0);
  });

  it('детерминирована: тот же сценарий — тот же ответ (FR-19)', () => {
    const scenario = { ...NONE, excludeTaskIds: ['late-1', 'qa-3'] };
    expect(simulate(canonicalScenario(), scenario, RISK_CONFIG, HISTORY)).toEqual(
      simulate(canonicalScenario(), scenario, RISK_CONFIG, HISTORY),
    );
  });
});

describe('отказы по существу', () => {
  it('блокер остающихся задач перенести нельзя (FR-33)', () => {
    const result = simulate(canonicalScenario(), { ...NONE, excludeTaskIds: ['be-hub'] });
    expect(result).toEqual({
      kind: 'rejected',
      problems: [
        { code: 'BLOCKS_REMAINING', taskIds: ['be-hub'], blockedTaskIds: ['fe-1', 'fe-2', 'fe-3'] },
      ],
    });
  });

  it('блокер можно перенести вместе со всеми, кого он держит', () => {
    const problems = validateScenario(canonicalScenario(), {
      ...NONE,
      excludeTaskIds: ['be-hub', 'fe-1', 'fe-2', 'fe-3'],
    });
    expect(problems).toEqual([]);
  });

  it('держит только незавершённых: связь с закрытой задачей переносу не мешает', () => {
    const base = canonicalScenario();
    base.tasks = base.tasks.map((t) => (t.id.startsWith('fe-') ? { ...t, status: 'done' } : t));
    expect(validateScenario(base, { ...NONE, excludeTaskIds: ['be-hub'] })).toEqual([]);
  });

  it('закрытую задачу не переносит: это вычло бы сделанную работу', () => {
    const problems = validateScenario(canonicalScenario(), { ...NONE, excludeTaskIds: ['done-0'] });
    expect(problems).toEqual([{ code: 'TASK_CLOSED', taskIds: ['done-0'] }]);
  });

  it('чужие задачи и команды называет поимённо', () => {
    const problems = validateScenario(canonicalScenario(), {
      excludeTaskIds: ['nope'],
      extraCapacity: [{ teamId: 'team-x', hours: 8 }],
    });
    expect(problems).toEqual([
      { code: 'UNKNOWN_TASK', taskIds: ['nope'] },
      { code: 'UNKNOWN_TEAM', teamIds: ['team-x'] },
    ]);
  });

  it('у просроченного релиза часы добавить некуда', () => {
    const overdue = snapshot({ now: '2026-09-28T09:00:00.000Z', tasks: [task({ id: 'a' })] });
    expect(
      validateScenario(overdue, { ...NONE, extraCapacity: [{ teamId: 'team-fe', hours: 8 }] }),
    ).toEqual([{ code: 'NO_WINDOW_FOR_CAPACITY' }]);
  });
});
