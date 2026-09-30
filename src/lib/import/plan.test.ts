import { describe, expect, it } from 'vitest';

import { parseImport } from './parse';
import { buildPlan, toTaskInsert, toTaskUpdate, type ImportContext } from './plan';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-30T10:00:00.000Z';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  teams: [
    { id: 'team-be', name: 'Бэкенд' },
    { id: 'team-qa', name: 'Тестирование' },
  ],
  releases: [{ id: 'rel-1', name: '2.14' }],
  existing: [{ id: 'task-old', key: 'PAY-1' }],
  ...over,
});

const plan = (csv: string, context = ctx()) => buildPlan(parseImport(csv, 'csv').rows, context);

describe('разрешение имён', () => {
  it('команда и релиз находятся без учёта регистра и пробелов', () => {
    const p = plan('key,title,estimate_h,team,release\nPAY-7,Задача,8, бэкенд , 2.14 ');
    expect(p.errors).toEqual([]);
    expect(p.create[0]).toMatchObject({ teamId: 'team-be', releaseId: 'rel-1' });
  });

  /*
    Ключевое решение этого слоя. Задача без команды выглядит нормальной и
    в базе, и на экране, но её часы не попадают ни в одну загрузку, и
    релиз выглядит спокойнее, чем есть. Поэтому неизвестное имя — отказ
    строке, а не тихое обнуление поля.
  */
  it('неизвестная команда отклоняет запись, а не обнуляет поле', () => {
    const p = plan('key,title,estimate_h,team\nPAY-7,Задача,8,Девопс');
    expect(p.create).toEqual([]);
    expect(p.errors).toEqual([
      {
        line: 2,
        field: 'team',
        message: 'Команда «Девопс» не найдена. Создайте её или исправьте имя',
      },
    ]);
  });

  it('неизвестный релиз отклоняет запись', () => {
    const p = plan('key,title,estimate_h,release\nPAY-7,Задача,8,3.0');
    expect(p.create).toEqual([]);
    expect(p.errors[0].field).toBe('release');
  });

  it('пустые поля команды и релиза законны: задача из бэклога', () => {
    const p = plan('key,title,estimate_h\nPAY-7,Задача,8');
    expect(p.errors).toEqual([]);
    expect(p.create[0]).toMatchObject({ teamId: null, releaseId: null });
  });
});

describe('создать или обновить', () => {
  it('известный ключ обновляется, новый заводится', () => {
    const p = plan('key,title,estimate_h\nPAY-1,Была,8\nPAY-9,Новая,4');
    expect(p.update.map((e) => e.existingId)).toEqual(['task-old']);
    expect(p.create.map((e) => e.row.key)).toEqual(['PAY-9']);
  });
});

describe('связи из колонки blocks', () => {
  it('ссылка на задачу того же файла разрешается независимо от порядка строк', () => {
    const p = plan('key,title,estimate_h,blocks\nPAY-7,Держит,8,PAY-8\nPAY-8,Ждёт,4,');
    expect(p.errors).toEqual([]);
    expect(p.dependencies).toEqual([{ line: 2, blockerKey: 'PAY-7', blockedKey: 'PAY-8' }]);
  });

  it('ссылка на задачу, которой нет ни в файле, ни в проекте, отклоняет запись', () => {
    const p = plan('key,title,estimate_h,blocks\nPAY-7,Держит,8,PAY-404');
    expect(p.create).toEqual([]);
    expect(p.errors[0].message).toContain('не найдена ни в файле, ни в проекте');
  });

  it('ссылка на себя отклоняется', () => {
    const p = plan('key,title,estimate_h,blocks\nPAY-7,Задача,8,PAY-7');
    expect(p.errors[0].message).toBe('Задача не может блокировать себя');
  });

  /*
    Отказ не идёт по цепочке. Задача, которая держит отклонённую,
    заводится: иначе одна опечатка в одной строке могла бы отменить
    половину файла. Несозданная связь при этом названа в отчёте.
  */
  it('ошибка в чужой строке не отменяет держащую задачу, но связь не создаётся', () => {
    const p = plan(
      'key,title,estimate_h,team,blocks\nPAY-7,Держит,8,Бэкенд,PAY-8\nPAY-8,Ждёт,4,Девопс,',
    );
    expect(p.create.map((e) => e.row.key)).toEqual(['PAY-7']);
    expect(p.dependencies).toEqual([]);
    expect(p.errors.map((e) => e.field)).toEqual(['team', 'blocks']);
    expect(p.errors[1].message).toContain('отклонена из-за ошибок в своей строке');
  });

  it('повтор пары в одной ячейке — одна связь, а не ошибка уникальности', () => {
    const p = plan('key,title,estimate_h,blocks\nPAY-7,Держит,8,"PAY-1 PAY-1"');
    expect(p.dependencies).toHaveLength(1);
  });
});

describe('перевод в строки базы', () => {
  const entry = (csv: string) => plan(csv).create[0] ?? plan(csv).update[0];

  it('блокировка ставится сервером и только открытой задаче', () => {
    expect(
      toTaskInsert(entry('key,title,estimate_h,blocked\nPAY-7,Задача,8,да'), ORG, PROJECT, NOW)
        .blocked_since,
    ).toBe(NOW);
    // Закрытая и одновременно заблокированная задача — то расхождение,
    // из-за которого «Блок: 4» в кокпите и пять строк по ссылке.
    expect(
      toTaskInsert(
        entry('key,title,estimate_h,status,blocked\nPAY-7,Задача,8,готово,да'),
        ORG,
        PROJECT,
        NOW,
      ).blocked_since,
    ).toBeNull();
  });

  it('момент попадания в релиз не переписывается при повторном импорте', () => {
    // Иначе каждая загрузка объявляла бы все задачи заново добавленными,
    // и дрейф объёма показывал бы стопроцентный прирост на пустом месте.
    const e = entry('key,title,estimate_h,release\nPAY-1,Задача,8,2.14');
    const same = toTaskUpdate(e, { release_id: 'rel-1', blocked_since: null }, NOW);
    expect('added_to_release_at' in same).toBe(false);

    const moved = toTaskUpdate(e, { release_id: 'rel-other', blocked_since: null }, NOW);
    expect(moved.added_to_release_at).toBe(NOW);
  });

  it('возраст блокера не обнуляется повторной загрузкой', () => {
    const e = entry('key,title,estimate_h,blocked\nPAY-1,Задача,8,да');
    const patch = toTaskUpdate(e, { release_id: null, blocked_since: '2026-09-01T00:00:00Z' }, NOW);
    expect('blocked_since' in patch).toBe(false);
  });

  it('снятая в файле блокировка снимается и в базе', () => {
    const e = entry('key,title,estimate_h,blocked\nPAY-1,Задача,8,нет');
    const patch = toTaskUpdate(e, { release_id: null, blocked_since: '2026-09-01T00:00:00Z' }, NOW);
    expect(patch.blocked_since).toBeNull();
  });
});
