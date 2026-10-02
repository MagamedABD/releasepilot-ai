import { describe, expect, it } from 'vitest';

import { isToolName, toolDefinitions, TOOL_SCHEMAS, type ToolName } from './tools';

const defs = toolDefinitions();

describe('описания инструментов для модели', () => {
  it('каждый инструмент назван, объяснён и несёт схему входа', () => {
    expect(defs).toHaveLength(Object.keys(TOOL_SCHEMAS).length);
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(40);
      expect(d.input_schema).toMatchObject({ type: 'object' });
    }
  });

  /*
    Главное свойство: схема выводится из той же проверки, которой потом
    разбирается вход. Напиши их раздельно — и в день, когда модель
    пришлёт поле, которого в проверке нет, расхождение обнаружится в
    работе, а не в тестах.
  */
  it('схема выведена из проверки, а не написана отдельно', () => {
    const simulate = defs.find((d) => d.name === 'simulate_scenario');
    const props = (simulate?.input_schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props).sort()).toEqual([
      'exclude_task_ids',
      'extra_capacity',
      'release_id',
    ]);
    expect((simulate?.input_schema as { required: string[] }).required).toEqual(['release_id']);
  });

  it('изменяющий инструмент ровно один — и это предложение, а не применение', () => {
    const writing = defs.filter((d) => d.writes).map((d) => d.name);
    expect(writing).toEqual(['propose_scenario']);
    // Применение остаётся за человеком: у агента нет такого инструмента.
    expect(defs.some((d) => d.name.includes('apply'))).toBe(false);
  });

  it('неизвестное имя инструмента распознаётся', () => {
    expect(isToolName('get_blockers')).toBe(true);
    expect(isToolName('apply_scenario')).toBe(false);
  });
});

describe('проверка входа инструментов', () => {
  it('мусор вместо идентификатора отвергается', () => {
    expect(TOOL_SCHEMAS.get_blockers.safeParse({ release_id: 'не-uuid' }).success).toBe(false);
  });

  it('выборка задач ограничена сверху', () => {
    const ok = TOOL_SCHEMAS.list_tasks.safeParse({
      release_id: '11111111-1111-4111-8111-111111111111',
      limit: 50,
    });
    expect(ok.success).toBe(true);
    expect(
      TOOL_SCHEMAS.list_tasks.safeParse({
        release_id: '11111111-1111-4111-8111-111111111111',
        limit: 500,
      }).success,
    ).toBe(false);
  });

  it('подбор требует ровно одной цели', () => {
    const release_id = '11111111-1111-4111-8111-111111111111';
    expect(TOOL_SCHEMAS.suggest_scenario.safeParse({ release_id }).success).toBe(false);
    expect(
      TOOL_SCHEMAS.suggest_scenario.safeParse({ release_id, target_risk_level: 'medium' }).success,
    ).toBe(true);
    // Две цели сразу — это не «одна из них», а вопрос без ответа.
    expect(
      TOOL_SCHEMAS.suggest_scenario.safeParse({
        release_id,
        target_risk_level: 'medium',
        target_probability: 0.8,
      }).success,
    ).toBe(false);
  });

  it('у каждого инструмента, кроме истории, релиз обязателен', () => {
    for (const name of Object.keys(TOOL_SCHEMAS) as ToolName[]) {
      if (name === 'get_release_history') continue;
      expect(TOOL_SCHEMAS[name].safeParse({}).success, name).toBe(false);
    }
  });
});
