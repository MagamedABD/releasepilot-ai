/**
 * Узкие выборки из метрик: загрузка команд и блокеры.
 *
 * Оба ответа — подмножества того, что отдаёт `/metrics`, и существуют не
 * ради экономии байтов. Разница в одном: здесь задачи названы.
 *
 * Движок оперирует идентификаторами и правильно делает — расчёту нет дела
 * до того, как задача называется. Но экран блокеров, получив список
 * `taskId`, бесполезен: человеку нужно прочесть «PAY-302 Подтверждение
 * возврата на стороне банка», а не сверять UUID. Дотянуть названия клиент
 * может и сам, но это запрос на задачу — то есть N+1 ровно там, где список
 * заведомо короткий и целиком лежит в том же снимке, из которого посчитаны
 * блокеры.
 *
 * Поэтому обогащение делается здесь, на границе, а не в движке. Домен
 * остаётся не знающим про представление, и при этом ни один экран не
 * вынужден собирать ответ из двух запросов.
 */

import type { BlockerInfo, ReleaseMetrics, ReleaseSnapshot, Task } from '@/domain/types';

import { toApiTeamLoad, type ApiTeamLoad } from './metrics';

/** Задача в том виде, в каком её показывают: ключ и название, не UUID. */
export type ApiTaskRef = {
  id: string;
  key: string | null;
  title: string | null;
};

export type ApiTeamLoadView = {
  releaseId: string;
  computedAt: string;
  /**
   * Остаток рабочих дней до плановой даты. Без него загрузка не читается:
   * «140%» означает разное при десяти днях в запасе и при двух.
   */
  remainingWorkingDays: number;
  teams: ApiTeamLoad[];
};

export type ApiBlocker = Omit<BlockerInfo, 'taskId'> & {
  task: ApiTaskRef;
};

export type ApiBlockersView = {
  releaseId: string;
  computedAt: string;
  remainingWorkingDays: number;
  blockers: ApiBlocker[];
  criticalChain: {
    /** Длина цепочки в рабочих днях. */
    days: number;
    /** Задачи по порядку следования в цепочке — именно в нём её и читают. */
    tasks: ApiTaskRef[];
  };
};

function taskIndex(snapshot: ReleaseSnapshot): Map<string, Task> {
  return new Map(snapshot.tasks.map((t) => [t.id, t]));
}

/**
 * Ссылка на задачу по идентификатору.
 *
 * Неизвестный идентификатор даёт ссылку с пустыми полями, а не выбрасывает
 * исключение и не пропадает из списка. Взяться он может только из
 * рассогласования снимка и расчёта, и в таком случае важнее увидеть
 * блокер без названия, чем не увидеть блокера.
 */
function ref(id: string, tasks: Map<string, Task>): ApiTaskRef {
  const task = tasks.get(id);
  return { id, key: task?.key ?? null, title: task?.title ?? null };
}

/** Снимок здесь не нужен: у команды есть имя, и оно уже в метриках. */
export function toApiTeamLoadView(metrics: ReleaseMetrics): ApiTeamLoadView {
  return {
    releaseId: metrics.releaseId,
    computedAt: metrics.computedAt,
    remainingWorkingDays: metrics.remainingWorkingDays,
    // Команды без остатка работ не отсеиваются: «у этой команды всё
    // сделано» — тоже ответ, и на экране загрузки он нужен.
    teams: metrics.teamLoad.map(toApiTeamLoad),
  };
}

export function toApiBlockersView(
  metrics: ReleaseMetrics,
  snapshot: ReleaseSnapshot,
): ApiBlockersView {
  const tasks = taskIndex(snapshot);

  return {
    releaseId: metrics.releaseId,
    computedAt: metrics.computedAt,
    remainingWorkingDays: metrics.remainingWorkingDays,
    blockers: metrics.blockers.map(({ taskId, ...rest }) => ({
      ...rest,
      task: ref(taskId, tasks),
    })),
    criticalChain: {
      days: metrics.criticalChain.days,
      tasks: metrics.criticalChain.taskIds.map((id) => ref(id, tasks)),
    },
  };
}
