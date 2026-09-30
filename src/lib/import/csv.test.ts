import { describe, expect, it } from 'vitest';

import { detectDelimiter, parseCsv } from './csv';

describe('разделитель', () => {
  it('точка с запятой выигрывает: так сохраняет русский Excel', () => {
    expect(detectDelimiter('key;title;estimate_h')).toBe(';');
    expect(detectDelimiter('key,title,estimate_h')).toBe(',');
  });

  it('запятая внутри кавычек не голосует', () => {
    // Иначе заголовок «Оценка, ч» перевесил бы настоящий разделитель, и
    // файл разобрался бы в одну колонку.
    expect(detectDelimiter('key;title;"Оценка, ч";"Затраты, ч"')).toBe(';');
  });
});

describe('разбор', () => {
  it('снимает BOM: иначе первая колонка называется «﻿key»', () => {
    const t = parseCsv('﻿key,title\nPAY-1,Задача\n');
    expect(t.header).toEqual(['key', 'title']);
    expect(t.rows[0].values).toEqual(['PAY-1', 'Задача']);
  });

  it('приводит заголовки к нижнему регистру и обрезает пробелы', () => {
    expect(parseCsv(' Key , Estimate_H \nPAY-1,8\n').header).toEqual(['key', 'estimate_h']);
  });

  it('держит кавычки, удвоенные кавычки и CRLF', () => {
    const t = parseCsv('key,title\r\nPAY-1,"Возврат ""по кнопке"", частичный"\r\n');
    expect(t.rows[0].values).toEqual(['PAY-1', 'Возврат "по кнопке", частичный']);
  });

  /*
    Главное, ради чего разбор написан руками: номер строки файла.
    Отчёт об ошибках построчный (FR-41), а запись с переводом строки
    внутри кавычек занимает в файле несколько строк — и ошибка в
    следующей записи должна указывать на её настоящую строку, а не на
    номер записи.
  */
  it('номер строки учитывает переводы строк внутри кавычек', () => {
    const t = parseCsv('key,title\nPAY-1,"Первая\nстрока\nвторая"\nPAY-2,Обычная\n');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toMatchObject({ line: 2 });
    expect(t.rows[0].values[1]).toBe('Первая\nстрока\nвторая');
    expect(t.rows[1]).toMatchObject({ line: 5 });
  });

  it('хвостовой перевод строки не даёт пустой записи', () => {
    expect(parseCsv('key\nPAY-1\n').rows).toHaveLength(1);
    expect(parseCsv('key\nPAY-1').rows).toHaveLength(1);
  });

  it('пустой файл — пустая таблица, а не исключение', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('пропущенное значение остаётся пустой строкой, а не исчезает', () => {
    // Сдвиг колонок был бы худшей ошибкой импорта: значения встали бы в
    // чужие поля, и каждая строка прошла бы проверку по-своему.
    const t = parseCsv('key,title,team\nPAY-1,,Бэкенд\n');
    expect(t.rows[0].values).toEqual(['PAY-1', '', 'Бэкенд']);
  });
});
