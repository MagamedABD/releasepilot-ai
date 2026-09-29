import { describe, expect, it } from 'vitest';

import { blocks, canonicalScenario, snapshot, task } from '@/domain/fixtures';
import { calculateRelease } from '@/domain/risk';

import { toApiBlockersView, toApiTeamLoadView } from './insight';

describe('загрузка команд отдельным ответом', () => {
  it('несёт остаток рабочих дней — без него проценты не читаются', () => {
    const snap = canonicalScenario();
    const view = toApiTeamLoadView(calculateRelease(snap));

    expect(view.releaseId).toBe(snap.release.id);
    expect(view.remainingWorkingDays).toBeGreaterThan(0);
    expect(view.teams.length).toBe(snap.teams.length);
    expect(view.teams.every((t) => t.hasCapacity)).toBe(true);
  });

  it('команду без остатка работ не прячет: «всё сделано» — тоже ответ', () => {
    const view = toApiTeamLoadView(
      calculateRelease(
        snapshot({ tasks: [task({ id: 't1', teamId: 'team-fe', status: 'done', estimateH: 8 })] }),
      ),
    );

    const be = view.teams.find((t) => t.teamId === 'team-be');
    expect(be).toBeDefined();
    expect(be?.remainingH).toBe(0);
  });
});

/**
 * Причина, по которой этот слой не сводится к выборке полей.
 *
 * Движок отдаёт `taskId`, и это правильно: расчёту нет дела до названий.
 * Но экран блокеров по списку UUID нечитаем, а названия лежат в том же
 * снимке, из которого блокеры и посчитаны.
 */
describe('блокеры называют задачи, а не только их идентификаторы', () => {
  const withBlocker = () =>
    snapshot({
      tasks: [
        task({
          id: 't1',
          key: 'PAY-302',
          title: 'Подтверждение возврата на стороне банка',
          status: 'in_progress',
          priority: 'P0',
          estimateH: 24,
          blockedSince: '2026-09-13T09:00:00.000Z',
        }),
        task({ id: 't2', key: 'PAY-303', title: 'Частичный возврат', estimateH: 20 }),
      ],
      dependencies: [blocks('t1', 't2')],
    });

  it('у блокера вместо taskId стоит ссылка с ключом и названием', () => {
    const snap = withBlocker();
    const metrics = calculateRelease(snap);
    expect(metrics.blockers[0]?.taskId).toBe('t1');

    const view = toApiBlockersView(metrics, snap);
    expect(view.blockers).toHaveLength(1);
    expect(view.blockers[0].task).toEqual({
      id: 't1',
      key: 'PAY-302',
      title: 'Подтверждение возврата на стороне банка',
    });
    // Остальные факты блокера при этом на месте.
    expect(view.blockers[0].blocksCount).toBe(1);
    expect(view.blockers[0].blockedDays).toBeGreaterThan(0);
    // `taskId` не дублируется: ответ говорит о задаче один раз.
    expect('taskId' in view.blockers[0]).toBe(false);
  });

  it('критическая цепочка сохраняет порядок задач', () => {
    const snap = withBlocker();
    const metrics = calculateRelease(snap);
    const view = toApiBlockersView(metrics, snap);

    expect(view.criticalChain.days).toBe(metrics.criticalChain.days);
    expect(view.criticalChain.tasks.map((t) => t.id)).toEqual(metrics.criticalChain.taskIds);
    expect(view.criticalChain.tasks.every((t) => t.key !== null)).toBe(true);
  });

  /*
    Рассогласование снимка и расчёта возможно только от ошибки, и тогда
    важнее увидеть блокер без названия, чем не увидеть блокера. Поэтому
    неизвестный идентификатор даёт пустые поля, а не исключение и не
    исчезновение из списка.
  */
  it('неизвестная задача даёт пустую ссылку, а не пропадает', () => {
    const snap = withBlocker();
    const metrics = calculateRelease(snap);
    const orphaned = {
      ...metrics,
      blockers: [{ ...metrics.blockers[0], taskId: 'нет-такой' }],
      criticalChain: { days: 1, taskIds: ['нет-такой'] },
    };

    const view = toApiBlockersView(orphaned, snap);
    expect(view.blockers).toHaveLength(1);
    expect(view.blockers[0].task).toEqual({ id: 'нет-такой', key: null, title: null });
    expect(view.criticalChain.tasks[0].title).toBeNull();
  });

  it('оба ответа переживают сериализацию', () => {
    const snap = canonicalScenario();
    const metrics = calculateRelease(snap);

    for (const view of [toApiTeamLoadView(metrics), toApiBlockersView(metrics, snap)]) {
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }
  });
});
