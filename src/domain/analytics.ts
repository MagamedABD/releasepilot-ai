/**
 * История поставки: доля релизов в срок, задержки, динамика (FR-36, FR-38).
 *
 * Слой чистый, как и остальной домен: на вход — факты о релизах, на выход
 * — числа. Ни базы, ни времени вызова здесь нет.
 *
 * Считается это по самим релизам, а не по снимкам метрик. Разница
 * принципиальна и определяет, на какие вопросы отвечает эндпоинт
 * аналитики. Факт «выпущен четвёртого вместо первого» живёт в релизе и
 * доступен сразу. А вопрос «какие причины риска повторяются из релиза в
 * релиз» (FR-37) требует знать, что система думала о релизе тогда, и
 * восстановить это из сегодняшних данных нельзя: задачи закрыты, блокеры
 * сняты, загрузка обнулилась. Отвечать на него пересчётом по текущему
 * состоянию значило бы выдать «в прошлом всё было хорошо» за историю.
 * Поэтому такие ответы берутся из `release_snapshots` (FR-39), и здесь их
 * нет.
 */

import { startOfDay } from './calendar';
import type { IsoDate, IsoDateTime } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeliveryStatus = 'planned' | 'active' | 'released' | 'postponed' | 'cancelled';

export type ReleaseFact = {
  releaseId: string;
  name: string;
  projectKey: string;
  status: DeliveryStatus;
  plannedDate: IsoDate;
  releasedAt: IsoDateTime | null;
};

export type DeliveryRecord = {
  releaseId: string;
  name: string;
  projectKey: string;
  plannedDate: IsoDate;
  releasedDate: IsoDate;
  /**
   * Отклонение со знаком, в календарных днях: минус — раньше срока.
   *
   * Календарных, а не рабочих, хотя движок везде считает рабочие. Вопросы
   * разные: «сколько работы влезет до срока» — про рабочие дни, а
   * «насколько мы опоздали» — про те дни, которые ждал заказчик, и
   * выходные он ждал тоже.
   */
  deviationDays: number;
  /** Задержка: то же, но без отрицательных значений. */
  delayDays: number;
  onTime: boolean;
};

export type DeliveryHistory = {
  /** Сколько релизов вообще учтено в знаменателе процента. */
  released: number;
  onTime: number;
  /** Доля в срок, 0–100. `null`, когда выпущенных релизов нет. */
  onTimePct: number | null;
  /**
   * Средняя задержка по опоздавшим, а не по всем.
   *
   * Иначе досрочные релизы гасят опоздания: команда, которая через релиз
   * то выпускает на десять дней раньше, то опаздывает на десять, получила
   * бы «среднюю задержку 0» — ответ, из которого следует, что всё в
   * порядке, тогда как в срок она не попадает никогда.
   */
  avgDelayDays: number | null;
  /** Среднее отклонение со знаком по всем выпущенным — дополнение к нему. */
  avgDeviationDays: number | null;
  worstDelay: DeliveryRecord | null;
  /**
   * Не выпущенные релизы. Нужны рядом с процентом, а не вместо него:
   * доля «в срок» среди выпущенных лжёт тем сильнее, чем больше релизов
   * отменили или перенесли, — отменённый релиз не опаздывает никогда.
   */
  cancelled: number;
  postponed: number;
  inFlight: number;
  /**
   * Релизы со статусом «выпущен» и без даты выпуска. Не молча
   * приписываются к успевшим: это расхождение в данных, и знать о нём
   * важнее, чем получить процент, посчитанный на догадке.
   */
  releasedWithoutDate: number;
  /** По порядку выпуска — это и есть динамика (FR-38). */
  records: DeliveryRecord[];
};

/** Разница в календарных днях по UTC-дням, без часов и часовых поясов. */
function dayDiff(from: IsoDate | IsoDateTime, to: IsoDate | IsoDateTime): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  // Один знак после запятой: «средняя задержка 2.7 дня» осмысленна,
  // 2.7333333333 — нет, а сравнивать такие числа в тестах мучительно.
  return Math.round((sum / values.length) * 10) / 10;
}

export function deliveryHistory(facts: ReleaseFact[]): DeliveryHistory {
  const records: DeliveryRecord[] = [];
  let cancelled = 0;
  let postponed = 0;
  let inFlight = 0;
  let releasedWithoutDate = 0;

  for (const fact of facts) {
    if (fact.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    if (fact.status === 'postponed') {
      postponed += 1;
      continue;
    }
    if (fact.status !== 'released') {
      inFlight += 1;
      continue;
    }
    if (!fact.releasedAt) {
      releasedWithoutDate += 1;
      continue;
    }

    const deviationDays = dayDiff(fact.plannedDate, fact.releasedAt);
    records.push({
      releaseId: fact.releaseId,
      name: fact.name,
      projectKey: fact.projectKey,
      plannedDate: fact.plannedDate,
      releasedDate: fact.releasedAt.slice(0, 10),
      deviationDays,
      delayDays: Math.max(0, deviationDays),
      // Выпуск в день срока — в срок: план назначен на день, а не на час.
      onTime: deviationDays <= 0,
    });
  }

  records.sort((a, b) => a.releasedDate.localeCompare(b.releasedDate));

  const late = records.filter((r) => !r.onTime);
  const onTime = records.length - late.length;

  return {
    released: records.length,
    onTime,
    onTimePct:
      records.length === 0 ? null : Math.round((onTime / records.length) * 1000) / 10,
    // Ни одного опоздавшего — это 0, а не «неизвестно»: отсутствие
    // задержек и отсутствие релизов означают разное.
    avgDelayDays: records.length === 0 ? null : (mean(late.map((r) => r.delayDays)) ?? 0),
    avgDeviationDays: mean(records.map((r) => r.deviationDays)),
    worstDelay: late.reduce<DeliveryRecord | null>(
      (worst, r) => (worst === null || r.delayDays > worst.delayDays ? r : worst),
      null,
    ),
    cancelled,
    postponed,
    inFlight,
    releasedWithoutDate,
    records,
  };
}
