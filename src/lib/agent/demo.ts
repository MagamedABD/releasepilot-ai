/**
 * Демо-режим ассистента: настоящие инструменты, ответ по шаблону, без модели.
 *
 * Зачем он нужен. Ключа Claude API у проекта нет, а платить за него ради
 * защиты не хочется. Показывать «ассистент недоступен» честно, но о самом
 * ассистенте это ничего не рассказывает. Демо-режим показывает всё, кроме
 * модели: вопрос разбирается по ключевым словам, вызываются **те же**
 * инструменты, что вызвала бы модель, и ответ собирается из **их** чисел.
 *
 * Что здесь настоящее, а что нет — и это надо говорить вслух, а не только в
 * коде:
 *
 * — настоящие: вызовы инструментов, все числа, предложение сценария и
 *   кнопка «Применить»; сверка чисел ответа (FR-25) проходит та же;
 * — заскриптовано: выбор инструментов (по словам вопроса, а не по смыслу) и
 *   формулировки (по шаблону, а не сочинены).
 *
 * Интерфейс помечает режим явно. Выдавать шаблон за модель нельзя: на защите
 * спросят «а это настоящий ИИ?», и ответ должен быть на экране.
 *
 * Модуль разделён на чистую часть (разбор вопроса, сборка текста из
 * результатов инструментов) и исполнение. Чистая часть проверяется тестами
 * на фикстурах — без базы и сети.
 */

import type { RiskLevel, RiskReason } from '@/domain/types';
import type { ApiForecast } from '@/lib/api/forecast';
import type { ApiReleaseMetrics } from '@/lib/api/metrics';
import { RISK_LEVEL, plural, reasonText } from '@/lib/ui/risk';
import {
  ESCALATION_ADVICE,
  LEVEL_GENITIVE,
  PINNED_HEADER,
  SUGGEST_LIMITS,
  lowerLevel,
  ruDate,
} from '@/lib/ui/scenario';

import type { ToolName } from './tools';

export type DemoIntent =
  | 'overview'
  | 'bottleneck'
  | 'forecast'
  | 'suggest'
  | 'propose'
  | 'history'
  | 'blockers'
  | 'chain';

/**
 * Разбор вопроса по словам.
 *
 * Порядок проверок важен и не алфавитный. «Перенеси» (просьба изменить)
 * проверяется раньше «перенести» (вопрос, что изменить): первое оформляет
 * предложение, второе только считает. Перепутать их — значит сохранить
 * сценарий там, где человек лишь спросил.
 *
 * Не понятый вопрос получает обзор, а не отказ: обзор отвечает на большую
 * часть вопросов о релизе, и пустой ответ на защите хуже приблизительного.
 */
export function classifyQuestion(question: string): DemoIntent {
  const q = question.toLowerCase().replace(/ё/g, 'е');

  if (/(перенеси|оформи|предложи сценарий|сохрани сценарий|примени)/.test(q)) return 'propose';
  if (/(перенест|убрат|снизит|что делать|что сделать|сценари)/.test(q)) return 'suggest';
  if (/(успеем|успеть|вероятност|прогноз|когда|к сроку|в срок|дат[уае])/.test(q)) return 'forecast';
  if (/(узк|загруз|перегру|команд|емкост)/.test(q)) return 'bottleneck';
  if (/(блокер|заблокир)/.test(q)) return 'blockers';
  if (/(цепочк|зависим)/.test(q)) return 'chain';
  if (/(истори|прошл|раньше|аналитик|задерж)/.test(q)) return 'history';
  return 'overview';
}

/** Какие инструменты вызывает каждый вид вопроса — по порядку. */
export const INTENT_TOOLS: Record<DemoIntent, ToolName[]> = {
  overview: ['get_release_overview', 'get_blockers'],
  bottleneck: ['get_team_load'],
  forecast: ['forecast_completion'],
  suggest: ['get_release_overview', 'suggest_scenario'],
  propose: ['get_release_overview', 'suggest_scenario', 'propose_scenario'],
  history: ['get_release_history'],
  blockers: ['get_blockers'],
  chain: ['get_critical_chain'],
};

