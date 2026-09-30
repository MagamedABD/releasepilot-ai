/**
 * Одна запись импорта: из чего угодно — в задачу.
 *
 * Слой стоит между разбором файла и записью в базу, и делает он одно:
 * приводит присланное человеком к тому, что понимает база, а непонятное
 * называет по имени и по строке (FR-41).
 *
 * Отдельный модуль, а не схема Zod, по двум причинам. Во-первых, здесь
 * не проверка, а перевод: «в работе», «In Progress» и «in_progress» —
 * один и тот же статус, и отвечать на первые два «неизвестный статус»
 * значит требовать от менеджера переписать выгрузку руками. Во-вторых,
 * ошибка обязана нести номер строки и имя колонки: отчёт «проверьте
 * заполнение полей» на файле из трёхсот задач бесполезен.
 *
 * Чего здесь нет: обращений к базе. Существование команды и релиза
 * проверяется дальше, где они известны, — иначе этот слой пришлось бы
 * тестировать с базой.
 */

import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/validation/task';

type TaskStatus = (typeof TASK_STATUSES)[number];
type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type ImportRow = {
  /** Для CSV — строка файла, для JSON — номер элемента. Считается с единицы. */
  line: number;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimateH: number;
  spentH: number;
  description: string | null;
  /** Имена, а не идентификаторы: в выгрузке их и не бывает. */
  teamName: string | null;
  releaseName: string | null;
  /** Ключи задач, которые эта задача держит. */
  blocks: string[];
  blocked: boolean;
};

export type RowError = {
  line: number;
  /** Колонка, из-за которой запись отклонена. `null` — вся запись. */
  field: string | null;
  message: string;
};

export type ParsedRows = { rows: ImportRow[]; errors: RowError[] };

/**
 * Синонимы колонок.
 *
 * Выгрузки приходят и по-английски, и по-русски, и требовать
 * переименования колонок значит переложить работу на того, кто и так
 * принёс данные. Список конечный и осознанный: угадывать по похожести
 * нельзя — колонка «время» может означать и оценку, и затраты.
 */
const COLUMNS: Record<string, string[]> = {
  key: ['key', 'ключ', 'id', 'issue', 'issue key'],
  title: ['title', 'название', 'summary', 'тема', 'заголовок'],
  description: ['description', 'описание'],
  status: ['status', 'статус'],
  priority: ['priority', 'приоритет'],
  estimateH: ['estimate_h', 'estimate', 'оценка', 'оценка, ч', 'estimate, h'],
  spentH: ['spent_h', 'spent', 'затраты', 'затраты, ч', 'spent, h'],
  teamName: ['team', 'команда'],
  releaseName: ['release', 'релиз', 'версия', 'fixversion', 'fix version'],
  blocks: ['blocks', 'блокирует', 'зависимости'],
  blocked: ['blocked', 'заблокирована', 'блок'],
};

/** Статусы разных трекеров — к своим. */
const STATUSES: Record<string, TaskStatus> = {
  backlog: 'backlog',
  бэклог: 'backlog',
  открыта: 'backlog',
  open: 'backlog',
  todo: 'backlog',
  'to do': 'backlog',
  new: 'backlog',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  'в работе': 'in_progress',
  review: 'review',
  'code review': 'review',
  ревью: 'review',
  'на ревью': 'review',
  testing: 'testing',
  тестирование: 'testing',
  'в тестировании': 'testing',
  qa: 'testing',
  done: 'done',
  готово: 'done',
  closed: 'done',
  завершена: 'done',
  выполнено: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  отменена: 'cancelled',
  отменено: 'cancelled',
};

const PRIORITIES: Record<string, TaskPriority> = {
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
  blocker: 'P0',
  critical: 'P0',
  критический: 'P0',
  major: 'P1',
  high: 'P1',
  высокий: 'P1',
  normal: 'P2',
  medium: 'P2',
  средний: 'P2',
  minor: 'P3',
  low: 'P3',
  низкий: 'P3',
};

const TRUE_WORDS = ['true', '1', 'yes', 'y', 'да', '+'];
const FALSE_WORDS = ['false', '0', 'no', 'n', 'нет', '-', ''];

/**
 * Число из ячейки.
 *
 * Запятая как разделитель дробной части — не небрежность, а норма
 * русской локали Excel: «8,5» в файле встречается чаще, чем «8.5».
 * Пробелы внутри («1 200») оттуда же — разделитель разрядов.
 */
function toNumber(raw: string): number | null {
  const text = raw.replace(/\s| /g, '').replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Сопоставление имён колонок файла с полями записи. */
export function mapHeader(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    const at = header.findIndex((h) => names.includes(h));
    if (at !== -1) index[field] = at;
  }
  return index;
}

