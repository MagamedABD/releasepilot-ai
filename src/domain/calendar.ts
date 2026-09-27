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

/**
 * Обратная операция к `remainingWorkingDays`: дата, до которой остаётся
 * ровно `days` рабочих дней.
 *
 * Дробное число дней округляется вверх. Задача, требующая 2.1 рабочего дня,
 * заканчивается на третий день, а не «через два дня с хвостиком»: календарь
 * не знает половин дней, а прогноз должен называть день, в который релиз
 * готов, а не момент, когда работа теоретически исчерпана.
 *
 * Тот же отсчёт, что и в `remainingWorkingDays`: считаем с завтрашнего дня,
 * поэтому обе функции обратны друг другу — это проверяется тестом.
 */
export function dateAfterWorkingDays(
  now: IsoDateTime,
  days: number,
  holidays: ReadonlySet<IsoDate>,
): IsoDate {
  if (!Number.isFinite(days)) {
    throw new Error(`Не число рабочих дней: ${days}`);
  }

  let cursor = startOfDay(now);
  let remaining = Math.ceil(days);
  // Ноль и меньше — работы не осталось, готово сегодня.
  if (remaining <= 0) return toIsoDate(cursor);

  for (let step = 0; remaining > 0; step++) {
    if (step > MAX_SPAN_DAYS) {
      throw new Error(`Слишком далёкая дата: ${Math.ceil(days)} рабочих дней`);
    }
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor) && !holidays.has(toIsoDate(cursor))) remaining--;
  }

  return toIsoDate(cursor);
}

export function daysBetween(from: IsoDateTime, to: IsoDateTime): number {
  return (parseInstant(to).getTime() - parseInstant(from).getTime()) / DAY_MS;
}
