import { RISK_CONFIG, type RiskConfig } from './config';
import {
  addDays,
  daysBetween,
  remainingWorkingDays,
  startOfDay,
  workingDaysInclusive,
} from './calendar';
import type {
  BlockerInfo,
  Dependency,
  IsoDate,
  ReleaseSnapshot,
  Task,
  TeamLoad,
} from './types';

/** Задача считается требующей работы, если она не завершена и не отменена. */
export function isOpen(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

export function isBlocked(task: Task): boolean {
  return Boolean(task.blockedSince) && isOpen(task);
}

export function countByStatus(tasks: Task[]) {
  const counts = {
    total: 0,
    done: 0,
    inProgress: 0,
    testing: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const task of tasks) {
    if (task.status === 'cancelled') {
      counts.cancelled++;
      continue;
    }
    counts.total++;
    if (task.status === 'done') counts.done++;
    if (task.status === 'in_progress' || task.status === 'review') counts.inProgress++;
    if (task.status === 'testing') counts.testing++;
    if (isBlocked(task)) counts.blocked++;
  }

  return counts;
}

/**
 * Трудозатраты. Отменённые задачи исключаются полностью: они не работа
 * и не должны ни улучшать, ни ухудшать готовность.
 */
export function effortTotals(tasks: Task[]) {
  let totalH = 0;
  let doneH = 0;

  for (const task of tasks) {
    if (task.status === 'cancelled') continue;
    totalH += task.estimateH;
    if (task.status === 'done') doneH += task.estimateH;
  }

  return { totalH, doneH, remainingH: totalH - doneH };
}

/**
 * Полезная ёмкость команды в интервале (now, plannedDate].
 *
 * Запись о ёмкости задаёт часы на период; берётся доля, пропорциональная
 * пересечению периода с оставшимся временем, и умножается на фокус-фактор.
 */
export function teamCapacityHours(
  snapshot: ReleaseSnapshot,
  teamId: string,
  config: RiskConfig = RISK_CONFIG,
): number {
  const holidays = new Set<IsoDate>(snapshot.calendar.holidays);
  const windowStart = addDays(startOfDay(snapshot.now), 1);
  const windowEnd = startOfDay(snapshot.release.plannedDate);

  let hours = 0;

  for (const record of snapshot.capacity) {
    if (record.teamId !== teamId) continue;

    const periodStart = startOfDay(record.periodStart);
    const periodEnd = startOfDay(record.periodEnd);
    const periodDays = workingDaysInclusive(periodStart, periodEnd, holidays);
    if (periodDays === 0) continue;

    const overlapStart = new Date(
      Math.max(periodStart.getTime(), windowStart.getTime()),
    );
    const overlapEnd = new Date(Math.min(periodEnd.getTime(), windowEnd.getTime()));
    const overlapDays = workingDaysInclusive(overlapStart, overlapEnd, holidays);
    if (overlapDays === 0) continue;

    hours += (record.availableHours * overlapDays) / periodDays;
  }

  return hours * config.defaultFocusFactor;
}

export function calculateTeamLoad(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
): TeamLoad[] {
  return snapshot.teams.map((team) => {
    const remainingH = snapshot.tasks
      .filter((task) => task.teamId === team.id && isOpen(task))
      .reduce((sum, task) => sum + task.estimateH, 0);

    const capacityH = teamCapacityHours(snapshot, team.id, config);

    // Ноль ёмкости при наличии работ — не «нулевая загрузка», а бесконечная.
    // Иначе команда без выделенного времени выглядит самой свободной.
    const load = capacityH > 0 ? remainingH / capacityH : remainingH > 0 ? Infinity : 0;

    return { teamId: team.id, teamName: team.name, remainingH, capacityH, load };
  });
}

export function collectBlockers(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
): BlockerInfo[] {
  const openIds = new Set(snapshot.tasks.filter(isOpen).map((t) => t.id));

  const blocksCount = new Map<string, number>();
  for (const dep of snapshot.dependencies) {
    if (dep.type !== 'blocks') continue;
    if (!openIds.has(dep.blockedTaskId)) continue;
    blocksCount.set(dep.blockerTaskId, (blocksCount.get(dep.blockerTaskId) ?? 0) + 1);
  }

  return snapshot.tasks
    .filter(isBlocked)
    .map((task) => {
      const blockedSince = task.blockedSince as string;
      const blockedDays = Math.max(0, daysBetween(blockedSince, snapshot.now));
      return {
        taskId: task.id,
        priority: task.priority,
        estimateH: task.estimateH,
        blockedSince,
        blockedDays,
        isStale: blockedDays >= config.staleBlockerDays,
        blocksCount: blocksCount.get(task.id) ?? 0,
      };
    })
    .sort((a, b) => b.blockedDays - a.blockedDays);
}

/**
 * Очередь тестирования. Задача, которую ещё предстоит протестировать,
 * создаёт нагрузку на QA пропорционально своей оценке.
 */
export function qaFunnel(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
): { share: number; requiredH: number; capacityH: number } {
  const qaTeams = snapshot.teams.filter((team) => team.kind === 'qa');
  if (qaTeams.length === 0) return { share: 0, requiredH: 0, capacityH: 0 };

  const qaTeamIds = new Set(qaTeams.map((team) => team.id));

  let requiredH = 0;
  for (const task of snapshot.tasks) {
    if (!isOpen(task)) continue;
    // Работа, уже лежащая на QA, учитывается целиком; остальная — долей,
    // которая придётся на тестирование.
    requiredH += qaTeamIds.has(task.teamId ?? '')
      ? task.estimateH
      : task.estimateH * config.qaEffortRatio;
  }

  const capacityH = qaTeams.reduce(
    (sum, team) => sum + teamCapacityHours(snapshot, team.id, config),
    0,
  );

  if (requiredH === 0) return { share: 0, requiredH: 0, capacityH };

  const share = Math.max(0, (requiredH - capacityH) / requiredH);
  return { share: Math.min(1, share), requiredH, capacityH };
}

/** Доля трудозатрат, добавленных в релиз после его старта. */
export function scopeDrift(snapshot: ReleaseSnapshot): {
  addedH: number;
  share: number;
} {
  const startedAt = snapshot.release.startedAt;
  const { totalH } = effortTotals(snapshot.tasks);
  if (!startedAt || totalH === 0) return { addedH: 0, share: 0 };

  const startInstant = startOfDay(startedAt).getTime();

  let addedH = 0;
  for (const task of snapshot.tasks) {
    if (task.status === 'cancelled') continue;
    if (!task.addedToReleaseAt) continue;
    if (startOfDay(task.addedToReleaseAt).getTime() > startInstant) {
      addedH += task.estimateH;
    }
  }

  return { addedH, share: addedH / totalH };
}

export function remainingDays(snapshot: ReleaseSnapshot): number {
  return remainingWorkingDays(
    snapshot.now,
    snapshot.release.plannedDate,
    new Set(snapshot.calendar.holidays),
  );
}

export function dependencyMap(dependencies: Dependency[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (dep.type !== 'blocks') continue;
    const list = map.get(dep.blockerTaskId);
    if (list) list.push(dep.blockedTaskId);
    else map.set(dep.blockerTaskId, [dep.blockedTaskId]);
  }
  return map;
}
