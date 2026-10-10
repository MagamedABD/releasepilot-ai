import { describe, expect, it } from 'vitest';

import { deliveryHistory, recurringCauses, type ReleaseFact } from './analytics';

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

describe('recurringCauses', () => {
  const day = (releaseId: string, codes: string[], teams: string[] = []) => ({
    releaseId,
    codes,
    teams,
  });

  it('ранжирует по числу релизов, а не дней', () => {
    const r = recurringCauses(
      [
        // BLOCKERS стоит долго, но в одном релизе.
        day('a', ['BLOCKERS']),
        day('a', ['BLOCKERS']),
        day('a', ['BLOCKERS']),
        // QA_FUNNEL — по дню в двух релизах.
        day('a', ['QA_FUNNEL']),
        day('b', ['QA_FUNNEL']),
      ],
      new Set(),
    );
    expect(r.causes.map((c) => c.code)).toEqual(['QA_FUNNEL', 'BLOCKERS']);
    expect(r.causes[0]).toMatchObject({ releases: 2, days: 2 });
    expect(r.causes[1]).toMatchObject({ releases: 1, days: 3 });
    expect(r.releases).toBe(2);
  });

  it('при равном числе релизов выше та, что держалась дольше', () => {
    const r = recurringCauses(
      [day('a', ['TIME_DEFICIT', 'SCOPE_DRIFT']), day('a', ['TIME_DEFICIT'])],
      new Set(),
    );
    expect(r.causes.map((c) => c.code)).toEqual(['TIME_DEFICIT', 'SCOPE_DRIFT']);
  });

  it('считает, в скольких релизах причина кончилась опозданием', () => {
    const r = recurringCauses(
      [day('late', ['BLOCKERS']), day('ok', ['BLOCKERS']), day('open', ['BLOCKERS'])],
      new Set(['late']),
    );
    expect(r.causes[0]).toMatchObject({ releases: 3, lateReleases: 1 });
  });

  it('повтор кода в одном снимке — один день', () => {
    const r = recurringCauses([day('a', ['TEAM_OVERLOAD', 'TEAM_OVERLOAD'])], new Set());
    expect(r.causes[0].days).toBe(1);
  });

  it('хронические узкие места — команды, перегруженные в нескольких релизах', () => {
    const r = recurringCauses(
      [
        day('a', ['TEAM_OVERLOAD'], ['Тестирование']),
        day('b', ['TEAM_OVERLOAD'], ['Тестирование', 'Бэкенд']),
      ],
      new Set(),
    );
    expect(r.bottlenecks).toEqual([
      { team: 'Тестирование', releases: 2, days: 2 },
      { team: 'Бэкенд', releases: 1, days: 1 },
    ]);
  });

  it('без снимков — пусто, а не выдуманная история', () => {
    expect(recurringCauses([], new Set())).toEqual({ releases: 0, causes: [], bottlenecks: [] });
  });
});
