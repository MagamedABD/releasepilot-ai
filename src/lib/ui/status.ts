/**
 * Статус релиза для руководства — пять-семь строк (FR-29).
 *
 * Текст собирает код, а не модель, и это то же решение, что у всего
 * проекта (ADR-001): каждое число здесь — из движка, и совпадает с
 * кокпитом по построению. Модель могла бы написать глаже, но статус уходит
 * руководству, и «вероятность 38%» в письме обязана быть той же, что на
 * экране, — без сверки и без ассистента, который может быть недоступен.
 *
 * Порядок строк — порядок вопросов руководителя: успеем ли, насколько
 * готово, почему под угрозой, что делаем.
 */

import type { ReleaseForecast, ReleaseMetrics, RiskReason } from '@/domain/types';

import { hours, plural, reasonText, RISK_LEVEL } from './risk';
import { pct } from './scenario';

/** Дата словами: «6 октября». */
function date(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Что делать — по главной причине. Это подсказка направления, а не план:
 * конкретный набор задач для переноса считает экран сценариев.
 */
function nextStep(reason: RiskReason | undefined): string {
  switch (reason?.code) {
    case 'CRITICAL_BLOCKER':
    case 'MULTIPLE_P1_BLOCKED':
    case 'BLOCKERS':
      return 'Снять блокировки — перенос задач риск не снизит, пока они стоят.';
    case 'TEAM_OVERLOAD':
    case 'TEAM_OVERLOAD_RULE':
      return `Разгрузить команду «${reason.facts.team}» — перенести часть задач или добавить людей.`;
    case 'QA_FUNNEL':
      return 'Добавить ёмкость тестирования или начать тестирование раньше.';
    case 'CRITICAL_CHAIN':
    case 'CHAIN_EXCEEDS_TIME':
      return 'Распараллелить цепочку зависимостей или сдвинуть дату.';
    case 'SCOPE_DRIFT':
      return 'Заморозить объём — добавленное после старта перенести в следующий релиз.';
    case 'TIME_DEFICIT':
    case 'LOW_PROBABILITY':
      return 'Сократить объём или сдвинуть дату — варианты посчитаны на экране сценариев.';
    default:
      return 'Вмешательство не требуется, держим курс.';
  }
}

export function executiveStatus(input: {
  name: string;
  plannedDate: string;
  metrics: ReleaseMetrics;
  forecast: ReleaseForecast;
}): string[] {
  const { name, plannedDate, metrics: m, forecast: f } = input;
  const left = Math.max(0, Math.round(m.remainingWorkingDays));
  const c = m.counts;

  const lines = [
    `Релиз «${name}»: риск ${RISK_LEVEL[m.riskLevel].label} (${Math.round(m.riskScore)}), готовность ${m.readinessPct.toFixed(1)}% по трудозатратам.`,
  ];

  // Вероятность без истории не называется вовсе (FR-22): одна дата из
  // деления часов на ёмкость — не распределение, и «вероятность» о ней
  // была бы выдумкой. Говорится прямо, почему её нет.
  const expected = f.expectedDate ? `, ожидаемая дата готовности — ${date(f.expectedDate)}` : '';
  lines.push(
    f.probabilityOnTime !== null
      ? `План — ${date(plannedDate)}, ${left} ${plural(left, 'рабочий день', 'рабочих дня', 'рабочих дней')}; вероятность успеть — ${pct(f.probabilityOnTime)}${expected}.`
      : `План — ${date(plannedDate)}, ${left} ${plural(left, 'рабочий день', 'рабочих дня', 'рабочих дней')}${expected}; вероятность не оценивается: мало истории (${f.degraded?.completedReleases ?? 0} из ${f.degraded?.requiredReleases ?? '—'} выпущенных релизов).`,
  );

  lines.push(
    `Готово ${c.done} из ${c.total} задач, в работе ${c.inProgress}, в тестировании ${c.testing}, заблокировано ${c.blocked}; осталось ${hours(m.effort.remainingH)}.`,
  );

  // Вероятность уже названа строкой выше; повторять её «главной угрозой»
  // значит потратить строку на то, что читатель только что прочёл.
  const threats = m.reasons.filter((r) => r.code !== 'LOW_PROBABILITY');
  const top = threats.slice(0, 2);
  if (top.length === 0) {
    lines.push('Факторов риска выше порога нет.');
  } else {
    top.forEach((r, i) => lines.push(`${i === 0 ? 'Главная угроза' : 'Также'}: ${lowerFirst(reasonText(r))}.`));
  }

  lines.push(`Что делаем: ${lowerFirst(nextStep(threats[0] ?? m.reasons[0]))}`);
  return lines;
}

function lowerFirst(s: string): string {
  // Аббревиатуры («QA», «P0») не трогаем: опускается только обычная буква.
  return /^[А-ЯЁA-Z][а-яёa-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
