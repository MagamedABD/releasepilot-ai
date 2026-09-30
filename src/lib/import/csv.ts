/**
 * Разбор CSV.
 *
 * Своими руками, а не библиотекой, и причина не в экономии зависимости.
 * Импорт обязан сообщать об ошибках построчно (FR-41), то есть знать
 * номер строки файла для каждой записи — включая записи, внутри которых
 * есть переводы строк в кавычках. Обёртки над готовыми разборщиками это
 * либо теряют, либо отдают в своём формате, который всё равно пришлось бы
 * переводить. Разбор же ниже — конечный автомат на сорок строк, и он
 * ровно про это: значения плюс номер строки, с которой запись началась.
 *
 * Что поддерживается: кавычки и удвоенные кавычки внутри них, переводы
 * строк внутри кавычек, CRLF, BOM, разделитель «запятая» или «точка с
 * запятой». Чего нет: экранирования обратным слэшем (в CSV его нет) и
 * смены разделителя посреди файла.
 */

export type CsvRow = {
  /** Номер строки файла, с которой началась запись. Считается с единицы. */
  line: number;
  values: string[];
};

export type CsvTable = {
  /** Заголовки в нижнем регистре и без пробелов по краям. */
  header: string[];
  rows: CsvRow[];
};

/**
 * Разделитель определяется по первой строке.
 *
 * В русской локали Excel сохраняет CSV с точкой с запятой, и файл,
 * выгруженный менеджером из Excel, иначе разобрался бы в одну колонку —
 * с сообщением «нет колонки key», которое ничего не объясняет.
 * Считаются вхождения вне кавычек: заголовок «Оценка, ч» не должен
 * перевешивать выбор.
 */
export function detectDelimiter(firstLine: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;

  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') commas += 1;
    else if (!quoted && ch === ';') semicolons += 1;
  }

  return semicolons > commas ? ';' : ',';
}

/** Одна запись CSV: значения и номер строки, с которой она началась. */
function parseRecords(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endField = () => {
    values.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // Пустая строка записью не считается: хвостовой перевод строки есть
    // почти в каждом файле, и запись из одного пустого поля дала бы
    // ошибку «нет ключа» на строке, которой в файле нет.
    if (values.length > 1 || values[0] !== '') rows.push({ line: recordLine, values });
    values = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (!started) {
      recordLine = line;
      started = true;
    }

    if (quoted) {
      if (ch === '"') {
        // Удвоенная кавычка внутри кавычек — это сама кавычка.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === '\r') {
      /* съедается вместе с \n ниже */
    } else if (ch === '\n') {
      endRecord();
      line += 1;
    } else field += ch;
  }

  if (started || field !== '' || values.length > 0) endRecord();

  return rows;
}

export function parseCsv(text: string): CsvTable {
  // BOM Excel дописывает всегда, и без его снятия первый заголовок
  // называется «﻿key» — колонка, которой никто не найдёт.
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.search(/\r?\n|$/));
  const records = parseRecords(clean, detectDelimiter(firstLine));

  if (records.length === 0) return { header: [], rows: [] };

  const [head, ...rest] = records;
  return {
    header: head.values.map((h) => h.trim().toLowerCase()),
    rows: rest,
  };
}
