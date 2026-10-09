/**
 * Порядок релизов: где горит — сверху.
 *
 * Не по дате. Менеджер открывает список, чтобы узнать, где горит, а не
 * чтобы посмотреть календарь. Поэтому сверху идут идущие релизы, ниже
 * запланированные, в самом низу выпущенные и отменённые — про них решение
 * уже принято.
 *
 * Внутри группы — по скору, а не по уровню. Уровень грубый: два релиза
 * могут оба оказаться «высокими» при скорах 39 и 8, и тогда список,
 * отсортированный по уровню, поставит их рядом как равные. Скор разводит.
 *
 * Вынесено из списка релизов, потому что тем же порядком пользуются меню
 * и кнопка «AI-ассистент»: ассистент без выбранного релиза открывается на
 * самом горящем, и «самый горящий» должен значить то же, что в списке.
 */

import type { ReleaseWithMetrics } from '@/lib/data/snapshot';

export const STATUS_ORDER: Record<string, number> = {
  active: 0,
  planned: 1,
  postponed: 2,
  released: 3,
  cancelled: 4,
};

export function byUrgency(a: ReleaseWithMetrics, b: ReleaseWithMetrics): number {
  const order = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (order !== 0) return order;
  const score = b.metrics.riskScore - a.metrics.riskScore;
  if (score !== 0) return score;
  return a.plannedDate.localeCompare(b.plannedDate);
}

/** Тот же порядок без метрик — для меню, где скор не считается. */
export function byStatus(
  a: { status: string; plannedDate: string },
  b: { status: string; plannedDate: string },
): number {
  const order = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (order !== 0) return order;
  return a.plannedDate.localeCompare(b.plannedDate);
}
