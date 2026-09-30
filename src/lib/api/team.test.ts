import { describe, expect, it } from 'vitest';

import type { Database } from '@/lib/database.types';

import { toApiCapacity, toApiTeam, toCapacityInsert } from './team';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-30T10:00:00.000Z';

type CapacityRow = Database['public']['Tables']['team_capacity']['Row'];

const capacityRow = (over: Partial<CapacityRow> = {}): CapacityRow => ({
  id: '33333333-3333-4333-8333-333333333333',
  org_id: ORG,
  team_id: TEAM,
  period_start: '2026-10-01',
  period_end: '2026-12-31',
  available_hours: 960,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

describe('toApiTeam', () => {
  it('отдаёт организацию: без неё список не разложить по организациям', () => {
    const api = toApiTeam({
      id: TEAM,
      org_id: ORG,
      name: 'Тестирование',
      kind: 'qa',
      created_at: NOW,
      updated_at: NOW,
    });
    expect(api).toEqual({ id: TEAM, orgId: ORG, name: 'Тестирование', kind: 'qa', createdAt: NOW });
  });
});

describe('toApiCapacity', () => {
  it('приводит numeric к числу', () => {
    // Строка вместо числа прошла бы дальше молча, и «960» + «40» на
    // клиенте дало бы «96040».
    const api = toApiCapacity(capacityRow({ available_hours: '960.50' as unknown as number }));
    expect(api.availableHours).toBe(960.5);
    expect(api.periodStart).toBe('2026-10-01');
  });
});

describe('toCapacityInsert', () => {
  it('берёт организацию из команды, а не из тела запроса', () => {
    const insert = toCapacityInsert(
      { periodStart: '2026-10-01', periodEnd: '2026-12-31', availableHours: 120 },
      TEAM,
      ORG,
    );
    expect(insert).toEqual({
      org_id: ORG,
      team_id: TEAM,
      period_start: '2026-10-01',
      period_end: '2026-12-31',
      available_hours: 120,
    });
  });
});
