import { describe, expect, it } from 'vitest';

import { TOOL_SCHEMAS } from '@/lib/agent/tools';

import { SUGGESTED_QUESTIONS, toolFailureLabel, toolLabel } from './agent';

describe('подписи инструментов', () => {
  /*
    Проверка, которая и есть смысл этого модуля: подпись обязана быть у
    каждого инструмента. Иначе в диалоге всплывёт «get_team_load», и
    видимость вызовов — требование экрана 5 — превратится в видимость
    английских имён функций.
  */
  it('есть у каждого инструмента агента', () => {
    for (const name of Object.keys(TOOL_SCHEMAS)) {
      const label = toolLabel(name);
      expect(label, name).not.toBe(name);
      expect(label).toMatch(/^[а-яё]/);
    }
  });

  it('неизвестное имя показывается как есть, а не прячется за «работаю»', () => {
    // Это значит, что инструмент добавили, а подпись забыли.
    expect(toolLabel('get_weather')).toBe('get_weather');
  });

  it('отказ инструмента виден отдельно', () => {
    expect(toolFailureLabel('get_blockers')).toBe('смотрю блокеры — не удалось');
  });
});

describe('подсказки вопросов', () => {
  it('совпадают со сценариями из документа: вопросы, а не команды', () => {
    expect(SUGGESTED_QUESTIONS.length).toBeGreaterThan(2);
    expect(SUGGESTED_QUESTIONS.every((q) => q.endsWith('?'))).toBe(true);
  });
});
