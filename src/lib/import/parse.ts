/**
 * Файл импорта → записи и ошибки.
 *
 * Здесь же — единственное место, где формат вообще имеет значение: дальше
 * записи одинаковы, откуда бы ни пришли. Ошибки не прерывают разбор, и
 * это главное свойство: файл на триста задач с двумя опечатками должен
 * дать двести девяносто восемь готовых записей и два понятных сообщения,
 * а не отказ целиком (FR-41).
 */

import { parseCsv } from './csv';
import {
  csvReader,
  mapHeader,
  objectReader,
  readRow,
  type ImportRow,
  type ParsedRows,
  type RowError,
} from './rows';

export const IMPORT_FORMATS = ['csv', 'json'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** Колонки, без которых импортировать нечего. */
const REQUIRED = [
  ['key', 'ключ'],
  ['title', 'название'],
  ['estimate_h', 'оценка'],
] as const;

function parseCsvText(text: string): ParsedRows {
  const table = parseCsv(text);
  if (table.header.length === 0) {
    return { rows: [], errors: [{ line: 1, field: null, message: 'Файл пуст' }] };
  }

  const index = mapHeader(table.header);
  const missing = REQUIRED.filter(([field]) => {
    const camel = field === 'estimate_h' ? 'estimateH' : field;
    return index[camel] === undefined;
  });
  if (missing.length > 0) {
    /*
      Отсутствие колонки — ошибка файла, а не строки, и дальше идти
      незачем: каждая запись дала бы одно и то же сообщение. Названия
      перечисляются оба, потому что принимаются оба, и менеджеру,
      выгрузившему файл по-русски, «нет колонки key» ничего не скажет.
    */
    return {
      rows: [],
      errors: missing.map(([field, ru]) => ({
        line: 1,
        field,
        message: `В файле нет обязательной колонки «${field}» (или «${ru}»)`,
      })),
    };
  }

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  for (const record of table.rows) {
    const result = readRow(record.line, csvReader(record.values, index));
    if (Array.isArray(result)) errors.push(...result);
    else rows.push(result);
  }

  return { rows, errors };
}

function parseJsonText(text: string): ParsedRows {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          field: null,
          message: `Файл не разобрался как JSON: ${e instanceof Error ? e.message : 'ошибка разбора'}`,
        },
      ],
    };
  }

  // Принимается и массив, и объект с полем `tasks`: выгрузки бывают и
  // такими, и такими, а требовать переупаковки файла — та же работа,
  // переложенная на человека.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { tasks?: unknown })?.tasks)
      ? ((parsed as { tasks: unknown[] }).tasks)
      : null;

  if (list === null) {
    return {
      rows: [],
      errors: [
        { line: 1, field: null, message: 'Ожидается массив задач или объект с полем «tasks»' },
      ],
    };
  }

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  list.forEach((item, i) => {
    // Номер элемента, а не строки файла: в JSON строка ничего не значит,
    // а элемент — то, что человек видит в редакторе.
    const line = i + 1;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push({ line, field: null, message: 'Элемент не объект' });
      return;
    }
    const result = readRow(line, objectReader(item as Record<string, unknown>));
    if (Array.isArray(result)) errors.push(...result);
    else rows.push(result);
  });

  return { rows, errors };
}

/**
 * Повторы ключей внутри файла.
 *
 * Отклоняется вторая запись, а не первая: без этого запись в базу
 * применила бы последнюю, и результат импорта зависел бы от порядка
 * строк в файле — тихо и невоспроизводимо.
 */
function rejectDuplicates({ rows, errors }: ParsedRows): ParsedRows {
  const seen = new Map<string, number>();
  const unique: ImportRow[] = [];
  const dupes: RowError[] = [];

  for (const row of rows) {
    const first = seen.get(row.key);
    if (first === undefined) {
      seen.set(row.key, row.line);
      unique.push(row);
    } else {
      dupes.push({
        line: row.line,
        field: 'key',
        message: `Ключ «${row.key}» уже встречался в строке ${first}`,
      });
    }
  }

  return { rows: unique, errors: [...errors, ...dupes] };
}

export function parseImport(text: string, format: ImportFormat): ParsedRows {
  const parsed = format === 'csv' ? parseCsvText(text) : parseJsonText(text);
  return rejectDuplicates(parsed);
}

/**
 * Формат по имени файла и типу содержимого.
 *
 * Расширение важнее заявленного типа: браузер присылает для CSV то
 * `text/csv`, то `application/vnd.ms-excel`, то `application/octet-stream`,
 * и доверять этому полю нельзя.
 */
export function detectFormat(fileName: string, contentType?: string | null): ImportFormat | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.json')) return 'json';
  if (contentType?.includes('json')) return 'json';
  if (contentType?.includes('csv')) return 'csv';
  return null;
}
