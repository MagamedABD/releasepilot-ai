import { describe, expect, it } from 'vitest';

import { RISK_CONFIG } from '@/domain/config';
import { canonicalScenario, capacity, snapshot, task } from '@/domain/fixtures';
import { simulate } from '@/domain/scenario';

import { problemFields, toApiSimulation } from './scenario';

describe('перевод симуляции в API', () => {
  it('бесконечная загрузка обеих сторон доходит до клиента признаком, а не null', () => {
    // У QA работа есть, ёмкости нет — «работать некому».
    const base = snapshot({
      tasks: [task({ id: 'q', teamId: 'team-qa' }), task({ id: 'f', teamId: 'team-fe' })],
      capacity: [capacity('team-fe', 40)],
    });
    const result = simulate(base, { excludeTaskIds: ['f'], extraCapacity: [] }, RISK_CONFIG);
    if (result.kind !== 'ok') throw new Error('сценарий отклонён');

    const api = toApiSimulation(result);
    for (const side of [api.before, api.after]) {
      const qa = side.metrics.teamLoad.find((t) => t.teamId === 'team-qa')!;
      expect(qa).toMatchObject({ load: null, hasCapacity: false });
      expect(side.forecast.reachable).toBe(false);
    }
    // Недостижимо и до, и после — разности в днях нет, и это сказано явно.
    expect(api.delta.expectedWorkingDays).toBeNull();
    expect(JSON.parse(JSON.stringify(api))).toEqual(api);
  });
});

describe('отказы по существу → поля ошибки', () => {
  it('блокер остающихся задач объясняется поимённо', () => {
    const result = simulate(canonicalScenario(), { excludeTaskIds: ['be-hub'], extraCapacity: [] });
    if (result.kind !== 'rejected') throw new Error('ожидался отказ');
    const fields = problemFields(result.problems);
    expect(Object.keys(fields)).toEqual(['excludeTaskIds']);
    expect(fields.excludeTaskIds[0]).toContain('fe-1, fe-2, fe-3');
  });

  it('проблемы с задачами и командами раскладываются по своим полям', () => {
    expect(
      problemFields([
        { code: 'UNKNOWN_TASK', taskIds: ['a'] },
        { code: 'TASK_CLOSED', taskIds: ['b'] },
        { code: 'UNKNOWN_TEAM', teamIds: ['t'] },
        { code: 'NO_WINDOW_FOR_CAPACITY' },
      ]),
    ).toEqual({
      excludeTaskIds: [expect.stringContaining('a'), expect.stringContaining('b')],
      extraCapacity: [expect.stringContaining('t'), expect.stringContaining('прошла')],
    });
  });
});
