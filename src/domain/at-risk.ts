/**
 * Задачи, способные сорвать релиз, с причиной попадания (FR-27, US-20).
 *
 * Причины риска в кокпите отвечают на вопрос «что не так с релизом», а
 * менеджеру нужен следующий: «за какие задачи хвататься». Ответ собирается
 * из уже посчитанных метрик — блокеров, критической цепочки, загрузки
 * команд, — а не считается заново: иначе список разошёлся бы с числами
 * кокпита при первой правке одной из формул.
 *
 * У задачи может быть несколько причин, и это главное в ранжировании:
 * застарелый блокер P0 на критической цепочке опаснее трёх задач с одной
 * причиной каждая. Вес причин — порядок величины, а не калибровка: он
 * нужен, чтобы упорядочить список, и в скор релиза не входит.
 */

import { isOpen } from './metrics';
import type { ReleaseMetrics, ReleaseSnapshot, Task } from './types';

export type AtRiskReasonCode =
  | 'BLOCKED'
  | 'BLOCKS_OTHERS'
  | 'CRITICAL_CHAIN'
  | 'NOT_STARTED'
  | 'TEAM_OVERLOADED'
  | 'OVERSPENT';

export type AtRiskReason = {
  code: AtRiskReasonCode;
  /** Числа для формулировки: дни блокировки, число ждущих задач и т. п. */
  facts: Record<string, number | string | boolean>;
};

export type AtRiskTask = {
  taskId: string;
  score: number;
  reasons: AtRiskReason[];
};

const WEIGHT: Record<AtRiskReasonCode, number> = {
  // Заблокированная задача стоит: остальные причины — о том, что она
  // может не успеть, эта — о том, что она не движется вовсе.
  BLOCKED: 7,
  BLOCKS_OTHERS: 4,
  CRITICAL_CHAIN: 3,
  NOT_STARTED: 2,
  TEAM_OVERLOADED: 2,
  OVERSPENT: 1,
};

const PRIORITY_BONUS: Record<Task['priority'], number> = { P0: 3, P1: 2, P2: 0, P3: 0 };

/** Перерасход считается заметным, когда потрачено на четверть больше оценки. */
const OVERSPENT_RATIO = 1.25;

export function tasksAtRisk(
  snapshot: ReleaseSnapshot,
  metrics: ReleaseMetrics,
  limit = 10,
): AtRiskTask[] {
  const blockers = new Map(metrics.blockers.map((b) => [b.taskId, b]));
  const chain = new Set(metrics.criticalChain.taskIds);
  const overloaded = new Map(
    metrics.teamLoad.filter((t) => t.load > 1).map((t) => [t.teamId, t]),
  );
  // Времени в обрез — меньше трети срока цепочки: тогда неначатая важная
  // задача уже сама по себе угроза.
  const tight = metrics.remainingWorkingDays <= Math.max(5, metrics.criticalChain.days);

  // Сколько открытых задач ждут эту — для незаблокированных задач
  // `metrics.blockers` этого не знает.
  const open = new Map(snapshot.tasks.filter(isOpen).map((t) => [t.id, t]));
  const waiting = new Map<string, number>();
  for (const d of snapshot.dependencies) {
    if (d.type !== 'blocks') continue;
    if (!open.has(d.blockerTaskId) || !open.has(d.blockedTaskId)) continue;
    waiting.set(d.blockerTaskId, (waiting.get(d.blockerTaskId) ?? 0) + 1);
  }

  const result: AtRiskTask[] = [];

  for (const task of open.values()) {
    const reasons: AtRiskReason[] = [];

    const blocker = blockers.get(task.id);
    if (blocker) {
      reasons.push({
        code: 'BLOCKED',
        facts: { days: Math.round(blocker.blockedDays), stale: blocker.isStale },
      });
    }

    const waits = waiting.get(task.id) ?? 0;
    if (waits > 0) reasons.push({ code: 'BLOCKS_OTHERS', facts: { count: waits } });

    if (chain.has(task.id) && chain.size > 1) {
      reasons.push({ code: 'CRITICAL_CHAIN', facts: { days: Math.round(metrics.criticalChain.days) } });
    }

    if (task.status === 'backlog' && tight && (task.priority === 'P0' || task.priority === 'P1')) {
      reasons.push({ code: 'NOT_STARTED', facts: { priority: task.priority } });
    }

    const team = task.teamId ? overloaded.get(task.teamId) : undefined;
    if (team) {
      reasons.push({
        code: 'TEAM_OVERLOADED',
        facts: { team: team.teamName, load: Number.isFinite(team.load) ? team.load : -1 },
      });
    }

    const spentH = task.spentH ?? 0;
    if (spentH > task.estimateH * OVERSPENT_RATIO) {
      reasons.push({ code: 'OVERSPENT', facts: { spentH, estimateH: task.estimateH } });
    }

    // Одна перегруженная команда — свойство команды, а не задачи: иначе в
    // список попали бы все её задачи разом, и он перестал бы что-то выделять.
    if (reasons.length === 0 || (reasons.length === 1 && reasons[0].code === 'TEAM_OVERLOADED')) {
      continue;
    }

    const score =
      reasons.reduce((sum, r) => sum + WEIGHT[r.code], 0) +
      PRIORITY_BONUS[task.priority] +
      (blocker?.isStale ? 2 : 0);

    result.push({ taskId: task.id, score, reasons });
  }

  return result
    .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId))
    .slice(0, limit);
}
