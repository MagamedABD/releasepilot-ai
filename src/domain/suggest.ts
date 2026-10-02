/**
 * Подбор сценария: что перенести, чтобы риск опустился до цели (FR-32, US-24).
 *
 * Отвечает на вопрос, который менеджер задаёт после «почему high»: а что
 * сделать? Своих формул здесь нет — каждый шаг проверяется той же
 * симуляцией, которой считается карточка what-if. Иначе подбор советовал
 * бы по одной модели, а эффект показывался бы по другой.
 *
 * Жадный поиск, а не точный. Минимальный набор задач — это задача о сумме
 * подмножеств, и перебирать 2^n вариантов на релизе из трёхсот задач
 * бессмысленно. Жадность даёт не доказуемо наименьший набор, а понятный:
 * на каждом шаге берётся задача, которая сильнее всего двигает к цели.
 * Честный ответ здесь не «оптимум», а «вот работающий план и вот его
 * эффект в числах» — а проверить его можно симуляцией, что и делается.
 */

import { RISK_CONFIG, type RiskConfig } from './config';
import { isOpen } from './metrics';
import { LEVEL_RANK } from './risk';
import { simulate, type ScenarioDelta, type ScenarioSide } from './scenario';
import type { ReleaseSnapshot, RiskLevel, RiskReason, Task, TaskPriority } from './types';

export type SuggestGoal =
  /** Скор риска не выше заданного. */
  | { kind: 'risk_score'; target: number }
  /** Уровень риска не выше заданного. */
  | { kind: 'risk_level'; target: RiskLevel }
  /** Вероятность выпуска в срок не ниже заданной (0–1). */
  | { kind: 'probability'; target: number };

export type SuggestOptions = {
  completedReleases?: number;
  /** Сколько задач максимум предлагать к переносу. */
  maxTasks?: number;
  /** Задачи, которые трогать нельзя. */
  keepTaskIds?: string[];
  /**
   * Приоритеты, которые не предлагаются к переносу.
   *
   * По умолчанию это P0, и умолчание содержательное: P0 — обязательство,
   * а не «работа с высоким приоритетом». Предложить перенести его молча —
   * то же, что посоветовать не выполнять обещание, не сказав об этом.
   * Разрешить можно явно, передав пустой список.
   */
  keepPriorities?: TaskPriority[];
  /**
   * Сколько кандидатов рассматривать на шаге. Ограничение не про вкус:
   * каждый кандидат — это полная симуляция с прогоном Монте-Карло, и без
   * потолка «подбери сценарий» на большом релизе считался бы минутами.
   */
  maxCandidates?: number;
};

/** Группа задач, переносимых вместе. */
export type SuggestionGroup = {
  /** Задача, которую предлагают перенести. */
  taskId: string;
  key: string | null;
  /** Названия может не быть: снимок его не требует (`Task.title` необязателен). */
  title: string | null;
  priority: TaskPriority;
  estimateH: number;
  /**
   * Зависимые задачи, уходящие вместе с ней.
   *
   * Не вольность, а требование FR-33: блокер нельзя унести, оставив
   * ждущих в релизе, — они выглядели бы свободными, хотя ждать им больше
   * нечего. Поэтому кандидат на перенос — не задача, а задача со своим
   * хвостом.
   */
  withTaskIds: string[];
  /** Скор риска после этого шага — не оценка, а результат симуляции. */
  riskScoreAfter: number;
};