/** Ключ и название задачи — для текста ответа, не для модели. */
export type TaskNames = Map<string, { key: string | null; title: string | null }>;

type Overview = { metrics: ApiReleaseMetrics; forecast: ApiForecast };
type TeamLoad = {
  remaining_working_days: number;
  teams: { team_name: string; remaining_h: number; capacity_h: number; load: number | null; has_capacity: boolean }[];
};
type Blockers = {
  blockers: { task: { id: string }; blocked_days: number; blocks_count: number; is_stale: boolean }[];
};
type Chain = { days: number; remaining_working_days: number; tasks: { id: string }[] };
type Suggest =
  | { outcome: 'already_met'; risk_score: number; risk_level: RiskLevel }
  | {
      outcome: 'ok' | 'unreachable';
      task_ids: string[];
      groups: { task: { id: string }; with_task_ids: string[]; risk_score_after: number }[];
      delta: { riskScore: number; riskLevel: { from: RiskLevel; to: RiskLevel }; probabilityOnTime: number | null } | null;
      pinned_by: { code: string }[];
    };
type History = {
  released: number;
  on_time: number;
  on_time_pct: number | null;
  avg_delay_days: number | null;
  avg_deviation_days: number | null;
};

/**
 * Проценты из доли — так же, как в кокпите.
 *
 * Округление то же, что у `reasonText`, и это не косметика: сверка чисел
 * ответа ищет их среди результатов инструментов, и «38%» обязано
 * получаться из 0.38 одинаково в обоих местах.
 */
const pct = (share: number) => `${Math.round(share * 100)}%`;

function taskLabel(id: string, names: TaskNames): string {
  const t = names.get(id);
  if (!t) return 'задача без названия';
  return [t.key, t.title].filter(Boolean).join(' ');
}

const level = (l: RiskLevel) => RISK_LEVEL[l]?.label ?? l;

function composeOverview(o: Overview, b: Blockers | undefined, names: TaskNames): string {
  const m = o.metrics;
  const lines: string[] = [];

  lines.push(
    `Риск ${level(m.riskLevel)}, скор ${m.riskScore}. ` +
      `Готовность ${m.readinessPct}% по трудозатратам` +
      (o.forecast.probabilityOnTime === null
        ? ', вероятность выпуска в срок не считается — мало истории.'
        : `, вероятность выпуска в срок ${pct(o.forecast.probabilityOnTime)}.`),
  );

  const top = m.reasons.slice(0, 3) as unknown as RiskReason[];
  if (top.length > 0) {
    lines.push('', 'Главное:');
    top.forEach((r, i) => lines.push(`${i + 1}. ${reasonText(r)}`));
  }

  const worst = b?.blockers.slice().sort((x, y) => y.blocks_count - x.blocks_count)[0];
  if (worst && worst.blocks_count > 0) {
    lines.push(
      '',
      `Сильнее всего держит ${taskLabel(worst.task.id, names)} — ` +
        `${worst.blocks_count} ${plural(worst.blocks_count, 'задачу', 'задачи', 'задач')}` +
        (worst.is_stale ? ', блокировка застарела.' : '.'),
    );
  }

  lines.push('', 'Что перенести, чтобы риск стал ниже, — спросите, посчитаю.');
  return lines.join('\n');
}

