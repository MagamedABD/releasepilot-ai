import { describe, expect, it } from 'vitest';

import { detectFormat, parseImport } from './parse';

const csv = (body: string) => parseImport(body, 'csv');

describe('перевод значений из выгрузки', () => {
  it('понимает русские и английские статусы и приоритеты', () => {
    const { rows, errors } = csv(
      [
        'ключ;название;оценка;статус;приоритет',
        'PAY-1;Возврат;8;в работе;critical',
        'PAY-2;Списание;4;In Progress;major',
        'PAY-3;Отчёт;2;Готово;низкий',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.status, r.priority])).toEqual([
      ['in_progress', 'P0'],
      ['in_progress', 'P1'],
      ['done', 'P3'],
    ]);
  });

  it('читает числа русского Excel: запятая и разделитель разрядов', () => {
    // «8,5» в выгрузке встречается чаще, чем «8.5», а «1 200» — как есть.
    const { rows, errors } = csv('key;title;оценка;затраты\nPAY-1;Задача;8,5;1 200');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ estimateH: 8.5, spentH: 1200 });
  });

  it('пустые необязательные поля дают умолчания, а не ошибки', () => {
    const { rows, errors } = csv('key,title,estimate_h\nPAY-1,Задача,8');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      status: 'backlog',
      priority: 'P2',
      spentH: 0,
      teamName: null,
      releaseName: null,
      blocks: [],
      blocked: false,
    });
  });

  it('ключи в колонке blocks разделяются чем угодно', () => {
    const { rows } = csv('key,title,estimate_h,blocks\nPAY-1,Задача,8,"PAY-2; PAY-3 PAY-4"');
    expect(rows[0].blocks).toEqual(['PAY-2', 'PAY-3', 'PAY-4']);
  });
});

describe('построчный отчёт об ошибках (FR-41)', () => {
  /*
    Свойство, ради которого отчёт вообще существует: одна плохая строка
    не отменяет файл. Иначе выгрузка на триста задач с двумя опечатками
    требовала бы исправить их до единой, ничего не импортировав.
  */
  it('плохая строка не отменяет хорошие', () => {
    const { rows, errors } = csv(
      [
        'key,title,estimate_h',
        'PAY-1,Первая,8',
        'PAY-2,,4',
        'PAY-3,Третья,',
        'PAY-4,Четвёртая,2',
      ].join('\n'),
    );
    expect(rows.map((r) => r.key)).toEqual(['PAY-1', 'PAY-4']);
    expect(errors).toEqual([
      { line: 3, field: 'title', message: 'Не указано название' },
      { line: 4, field: 'estimate_h', message: 'Не указана оценка трудозатрат' },
    ]);
  });

  it('в одной строке сообщается обо всех ошибках сразу', () => {
    // Иначе исправление файла — переписка из десяти раундов: каждая
    // загрузка сообщала бы об одной следующей ошибке в той же строке.
    const { errors } = csv('key,title,estimate_h,status\n,,-1,летит');
    expect(errors.map((e) => e.field)).toEqual(['key', 'title', 'estimate_h', 'status']);
    expect(errors.every((e) => e.line === 2)).toBe(true);
  });

  it('нулевая оценка отклоняется, а не обнуляет готовность релиза', () => {
    const { rows, errors } = csv('key,title,estimate_h\nPAY-1,Задача,0');
    expect(rows).toEqual([]);
    expect(errors[0].message).toBe('Оценка должна быть больше нуля');
  });

  it('повторный ключ отклоняется второй, а не первый', () => {
    // Иначе результат импорта зависел бы от порядка строк в файле.
    const { rows, errors } = csv(
      'key,title,estimate_h\nPAY-1,Первая,8\nPAY-1,Вторая,4',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Первая');
    expect(errors).toEqual([
      { line: 3, field: 'key', message: 'Ключ «PAY-1» уже встречался в строке 2' },
    ]);
  });

  it('отсутствие обязательной колонки — ошибка файла, а не каждой строки', () => {
    const { rows, errors } = csv('key,title\nPAY-1,Задача\nPAY-2,Другая');
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('оценка');
  });

  it('пустой файл не притворяется успешным импортом', () => {
    expect(csv('').errors[0].message).toBe('Файл пуст');
  });
});

describe('JSON', () => {
  it('принимается и массив, и объект с полем tasks', () => {
    const item = { key: 'PAY-1', title: 'Задача', estimate_h: 8 };
    expect(parseImport(JSON.stringify([item]), 'json').rows).toHaveLength(1);
    expect(parseImport(JSON.stringify({ tasks: [item] }), 'json').rows).toHaveLength(1);
  });

  it('читает и estimateH, и estimate_h', () => {
    const { rows, errors } = parseImport(
      JSON.stringify([{ key: 'PAY-1', title: 'Задача', estimateH: 6, team: 'Бэкенд' }]),
      'json',
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ estimateH: 6, teamName: 'Бэкенд' });
  });

  it('ошибка указывает номер элемента, а не строки файла', () => {
    const { errors } = parseImport(
      JSON.stringify([{ key: 'PAY-1', title: 'Ок', estimate_h: 1 }, { key: 'PAY-2' }]),
      'json',
    );
    expect(errors[0].line).toBe(2);
  });

  it('битый JSON объясняется, а не превращается в «файл пуст»', () => {
    expect(parseImport('{нет', 'json').errors[0].message).toContain('не разобрался как JSON');
  });

  it('не массив — понятное сообщение', () => {
    expect(parseImport('{"a":1}', 'json').errors[0].message).toContain('массив задач');
  });
});

describe('определение формата', () => {
  it('расширение важнее заявленного типа', () => {
    // Браузер присылает для CSV и text/csv, и application/vnd.ms-excel,
    // и application/octet-stream — доверять этому полю нельзя.
    expect(detectFormat('tasks.csv', 'application/octet-stream')).toBe('csv');
    expect(detectFormat('tasks.json', 'text/plain')).toBe('json');
    expect(detectFormat('tasks', 'application/json')).toBe('json');
    expect(detectFormat('tasks.txt', 'text/plain')).toBeNull();
  });
});
