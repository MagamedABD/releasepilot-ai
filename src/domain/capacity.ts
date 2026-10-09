/**
 * Ёмкость команды за вычетом отсутствий (FR-11, US-08).
 *
 * Ёмкость задаётся на период номинальными часами — сколько команда может
 * дать, если все на месте. Отпуск или больничный участника эти часы
 * уменьшает: каждый его рабочий день отсутствия внутри периода снимает
 * `workingHoursPerDay`, умноженные на долю, которую он отдаёт команде.
 * Человек на 50% в двух командах, уйдя в отпуск, уменьшает обе — каждую
 * на свою половину.
 *
 * Функция чистая, как и весь движок: на вход строки, на выход строки, без
 * базы и часов. Ёмкость не уходит ниже нуля — отпуск всей команды делает
 * её нулевой, а не отрицательной, иначе загрузка стала бы бессмысленным
 * отрицательным процентом.
 */

import { startOfDay, workingDaysInclusive } from './calendar';
import type { IsoDate, TeamCapacity } from './types';

export type TeamMember = {
  teamId: string;
  profileId: string;
  /** Доля времени, отдаваемая этой команде, 1–100. */
  allocationPct: number;
};

export type Absence = {
  profileId: string;
  startDate: IsoDate;
  endDate: IsoDate;
};

/** Часы, на которые отсутствия уменьшают одну запись ёмкости. */
export function absenceHours(
  capacity: TeamCapacity,
  members: readonly TeamMember[],
  absences: readonly Absence[],
  hoursPerDay: number,
  holidays: ReadonlySet<IsoDate> = new Set(),
): number {
  let total = 0;
  for (const m of members) {
    if (m.teamId !== capacity.teamId) continue;
    for (const a of absences) {
      if (a.profileId !== m.profileId) continue;
      // Пересечение отсутствия с периодом ёмкости; строки ISO-дат
      // сравниваются как даты.
      const from = a.startDate > capacity.periodStart ? a.startDate : capacity.periodStart;
      const to = a.endDate < capacity.periodEnd ? a.endDate : capacity.periodEnd;
      if (from > to) continue;
      const days = workingDaysInclusive(startOfDay(from), startOfDay(to), holidays);
      total += days * hoursPerDay * (m.allocationPct / 100);
    }
  }
  return total;
}

export function netCapacity(
  capacity: readonly TeamCapacity[],
  members: readonly TeamMember[],
  absences: readonly Absence[],
  hoursPerDay: number,
  holidays: ReadonlySet<IsoDate> = new Set(),
): TeamCapacity[] {
  if (absences.length === 0) return [...capacity];
  return capacity.map((c) => ({
    ...c,
    availableHours: Math.max(
      0,
      c.availableHours - absenceHours(c, members, absences, hoursPerDay, holidays),
    ),
  }));
}
