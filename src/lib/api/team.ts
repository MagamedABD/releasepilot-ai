/**
 * Команда и её ёмкость: строка базы ↔ представление в API.
 *
 * Как и у задач, наружу уходит camelCase, а не имена колонок: имя
 * колонки — часть внутреннего устройства, и чтение `available_hours`
 * клиентом превращает переименование в ломающее изменение API.
 */

import type { Database } from '@/lib/database.types';
import type { CapacityPutInput } from '@/lib/validation/team';

type TeamRow = Database['public']['Tables']['teams']['Row'];
type CapacityRow = Database['public']['Tables']['team_capacity']['Row'];
type CapacityInsert = Database['public']['Tables']['team_capacity']['Insert'];

export type ApiTeam = {
  id: string;
  orgId: string;
  name: string;
  kind: TeamRow['kind'];
  createdAt: string;
};

export type ApiCapacity = {
  id: string;
  teamId: string;
  periodStart: string;
  periodEnd: string;
  availableHours: number;
  updatedAt: string;
};

/**
 * Организация в ответе оставлена намеренно, в отличие от связи задач.
 *
 * Пользователь может состоять в двух организациях, и список команд без
 * `orgId` невозможно разложить по ним — экран показал бы две «Тестирование»
 * подряд без признака, чьи они.
 */
export function toApiTeam(row: TeamRow): ApiTeam {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

export function toApiCapacity(row: CapacityRow): ApiCapacity {
  return {
    id: row.id,
    teamId: row.team_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    // numeric из Postgres приходит строкой — та же причина, по которой
    // приведение стоит в переводе задачи и снимка.
    availableHours: Number(row.available_hours),
    updatedAt: row.updated_at,
  };
}

export function toCapacityInsert(
  input: CapacityPutInput,
  teamId: string,
  orgId: string,
): CapacityInsert {
  return {
    org_id: orgId,
    team_id: teamId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    available_hours: input.availableHours,
  };
}
