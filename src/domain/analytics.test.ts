import { describe, expect, it } from 'vitest';

import { deliveryHistory, type ReleaseFact } from './analytics';

const fact = (over: Partial<ReleaseFact> = {}): ReleaseFact => ({
  releaseId: 'r1',
  name: 'Release 1',
  projectKey: 'PAY',
  status: 'released',
  plannedDate: '2026-09-01',
  releasedAt: '2026-09-01T12:00:00.000Z',
  ...over,
});

describe('доля релизов в срок (FR-36)', () => {
  it('выпуск в день срока считается выполненным', () => {
    // План назначается на день, а не на час: релиз, ушедший в шесть
    // вечера того же дня, опоздавшим не является.
    const h = deliveryHistory([fact({ releasedAt: '2026-09-01T18:30:00.000Z' })]);
    expect(h.onTime).toBe(1);
    expect(h.onTimePct).toBe(100);
    expect(h.records[0].deviationDays).toBe(0);
    expect(h.records[0].delayDays).toBe(0);
  });

  it('досрочный выпуск даёт отрицательное отклонение и нулевую задержку', () => {
    const h = deliveryHistory([fact({ releasedAt: '2026-08-28T09:00:00.000Z' })]);
    expect(h.records[0].deviationDays).toBe(-4);
    expect(h.records[0].delayDays).toBe(0);
    expect(h.onTime).toBe(1);
  });

  it('без выпущенных релизов процент не выдумывается', () => {
    const h = deliveryHistory([fact({ status: 'active', releasedAt: null })]);
    expect(h.onTimePct).toBeNull();
    expect(h.avgDelayDays).toBeNull();
    expect(h.inFlight).toBe(1);
  });
});

/*
  Главное свойство этого расчёта, из-за которого он не сводится к одному
  среднему. Команда, которая через релиз то выпускает на десять дней
  раньше, то опаздывает на десять, в срок не попадает никогда — но
  среднее отклонение у неё нулевое.
*/
describe('средняя задержка считается по опоздавшим', () => {
  const alternating = [
    fact({ releaseId: 'a', releasedAt: '2026-08-22T10:00:00.000Z' }),
    fact({ releaseId: 'b', plannedDate: '2026-09-10', releasedAt: '2026-09-20T10:00:00.000Z' }),
  ];

  it('не гасит опоздания досрочными выпусками', () => {
    const h = deliveryHistory(alternating);
    expect(h.avgDelayDays).toBe(10);
    // Дополнение, из которого видно, что разброс есть: −10 и +10.
    expect(h.avgDeviationDays).toBe(0);
    expect(h.onTimePct).toBe(50);
  });

  it('отсутствие опозданий — это ноль, а не «неизвестно»', () => {
    expect(deliveryHistory([fact()]).avgDelayDays).toBe(0);
  });

  it('называет худший релиз, а не только число', () => {
    const h = deliveryHistory([
      ...alternating,
      fact({ releaseId: 'c', plannedDate: '2026-07-01', releasedAt: '2026-07-31T10:00:00.000Z' }),
    ]);
    expect(h.worstDelay?.releaseId).toBe('c');
    expect(h.worstDelay?.delayDays).toBe(30);
  });
});

describe('не выпущенные релизы', () => {
  /*
    Отменённый релиз не опаздывает никогда, поэтому его нельзя ни
    засчитать в срок, ни выбросить молча: доля «в срок» среди выпущенных
    тем лживее, чем больше релизов отменили. Числа стоят рядом с
    процентом, чтобы его можно было прочесть в контексте.
  */
  it('отменённые и перенесённые не попадают в процент, но видны', () => {
    const h = deliveryHistory([
      fact({ releaseId: 'ok' }),
      fact({ releaseId: 'x', status: 'cancelled', releasedAt: null }),
      fact({ releaseId: 'p', status: 'postponed', releasedAt: null }),
    ]);
    expect(h.released).toBe(1);
    expect(h.onTimePct).toBe(100);
    expect(h.cancelled).toBe(1);
    expect(h.postponed).toBe(1);
  });

  it('«выпущен» без даты выпуска не приписывается к успевшим', () => {
    const h = deliveryHistory([fact({ status: 'released', releasedAt: null })]);
    expect(h.released).toBe(0);
    expect(h.releasedWithoutDate).toBe(1);
    expect(h.onTimePct).toBeNull();
  });
});

describe('динамика (FR-38)', () => {
  it('записи идут по порядку выпуска, а не по порядку в выборке', () => {
    const h = deliveryHistory([
      fact({ releaseId: 'late', plannedDate: '2026-09-10', releasedAt: '2026-09-15T10:00:00.000Z' }),
      fact({ releaseId: 'early', plannedDate: '2026-08-10', releasedAt: '2026-08-11T10:00:00.000Z' }),
    ]);
    expect(h.records.map((r) => r.releaseId)).toEqual(['early', 'late']);
  });
});
