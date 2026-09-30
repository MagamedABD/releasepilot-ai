/**
 * Записи файла + текущее состояние проекта → план записи.
 *
 * Слой отвечает на вопросы, на которые разбор ответить не мог: есть ли
 * такая команда, есть ли такой релиз, заводить задачу или обновлять
 * существующую, на какую задачу указывает ключ в колонке `blocks`.
 * Обращений к базе здесь по-прежнему нет — состояние передаётся снаружи,
 * поэтому план проверяется тестами целиком.
 *
 * Правило, общее для всех неразрешённых ссылок: **запись отклоняется, а
 * не принимается наполовину**. Если в файле написано «Бэкенд», а команды
 * с таким именем нет, задача не заводится вовсе — вместо того, чтобы
 * завестись без команды. Причина не в строгости: задача без команды
 * выглядит нормально и в базе, и на экране, но её часы не попадают ни в
 * одну загрузку, и релиз выглядит спокойнее, чем есть. Отчёт же назовёт
 * строку и колонку, и исправление — одна правка в файле.
 */

import { isOpenStatus } from '@/domain/metrics';
import type { Database } from '@/lib/database.types';

import type { ImportRow, RowError } from './rows';

type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

export type NamedEntity = { id: string; name: string };
export type ExistingTask = { id: string; key: string };

export type ImportContext = {
  /** Команды организации. */
  teams: NamedEntity[];
  /** Релизы проекта. */
  releases: NamedEntity[];
  /** Задачи проекта, у которых есть внешний ключ. */
  existing: ExistingTask[];
};

export type PlanEntry = {
  row: ImportRow;
  /** Идентификатор задачи, если такой ключ в проекте уже есть. */
  existingId: string | null;
  teamId: string | null;
  releaseId: string | null;
};

export type DependencyPlanEntry = {
  line: number;
  blockerKey: string;
  blockedKey: string;
};

export type ImportPlan = {
  create: PlanEntry[];
  update: PlanEntry[];
  dependencies: DependencyPlanEntry[];
  errors: RowError[];
};

/** Сопоставление по имени: без учёта регистра и краевых пробелов. */
function byName(entities: NamedEntity[]): Map<string, string> {
  return new Map(entities.map((e) => [e.name.trim().toLowerCase(), e.id]));
}

