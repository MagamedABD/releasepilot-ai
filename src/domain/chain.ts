import { RISK_CONFIG, type RiskConfig } from './config';
import { dependencyMap, isOpen } from './metrics';
import type { ReleaseSnapshot, Task } from './types';

/**
 * Критическая цепочка — самая длинная последовательность незавершённых задач,
 * связанных отношением «блокирует».
 *
 * Это не сумма всех работ и не критический путь в классическом смысле: здесь
 * важно, что эти задачи нельзя делать параллельно, сколько бы людей ни добавить.
 * Именно поэтому цепочка длиннее оставшегося времени — приговор релизу,
 * а не повод нанять ещё разработчика.
 */
export function criticalChain(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
): { taskIds: string[]; days: number } {
  const open = snapshot.tasks.filter(isOpen);
  if (open.length === 0) return { taskIds: [], days: 0 };

  const byId = new Map<string, Task>(open.map((task) => [task.id, task]));
  const blocks = dependencyMap(snapshot.dependencies);
  const hoursPerDay = config.workingHoursPerDay * config.defaultFocusFactor;

  const taskDays = (task: Task) => task.estimateH / hoursPerDay;

  /** Мемоизация: длиннейший хвост, начинающийся с задачи. */
  const memo = new Map<string, { days: number; path: string[] }>();
  /** Задачи в текущей ветке обхода — защита от цикла. */
  const visiting = new Set<string>();

  function longestFrom(taskId: string): { days: number; path: string[] } {
    const cached = memo.get(taskId);
    if (cached) return cached;

    const task = byId.get(taskId);
    if (!task) return { days: 0, path: [] };

    // Циклы запрещены триггером в БД, но движок обязан оставаться
    // работоспособным на любом входе, включая испорченный.
    if (visiting.has(taskId)) return { days: 0, path: [] };
    visiting.add(taskId);

    let best: { days: number; path: string[] } = { days: 0, path: [] };
    for (const nextId of blocks.get(taskId) ?? []) {
      if (!byId.has(nextId)) continue;
      const candidate = longestFrom(nextId);
      if (candidate.days > best.days) best = candidate;
    }

    visiting.delete(taskId);

    const result = {
      days: taskDays(task) + best.days,
      path: [taskId, ...best.path],
    };
    memo.set(taskId, result);
    return result;
  }

  let best: { days: number; path: string[] } = { days: 0, path: [] };
  for (const task of open) {
    const candidate = longestFrom(task.id);
    if (candidate.days > best.days) best = candidate;
  }

  return { taskIds: best.path, days: best.days };
}