/**
 * Значение поля записи, откуда бы запись ни пришла.
 *
 * CSV даёт массив значений и карту колонок, JSON — объект с именами.
 * Чтобы проверка была одна, обе формы приводятся к одной функции доступа.
 */
export type FieldReader = (field: string) => string;

export function csvReader(values: string[], index: Record<string, number>): FieldReader {
  return (field) => {
    const at = index[field];
    return at === undefined ? '' : (values[at] ?? '').trim();
  };
}

export function objectReader(row: Record<string, unknown>): FieldReader {
  // Ключи объекта тоже приводятся к нижнему регистру: в JSON из трекера
  // поле называется то `estimateH`, то `estimate_h`.
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lower.set(k.trim().toLowerCase(), v);

  return (field) => {
    for (const name of [field.toLowerCase(), ...(COLUMNS[field] ?? [])]) {
      const value = lower.get(name);
      if (value === undefined || value === null) continue;
      return String(value).trim();
    }
    return '';
  };
}

/**
 * Проверка и перевод одной записи.
 *
 * Ошибки собираются все, а не только первая: иначе исправление файла
 * превращается в переписку из десяти раундов — каждая загрузка сообщала
 * бы об одной следующей ошибке в той же строке.
 */
export function readRow(line: number, read: FieldReader): ImportRow | RowError[] {
  const errors: RowError[] = [];

  const key = read('key');
  if (key === '') errors.push({ line, field: 'key', message: 'Не указан ключ задачи' });
  else if (key.length > 40) errors.push({ line, field: 'key', message: 'Ключ длиннее 40 символов' });

  const title = read('title');
  if (title === '') errors.push({ line, field: 'title', message: 'Не указано название' });
  else if (title.length > 300) {
    errors.push({ line, field: 'title', message: 'Название длиннее 300 символов' });
  }

  /*
    Оценка обязательна и строго больше нуля — это ограничение базы, и
    оно же требование FR-07: на оценках держится вся готовность.
    Задача с нулевой оценкой прошла бы импорт и обнулила бы процент
    готовности релиза, не вызвав ни одной ошибки.
  */
  const estimateRaw = read('estimateH');
  const estimateH = toNumber(estimateRaw);
  if (estimateRaw === '') {
    errors.push({ line, field: 'estimate_h', message: 'Не указана оценка трудозатрат' });
  } else if (estimateH === null) {
    errors.push({ line, field: 'estimate_h', message: `Оценка не число: «${estimateRaw}»` });
  } else if (estimateH <= 0) {
    errors.push({ line, field: 'estimate_h', message: 'Оценка должна быть больше нуля' });
  } else if (estimateH > 10_000) {
    errors.push({ line, field: 'estimate_h', message: 'Похоже на опечатку: слишком много часов' });
  }

  const spentRaw = read('spentH');
  const spentH = spentRaw === '' ? 0 : toNumber(spentRaw);
  if (spentH === null) {
    errors.push({ line, field: 'spent_h', message: `Затраты не число: «${spentRaw}»` });
  } else if (spentH < 0) {
    errors.push({ line, field: 'spent_h', message: 'Затраты не бывают отрицательными' });
  }

  const statusRaw = read('status').toLowerCase();
  const status = statusRaw === '' ? 'backlog' : STATUSES[statusRaw];
  if (status === undefined) {
    errors.push({ line, field: 'status', message: `Неизвестный статус: «${read('status')}»` });
  }

  const priorityRaw = read('priority').toLowerCase();
  const priority = priorityRaw === '' ? 'P2' : PRIORITIES[priorityRaw];
  if (priority === undefined) {
    errors.push({ line, field: 'priority', message: `Неизвестный приоритет: «${read('priority')}»` });
  }

  const blockedRaw = read('blocked').toLowerCase();
  let blocked = false;
  if (TRUE_WORDS.includes(blockedRaw)) blocked = true;
  else if (!FALSE_WORDS.includes(blockedRaw)) {
    errors.push({ line, field: 'blocked', message: `Непонятно, да или нет: «${read('blocked')}»` });
  }

  if (errors.length > 0) return errors;

  return {
    line,
    key,
    title,
    status: status as TaskStatus,
    priority: priority as TaskPriority,
    estimateH: estimateH as number,
    spentH: spentH as number,
    description: read('description') || null,
    teamName: read('teamName') || null,
    releaseName: read('releaseName') || null,
    // Несколько ключей в одной ячейке разделяют запятой, точкой с
    // запятой или пробелом — в выгрузках встречается всё.
    blocks: read('blocks')
      .split(/[,;\s]+/)
      .map((k) => k.trim())
      .filter((k) => k !== ''),
    blocked,
  };
}
