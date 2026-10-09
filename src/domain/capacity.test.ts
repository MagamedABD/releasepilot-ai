import { describe, expect, it } from 'vitest';

import { absenceHours, netCapacity, type Absence, type TeamMember } from './capacity';
import type { TeamCapacity } from './types';

// Неделя 5–9 октября 2026: понедельник — пятница.
const CAP: TeamCapacity = {
  teamId: 'be',
  periodStart: '2026-10-05',
  periodEnd: '2026-10-16',
  availableHours: 160,
};
const MEMBERS: TeamMember[] = [
  { teamId: 'be', profileId: 'anna', allocationPct: 100 },
  { teamId: 'be', profileId: 'oleg', allocationPct: 50 },
  { teamId: 'fe', profileId: 'oleg', allocationPct: 50 },
];

const off = (profileId: string, startDate: string, endDate: string): Absence => ({
  profileId,
  startDate,
  endDate,
});

describe('absenceHours', () => {
  it('рабочие дни отсутствия × часы в день', () => {
    // Пн–ср, три рабочих дня.
    expect(absenceHours(CAP, MEMBERS, [off('anna', '2026-10-05', '2026-10-07')], 8)).toBe(24);
  });

  it('выходные внутри отсутствия не считаются', () => {
    // Пт–пн: пятница и понедельник, суббота с воскресеньем — нет.
    expect(absenceHours(CAP, MEMBERS, [off('anna', '2026-10-09', '2026-10-12')], 8)).toBe(16);
  });

  it('учитывается только пересечение с периодом', () => {
    // Отпуск начался до периода: в период попадают 5 и 6 октября.
    expect(absenceHours(CAP, MEMBERS, [off('anna', '2026-09-28', '2026-10-06')], 8)).toBe(16);
  });

  it('частичная занятость уменьшает вычет', () => {
    // Олег отдаёт бэкенду половину времени: два дня — 8 часов, а не 16.
    expect(absenceHours(CAP, MEMBERS, [off('oleg', '2026-10-05', '2026-10-06')], 8)).toBe(8);
  });

  it('отсутствие вне периода и чужой команды не влияет', () => {
    expect(absenceHours(CAP, MEMBERS, [off('anna', '2026-11-02', '2026-11-03')], 8)).toBe(0);
    expect(absenceHours(CAP, [MEMBERS[2]], [off('oleg', '2026-10-05', '2026-10-06')], 8)).toBe(0);
  });

  it('праздники не вычитаются повторно', () => {
    const holidays = new Set(['2026-10-05']);
    expect(
      absenceHours(CAP, MEMBERS, [off('anna', '2026-10-05', '2026-10-06')], 8, holidays),
    ).toBe(8);
  });
});

describe('netCapacity', () => {
  it('без отсутствий возвращает ёмкость как есть', () => {
    expect(netCapacity([CAP], MEMBERS, [], 8)).toEqual([CAP]);
  });

  it('вычитает отсутствия и не уходит ниже нуля', () => {
    const [net] = netCapacity([CAP], MEMBERS, [off('anna', '2026-10-05', '2026-10-07')], 8);
    expect(net.availableHours).toBe(136);

    const [zero] = netCapacity(
      [{ ...CAP, availableHours: 10 }],
      MEMBERS,
      [off('anna', '2026-10-05', '2026-10-16')],
      8,
    );
    expect(zero.availableHours).toBe(0);
  });
});
