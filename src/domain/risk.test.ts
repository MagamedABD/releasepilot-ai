import { describe, expect, it } from 'vitest';
import { RISK_CONFIG } from './config';
import { calculateRelease } from './risk';
import { blocks, canonicalScenario, capacity, snapshot, task } from './fixtures';
import type { ReasonCode } from './types';

const codes = (metrics: ReturnType<typeof calculateRelease>): ReasonCode[] =>
  metrics.reasons.map((reason) => reason.code);

describe('конфигурация', () => {
  it('веса факторов в сумме дают ровно 100', () => {
    const sum = Object.values(RISK_CONFIG.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe('сценарий из постановки задачи', () => {
  const metrics = calculateRelease(canonicalScenario());

  it('готовность считается по трудозатратам и равна примерно 78%', () => {
    expect(metrics.readinessPct).toBeCloseTo(78.1, 1);
  });

  it('узкое место — QA с загрузкой 135%', () => {
    const qa = metrics.teamLoad.find((team) => team.teamId === 'team-qa');
    expect(qa?.load).toBeCloseTo(1.35, 2);
    expect(Math.max(...metrics.teamLoad.map((t) => t.load))).toBe(qa?.load);
  });

  it('критическая цепочка длиннее оставшегося времени', () => {
    expect(metrics.remainingWorkingDays).toBe(4);
    expect(metrics.criticalChain.taskIds[0]).toBe('be-hub');
    expect(metrics.criticalChain.days).toBeGreaterThan(metrics.remainingWorkingDays);
  });

  /**
   * Ключевой тест проекта. Средневзвешенный скор даёт Medium — и именно это
   * расхождение с экспертной оценкой привело к двухуровневой модели
   * (ADR-001, §4). Если однажды скор сам дорастёт до High, тест не упадёт,
   * но об изменении смысла надо будет знать.
   */
  it('скор даёт Medium, а правила эскалации — High, как оценил бы человек', () => {
    expect(metrics.riskLevelByScore).toBe('medium');
    expect(metrics.riskLevel).toBe('high');
  });

  it('называет все сработавшие правила, а не первое по порядку', () => {
    expect(codes(metrics)).toEqual(
      expect.arrayContaining([
        'CRITICAL_BLOCKER',
        'TEAM_OVERLOAD_RULE',
        'CHAIN_EXCEEDS_TIME',
      ]),
    );
  });

  it('причины-факторы отсортированы по вкладу, перегрузка — первая', () => {
    const factors = metrics.reasons.filter((reason) => reason.kind === 'factor');
    const contributions = factors.map((reason) => reason.contribution);
    expect([...contributions].sort((a, b) => b - a)).toEqual(contributions);
    expect(factors[0]?.code).toBe('TEAM_OVERLOAD');
  });

  it('правила эскалации идут раньше факторов: они определили уровень', () => {
    expect(metrics.reasons[0]?.kind).toBe('escalation');
  });

  it('каждая причина ведёт к задачам или к конкретным фактам', () => {
    for (const reason of metrics.reasons) {
      expect(Object.keys(reason.facts).length).toBeGreaterThan(0);
    }
    const blockers = metrics.reasons.find((r) => r.code === 'CRITICAL_BLOCKER');
    expect(blockers?.taskIds).toEqual(['blocked-p0-a', 'blocked-p0-b']);
  });
});

describe('детерминированность (FR-19)', () => {
  it('один и тот же снимок даёт побайтово одинаковый результат', () => {
    const input = canonicalScenario();
    expect(calculateRelease(input)).toEqual(calculateRelease(input));
  });

  it('порядок задач во входных данных не влияет на результат', () => {
    const input = canonicalScenario();
    const shuffled = { ...input, tasks: [...input.tasks].reverse() };
    expect(calculateRelease(shuffled).riskScore).toBe(calculateRelease(input).riskScore);
  });
});

describe('правила эскалации', () => {
  const healthy = () =>
    snapshot({
      tasks: [
        task({ id: 'a', status: 'done', estimateH: 40 }),
        task({ id: 'b', estimateH: 4 }),
      ],
      capacity: [capacity('team-fe', 100), capacity('team-be', 100), capacity('team-qa', 100)],
    });

  it('спокойный релиз получает Low', () => {
    const metrics = calculateRelease(healthy());
    expect(metrics.riskLevel).toBe('low');
    expect(metrics.reasons.filter((r) => r.kind === 'escalation')).toHaveLength(0);
  });

  it('одна заблокированная P0 поднимает уровень до High', () => {
    const base = healthy();
    const metrics = calculateRelease({
      ...base,
      tasks: [
        ...base.tasks,
        task({
          id: 'p0',
          priority: 'P0',
          estimateH: 2,
          blockedSince: '2026-09-19T09:00:00.000Z',
        }),
      ],
    });
    expect(metrics.riskLevelByScore).not.toBe('high');
    expect(metrics.riskLevel).toBe('high');
  });

  it('одна заблокированная P2 до High не поднимает', () => {
    const base = healthy();
    const metrics = calculateRelease({
      ...base,
      tasks: [
        ...base.tasks,
        task({
          id: 'p2',
          priority: 'P2',
          estimateH: 2,
          blockedSince: '2026-09-19T09:00:00.000Z',
        }),
      ],
    });
    expect(metrics.riskLevel).not.toBe('high');
  });

  it('две заблокированные P1 поднимают уровень до High', () => {
    const base = healthy();
    const withOne = calculateRelease({
      ...base,
      tasks: [
        ...base.tasks,
        task({ id: 'p1-a', priority: 'P1', estimateH: 1, blockedSince: '2026-09-19T09:00:00.000Z' }),
      ],
    });
    const withTwo = calculateRelease({
      ...base,
      tasks: [
        ...base.tasks,
        task({ id: 'p1-a', priority: 'P1', estimateH: 1, blockedSince: '2026-09-19T09:00:00.000Z' }),
        task({ id: 'p1-b', priority: 'P1', estimateH: 1, blockedSince: '2026-09-19T09:00:00.000Z' }),
      ],
    });
    expect(withOne.riskLevel).not.toBe('high');
    expect(withTwo.riskLevel).toBe('high');
  });

  /** Проверка формулировки заказчика: «110% — это Medium, почти High». */
  it('загрузка 110% без других проблем даёт Medium', () => {
    const metrics = calculateRelease(
      snapshot({
        tasks: [
          task({ id: 'done', status: 'done', estimateH: 60, teamId: 'team-fe' }),
          // 28.6 ч при полезной ёмкости 26 ч — загрузка 110%.
          task({ id: 'open', estimateH: 28.6, teamId: 'team-fe' }),
        ],
        capacity: [capacity('team-fe', 50), capacity('team-be', 50), capacity('team-qa', 50)],
      }),
    );
    const fe = metrics.teamLoad.find((team) => team.teamId === 'team-fe');
    expect(fe?.load).toBeCloseTo(1.1, 2);
    expect(metrics.riskLevel).toBe('medium');
  });

  /**
   * Найдено тестом: одиночная задача длиннее остатка времени срабатывала как
   * «критическая цепочка» и поднимала релиз до High. Цепочка — это
   * последовательность, и её смысл в том, что задачи нельзя делать
   * параллельно; для одной задачи это утверждение пусто, а её объём уже
   * учтён загрузкой команды.
   */
  it('одиночная крупная задача не считается критической цепочкой', () => {
    const metrics = calculateRelease(
      snapshot({
        tasks: [task({ id: 'big', estimateH: 60, teamId: 'team-fe' })],
        capacity: [capacity('team-fe', 200), capacity('team-be', 200), capacity('team-qa', 200)],
      }),
    );
    expect(metrics.criticalChain.taskIds).toHaveLength(1);
    expect(codes(metrics)).not.toContain('CHAIN_EXCEEDS_TIME');
    expect(codes(metrics)).not.toContain('CRITICAL_CHAIN');
  });

  it('низкая вероятность выпуска поднимает уровень, высокая — нет', () => {
    const input = healthy();
    expect(calculateRelease(input, RISK_CONFIG, { probabilityOnTime: 0.9 }).riskLevel).toBe('low');
    expect(calculateRelease(input, RISK_CONFIG, { probabilityOnTime: 0.3 }).riskLevel).toBe('high');
    expect(calculateRelease(input, RISK_CONFIG, { probabilityOnTime: 0.1 }).riskLevel).toBe(
      'critical',
    );
  });

  it('правила только поднимают уровень и никогда не понижают', () => {
    // Скор заведомо в зоне Critical, при этом ни одно правило не требует High.
    const metrics = calculateRelease(
      snapshot({
        tasks: [
          task({ id: 'huge', estimateH: 400, teamId: 'team-fe' }),
          task({ id: 'huge-2', estimateH: 400, teamId: 'team-be' }),
          task({ id: 'huge-3', estimateH: 400, teamId: 'team-qa' }),
        ],
        dependencies: [blocks('huge', 'huge-2')],
        capacity: [capacity('team-fe', 10), capacity('team-be', 10), capacity('team-qa', 10)],
      }),
    );
    expect(metrics.riskLevelByScore).toBe('critical');
    expect(metrics.riskLevel).toBe('critical');
  });
});

describe('устойчивость к плохим данным', () => {
  it('пустой релиз не роняет расчёт', () => {
    const metrics = calculateRelease(snapshot());
    expect(metrics.riskScore).toBe(0);
    expect(metrics.readinessPct).toBe(0);
    expect(metrics.riskLevel).toBe('low');
  });

  it('команда без выделенной ёмкости считается перегруженной, а не свободной', () => {
    const metrics = calculateRelease(
      snapshot({
        tasks: [task({ id: 'a', estimateH: 10, teamId: 'team-fe' })],
        capacity: [],
      }),
    );
    const fe = metrics.teamLoad.find((team) => team.teamId === 'team-fe');
    expect(fe?.load).toBe(Infinity);
    expect(metrics.riskLevel).toBe('high');
  });

  it('цикл в зависимостях не приводит к бесконечному обходу', () => {
    const metrics = calculateRelease(
      snapshot({
        tasks: [task({ id: 'a' }), task({ id: 'b' })],
        dependencies: [blocks('a', 'b'), blocks('b', 'a')],
        capacity: [capacity('team-fe', 100)],
      }),
    );
    expect(Number.isFinite(metrics.criticalChain.days)).toBe(true);
  });
});
