import { describe, expect, it } from 'vitest';

import {
  absenceCreateSchema,
  capacityPutSchema,
  capacityQuerySchema,
  memberPutSchema,
  teamCreateSchema,
  teamQuerySchema,
  teamUpdateSchema,
} from './team';

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

describe('правка команд и отсутствий', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const P = '22222222-2222-4222-8222-222222222222';

  it('команда: вид по умолчанию — other, пустое имя отклоняется', () => {
    expect(teamCreateSchema.parse({ orgId: ORG, name: ' QA ' })).toEqual({
      orgId: ORG,
      name: 'QA',
      kind: 'other',
    });
    expect(teamCreateSchema.safeParse({ orgId: ORG, name: '  ' }).success).toBe(false);
  });

  it('правка команды без полей отклоняется', () => {
    expect(teamUpdateSchema.safeParse({}).success).toBe(false);
    expect(teamUpdateSchema.parse({ kind: 'qa' })).toEqual({ kind: 'qa' });
  });

  it('доля участника — целое от 1 до 100, по умолчанию 100', () => {
    expect(memberPutSchema.parse({ profileId: P }).allocationPct).toBe(100);
    expect(memberPutSchema.safeParse({ profileId: P, allocationPct: 0 }).success).toBe(false);
    expect(memberPutSchema.safeParse({ profileId: P, allocationPct: 50.5 }).success).toBe(false);
  });

  it('отсутствие: конец не раньше начала, ошибка — на поле конца', () => {
    const r = absenceCreateSchema.safeParse({
      orgId: ORG,
      profileId: P,
      startDate: '2026-10-10',
      endDate: '2026-10-09',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['endDate']);
  });
});
