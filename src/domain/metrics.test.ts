import { describe, expect, it } from 'vitest';
import {
  isWeekend,
  remainingWorkingDays,
  startOfDay,
  toIsoDate,
  workingDaysInclusive,
} from './calendar';
import {
  calculateTeamLoad,
  collectBlockers,
  countByStatus,
  effortTotals,
  qaFunnel,
  scopeDrift,
  teamCapacityHours,
} from './metrics';
import { criticalChain } from './chain';
import { blocks, capacity, snapshot, task } from './fixtures';

describe('календарь', () => {
  const noHolidays = new Set<string>();

  it('20 сентября 2026 года — воскресенье', () => {
    expect(isWeekend(startOfDay('2026-09-20'))).toBe(true);
    expect(isWeekend(startOfDay('2026-09-21'))).toBe(false);
  });

  it('считает рабочие дни включительно, пропуская выходные', () => {
    // Пн 21 — Пт 25 сентября.
    expect(workingDaysInclusive(startOfDay('2026-09-21'), startOfDay('2026-09-25'), noHolidays)).toBe(5);
    // Захватывает выходные 26–27, но они не считаются.
    expect(workingDaysInclusive(startOfDay('2026-09-21'), startOfDay('2026-09-28'), noHolidays)).toBe(6);
  });

  it('исключает праздники', () => {
    const holidays = new Set(['2026-09-23']);
    expect(workingDaysInclusive(startOfDay('2026-09-21'), startOfDay('2026-09-25'), holidays)).toBe(4);
  });

  it('текущий день не считается остатком: он уже частично израсходован', () => {
    expect(remainingWorkingDays('2026-09-21T15:00:00.000Z', '2026-09-25', noHolidays)).toBe(4);
  });

  it('прошедшая дата даёт ноль, а не отрицательное число', () => {
    expect(remainingWorkingDays('2026-09-25T09:00:00.000Z', '2026-09-21', noHolidays)).toBe(0);
  });

  it('работает в UTC независимо от зоны машины', () => {
    expect(toIsoDate(startOfDay('2026-09-20T23:30:00.000Z'))).toBe('2026-09-20');
  });

  it('отвергает мусор вместо даты', () => {
    expect(() => startOfDay('не дата')).toThrow(/Некорректная дата/);
  });
});

describe('базовые метрики', () => {
  it('отменённые задачи не входят ни в трудозатраты, ни в счётчики', () => {
    const tasks = [
      task({ id: 'a', status: 'done', estimateH: 10 }),
      task({ id: 'b', status: 'cancelled', estimateH: 100 }),
      task({ id: 'c', estimateH: 10 }),
    ];
    expect(effortTotals(tasks)).toEqual({ totalH: 20, doneH: 10, remainingH: 10 });
    expect(countByStatus(tasks).total).toBe(2);
    expect(countByStatus(tasks).cancelled).toBe(1);
  });

  it('считает статусы по отдельности, блокировку — поверх статуса', () => {
    const counts = countByStatus([
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'review' }),
      task({ id: 'c', status: 'testing' }),
      task({ id: 'd', status: 'backlog', blockedSince: '2026-09-18T00:00:00.000Z' }),
    ]);
    expect(counts).toMatchObject({ total: 4, inProgress: 2, testing: 1, blocked: 1 });
  });

  it('завершённая задача не считается заблокированной, даже если отметка осталась', () => {
    const counts = countByStatus([
      task({ id: 'a', status: 'done', blockedSince: '2026-09-18T00:00:00.000Z' }),
    ]);
    expect(counts.blocked).toBe(0);
  });
});

describe('ёмкость и загрузка', () => {
  it('берёт долю периода, попавшую в остаток времени, и применяет фокус-фактор', () => {
    // 50 номинальных часов на пять рабочих дней, до плановой даты — четыре.
    // 50 × 4/5 × 0.65 = 26.
    const input = snapshot({ capacity: [capacity('team-qa', 50)] });
    expect(teamCapacityHours(input, 'team-qa')).toBeCloseTo(26, 6);
  });

  it('период, полностью лежащий в прошлом, ёмкости не даёт', () => {
    const input = snapshot({
      capacity: [capacity('team-qa', 50, '2026-09-07', '2026-09-11')],
    });
    expect(teamCapacityHours(input, 'team-qa')).toBe(0);
  });

  it('считает загрузку только по незавершённым задачам', () => {
    const input = snapshot({
      tasks: [
        task({ id: 'a', status: 'done', estimateH: 100, teamId: 'team-qa' }),
        task({ id: 'b', estimateH: 13, teamId: 'team-qa' }),
      ],
      capacity: [capacity('team-qa', 50)],
    });
    const qa = calculateTeamLoad(input).find((team) => team.teamId === 'team-qa');
    expect(qa?.load).toBeCloseTo(0.5, 6);
  });
});

