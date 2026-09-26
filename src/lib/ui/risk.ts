/**
 * Перевод результатов движка в то, что читает человек.
 *
 * Движок отдаёт код и факты, формулировку даёт этот слой (ADR-001 §5).
 * Причина разделения не в чистоте ради чистоты: текст меняется гораздо чаще
 * расчёта, переводится на другой язык и в одном месте интерфейса должен быть
 * короче, чем в другом. Если бы движок возвращал готовую фразу, каждая правка
 * формулировки означала бы правку расчёта и перезапуск его тестов.
 *
 * Здесь же — единственное место, где уровень риска превращается в цвет.
 * И цвет никогда не идёт без слова: дальтонизм и печать в ч/б не должны
 * ломать смысл (NFR-17, концепция интерфейса, правило 3).
 */

import type { RiskLevel, RiskReason } from '@/domain/types';

export const RISK_LEVEL: Record<RiskLevel, { label: string; badge: string; dot: string }> = {
  low: {
    label: 'низкий',
    badge: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  medium: {
    label: 'средний',
    badge: 'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  high: {
    label: 'высокий',
    badge: 'border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  critical: {
    label: 'критический',
    badge: 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
};

export const RELEASE_STATUS: Record<string, string> = {
  planned: 'запланирован',
  active: 'в работе',
  released: 'выпущен',
  postponed: 'отложен',
  cancelled: 'отменён',
};

/** Склонение по числу: plural(2, 'задача', 'задачи', 'задач') → 'задачи'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const num = (x: unknown) => Number(x ?? 0);

/**
 * Дни словами. Округление здесь не косметика.
 *
 * Движок считает дни дробными — 13.08 выходит из деления часов на ёмкость,
 * и внутри расчёта эта точность нужна. На экране она лишняя: решение
 * «успеваем или нет» не меняется от сотых долей дня, а вид «13.08 дней»
 * заставляет читателя гадать, откуда такая точность.
 *
 * Есть и прямая ошибка, которую округление чинит: plural(2.08) даёт
 * «дней» вместо «дня», потому что 2.08 не равно двум. Склонение обязано
 * получать целое.
 */
export function days(n: number): string {
  const d = Math.round(n);
  return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
}

/** Часы всегда целые: половина часа на горизонте релиза ничего не решает. */
export function hours(n: number): string {
  return `${Math.round(n)} ч`;
}

/**
 * Фраза о причине риска.
 *
 * Каждая формулировка называет величину, а не только факт: «заблокирована
 * 1 задача, она висит 7 дней» полезнее, чем «есть блокеры». Менеджеру нужно
 * решить, вмешиваться ли сейчас, а для этого нужен масштаб.
 */
export function reasonText(reason: RiskReason): string {
  const f = reason.facts;

  switch (reason.code) {
    case 'TIME_DEFICIT': {
      const left = Math.round(num(f.remainingWorkingDays));
      return `Работ больше, чем ёмкости: остаток требует ${pct(num(f.demandRatio))} доступного времени при ${left} рабочих ${plural(left, 'дне', 'днях', 'днях')} до даты`;
    }
    case 'TEAM_OVERLOAD':
      return `Команда «${f.team}» загружена на ${pct(num(f.load))}`;
    case 'BLOCKERS': {
      const n = num(f.blockedCount);
      const stale = num(f.staleCount);
      const base = `${n} ${plural(n, 'задача заблокирована', 'задачи заблокированы', 'задач заблокированы')}`;
      return stale > 0 ? `${base}, из них ${stale} ${plural(stale, 'застарелая', 'застарелые', 'застарелых')}` : base;
    }
    case 'CRITICAL_CHAIN':
      return `Цепочка зависимостей из ${f.chainLength} задач занимает ${days(num(f.chainDays))} при ${Math.round(num(f.remainingWorkingDays))} оставшихся`;
    case 'QA_FUNNEL':
      return `Тестированию нужно ${hours(num(f.requiredH))} при ёмкости ${hours(num(f.capacityH))}`;
    case 'SCOPE_DRIFT':
      return `После старта в релиз добавили ${hours(num(f.addedH))} работ — ${pct(num(f.share))} объёма`;

    case 'CRITICAL_BLOCKER': {
      const n = num(f.count);
      return `${plural(n, 'Заблокирована', 'Заблокированы', 'Заблокировано')} ${n} ${plural(n, 'задача', 'задачи', 'задач')} приоритета P0`;
    }
    case 'MULTIPLE_P1_BLOCKED':
      return `Заблокировано ${num(f.count)} ${plural(num(f.count), 'задача', 'задачи', 'задач')} приоритета P1`;
    case 'TEAM_OVERLOAD_RULE':
      return `Загрузка команды «${f.team}» — ${pct(num(f.load))}, порог ${pct(num(f.threshold))}`;
    case 'CHAIN_EXCEEDS_TIME':
      return `Цепочка ${days(num(f.chainDays))} при ${Math.round(num(f.remainingWorkingDays))} оставшихся — релиз не успевает по зависимостям`;
    case 'LOW_PROBABILITY':
      return `Вероятность выпуска в срок — ${pct(num(f.probability))}`;
    default:
      return reason.code;
  }
}

/**
 * Пояснение, почему причина здесь.
 *
 * Факторы складываются в скор, правила эскалации только поднимают уровень.
 * Показывать «вклад 0» у правила было бы враньём, а молчать — непонятно.
 */
export function reasonWeight(reason: RiskReason): string {
  return reason.kind === 'factor'
    ? `вклад ${reason.contribution}`
    : 'поднимает уровень';
}