export type SuggestResult =
  /** Цель уже выполнена: переносить нечего. */
  | { kind: 'already_met'; before: ScenarioSide }
  | {
      kind: 'ok';
      taskIds: string[];
      groups: SuggestionGroup[];
      before: ScenarioSide;
      after: ScenarioSide;
      delta: ScenarioDelta;
    }
  /**
   * Цель недостижима переносом задач. Отдаётся лучшее, что нашлось:
   * «не получается» без числа — не ответ, менеджеру важно знать, насколько
   * не получается.
   */
  | {
      kind: 'unreachable';
      taskIds: string[];
      groups: SuggestionGroup[];
      before: ScenarioSide;
      after: ScenarioSide | null;
      delta: ScenarioDelta | null;
      /**
       * Правила эскалации, которые держат уровень в лучшем найденном
       * состоянии.
       *
       * Главная причина, по которой подбор возвращает «недостижимо», —
       * не нехватка переносов, а правило, на перенос не реагирующее:
       * заблокированная задача P0 держит уровень high, сколько бы
       * обычной работы из релиза ни унесли. Без этого списка ответ
       * выглядел бы как «мы пытались, не вышло», тогда как настоящий
       * совет — не переносить, а разблокировать.
       */
      pinnedBy: RiskReason[];
    };

const PRIORITY_RANK: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function met(side: ScenarioSide, goal: SuggestGoal): boolean {
  switch (goal.kind) {
    case 'risk_score':
      return side.metrics.riskScore <= goal.target;
    case 'risk_level':
      return LEVEL_RANK[side.metrics.riskLevel] <= LEVEL_RANK[goal.target];
    case 'probability':
      // Непосчитанная вероятность цели не достигает: отсутствие числа —
      // это не «успеем», и считать его успехом значило бы выдать
      // незнание за хорошую новость.
      return (side.forecast.probabilityOnTime ?? -1) >= goal.target;
  }
}

/**
 * Насколько сторона близка к цели. Меньше — лучше.
 *
 * Для уровня риска мерой остаётся скор: внутри уровня он единственное,
 * что различает «почти medium» и «едва ли не critical», а по самому
 * уровню шаг, не меняющий его, выглядел бы бесполезным.
 */
function distance(side: ScenarioSide, goal: SuggestGoal): number {
  if (goal.kind === 'probability') {
    return -(side.forecast.probabilityOnTime ?? -1);
  }
  return side.metrics.riskScore;
}

/** Задачи, которые уйдут вместе с данной: транзитивное замыкание «блокирует». */
function dependents(snapshot: ReleaseSnapshot, taskId: string): string[] {
  const open = new Set(snapshot.tasks.filter(isOpen).map((t) => t.id));
  const out: string[] = [];
  const seen = new Set([taskId]);
  const queue = [taskId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dep of snapshot.dependencies) {
      if (dep.type !== 'blocks') continue;
      if (dep.blockerTaskId !== current) continue;
      if (seen.has(dep.blockedTaskId)) continue;
      // Закрытая зависимая задача никого не ждёт: уносить её незачем.
      if (!open.has(dep.blockedTaskId)) continue;
      seen.add(dep.blockedTaskId);
      out.push(dep.blockedTaskId);
      queue.push(dep.blockedTaskId);
    }
  }

  return out;
}

type Candidate = {
  task: Task;
  /** Задача вместе с хвостом зависимых. */
  ids: string[];
};

function candidates(snapshot: ReleaseSnapshot, options: SuggestOptions): Candidate[] {
  const keep = new Set(options.keepTaskIds ?? []);
  const keepPriorities = new Set(options.keepPriorities ?? (['P0'] as TaskPriority[]));
  const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));

  const list: Candidate[] = [];
  for (const task of snapshot.tasks) {
    if (!isOpen(task)) continue;
    if (keep.has(task.id)) continue;
    if (keepPriorities.has(task.priority)) continue;

    const tail = dependents(snapshot, task.id);
    // Если хвост задевает неприкосновенную задачу, перенести группу
    // нельзя целиком, а частями нельзя по FR-33 — кандидат отпадает.
    const blocked = tail.some(
      (id) => keep.has(id) || keepPriorities.has(byId.get(id)?.priority ?? 'P3'),
    );
    if (blocked) continue;

    list.push({ task, ids: [task.id, ...tail] });
  }

  /*
    Порядок кандидатов решает, кого вообще рассмотрят при потолке.
    Сначала те, у кого больше часов: перенос трудоёмкой задачи двигает
    и загрузку, и прогноз сильнее. Внутри равных — менее приоритетные:
    при равном эффекте правильнее предложить то, чем меньше дорожат.
  */
  return list.sort(
    (a, b) =>
      b.task.estimateH - a.task.estimateH ||
      PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority],
  );
}

