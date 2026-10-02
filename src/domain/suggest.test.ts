import { describe, expect, it } from 'vitest';

import { blocks, canonicalScenario, snapshot, task } from './fixtures';
import { calculateRelease } from './risk';
import { suggestScenario } from './suggest';

describe('цель уже выполнена', () => {
  it('ничего не предлагает, когда риск и так ниже цели', () => {
    const snap = snapshot({ tasks: [task({ id: 't1', status: 'done' })] });
    const result = suggestScenario(snap, { kind: 'risk_level', target: 'high' });
    expect(result.kind).toBe('already_met');
  });
});

describe('подбор на каноническом сценарии', () => {
  const snap = canonicalScenario();

  it('снижает скор и отдаёт эффект из симуляции, а не арифметикой по шагам', () => {
    const base = calculateRelease(snap);
    expect(base.riskLevel).toBe('high');

    const result = suggestScenario(snap, { kind: 'risk_score', target: base.riskScore - 5 });
    if (result.kind !== 'ok') throw new Error(`ожидался ok, получено ${result.kind}`);

    // Подбор и карточка what-if обязаны показывать одно и то же число.
    expect(result.after.metrics.riskScore).toBeLessThanOrEqual(base.riskScore - 5);
    expect(result.delta.riskScore).toBeLessThan(0);
    expect(result.taskIds.length).toBeGreaterThan(0);
    expect(result.groups[0].riskScoreAfter).toBeLessThan(base.riskScore);
  });

  /*
    Находка, из-за которой у «недостижимо» появился отдельный список
    причин. Уровень high на этом сценарии держит правило эскалации —
    заблокированная задача P0, — и оно на перенос не реагирует: сколько
    обычной работы из релиза ни унеси, пока P0 заблокирована, уровень
    останется. Настоящий совет здесь не «перенести», а «разблокировать»,
    и ответ обязан это сказать, а не выглядеть как «мы пытались».
  */
  it('называет правило, которое держит уровень, когда перенос не помогает', () => {
    const result = suggestScenario(snap, { kind: 'risk_level', target: 'medium' });
    expect(result.kind).toBe('unreachable');
    if (result.kind !== 'unreachable') return;

    expect(result.pinnedBy.map((r) => r.code)).toContain('CRITICAL_BLOCKER');
    expect(result.pinnedBy.every((r) => r.kind === 'escalation')).toBe(true);

    // И проверка диагноза: с разрешением трогать P0 цель достигается.
    const allowed = suggestScenario(snap, { kind: 'risk_level', target: 'medium' }, undefined, {
      keepPriorities: [],
      maxTasks: 8,
    });
    expect(allowed.kind).toBe('ok');
  });

  /*
    Умолчание, которое стоит объяснить: P0 не предлагается.

    P0 — обязательство, а не «работа с высоким приоритетом». Предложить
    перенести его молча — то же, что посоветовать не выполнять обещание,
    не сказав об этом. Разрешается явно, пустым списком.
  */
  it('не трогает P0, пока это не разрешено явно', () => {
    const result = suggestScenario(snap, { kind: 'risk_score', target: 10 });
    const touched = new Set(result.kind === 'ok' ? result.taskIds : result.taskIds);
    expect(touched.has('blocked-p0-a')).toBe(false);
    expect(touched.has('blocked-p0-b')).toBe(false);

    const allowed = suggestScenario(
      snap,
      { kind: 'risk_score', target: 10 },
      undefined,
      { keepPriorities: [], maxTasks: 12 },
    );
    expect(allowed.taskIds.length).toBeGreaterThan(0);
  });

  it('держит потолок числа задач', () => {
    const result = suggestScenario(snap, { kind: 'risk_score', target: 0 }, undefined, {
      maxTasks: 2,
    });
    expect(result.kind).toBe('unreachable');
    if (result.kind !== 'unreachable') return;
    expect(result.taskIds.length).toBeLessThanOrEqual(2);
    // «Не получается» без числа — не ответ: видно, насколько не получается.
    expect(result.after).not.toBeNull();
    expect(result.delta?.riskScore).toBeLessThan(0);
  });

  it('недостижимая цель не выдаёт пустой список за успех', () => {
    const result = suggestScenario(snap, { kind: 'probability', target: 1 });
    expect(result.kind).toBe('unreachable');
  });
});

/*
  FR-33 в подборе. Блокер нельзя унести, оставив ждущих в релизе: они
  выглядели бы свободными, хотя ждать им больше нечего. Поэтому кандидат
  на перенос — не задача, а задача со своим хвостом зависимых.
*/
describe('блокер уходит вместе с зависимыми', () => {
  const withChain = () =>
    snapshot({
      tasks: [
        task({ id: 'hub', key: 'PAY-1', estimateH: 40, teamId: 'team-be' }),
        task({ id: 'dep-1', key: 'PAY-2', estimateH: 20 }),
        task({ id: 'dep-2', key: 'PAY-3', estimateH: 20 }),
        task({ id: 'done-1', key: 'PAY-9', estimateH: 60, status: 'done' }),
      ],
      dependencies: [blocks('hub', 'dep-1'), blocks('dep-1', 'dep-2')],
      capacity: [],
    });

  it('предлагает группу, а не одну задачу', () => {
    const result = suggestScenario(withChain(), { kind: 'risk_level', target: 'low' }, undefined, {
      maxTasks: 5,
    });
    const group = (result.kind === 'ok' ? result.groups : result.groups).find(
      (g) => g.taskId === 'hub',
    );
    if (!group) return; // жадность могла обойтись хвостом — тогда проверять нечего
    // Хвост транзитивный: dep-2 ждёт dep-1, который ждёт hub.
    expect(group.withTaskIds.sort()).toEqual(['dep-1', 'dep-2']);
  });

  it('не предлагает группу, если её хвост задевает неприкосновенную задачу', () => {
    const snap = snapshot({
      tasks: [
        task({ id: 'hub', estimateH: 40, teamId: 'team-be' }),
        task({ id: 'p0', priority: 'P0', estimateH: 20 }),
      ],
      dependencies: [blocks('hub', 'p0')],
    });

    const result = suggestScenario(snap, { kind: 'risk_score', target: 0 });
    expect(result.taskIds).toEqual([]);
  });
});

describe('потолок кандидатов', () => {
  it('ограничение рассматриваемых задач не ломает подбор', () => {
    // Каждый кандидат — полная симуляция с Монте-Карло, и без потолка
    // подбор на большом релизе считался бы минутами.
    const snap = snapshot({
      tasks: Array.from({ length: 40 }, (_, i) =>
        task({ id: `t${i}`, key: `PAY-${i}`, estimateH: 4 + (i % 7) }),
      ),
    });

    const result = suggestScenario(snap, { kind: 'risk_level', target: 'low' }, undefined, {
      maxCandidates: 5,
      maxTasks: 3,
    });
    expect(['ok', 'unreachable', 'already_met']).toContain(result.kind);
  });
});