describe('блокеры', () => {
  const input = snapshot({
    now: '2026-09-20T09:00:00.000Z',
    tasks: [
      task({ id: 'fresh', priority: 'P1', blockedSince: '2026-09-20T03:00:00.000Z' }),
      task({ id: 'stale', priority: 'P0', blockedSince: '2026-09-16T09:00:00.000Z' }),
      task({ id: 'free' }),
    ],
    dependencies: [blocks('stale', 'free')],
  });

  it('сортирует по длительности блокировки и помечает застарелые', () => {
    const blockers = collectBlockers(input);
    expect(blockers.map((b) => b.taskId)).toEqual(['stale', 'fresh']);
    expect(blockers[0].isStale).toBe(true);
    expect(blockers[0].blockedDays).toBeCloseTo(4, 2);
    expect(blockers[1].isStale).toBe(false);
  });

  it('считает, сколько незавершённых задач ждут блокера', () => {
    const blockers = collectBlockers(input);
    expect(blockers.find((b) => b.taskId === 'stale')?.blocksCount).toBe(1);
  });
});

describe('критическая цепочка', () => {
  it('выбирает самую длинную последовательность, а не самую многочисленную', () => {
    const input = snapshot({
      tasks: [
        task({ id: 'a', estimateH: 10 }),
        task({ id: 'b', estimateH: 10 }),
        task({ id: 'c', estimateH: 1 }),
        task({ id: 'd', estimateH: 1 }),
        task({ id: 'e', estimateH: 1 }),
      ],
      dependencies: [blocks('a', 'b'), blocks('c', 'd'), blocks('d', 'e')],
    });
    const chain = criticalChain(input);
    expect(chain.taskIds).toEqual(['a', 'b']);
    // 20 ч при 8 × 0.65 = 5.2 ч полезных в день.
    expect(chain.days).toBeCloseTo(20 / 5.2, 6);
  });

  it('завершённые задачи выпадают из цепочки', () => {
    const input = snapshot({
      tasks: [
        task({ id: 'a', status: 'done', estimateH: 100 }),
        task({ id: 'b', estimateH: 5.2 }),
      ],
      dependencies: [blocks('a', 'b')],
    });
    expect(criticalChain(input).taskIds).toEqual(['b']);
  });

  it('связи типа relates цепочку не образуют', () => {
    const input = snapshot({
      tasks: [task({ id: 'a', estimateH: 5.2 }), task({ id: 'b', estimateH: 5.2 })],
      dependencies: [{ blockerTaskId: 'a', blockedTaskId: 'b', type: 'relates' }],
    });
    expect(criticalChain(input).taskIds).toHaveLength(1);
  });
});

describe('воронка QA и дрейф скоупа', () => {
  it('при отсутствии команды QA фактор не считается', () => {
    const input = snapshot({
      teams: [{ id: 'team-fe', name: 'Frontend', kind: 'dev' }],
      tasks: [task({ id: 'a', estimateH: 10 })],
    });
    expect(qaFunnel(input)).toEqual({ share: 0, requiredH: 0, capacityH: 0 });
  });

  it('доля непротестированного растёт, когда ёмкости QA не хватает', () => {
    const input = snapshot({
      tasks: [task({ id: 'a', estimateH: 40, teamId: 'team-qa' })],
      capacity: [capacity('team-qa', 20)],
    });
    // Полезная ёмкость 20 × 4/5 × 0.65 = 10.4 из требуемых 40.
    expect(qaFunnel(input).share).toBeCloseTo((40 - 10.4) / 40, 6);
  });

  it('дрейф скоупа считает только задачи, добавленные после старта релиза', () => {
    const input = snapshot({
      tasks: [
        task({ id: 'planned', estimateH: 90, addedToReleaseAt: '2026-09-01T00:00:00.000Z' }),
        task({ id: 'late', estimateH: 10, addedToReleaseAt: '2026-09-15T00:00:00.000Z' }),
      ],
    });
    expect(scopeDrift(input)).toEqual({ addedH: 10, share: 0.1 });
  });

  it('у релиза без даты старта дрейфа нет', () => {
    const input = snapshot({
      release: {
        id: 'r',
        name: 'r',
        plannedDate: '2026-09-24',
        startedAt: null,
      },
      tasks: [task({ id: 'late', estimateH: 10, addedToReleaseAt: '2026-09-15T00:00:00.000Z' })],
    });
    expect(scopeDrift(input).share).toBe(0);
  });
});
