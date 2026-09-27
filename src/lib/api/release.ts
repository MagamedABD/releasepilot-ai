/**
 * Релиз: строка базы ↔ представление в API.
 *
 * Наружу — camelCase, как и у задачи: имена колонок остаются внутренним
 * устройством, иначе переименование колонки ломает клиентов.
 *
 * Главное здесь — две отметки времени релиза, `started_at` и
 * `released_at`. Их ставит сервер по переходу статуса, и клиент не может
 * прислать их сам. Причина в разделе о `toReleaseUpdate`.
 */

import type { Database } from '@/lib/database.types';
import type { ReleaseCreateInput, ReleaseUpdateInput } from '@/lib/validation/release';

type ReleaseRow = Database['public']['Tables']['releases']['Row'];

export type ApiRelease = {
  id: string;
  projectId: string;
  name: string;
  status: ReleaseRow['status'];
  plannedDate: string;
  startedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toApiRelease(row: ReleaseRow): ApiRelease {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    plannedDate: row.planned_date,
    startedAt: row.started_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ReleaseInsert = Database['public']['Tables']['releases']['Insert'];
type ReleaseUpdate = Database['public']['Tables']['releases']['Update'];

export function toReleaseInsert(
  input: ReleaseCreateInput,
  orgId: string,
  now: string,
): ReleaseInsert {
  return {
    org_id: orgId,
    project_id: input.projectId,
    name: input.name,
    status: input.status,
    planned_date: input.plannedDate,
    // Релиз можно завести сразу активным — так бывает, когда систему
    // подключают к работе, которая уже идёт. Тогда моментом старта
    // считается создание: другого известного нам момента нет.
    started_at: input.status === 'active' ? now : null,
    // А вот выпущенным сразу — нет. Создать релиз в статусе `released`
    // формально можно (перенос истории), но дата выпуска при этом
    // неизвестна, и подставлять «сейчас» значило бы записать выдумку:
    // историю переносят не в день выпуска.
    released_at: null,
  };
}

/**
 * Изменение релиза.
 *
 * `started_at` ставится один раз — при первом переходе в работу — и
 * больше не сдвигается. Это не мелочь, на ней держится фактор F6.
 *
 * Дрейф объёма движок считает так: задача, у которой
 * `added_to_release_at` позже старта релиза, — это работа, которой при
 * планировании не было. Если бы возврат из «отложен» в «в работе»
 * переставлял старт на сегодня, все ранее добавленные задачи оказались
 * бы добавленными «до старта», и дрейф обнулился бы. То есть релиз,
 * который откладывали дважды, выглядел бы чище релиза, который не
 * откладывали ни разу, — ровно наоборот к действительности.
 *
 * `released_at` ведёт себя иначе: ставится при переходе в «выпущен» и
 * снимается при уходе оттуда. Снимать обязательно — статус в кокпите
 * закрывает расчёты, и релиз, случайно помеченный выпущенным и
 * возвращённый в работу, иначе сохранил бы дату выпуска, которого не
 * было.
 */
export function toReleaseUpdate(
  input: ReleaseUpdateInput,
  current: ReleaseRow,
  now: string,
): ReleaseUpdate {
  const patch: ReleaseUpdate = {};

  if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
  if (input.plannedDate !== undefined && input.plannedDate !== current.planned_date) {
    patch.planned_date = input.plannedDate;
  }

  if (input.status !== undefined && input.status !== current.status) {
    patch.status = input.status;

    if (input.status === 'active' && current.started_at === null) patch.started_at = now;

    if (input.status === 'released') patch.released_at = now;
    else if (current.released_at !== null) patch.released_at = null;
  }

  return patch;
}