export function buildPlan(rows: ImportRow[], ctx: ImportContext): ImportPlan {
  const teams = byName(ctx.teams);
  const releases = byName(ctx.releases);
  const existing = new Map(ctx.existing.map((t) => [t.key, t.id]));

  // Ключи из файла считаются существующими для разрешения связей: задача
  // вправе держать другую задачу того же файла, и порядок строк на это
  // влиять не должен.
  const fileKeys = new Set(rows.map((r) => r.key));

  const accepted: PlanEntry[] = [];
  const errors: RowError[] = [];

  for (const row of rows) {
    const rowErrors: RowError[] = [];

    let teamId: string | null = null;
    if (row.teamName) {
      teamId = teams.get(row.teamName.trim().toLowerCase()) ?? null;
      if (teamId === null) {
        rowErrors.push({
          line: row.line,
          field: 'team',
          message: `Команда «${row.teamName}» не найдена. Создайте её или исправьте имя`,
        });
      }
    }

    let releaseId: string | null = null;
    if (row.releaseName) {
      releaseId = releases.get(row.releaseName.trim().toLowerCase()) ?? null;
      if (releaseId === null) {
        rowErrors.push({
          line: row.line,
          field: 'release',
          message: `Релиз «${row.releaseName}» не найден в этом проекте`,
        });
      }
    }

    for (const blockedKey of row.blocks) {
      if (blockedKey === row.key) {
        rowErrors.push({
          line: row.line,
          field: 'blocks',
          message: 'Задача не может блокировать себя',
        });
        continue;
      }
      if (!fileKeys.has(blockedKey) && !existing.has(blockedKey)) {
        rowErrors.push({
          line: row.line,
          field: 'blocks',
          message: `Задача «${blockedKey}» не найдена ни в файле, ни в проекте`,
        });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    accepted.push({ row, existingId: existing.get(row.key) ?? null, teamId, releaseId });
  }

  /*
    Связи собираются только по принятым записям, и здесь правило «или
    целиком, или никак» намеренно не продолжается вглубь.

    Ссылка на задачу, отклонённую из-за ошибок в её собственной строке,
    связь создать не позволяет — её не на что вешать. Но отклонять из-за
    этого и саму держащую задачу нельзя: отказ пошёл бы по цепочке
    дальше, и одна опечатка в одной строке могла бы отменить половину
    файла. Поэтому задача заводится, а несозданная связь попадает в
    отчёт — там же, где и причина, по которой она не создана.

    Повторы пары отбрасываются: «PAY-2 PAY-2» в одной ячейке — описка,
    а не две связи, и вставка второй упёрлась бы в уникальный ключ,
    превратив описку в ошибку всего пакета.
  */
  const acceptedKeys = new Set(accepted.map((e) => e.row.key));
  const dependencies: DependencyPlanEntry[] = [];
  const seenPairs = new Set<string>();
  for (const entry of accepted) {
    for (const blockedKey of entry.row.blocks) {
      const pair = `${entry.row.key}→${blockedKey}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);

      if (acceptedKeys.has(blockedKey) || existing.has(blockedKey)) {
        dependencies.push({
          line: entry.row.line,
          blockerKey: entry.row.key,
          blockedKey,
        });
      } else {
        errors.push({
          line: entry.row.line,
          field: 'blocks',
          message: `Связь не создана: задача «${blockedKey}» отклонена из-за ошибок в своей строке`,
        });
      }
    }
  }

  return {
    create: accepted.filter((e) => e.existingId === null),
    update: accepted.filter((e) => e.existingId !== null),
    dependencies,
    errors,
  };
}

/**
 * Новая задача.
 *
 * Отметка блокировки ставится сервером и только у открытой задачи — тот
 * же инвариант, что и в обычном создании задачи (`src/lib/api/task.ts`).
 * Иначе импорт заводил бы задачи одновременно готовые и заблокированные,
 * а два ответа на вопрос «сколько блокеров» расходились бы.
 */
export function toTaskInsert(
  entry: PlanEntry,
  orgId: string,
  projectId: string,
  now: string,
): TaskInsert {
  const { row } = entry;
  return {
    org_id: orgId,
    project_id: projectId,
    release_id: entry.releaseId,
    external_key: row.key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimate_h: row.estimateH,
    spent_h: row.spentH,
    team_id: entry.teamId,
    blocked_since: row.blocked && isOpenStatus(row.status) ? now : null,
    added_to_release_at: entry.releaseId ? now : null,
  };
}

/**
 * Обновление существующей задачи.
 *
 * Пишутся все поля, которые импорт знает, а не только изменившиеся: файл
 * — это заявленное состояние задачи целиком, и выборочное обновление
 * оставило бы в базе смесь старого и нового, про которую нельзя сказать,
 * откуда что взялось.
 *
 * Момент попадания в релиз обновляется только при смене релиза — иначе
 * каждый повторный импорт объявлял бы все задачи заново добавленными, и
 * дрейф объёма (F6) показывал бы стопроцентный прирост на пустом месте.
 */
export function toTaskUpdate(
  entry: PlanEntry,
  current: { release_id: string | null; blocked_since: string | null },
  now: string,
): TaskUpdate {
  const { row } = entry;
  const patch: TaskUpdate = {
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimate_h: row.estimateH,
    spent_h: row.spentH,
    team_id: entry.teamId,
    release_id: entry.releaseId,
  };

  if (entry.releaseId !== current.release_id) {
    patch.added_to_release_at = entry.releaseId ? now : null;
  }

  const wasBlocked = current.blocked_since !== null;
  const shouldBlock = row.blocked && isOpenStatus(row.status);
  // Уже стоящую отметку повторный импорт не сдвигает: иначе возраст
  // блокера обнулялся бы при каждой загрузке файла, и застарелых
  // блокеров не стало бы вовсе.
  if (shouldBlock && !wasBlocked) patch.blocked_since = now;
  if (!shouldBlock && wasBlocked) patch.blocked_since = null;

  return patch;
}
