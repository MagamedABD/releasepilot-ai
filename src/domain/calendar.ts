import type { IsoDate, IsoDateTime } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Всё считается в UTC. Причина не в академической чистоте: при расчёте
 * в локальной зоне один и тот же снимок даёт разный результат на машине
 * разработчика и на сервере, а детерминированность — требование FR-19.
 */
export function parseInstant(value: IsoDate | IsoDateTime): Date {
  const iso = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Некорректная дата: ${value}`);
  }
  return date;
}

/** Отбрасывает время, оставляя календарный день в UTC. */
export function startOfDay(value: IsoDate | IsoDateTime): Date {
  const d = parseInstant(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Страховка от зацикливания на мусорных датах вроде 3000 года. */
const MAX_SPAN_DAYS = 3650;

/**
 * Рабочие дни в отрезке, включая обе границы.
 * Выходные — суббота и воскресенье, праздники приходят снимком.
 */
export function workingDaysInclusive(
  from: Date,
  to: Date,
  holidays: ReadonlySet<IsoDate>,
): number {
  if (to.getTime() < from.getTime()) return 0;

  const span = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (span > MAX_SPAN_DAYS) {
    throw new Error(`Слишком длинный период: ${span} дней`);
  }

  let count = 0;
  for (let i = 0; i <= span; i++) {
    const day = addDays(from, i);
    if (!isWeekend(day) && !holidays.has(toIsoDate(day))) count++;
  }
  return count;
}

/**
 * Рабочие дни, оставшиеся до даты включительно, не считая сам день `from`.
 *
 * Текущий день не учитывается сознательно: он уже частично израсходован,
 * и считать его целым — способ получить оптимистичный прогноз на ровном месте.
 */
export function remainingWorkingDays(
  now: IsoDateTime,
  until: IsoDate,
  holidays: ReadonlySet<IsoDate>,
): number {
  const from = addDays(startOfDay(now), 1);
  const to = startOfDay(until);
  return workingDaysInclusive(from, to, holidays);
}

export function daysBetween(from: IsoDateTime, to: IsoDateTime): number {
  return (parseInstant(to).getTime() - parseInstant(from).getTime()) / DAY_MS;
}
