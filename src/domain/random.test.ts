import { describe, expect, it } from 'vitest';

import {
  betaVariate,
  gammaVariate,
  gaussian,
  mulberry32,
  pertShape,
  seedFromString,
} from './random';

/**
 * Свойство, ради которого генератор вообще написан свой.
 *
 * Прогноз, меняющийся при обновлении страницы, не проверяется тестом и не
 * вызывает доверия у того, кто по нему принимает решение о переносе релиза.
 */
describe('воспроизводимость', () => {
  it('одно зерно — одна последовательность', () => {
    const first = Array.from({ length: 10 }, mulberry32(42));
    const second = Array.from({ length: 10 }, mulberry32(42));
    expect(first).toEqual(second);
  });

  it('разные зёрна — разные последовательности', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('зерно из строки устойчиво и различает строки', () => {
    expect(seedFromString('rel-1')).toBe(seedFromString('rel-1'));
    expect(seedFromString('rel-1')).not.toBe(seedFromString('rel-2'));
  });

  // Ноль — рабочее состояние генератора, но зерно 0 выглядело бы как
  // «зерно забыли передать», поэтому пустая строка его не даёт.
  it('пустая строка не даёт нулевого зерна', () => {
    expect(seedFromString('')).not.toBe(0);
  });
});

describe('равномерность', () => {
  const values = Array.from({ length: 20000 }, mulberry32(7));

  it('лежит в [0, 1)', () => {
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it('среднее около 0.5', () => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeCloseTo(0.5, 2);
  });

  // Грубая проверка на перекос: в каждую десятую долю должно попасть
  // примерно по десятой части выборки.
  it('распределено по всем децилям', () => {
    const buckets = new Array(10).fill(0);
    for (const v of values) buckets[Math.floor(v * 10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(values.length / 10 * 0.9);
      expect(count).toBeLessThan((values.length / 10) * 1.1);
    }
  });
});

describe('нормальное распределение', () => {
  const random = mulberry32(11);
  const values = Array.from({ length: 20000 }, () => gaussian(random));

  it('среднее около нуля, разброс около единицы', () => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });

  it('конечно всегда', () => {
    expect(values.every(Number.isFinite)).toBe(true);
  });
});

describe('гамма-распределение', () => {
  // Математическое ожидание Gamma(k, 1) равно k. Проверяется и ветка k < 1,
  // где работает отдельное тождество, — иначе она осталась бы непокрытой.
  it.each([0.5, 1, 1.6667, 4.3333, 10])('среднее равно параметру формы: %s', (shape) => {
    const random = mulberry32(3);
    const values = Array.from({ length: 20000 }, () => gammaVariate(random, shape));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean / shape).toBeCloseTo(1, 1);
    expect(values.every((v) => v > 0)).toBe(true);
  });

  it('отвергает неположительную форму', () => {
    expect(() => gammaVariate(mulberry32(1), 0)).toThrow(/положительным/);
    expect(() => gammaVariate(mulberry32(1), -2)).toThrow(/положительным/);
  });
});

describe('Beta-PERT', () => {
  /**
   * Параметры при λ = 4 обязаны давать классическое среднее PERT
   * `(o + 4m + p) / 6`. Это и есть проверка того, что формулы α и β не
   * переставлены местами: при перестановке среднее уехало бы к другому краю,
   * а прогноз получился бы оптимистичнее оценки — то есть бесполезным.
   */
  it('среднее совпадает с формулой PERT', () => {
    const o = 0.8;
    const m = 1;
    const p = 2;
    const { alpha, beta } = pertShape(o, m, p, 4);

    const random = mulberry32(5);
    const values = Array.from(
      { length: 20000 },
      () => o + betaVariate(random, alpha, beta) * (p - o),
    );
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

    expect(mean).toBeCloseTo((o + 4 * m + p) / 6, 2);
  });

  it('не выходит за три точки', () => {
    const { alpha, beta } = pertShape(0.8, 1, 2, 4);
    const random = mulberry32(9);
    for (let i = 0; i < 5000; i++) {
      const value = betaVariate(random, alpha, beta);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  /**
   * Асимметрия — смысл всей затеи: оценки занижают, а не завышают. Медиана
   * обязана лежать левее середины отрезка `[0.8, 2]`, иначе распределение
   * говорило бы, что перерасход и экономия равновероятны.
   */
  it('смещено к вероятному значению, а не к середине размаха', () => {
    const { alpha, beta } = pertShape(0.8, 1, 2, 4);
    const random = mulberry32(13);
    const values = Array.from(
      { length: 20000 },
      () => 0.8 + betaVariate(random, alpha, beta) * 1.2,
    ).sort((a, b) => a - b);

    const median = values[Math.floor(values.length / 2)];
    expect(median).toBeLessThan(1.4);
    expect(median).toBeGreaterThan(0.9);
  });

  it('на вырожденных трёх точках не делит на ноль', () => {
    expect(pertShape(5, 5, 5, 4)).toEqual({ alpha: 1, beta: 1 });
    expect(Number.isFinite(betaVariate(mulberry32(1), 1, 1))).toBe(true);
  });
});
