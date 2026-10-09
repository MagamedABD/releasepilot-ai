import { describe, expect, it } from 'vitest';

import { canonicalScenario, snapshot } from '@/domain/fixtures';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';

import { executiveStatus } from './status';

function status(snap = canonicalScenario()) {
  const forecast = forecastRelease(snap);
  const metrics = calculateRelease(snap, undefined, {
    probabilityOnTime: forecast.probabilityOnTime,
  });
  return {
    metrics,
    forecast,
    lines: executiveStatus({
      name: snap.release.name,
      plannedDate: snap.release.plannedDate,
      metrics,
      forecast,
    }),
  };
}

describe('executiveStatus', () => {
  it('от пяти до семи строк — столько, сколько читает руководитель', () => {
    const { lines } = status();
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.length).toBeLessThanOrEqual(7);
  });

  it('числа — те же, что у движка', () => {
    const { lines, metrics } = status();
    expect(lines[0]).toContain(`(${Math.round(metrics.riskScore)})`);
    expect(lines[0]).toContain(`${metrics.readinessPct.toFixed(1)}%`);
    expect(lines[2]).toContain(`из ${metrics.counts.total} задач`);
  });

  it('без истории вероятность не называется, а объясняется', () => {
    const { lines, forecast } = status();
    // Фикстура не передаёт выпущенных релизов — прогноз упрощённый.
    expect(forecast.probabilityOnTime).toBeNull();
    expect(lines[1]).toContain('вероятность не оценивается: мало истории');
    expect(lines.join(' ')).not.toContain('—%');
  });

  it('главная угроза и следующий шаг идут от первой причины', () => {
    const { lines, metrics } = status();
    expect(metrics.reasons.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith('Главная угроза: '))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Что делаем: /);
  });

  it('вероятность не повторяется «главной угрозой» — она уже во второй строке', () => {
    const { lines } = status();
    expect(lines.filter((l) => l.includes('Вероятность выпуска в срок'))).toHaveLength(0);
  });

  it('пустой релиз — без угроз и без выдуманных действий', () => {
    const { lines } = status(snapshot({ tasks: [], dependencies: [] }));
    expect(lines).toContain('Факторов риска выше порога нет.');
    expect(lines.at(-1)).toBe('Что делаем: вмешательство не требуется, держим курс.');
  });
});
