/**
 * Подписи для экрана сценариев.
 *
 * Отдельно от компонентов по той же причине, по которой отдельно живут
 * подписи риска: «−12.4» и «улучшение на 12.4» — одно число, и решать,
 * как его читать, должен один модуль, а не каждое место вывода.
 */

import type { RiskLevel } from '@/domain/types';

/**
 * Число со знаком.
 *
 * Знак обязателен, в том числе плюс: «риск 12.4» и «риск +12.4» читаются
 * по-разному, и второе — то, что имеется в виду в дельте.
 */
export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toFixed(digits).replace(/\.0$/, '');
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return '0';
}

/**
 * Куда двигает сценарий: вниз (лучше), вверх (хуже), никуда.
 *
 * Для риска меньше — лучше, для вероятности и готовности — наоборот.
 * Поэтому направление задаётся вызывающим, а не выводится из знака:
 * иначе рост вероятности однажды покрасился бы красным.
 */
export type Direction = 'better' | 'worse' | 'same';

export function direction(delta: number, lowerIsBetter: boolean): Direction {
  if (delta === 0) return 'same';
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  return better ? 'better' : 'worse';
}

export const DIRECTION_TONE: Record<Direction, string> = {
  better: 'text-emerald-700 dark:text-emerald-400',
  worse: 'text-red-700 dark:text-red-400',
  same: 'opacity-60',
};

/** «high → medium» или «high» — когда уровень не изменился. */
export function levelChange(from: RiskLevel, to: RiskLevel, label: (l: RiskLevel) => string): string {
  return from === to ? label(from) : `${label(from)} → ${label(to)}`;
}

/** Проценты из доли. `null` остаётся «—»: незнание не ноль. */
export function pct(share: number | null, digits = 0): string {
  return share === null ? '—' : `${(share * 100).toFixed(digits)}%`;
}

const ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * Цель подбора: на один уровень ниже текущего.
 *
 * Не «low» и не «ноль»: предложение «перенесите девять задач» верно
 * арифметически и бесполезно практически. Вопрос, который задают на самом
 * деле, — «что убрать, чтобы перестало быть critical».
 *
 * У низкого уровня цели нет: снижать нечего, и `null` здесь означает
 * именно это, а не «не смогли посчитать».
 */
export function lowerLevel(level: RiskLevel): RiskLevel | null {
  const at = ORDER.indexOf(level);
  return at <= 0 ? null : ORDER[at - 1];
}

/**
 * Правила эскалации — словами.
 *
 * Нужны ровно там, где подбор ответил «недостижимо»: код `CRITICAL_BLOCKER`
 * сам по себе ничего не советует, а «разблокировать, а не переносить» —
 * советует.
 */
export const ESCALATION_ADVICE: Record<string, string> = {
  CRITICAL_BLOCKER:
    'Заблокирована задача приоритета P0 — её надо разблокировать, а не переносить',
  CHAIN_EXCEEDS_TIME: 'Критическая цепочка длиннее, чем осталось рабочих дней',
  CRITICAL_CHAIN: 'Критическая цепочка занимает почти весь остаток времени',
  LOW_PROBABILITY: 'Вероятность выпуска в срок слишком низкая',
  QA_FUNNEL: 'Тестирование не успевает пропустить остаток работ',
  BLOCKERS: 'Заблокировано слишком много задач',
  SCOPE_DRIFT: 'Объём релиза вырос уже после старта',
};
