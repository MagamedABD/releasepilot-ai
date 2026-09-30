/**
 * Задача: строка базы ↔ представление в API.
 *
 * Наружу отдаётся camelCase, а не имена колонок. Это не косметика:
 * имена колонок — часть внутреннего устройства, и как только клиент
 * начинает читать `estimate_h`, переименование колонки становится
 * ломающим изменением API.
 */

import { isOpenStatus } from '@/domain/metrics';
import type { Database } from '@/lib/database.types';
import type { TaskCreateInput, TaskUpdateInput } from '@/lib/validation/task';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

export type ApiTask = {
  id: string;
  projectId: string;
  releaseId: string | null;
  externalKey: string | null;
  title: string;
  description: string | null;
  status: TaskRow['status'];
  priority: TaskRow['priority'];
  estimateH: number;
  spentH: number;
  teamId: string | null;
  assigneeId: string | null;
  /** Наружу — факт, а не отметка времени: её ставит сервер. */
  blocked: boolean;
  blockedSince: string | null;
  addedToReleaseAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toApiTask(row: TaskRow): ApiTask {
  return {
    id: row.id,
    projectId: row.project_id,
    releaseId: row.release_id,
    externalKey: row.external_key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    // Числовые типы Postgres приходят строкой — та же причина, по которой
    // Number() стоит в переводе снимка.
    estimateH: Number(row.estimate_h),
    spentH: Number(row.spent_h),
    teamId: row.team_id,
    assigneeId: row.assignee_id,
    blocked: row.blocked_since !== null,
    blockedSince: row.blocked_since,
    addedToReleaseAt: row.added_to_release_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type Insert = Database['public']['Tables']['tasks']['Insert'];
type Update = Database['public']['Tables']['tasks']['Update'];

export function toInsert(input: TaskCreateInput, orgId: string, now: string): Insert {
  return {
    org_id: orgId,
    project_id: input.projectId,
    release_id: input.releaseId ?? null,
    external_key: input.externalKey ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status,
    priority: input.priority,
    estimate_h: input.estimateH,
    spent_h: input.spentH,
    team_id: input.teamId ?? null,
    assignee_id: input.assigneeId ?? null,
    // Тот же инвариант, что и при изменении: сразу закрытая задача
    // заблокированной не создаётся (объяснение — у `toUpdate`).
    blocked_since: input.blocked && isOpenStatus(input.status) ? now : null,
    // Момент попадания в релиз ставится здесь же. От него движок считает
    // дрейф объёма (F6): задача, добавленная после старта релиза, —
    // это работа, которой при планировании не было.
    added_to_release_at: input.releaseId ? now : null,
  };
}

/**
 * Изменение задачи.
 *
 * Две отметки времени сервер ведёт сам, и обе — по переходу, а не по
 * состоянию:
 *
 * `blocked_since` ставится, когда задача стала заблокированной, и
 * снимается, когда перестала. Уже стоящую отметку повторный `blocked:
 * true` не сдвигает — иначе любое сохранение формы обнуляло бы возраст
 * блокера, и застарелых блокеров не стало бы вовсе: каждый выглядел бы
 * свежим ровно до следующего редактирования.
 *
 * `added_to_release_at` ставится при переносе задачи в релиз и
 * снимается при изъятии. Прежнее значение при переносе в другой релиз
 * не сохраняется: для нового релиза важно, когда задача попала в него,
 * а не когда она когда-то попала в предыдущий.
 */
export function toUpdate(input: TaskUpdateInput, current: TaskRow, now: string): Update {
  const patch: Update = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.externalKey !== undefined) patch.external_key = input.externalKey ?? null;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.estimateH !== undefined) patch.estimate_h = input.estimateH;
  if (input.spentH !== undefined) patch.spent_h = input.spentH;
  if (input.teamId !== undefined) patch.team_id = input.teamId ?? null;
  if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId ?? null;

  if (input.blocked !== undefined) {
    const isBlocked = current.blocked_since !== null;
    if (input.blocked && !isBlocked) patch.blocked_since = now;
    if (!input.blocked && isBlocked) patch.blocked_since = null;
  }

  if (input.releaseId !== undefined) {
    const next = input.releaseId ?? null;
    if (next !== current.release_id) {
      patch.release_id = next;
      patch.added_to_release_at = next ? now : null;
    }
  }

  /*
    Закрытая задача не бывает заблокированной, и отметку снимает сервер.

    Без этого `PATCH { status: 'done' }` оставляет `blocked_since`
    стоять, и в базе заводится задача одновременно готовая и
    заблокированная. Движок такую считает незаблокированной (`isBlocked`
    требует открытости), а выборка по `blocked_since is not null` —
    заблокированной, и два ответа на один вопрос расходятся: в кокпите
    «Блок: 4», а по ссылке с этого числа пять строк. Правило концепции
    «каждое число — ссылка» держится ровно до первого такого расхождения.

    Чинить это фильтром в каждой выборке значит чинить следствие: пока
    инвариант не обеспечен при записи, его придётся обходить всюду, где
    кто-то спросит про блокировки. Поэтому запрет стоит здесь.
  */
  const nextStatus = patch.status ?? current.status;
  if (!isOpenStatus(nextStatus)) {
    // Отметку снимаем, только если она есть. Записать `null` поверх
    // `null` значит сделать патч непустым на пустом месте: маршрут
    // перестанет видеть, что менять нечего, выполнит настоящий UPDATE
    // и сдвинет `updated_at` — по запросу, который ничего не изменил.
    if (current.blocked_since !== null) patch.blocked_since = null;
    else delete patch.blocked_since;
  }

  return patch;
}

type DependencyRow = Database['public']['Tables']['task_dependencies']['Row'];

/**
 * Связь между задачами.
 *
 * Наружу отдаётся парой «кто держит — кого держат», а не направлением из
 * запроса. Запрос описывает связь относительно задачи в адресе, ответ —
 * сама связь, и читать его должно быть одинаково независимо от того, с
 * какой стороны её добавили.
 */
export type ApiDependency = {
  id: string;
  blockerTaskId: string;
  blockedTaskId: string;
  type: DependencyRow['type'];
  createdAt: string;
};

export function toApiDependency(row: DependencyRow): ApiDependency {
  return {
    id: row.id,
    blockerTaskId: row.blocker_task_id,
    blockedTaskId: row.blocked_task_id,
    type: row.type,
    createdAt: row.created_at,
  };
}
