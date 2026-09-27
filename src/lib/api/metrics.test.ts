import { describe, expect, it } from 'vitest';

import { canonicalScenario, capacity, snapshot, task } from '@/domain/fixtures';
import { calculateRelease } from '@/domain/risk';

import { toApiMetrics } from './metrics';

/** Работа есть, ёмкости нет: загрузка не «высокая», а неопределимая. */
const noCapacity = () =>
  snapshot({ capacity: [], tasks: [task({ id: 't1', teamId: 'team-fe', estimateH: 40 })] });

describe('перевод метрик в ответ API', () => {
  it('сохраняет всё, кроме загрузки команд', () => {
    const metrics = calculateRelease(canonicalScenario());
    const api = toApiMetrics(metrics);

    expect(api.riskScore).toBe(metrics.riskScore);
    expect(api.riskLevel).toBe(metrics.riskLevel);
    expect(api.reasons).toEqual(metrics.reasons);
    expect(api.blockers).toEqual(metrics.blockers);
    expect(api.criticalChain).toEqual(metrics.criticalChain);
    expect(api.effort).toEqual(metrics.effort);
    expect(api.teamLoad).toHaveLength(metrics.teamLoad.length);
  });

  it('у команды с ёмкостью загрузка остаётся числом', () => {
    const api = toApiMetrics(
      calculateRelease(
        snapshot({
          capacity: [capacity('team-fe', 100)],
          tasks: [task({ id: 't1', teamId: 'team-fe', estimateH: 26 })],
        }),
      ),
    );

    const fe = api.teamLoad.find((t) => t.teamId === 'team-fe');
    expect(fe?.hasCapacity).toBe(true);
    expect(typeof fe?.load).toBe('number');
  });
});

/**
 * Причина, по которой этот слой существует.
 *
 * `JSON.stringify(Infinity)` возвращает `null` — молча. Отдай метрики
 * движка напрямую, и команда, у которой на остаток работ нет ни часа,
 * выглядела бы в ответе так же, как команда, для которой загрузку не
 * считали. Это противоположные вещи: во втором случае делать нечего, в
 * первом — надо снимать работу.
 */
describe('отсутствие ёмкости выражается признаком, а не числом', () => {
  it('бесконечная загрузка становится null с признаком hasCapacity', () => {
    const metrics = calculateRelease(noCapacity());
    const engine = metrics.teamLoad.find((t) => t.teamId === 'team-fe');
    expect(engine?.load).toBe(Infinity);

    const fe = toApiMetrics(metrics).teamLoad.find((t) => t.teamId === 'team-fe');
    expect(fe?.load).toBeNull();
    expect(fe?.hasCapacity).toBe(false);
    // Остаток работ при этом известен и теряться не должен: именно он
    // отвечает на вопрос «сколько часов снимать».
    expect(fe?.remainingH).toBeGreaterThan(0);
  });

  /*
    Второе место, где живёт бесконечность, и его легко не заметить: в
    `facts` у причин лежат те же отношения, что и в `teamLoad`. Пропусти
    их — и ответ остался бы валидным JSON с `null` вместо величины.
  */
  it('бесконечные величины в фактах причин тоже становятся null', () => {
    const metrics = calculateRelease(noCapacity());
    const overload = metrics.reasons.find((r) => r.code === 'TEAM_OVERLOAD');
    expect(overload?.facts.load).toBe(Infinity);

    const api = toApiMetrics(metrics);
    const apiOverload = api.reasons.find((r) => r.code === 'TEAM_OVERLOAD');
    expect(apiOverload?.facts.load).toBeNull();
    // Остальные факты не тронуты: просеивается значение, а не поле.
    expect(apiOverload?.facts.teamId).toBe('team-fe');
  });

  it('ответ переживает сериализацию без потери смысла', () => {
    const api = toApiMetrics(calculateRelease(noCapacity()));
    const revived = JSON.parse(JSON.stringify(api)) as typeof api;

    expect(revived).toEqual(api);
    expect(revived.teamLoad.find((t) => t.teamId === 'team-fe')?.hasCapacity).toBe(false);
  });

  it('у канонического сценария ни одно число не теряется при сериализации', () => {
    const api = toApiMetrics(calculateRelease(canonicalScenario()));
    const revived = JSON.parse(JSON.stringify(api)) as typeof api;

    expect(revived).toEqual(api);
    expect(revived.teamLoad.every((t) => t.hasCapacity)).toBe(true);
  });
});
