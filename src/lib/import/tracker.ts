/**
 * Yandex Tracker → записи импорта (FR-40).
 *
 * Слой чистый: на вход — разобранный JSON задач и связей, на выход — те же
 * `ImportRow`, что даёт файл. Дальше работает общий путь импорта: план,
 * проверка ссылок, запись. Иначе у трекера появился бы свой путь записи, и
 * правила «что отклонять» разошлись бы с файловым импортом — а они одни.
 *
 * **Форма ответа взята из документации API, а не из живого вызова.**
 * Корпоративный трекер — чужие данные, и обращаться к нему без решения
 * владельца нельзя. Поэтому разбор написан по документированным полям и
 * проверен на фикстуре; при первом живом запуске расхождения возможны, и
 * искать их нужно здесь, а не в плане импорта.
 */

import type { ImportRow, RowError } from './rows';
import { anonymizeTask } from './anonymize';

/** Задача в ответе `/v2/issues`. Перечислены только используемые поля. */
export type TrackerIssue = {
  key?: string;
  summary?: string;
  description?: string;
  status?: { key?: string };
  priority?: { key?: string };
  /** ISO-8601, например `P1DT4H`. */
  estimation?: string;
  spent?: string;
  assignee?: { display?: string };
  queue?: { key?: string };
};

/** Связь в ответе `/v2/issues/{key}/links`. */
export type TrackerLink = {
  type?: { id?: string };
  direction?: string;
  object?: { key?: string };
};

/**
 * Статусы трекера.
 *
 * Ключи статусов настраиваются в каждой очереди, поэтому список заведомо
 * неполон — и это не повод угадывать по похожести. Незнакомый статус
 * отклоняет запись с указанием, какой именно встретился: добавить
 * сопоставление дешевле, чем разбираться потом, почему релиз выглядит
 * готовым на 90%.
 */
const STATUSES: Record<string, ImportRow['status']> = {
  open: 'backlog',
  new: 'backlog',
  needinfo: 'backlog',
  inprogress: 'in_progress',
  inprogres: 'in_progress',
  review: 'review',
  needreview: 'review',
  testing: 'testing',
  readyfortest: 'testing',
  closed: 'done',
  resolved: 'done',
  released: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  rejected: 'cancelled',
};

const PRIORITIES: Record<string, ImportRow['priority']> = {
  blocker: 'P0',
  critical: 'P1',
  normal: 'P2',
  minor: 'P3',
  trivial: 'P3',
};

/**
 * Длительность ISO-8601 в часах.
 *
 * `P1DT4H` — это 12 часов, а не 28: в трекере день оценки равен рабочему
 * дню, а не сутками. Неделя — пять дней. Числа взяты из настроек трекера
 * по умолчанию и собраны здесь, потому что ошибка в них масштабирует все
 * оценки сразу: релиз выглядел бы вдвое тяжелее или вдвое легче, и ни
 * один тест этого бы не заметил.
 */
const HOURS_PER_DAY = 8;
const DAYS_PER_WEEK = 5;

export function durationToHours(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!match) return null;

  const [, w, d, h, m] = match;
  const hours =
    (Number(w ?? 0) * DAYS_PER_WEEK + Number(d ?? 0)) * HOURS_PER_DAY +
    Number(h ?? 0) +
    Number(m ?? 0) / 60;

  return Math.round(hours * 100) / 100;
}

export type TrackerMapOptions = {
  orgId: string;
  /**
   * Анонимизация (FR-42). По умолчанию включена: утёкшее название задачи
   * обратно не спрячешь, а псевдонимизированное можно переимпортировать.
   */
  anonymize?: boolean;
  /** Название релиза, в который идут задачи. Одно на запуск импорта. */
  releaseName?: string | null;
  /** Ключ очереди → имя команды в организации. */
  teamByQueue?: Record<string, string>;
};

/**
 * Задачи трекера → записи импорта.
 *
 * Номер «строки» — порядковый номер задачи в ответе: строк у JSON нет, а
 * отчёт обязан указывать, о какой именно задаче речь (FR-41).
 */
export function mapTrackerIssues(
  issues: TrackerIssue[],
  links: Record<string, TrackerLink[]>,
  options: TrackerMapOptions,
): { rows: ImportRow[]; errors: RowError[] } {
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const anonymize = options.anonymize ?? true;

  issues.forEach((issue, index) => {
    const line = index + 1;
    const key = issue.key?.trim();
    if (!key) {
      errors.push({ line, field: 'key', message: 'У задачи нет ключа' });
      return;
    }

    const estimateH = durationToHours(issue.estimation);
    if (estimateH === null) {
      /*
        Оценки нет — задача не импортируется. Подставить час «чтобы
        прошло» нельзя: на оценках держится вся готовность, и выдуманные
        часы делают процент выдуманным. Отчёт назовёт такие задачи, и
        проставить оценки в трекере — работа на минуту.
      */
      errors.push({ line, field: 'estimation', message: `${key}: не указана оценка` });
      return;
    }
    if (estimateH <= 0) {
      errors.push({ line, field: 'estimation', message: `${key}: оценка не больше нуля` });
      return;
    }

    const statusKey = issue.status?.key?.toLowerCase() ?? '';
    const status = statusKey === '' ? 'backlog' : STATUSES[statusKey];
    if (status === undefined) {
      errors.push({
        line,
        field: 'status',
        message: `${key}: неизвестный статус «${issue.status?.key}» — добавьте сопоставление`,
      });
      return;
    }

    const priorityKey = issue.priority?.key?.toLowerCase() ?? '';
    const priority = priorityKey === '' ? 'P2' : PRIORITIES[priorityKey];
    if (priority === undefined) {
      errors.push({
        line,
        field: 'priority',
        message: `${key}: неизвестный приоритет «${issue.priority?.key}»`,
      });
      return;
    }

    /*
      Связи: нас интересует только «блокирует». Ключ типа в трекере —
      `depends`, и направление различает, кто кого держит: `outward`
      означает «эта задача зависит от объекта», то есть объект её
      блокирует, а не наоборот. Перепутать направление здесь — значит
      построить критическую цепочку задом наперёд, причём молча.
    */
    const blocks = (links[key] ?? [])
      .filter((l) => l.type?.id === 'depends' && l.direction === 'inward' && l.object?.key)
      .map((l) => l.object?.key as string);

    const text = anonymize
      ? anonymizeTask(options.orgId, key)
      : { key, title: issue.summary ?? key, description: issue.description ?? null };

    rows.push({
      line,
      key: text.key,
      title: text.title,
      description: text.description,
      status,
      priority,
      estimateH,
      spentH: durationToHours(issue.spent) ?? 0,
      teamName: options.teamByQueue?.[issue.queue?.key ?? ''] ?? null,
      releaseName: options.releaseName ?? null,
      // Связи тоже псевдонимизируются — иначе в них остались бы исходные
      // ключи, и анонимизация текста оказалась бы напрасной.
      blocks: anonymize ? blocks.map((k) => anonymizeTask(options.orgId, k).key) : blocks,
      // Признака блокировки в трекере нет: «заблокирована» там выражается
      // связью, а не флагом, и выводить его из связей здесь нельзя —
      // блокировка считается движком по открытости блокера.
      blocked: false,
    });
  });

  return { rows, errors };
}
