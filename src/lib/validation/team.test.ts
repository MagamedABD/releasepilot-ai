import { describe, expect, it } from 'vitest';

import { capacityPutSchema, capacityQuerySchema, teamQuerySchema } from './team';

describe('teamQuerySchema', () => {
  it('принимает пустой запрос: список команд не требует фильтров', () => {
    expect(teamQuerySchema.parse({})).toEqual({});
  });

  it('отвергает неизвестный вид команды', () => {
    const r = teamQuerySchema.safeParse({ kind: 'devops' });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toBe('Неизвестный вид команды');
  });
});

describe('capacityQuerySchema', () => {
  it('рамки необязательны и проверяются на порядок', () => {
    expect(capacityQuerySchema.parse({}).from).toBeUndefined();
    expect(capacityQuerySchema.safeParse({ from: '2026-10-01', to: '2026-09-01' }).success).toBe(
      false,
    );
    expect(capacityQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-01' }).success).toBe(
      true,
    );
  });
});

describe('capacityPutSchema', () => {
  const base = { periodStart: '2026-10-01', periodEnd: '2026-12-31', availableHours: 960 };

  it('принимает период и часы', () => {
    expect(capacityPutSchema.parse(base)).toEqual(base);
  });

  /*
    Ёмкость стоит в знаменателе загрузки: один лишний ноль делает
    загрузку в десять раз меньше настоящей, и отчёт становится
    успокаивающим — ни одного перегруза. Поэтому верхняя граница.
  */
  it('сторожит правдоподобие часов, а не только знак', () => {
    expect(capacityPutSchema.safeParse({ ...base, availableHours: -1 }).success).toBe(false);
    expect(capacityPutSchema.safeParse({ ...base, availableHours: 0 }).success).toBe(true);
    expect(capacityPutSchema.safeParse({ ...base, availableHours: 1_000_000 }).success).toBe(false);
  });

  it('называет поле, в котором перевёрнут период', () => {
    const r = capacityPutSchema.safeParse({
      ...base,
      periodStart: '2026-12-31',
      periodEnd: '2026-10-01',
    });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].path).toEqual(['periodEnd']);
  });

  it('не пропускает несуществующий день', () => {
    // Date.parse перекатил бы его в 2 марта, и период молча сдвинулся бы.
    expect(capacityPutSchema.safeParse({ ...base, periodStart: '2026-02-30' }).success).toBe(false);
  });
});
