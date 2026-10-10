/**
 * Рост уровня риска (FR-44, US-31).
 *
 * Уведомление — про переход уровня, а не про скор: скор гуляет на
 * единицы каждый день, и письмо на каждое «62 → 64» приучило бы их не
 * читать. Уровней четыре, переход между ними редок и означает, что
 * изменилось качественно: сработало правило эскалации или фактор
 * пересёк порог.
 *
 * Снижение уровня уведомлением не считается — оно ни к чему не
 * призывает. Первый снимок релиза тоже: сравнивать не с чем, и «риск
 * вырос» про только что заведённый релиз было бы неправдой.
 */

import type { RiskLevel } from '@/domain/types';

const ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function riskRose(from: RiskLevel | null, to: RiskLevel): boolean {
  return from !== null && ORDER[to] > ORDER[from];
}

export type Escalation<T> = T & { from: RiskLevel; to: RiskLevel };

export function detectEscalations<T extends { releaseId: string; level: RiskLevel }>(
  previous: ReadonlyMap<string, RiskLevel>,
  current: readonly T[],
): Escalation<T>[] {
  const result: Escalation<T>[] = [];
  for (const item of current) {
    const from = previous.get(item.releaseId) ?? null;
    if (from !== null && riskRose(from, item.level)) {
      result.push({ ...item, from, to: item.level });
    }
  }
  return result;
}