function composeBottleneck(t: TeamLoad): string {
  const withCapacity = t.teams.filter((x) => x.has_capacity && x.load !== null);
  const noCapacity = t.teams.filter((x) => !x.has_capacity && x.remaining_h > 0);

  if (withCapacity.length === 0 && noCapacity.length === 0) {
    return 'Остатка работ у команд нет — узкого места нет.';
  }

  const lines: string[] = [];
  const worst = withCapacity.slice().sort((a, b) => (b.load ?? 0) - (a.load ?? 0))[0];

  if (worst) {
    const over = Math.round(worst.remaining_h - worst.capacity_h);
    lines.push(
      `Узкое место — ${worst.team_name}: загрузка ${pct(worst.load ?? 0)}, ` +
        `${Math.round(worst.remaining_h)} ч работ при ёмкости ${Math.round(worst.capacity_h)} ч` +
        (over > 0 ? `, перегруз ${over} ч.` : '.'),
    );
  }

  /*
    Команда без ёмкости называется отдельно и прямо. Её загрузка не
    «нулевая» и не «максимальная» — она бесконечная: часы есть, людей на
    них нет. Спрятать её в общий список значило бы показать самую
    безнадёжную команду как благополучную.
  */
  for (const team of noCapacity) {
    lines.push(`У команды «${team.team_name}» ${Math.round(team.remaining_h)} ч работ, а ёмкость не задана.`);
  }

  const others = withCapacity
    .filter((x) => x !== worst)
    .sort((a, b) => (b.load ?? 0) - (a.load ?? 0))
    .map((x) => `${x.team_name} ${pct(x.load ?? 0)}`);
  if (others.length > 0) lines.push('', `Остальные: ${others.join(', ')}.`);

  lines.push('', `До плановой даты ${t.remaining_working_days} ${plural(t.remaining_working_days, 'рабочий день', 'рабочих дня', 'рабочих дней')}.`);
  return lines.join('\n');
}

function composeForecast(f: ApiForecast): string {
  if (!f.reachable) {
    return 'При нынешней ёмкости релиз не завершится никогда: у команд нет часов на остаток работ. Сначала — ёмкость.';
  }
  if (f.probabilityOnTime === null) {
    return (
      `Вероятность не считается: выпущенных релизов слишком мало для прогноза распределением. ` +
      `По остатку работ и ёмкости ожидаемая дата — ${f.expectedDate ? ruDate(f.expectedDate) : 'не определена'}.`
    );
  }

  const p80 = f.percentiles.find((p) => p.probability === 0.8);
  return [
    `Успеть к ${ruDate(f.targetDate)}: вероятность ${pct(f.probabilityOnTime)}.`,
    `Ожидаемая дата готовности — ${f.expectedDate ? ruDate(f.expectedDate) : 'не определена'}` +
      (p80?.date ? `, с уверенностью 80% — не позже ${ruDate(p80.date)}.` : '.'),
    '',
    'Это не «да» или «нет», а доля из ' +
      `${f.iterations} прогонов Монте-Карло, в которых релиз успевает.`,
  ].join('\n');
}

function composeSuggest(o: Overview, s: Suggest, names: TaskNames): string {
  const current = o.metrics.riskLevel;
  const goal = lowerLevel(current);

  if (goal === null || s.outcome === 'already_met') {
    return `Риск уже ${level(current)} — снижать нечего.`;
  }

  if (s.outcome === 'ok') {
    const lines = [
      `Чтобы риск опустился до ${LEVEL_GENITIVE[goal]}, достаточно убрать ` +
        `${s.task_ids.length} ${plural(s.task_ids.length, 'задачу', 'задачи', 'задач')}:`,
    ];
    for (const g of s.groups) {
      lines.push(
        `— ${taskLabel(g.task.id, names)}` +
          (g.with_task_ids.length > 0 ? ` (вместе с зависимыми: ${g.with_task_ids.length})` : '') +
          ` → скор ${g.risk_score_after}`,
      );
    }
    /*
      Итоговый скор берётся из последнего шага подбора, а не вычисляется
      сложением «было + дельта». Сложение — это и есть счёт, которого
      ассистенту делать нельзя: на калибровке округления оно однажды дало
      бы число, которого нет ни в одном расчёте.
    */
    const final = s.groups[s.groups.length - 1]?.risk_score_after;
    if (final !== undefined) lines.push('', `Итог: скор ${o.metrics.riskScore} → ${final}.`);
    lines.push('', 'Скажите «оформи предложение» — сохраню сценарий, применить его сможете кнопкой.');
    return lines.join('\n');
  }

  /*
    «Недостижимо» объясняется причиной, а не сожалением. Уровень держат
    правила, на перенос не реагирующие, и настоящий совет тогда — не
    переносить, а снять то, что держит. Ровно это и надо сказать.
  */
  const lines = [`Переносом задач (${SUGGEST_LIMITS}) риск до ${LEVEL_GENITIVE[goal]} не опустить.`];
  if (s.pinned_by.length > 0) {
    lines.push('', PINNED_HEADER);
    for (const r of s.pinned_by) lines.push(`— ${ESCALATION_ADVICE[r.code] ?? r.code}`);
  }
  const best = s.groups[s.groups.length - 1]?.risk_score_after;
  if (best !== undefined) {
    lines.push('', `Лучшее, что нашлось: скор ${o.metrics.riskScore} → ${best}.`);
  }
  return lines.join('\n');
}

