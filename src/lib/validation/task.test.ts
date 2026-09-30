import { describe, expect, it } from 'vitest';

import {
  dependencyCreateSchema,
  taskCreateSchema,
  taskQuerySchema,
  taskUpdateSchema,
} from './task';

const PROJECT = '5d50e8b5-b3b1-4678-abf3-2ed7b110e553';

describe('taskCreateSchema', () => {
  it('подставляет умолчания новой задаче', () => {
    const r = taskCreateSchema.parse({ projectId: PROJECT, title: 'Задача', estimateH: 8 });
    expect(r).toMatchObject({ status: 'backlog', priority: 'P2', spentH: 0, blocked: false });
  });

  it('отвергает отрицательные и неправдоподобные часы', () => {
    const base = { projectId: PROJECT, title: 'Задача' };
    expect(taskCreateSchema.safeParse({ ...base, estimateH: -1 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, estimateH: 100_000 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...base, estimateH: 0 }).success).toBe(true);
  });

  it('не принимает пустое название после обрезки пробелов', () => {
    expect(
      taskCreateSchema.safeParse({ projectId: PROJECT, title: '   ', estimateH: 1 }).success,
    ).toBe(false);
  });
});

describe('taskUpdateSchema', () => {
  /**
   * Главная проверка файла — защита от уже случившейся ошибки.
   *
   * Схема изменения когда-то выводилась из схемы создания через
   * `.partial()`. Поля становились необязательными, но умолчания
   * оставались, и пустой объект выходил из разбора заполненным.
   * Дальше по коду эти значения неотличимы от присланных, и `PATCH {}`
   * сбрасывал готовую задачу в `backlog`, приоритет в `P2`, потраченные
   * часы в ноль и снимал блокировку — отвечая при этом 200.
   *
   * Поэтому проверяется не «пустой объект отклонён», а именно то, что
   * разбор ничего не придумывает: при возврате к `.partial()` от схемы
   * создания падает второй expect, а не только первый.
   */
  it('пустой объект не превращается в набор умолчаний', () => {
    const r = taskUpdateSchema.safeParse({});
    expect(r.success).toBe(false);

    const fields = taskUpdateSchema.safeParse({ title: 'Только название' });
    expect(fields.success).toBe(true);
    expect(fields.success && Object.keys(fields.data)).toEqual(['title']);
  });

  it('пропускает ровно те поля, что прислали', () => {
    const r = taskUpdateSchema.parse({ status: 'done', blocked: false });
    expect(Object.keys(r).sort()).toEqual(['blocked', 'status']);
  });

  it('не даёт писать служебные отметки времени напрямую', () => {
    const r = taskUpdateSchema.parse({
      title: 'Задача',
      blockedSince: '2020-01-01T00:00:00Z',
      addedToReleaseAt: '2020-01-01T00:00:00Z',
      orgId: 'ЧУЖАЯ',
    } as Record<string, unknown>);
    expect(r).toEqual({ title: 'Задача' });
  });

  it('сообщает об ошибке по-русски, как остальной интерфейс', () => {
    const r = taskUpdateSchema.safeParse({ priority: 'P9' });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toBe('Неизвестный приоритет');
  });
});

describe('taskQuerySchema', () => {
  it('приводит строки query-строки к числам и булевым', () => {
    const r = taskQuerySchema.parse({ blocked: 'true', limit: '10', offset: '20' });
    expect(r).toMatchObject({ blocked: true, limit: 10, offset: 20 });
  });

  it('держит потолок выборки', () => {
    expect(taskQuerySchema.safeParse({ limit: '1000000' }).success).toBe(false);
    expect(taskQuerySchema.parse({}).limit).toBe(50);
  });
});

describe('dependencyCreateSchema', () => {
  const A = '11111111-1111-4111-8111-111111111111';

  it('приводит направление к паре «кто держит — кого держат»', () => {
    expect(dependencyCreateSchema.parse({ blocksTaskId: A })).toEqual({
      otherTaskId: A,
      pathTaskBlocks: true,
      type: 'blocks',
    });
    expect(dependencyCreateSchema.parse({ blockedByTaskId: A })).toMatchObject({
      otherTaskId: A,
      pathTaskBlocks: false,
    });
  });

  /*
    Ни одного поля и оба сразу отвергаются одинаково, и это не
    придирчивость. Пустое тело — потерянный запрос, а оба поля вместе —
    либо цикл из двух звеньев, либо путаница в клиенте; выбрать одно из
    них «на своё усмотрение» значит создать связь, которой не просили.
  */
  it('требует ровно одно направление', () => {
    expect(dependencyCreateSchema.safeParse({}).success).toBe(false);
    const both = dependencyCreateSchema.safeParse({
      blocksTaskId: A,
      blockedByTaskId: '22222222-2222-4222-8222-222222222222',
    });
    expect(both.success).toBe(false);
  });

  it('тип связи по умолчанию — блокировка, неизвестный отвергается', () => {
    expect(dependencyCreateSchema.parse({ blocksTaskId: A }).type).toBe('blocks');
    expect(dependencyCreateSchema.parse({ blocksTaskId: A, type: 'relates' }).type).toBe('relates');
    const bad = dependencyCreateSchema.safeParse({ blocksTaskId: A, type: 'дружит' });
    expect(bad.success).toBe(false);
    expect(bad.success === false && bad.error.issues[0].message).toBe('Неизвестный тип связи');
  });
});