function evaluate(
  snapshot: ReleaseSnapshot,
  excludeTaskIds: string[],
  config: RiskConfig,
  options: SuggestOptions,
) {
  return simulate(
    snapshot,
    { excludeTaskIds, extraCapacity: [] },
    config,
    { completedReleases: options.completedReleases },
  );
}

export function suggestScenario(
  snapshot: ReleaseSnapshot,
  goal: SuggestGoal,
  config: RiskConfig = RISK_CONFIG,
  options: SuggestOptions = {},
): SuggestResult {
  const maxTasks = options.maxTasks ?? 5;
  const maxCandidates = options.maxCandidates ?? 30;

  const base = evaluate(snapshot, [], config, options);
  /*
    Пустой сценарий отвергнуться не может: исключать нечего, часов не
    добавляется, и проверять нечего. Если это всё же случилось, значит
    сломалась сама проверка сценария, и подменять ответ правдоподобным
    нельзя — исключение здесь честнее, чем результат, которому нельзя
    верить.
  */
  if (base.kind !== 'ok') {
    throw new Error('Пустой сценарий отвергнут — сломана проверка сценария');
  }

  const before = base.before;
  if (met(before, goal)) return { kind: 'already_met', before };

  const pool = candidates(snapshot, options).slice(0, maxCandidates);

  const chosen: string[] = [];
  const groups: SuggestionGroup[] = [];
  const used = new Set<string>();
  let current = before;

  while (chosen.length < maxTasks) {
    let best: { candidate: Candidate; side: ScenarioSide; result: typeof base } | null = null;

    for (const candidate of pool) {
      if (candidate.ids.some((id) => used.has(id))) continue;
      if (chosen.length + candidate.ids.length > maxTasks) continue;

      const attempt = evaluate(snapshot, [...chosen, ...candidate.ids], config, options);
      // Отклонённый сценарий — не ошибка подбора: так бывает, когда
      // группа всё равно оставляет в релизе ждущие задачи. Кандидат
      // просто не подходит.
      if (attempt.kind !== 'ok') continue;

      if (
        best === null ||
        distance(attempt.after, goal) < distance(best.side, goal) ||
        (distance(attempt.after, goal) === distance(best.side, goal) &&
          PRIORITY_RANK[candidate.task.priority] > PRIORITY_RANK[best.candidate.task.priority])
      ) {
        best = { candidate, side: attempt.after, result: attempt };
      }
    }

    // Ни один кандидат не двигает к цели — дальше идти незачем: жадный
    // шаг, не улучшающий положение, не улучшит его и в следующий раз.
    if (best === null || distance(best.side, goal) >= distance(current, goal)) break;

    chosen.push(...best.candidate.ids);
    for (const id of best.candidate.ids) used.add(id);
    groups.push({
      taskId: best.candidate.task.id,
      key: best.candidate.task.key ?? null,
      title: best.candidate.task.title ?? null,
      priority: best.candidate.task.priority,
      estimateH: best.candidate.task.estimateH,
      withTaskIds: best.candidate.ids.slice(1),
      riskScoreAfter: best.side.metrics.riskScore,
    });
    current = best.side;

    if (met(current, goal)) {
      return {
        kind: 'ok',
        taskIds: chosen,
        groups,
        before,
        after: best.result.after,
        delta: best.result.delta,
      };
    }
  }

  const final = chosen.length > 0 ? evaluate(snapshot, chosen, config, options) : null;
  const best = final?.kind === 'ok' ? final.after : before;
  return {
    kind: 'unreachable',
    taskIds: chosen,
    groups,
    before,
    after: final?.kind === 'ok' ? final.after : null,
    delta: final?.kind === 'ok' ? final.delta : null,
    pinnedBy: best.metrics.reasons.filter((r) => r.kind === 'escalation'),
  };
}