function composeHistory(h: History): string {
  if (h.released === 0) return 'Выпущенных релизов пока нет — истории для выводов не хватает.';
  const lines = [
    `В срок вышло ${h.on_time} из ${h.released} релизов — ${h.on_time_pct}%.`,
    `Средняя задержка у опоздавших — ${h.avg_delay_days} дн., среднее отклонение со знаком — ${h.avg_deviation_days} дн.`,
  ];
  // Пояснение нужно только тогда, когда числа расходятся: иначе оно
  // объясняло бы разницу, которой нет.
  if (
    h.avg_delay_days !== null &&
    h.avg_deviation_days !== null &&
    h.avg_deviation_days < h.avg_delay_days
  ) {
    lines.push(
      '',
      'Второе число меньше первого, потому что досрочные выпуски гасят опоздания. Смотреть стоит на первое.',
    );
  }
  return lines.join('\n');
}

function composeBlockers(b: Blockers, names: TaskNames): string {
  if (b.blockers.length === 0) return 'Заблокированных задач нет.';
  const sorted = b.blockers.slice().sort((x, y) => y.blocks_count - x.blocks_count);
  const lines = [`Заблокировано ${sorted.length} ${plural(sorted.length, 'задача', 'задачи', 'задач')}:`];
  for (const x of sorted) {
    lines.push(
      `— ${taskLabel(x.task.id, names)}: стоит ${Math.round(x.blocked_days)} дн., ` +
        `держит ${x.blocks_count}` +
        (x.is_stale ? ', застарела' : ''),
    );
  }
  return lines.join('\n');
}

function composeChain(c: Chain, names: TaskNames): string {
  if (c.tasks.length < 2) return 'Длинных цепочек зависимостей нет: задачи можно делать параллельно.';
  const lines = [
    `Критическая цепочка — ${c.days} дн. при ${c.remaining_working_days} оставшихся:`,
    ...c.tasks.map((t, i) => `${i + 1}. ${taskLabel(t.id, names)}`),
  ];
  if (c.days > c.remaining_working_days) {
    lines.push('', 'Цепочка длиннее остатка: людей добавлять бесполезно, задачи идут одна за другой.');
  }
  return lines.join('\n');
}

/** Ответ из результатов инструментов. Своих чисел здесь нет ни одного. */
export function composeAnswer(
  intent: DemoIntent,
  results: Partial<Record<ToolName, unknown>>,
  names: TaskNames,
): string {
  const o = results.get_release_overview as Overview | undefined;

  switch (intent) {
    case 'overview':
      return o ? composeOverview(o, results.get_blockers as Blockers | undefined, names) : '';
    case 'bottleneck':
      return composeBottleneck(results.get_team_load as TeamLoad);
    case 'forecast':
      return composeForecast(results.forecast_completion as ApiForecast);
    case 'suggest':
      return o ? composeSuggest(o, results.suggest_scenario as Suggest, names) : '';
    case 'propose': {
      const s = results.suggest_scenario as Suggest | undefined;
      if (!o || !s) return '';
      if (s.outcome !== 'ok') return composeSuggest(o, s, names);
      return results.propose_scenario
        ? 'Сценарий сохранён — карточка выше. Применить его можете только вы, кнопкой «Применить»: сам я состав релиза не меняю.'
        : 'Сохранить сценарий не вышло — для этого нужна роль менеджера.';
    }
    case 'history':
      return composeHistory(results.get_release_history as History);
    case 'blockers':
      return composeBlockers(results.get_blockers as Blockers, names);
    case 'chain':
      return composeChain(results.get_critical_chain as Chain, names);
  }
}
