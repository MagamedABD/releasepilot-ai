/**
 * Проект: строка базы ↔ представление в API.
 *
 * Отметок времени по переходу состояния у проекта нет — в отличие от
 * релиза и задачи, где сервер ведёт их сам. Поэтому и преобразования
 * здесь простые: ни одно поле не выводится из прежнего значения.
 */

import type { Database } from '@/lib/database.types';
import type { ProjectCreateInput, ProjectUpdateInput } from '@/lib/validation/release';

type ProjectRow = Database['public']['Tables']['projects']['Row'];

export type ApiProject = {
  id: string;
  orgId: string;
  name: string;
  key: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * `orgId` отдаётся наружу, в отличие от задачи и релиза.
 *
 * Не потому, что здесь другие правила доступа — они те же. Просто
 * пользователь может состоять в двух организациях, и без этого поля
 * список проектов не разложить по организациям, не запрашивая каждый
 * проект отдельно.
 */
export function toApiProject(row: ProjectRow): ApiProject {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    key: row.key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export function toProjectInsert(input: ProjectCreateInput): ProjectInsert {
  return { org_id: input.orgId, name: input.name, key: input.key };
}

/**
 * Изменение проекта.
 *
 * Поле попадает в патч только если значение действительно другое. Иначе
 * `PATCH` с прежним названием выполнил бы настоящий UPDATE и сдвинул
 * `updated_at` — запись изменилась бы по запросу, который ничего не менял.
 */
export function toProjectUpdate(input: ProjectUpdateInput, current: ProjectRow): ProjectUpdate {
  const patch: ProjectUpdate = {};
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
  if (input.key !== undefined && input.key !== current.key) patch.key = input.key;
  return patch;
}
