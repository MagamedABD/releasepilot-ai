import { describe, expect, it } from 'vitest';

import {
  projectCreateSchema,
  projectUpdateSchema,
  releaseCreateSchema,
  releaseQuerySchema,
  releaseUpdateSchema,
  simulateSchema,
} from './release';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

describe('releaseCreateSchema', () => {
  it('подставляет статус «запланирован», когда он не указан', () => {
    const parsed = releaseCreateSchema.parse({
      projectId: PROJECT,
      name: 'Платежи 2.4',
      plannedDate: '2026-10-19',
    });
    expect(parsed.status).toBe('planned');
  });

  it('не принимает отметки времени: их ставит сервер', () => {
    const parsed = releaseCreateSchema.parse({
      projectId: PROJECT,
      name: 'Платежи 2.4',
      plannedDate: '2026-10-19',
      startedAt: '2020-01-01T00:00:00.000Z',
      releasedAt: '2020-01-01T00:00:00.000Z',
    });
    expect('startedAt' in parsed).toBe(false);
    expect('releasedAt' in parsed).toBe(false);
  });
});

/**
 * Дата — календарный день, а не момент.
 *
 * `timestamptz` здесь был бы не точнее, а вреднее: «19 октября 23:00 UTC»
 * для читателя в Москве — уже двадцатое, и остаток рабочих дней сдвинулся
 * бы на единицу от часового пояса.
 */
describe('плановая дата', () => {
  const create = (plannedDate: string) =>
    releaseCreateSchema.safeParse({ projectId: PROJECT, name: 'Р', plannedDate });

  it('принимает ГГГГ-ММ-ДД', () => {
    expect(create('2026-10-19').success).toBe(true);
  });

  it('отвергает момент времени и другие формы записи', () => {
    for (const bad of ['2026-10-19T00:00:00Z', '19.10.2026', '2026-10-9', 'завтра']) {
      expect(create(bad).success).toBe(false);
    }
  });

  /**
   * Ловушка, из-за которой проверка сделана сборкой даты, а не
   * `Date.parse`: последний на «2026-02-30» не отказывает, а перекатывает
   * день во второе марта. Плановый срок сдвинулся бы на два дня, и в базе
   * лежала бы вполне правдоподобная дата.
   */
  it('отвергает дату, которой не существует', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31']) {
      expect(create(bad).success).toBe(false);
    }
  });
});

/**
 * Тот же разбор, что у задачи, и та же причина: `.partial()` не снимает
 * значения по умолчанию, и `PATCH {}` прошёл бы как «вернуть в статус
 * „запланирован“» — то есть выпущенный релиз стал бы запланированным в
 * ответ на запрос без единого поля.
 */
describe('releaseUpdateSchema', () => {
  it('пустой объект не проходит', () => {
    expect(releaseUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('одно поле проходит и не тянет за собой умолчаний', () => {
    const parsed = releaseUpdateSchema.parse({ name: 'Платежи 2.5' });
    expect(parsed).toEqual({ name: 'Платежи 2.5' });
  });
});

describe('releaseQuerySchema', () => {
  it('приводит limit и offset к числам и ставит умолчания', () => {
    expect(releaseQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(releaseQuerySchema.parse({ limit: '20', offset: '40' })).toMatchObject({
      limit: 20,
      offset: 40,
    });
  });

  // Без потолка `?limit=1000000` становится способом уронить сервер,
  // ничего не взломав.
  it('не пускает запрос за потолок выборки', () => {
    expect(releaseQuerySchema.safeParse({ limit: '100000' }).success).toBe(false);
  });
});

describe('ключ проекта', () => {
  const key = (k: string) => projectCreateSchema.safeParse({ orgId: ORG, name: 'Платежи', key: k });

  it('приводит к верхнему регистру', () => {
    const parsed = projectCreateSchema.parse({ orgId: ORG, name: 'Платежи', key: 'pay' });
    expect(parsed.key).toBe('PAY');
  });

  it('принимает буквы и цифры, начиная с буквы', () => {
    for (const k of ['PAY', 'PAY2', 'ABCDEFGHIJ']) expect(key(k).success).toBe(true);
  });

  /**
   * Ограничение повторяет проверку в базе. Смысл дублирования не в
   * надёжности — база и так не пропустит, — а в ответе: без схемы клиент
   * получил бы 422 про нарушенный check-констрейнт, из которого не
   * следует, что исправить.
   */
  it('отвергает то, что отвергнет база', () => {
    for (const k of ['P', '2PAY', 'PAY-1', 'ПЛАТЕЖИ', 'ABCDEFGHIJK', '']) {
      expect(key(k).success).toBe(false);
    }
  });
});

describe('projectUpdateSchema', () => {
  it('пустой объект не проходит', () => {
    expect(projectUpdateSchema.safeParse({}).success).toBe(false);
  });

  // Переноса проекта между организациями в схеме нет: он оставил бы
  // задачи и релизы в прежней организации, то есть развалил проект надвое.
  it('организацию сменить нельзя', () => {
    const parsed = projectUpdateSchema.parse({ name: 'Платежи', orgId: ORG });
    expect('orgId' in parsed).toBe(false);
  });
});

describe('simulateSchema', () => {
  const TASK = '33333333-3333-4333-8333-333333333333';
  const TEAM = '44444444-4444-4444-8444-444444444444';

  it('пустой сценарий отклоняется: считать нечего', () => {
    expect(simulateSchema.safeParse({}).success).toBe(false);
    expect(simulateSchema.safeParse({ excludeTaskIds: [], extraCapacity: [] }).success).toBe(false);
  });

  it('повтор задачи сливается, недостающий список становится пустым', () => {
    const parsed = simulateSchema.parse({ excludeTaskIds: [TASK, TASK] });
    expect(parsed).toEqual({ excludeTaskIds: [TASK], extraCapacity: [] });
  });

  it('повтор команды отклоняется, а не складывается', () => {
    const result = simulateSchema.safeParse({
      extraCapacity: [
        { teamId: TEAM, hours: 10 },
        { teamId: TEAM, hours: 20 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('часы строго положительны и ограничены сверху', () => {
    for (const hours of [0, -5, 1001]) {
      expect(simulateSchema.safeParse({ extraCapacity: [{ teamId: TEAM, hours }] }).success).toBe(false);
    }
    expect(simulateSchema.safeParse({ extraCapacity: [{ teamId: TEAM, hours: 12.5 }] }).success).toBe(true);
  });

  it('идентификаторы — только UUID', () => {
    expect(simulateSchema.safeParse({ excludeTaskIds: ['PPT-301'] }).success).toBe(false);
  });
});
