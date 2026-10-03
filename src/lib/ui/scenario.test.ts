import { describe, expect, it } from 'vitest';

import {
  ESCALATION_ADVICE,
  LEVEL_GENITIVE,
  direction,
  levelChange,
  lowerLevel,
  pct,
  signed,
} from './scenario';

describe('число со знаком', () => {
  it('плюс обязателен: «риск 12.4» и «риск +12.4» читаются по-разному', () => {
    expect(signed(12.4)).toBe('+12.4');
    expect(signed(-12.4)).toBe('−12.4');
    expect(signed(0)).toBe('0');
  });

  it('минус — типографский, а не дефис', () => {
    // Дефис в табличных цифрах выглядит переносом строки.
    expect(signed(-3)).toBe('−3');
  });

  it('целое не носит нулевую дробную часть', () => {
    expect(signed(-12)).toBe('−12');
    expect(signed(-12.04, 1)).toBe('−12');
  });
});

/*
  Направление задаётся вызывающим, а не выводится из знака. Для риска
  меньше — лучше, для вероятности и готовности — наоборот, и общее правило
  «минус значит хорошо» однажды покрасило бы рост вероятности красным.
*/
describe('направление изменения', () => {
  it('для риска лучше меньше', () => {
    expect(direction(-5, true)).toBe('better');
    expect(direction(5, true)).toBe('worse');
  });

  it('для вероятности лучше больше', () => {
    expect(direction(5, false)).toBe('better');
    expect(direction(-5, false)).toBe('worse');
  });

  it('ноль — это «так же», а не «лучше»', () => {
    expect(direction(0, true)).toBe('same');
    expect(direction(0, false)).toBe('same');
  });
});

describe('переход уровня', () => {
  const label = (l: string) => l.toUpperCase();

  it('показывает оба уровня, когда он изменился', () => {
    expect(levelChange('high', 'medium', label)).toBe('HIGH → MEDIUM');
  });

  it('и один, когда не изменился', () => {
    expect(levelChange('high', 'high', label)).toBe('HIGH');
  });
});

describe('цель подбора', () => {
  it('на один уровень ниже текущего', () => {
    expect(lowerLevel('critical')).toBe('high');
    expect(lowerLevel('high')).toBe('medium');
    expect(lowerLevel('medium')).toBe('low');
  });

  it('у низкого цели нет — снижать нечего', () => {
    // null здесь означает «нечего снижать», а не «не смогли посчитать».
    expect(lowerLevel('low')).toBeNull();
  });
});

describe('проценты из доли', () => {
  it('null остаётся прочерком: незнание — не ноль', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0)).toBe('0%');
    expect(pct(0.384)).toBe('38%');
  });
});

describe('советы по правилам эскалации', () => {
  it('заблокированная P0 советует разблокировать, а не переносить', () => {
    // Ради этого случая у подбора и появился ответ «недостижимо»: код
    // CRITICAL_BLOCKER сам по себе ничего не советует.
    expect(ESCALATION_ADVICE.CRITICAL_BLOCKER).toContain('разблокировать');
  });
});

describe('уровень в родительном падеже', () => {
  /*
    «Уровень до высокий не опустить» — так экран сценариев писал на
    продакшне. Строка собиралась из двух правильных частей, и ни одна из
    них по отдельности не была неверной.
  */
  it('подставляется после «до» и «ниже» без ошибки падежа', () => {
    expect(`до ${LEVEL_GENITIVE.high}`).toBe('до высокого');
    expect(LEVEL_GENITIVE.medium).toBe('среднего');
    // «среднего» — мягкая основа, поэтому окончание и «-ого», и «-его».
    expect(Object.values(LEVEL_GENITIVE).every((v) => /(ого|его)$/.test(v))).toBe(true);
  });
});
