import { describe, expect, it } from 'vitest';

import { toApiDependency, toApiTask, toInsert, toUpdate } from './task';
import type { Database } from '@/lib/database.types';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

const NOW = '2026-09-26T10:00:00.000Z';
const EARLIER = '2026-09-20T10:00:00.000Z';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const RELEASE = '33333333-3333-4333-8333-333333333333';
const OTHER_RELEASE = '44444444-4444-4444-8444-444444444444';

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    org_id: ORG,
    project_id: PROJECT,
    release_id: RELEASE,
    external_key: 'PAY-101',
    title: 'Задача',
    description: null,
    status: 'in_progress',
    priority: 'P2',
    estimate_h: 8,
    spent_h: 2,
    team_id: null,
    assignee_id: null,
    added_to_release_at: EARLIER,
    blocked_since: null,
    created_at: EARLIER,
    updated_at: EARLIER,
    ...over,
  };
}

describe('toUpdate: отметка блокировки', () => {
  it('ставит отметку, когда задачу только что заблокировали', () => {
    expect(toUpdate({ blocked: true }, row(), NOW)).toEqual({ blocked_since: NOW });
  });

  /**
   * Повторное «заблокирована» не должно сдвигать отметку.
   *
   * Иначе возраст блокера обнуляется при каждом сохранении, застарелых
   * блокеров не остаётся вовсе, и фактор F3 перестаёт срабатывать —
   * незаметно, потому что внешне всё выглядит рабочим.
   */
  it('не сдвигает уже стоящую отметку', () => {
    expect(toUpdate({ blocked: true }, row({ blocked_since: EARLIER }), NOW)).toEqual({});
  });

  it('снимает отметку, когда блокировку сняли', () => {
    expect(toUpdate({ blocked: false }, row({ blocked_since: EARLIER }), NOW)).toEqual({
      blocked_since: null,
    });
  });
});

/**
 * Инвариант: закрытая задача не бывает заблокированной.
 *
 * Держится не ради аккуратности. Движок считает заблокированными только
 * открытые задачи, а выборка фильтрует по наличию отметки. Стоит им
 * разойтись — и число «Блок: N» в кокпите перестаёт совпадать со
 * списком, который открывается по нажатию на это число.
 */
describe('toUpdate: закрытие задачи снимает блокировку', () => {
  it('снимает отметку при переходе в done', () => {
    const patch = toUpdate({ status: 'done' }, row({ blocked_since: EARLIER }), NOW);
    expect(patch).toEqual({ status: 'done', blocked_since: null });
  });

  it('снимает отметку и при отмене', () => {
    const patch = toUpdate({ status: 'cancelled' }, row({ blocked_since: EARLIER }), NOW);
    expect(patch).toEqual({ status: 'cancelled', blocked_since: null });
  });

  it('не даёт заблокировать задачу тем же запросом, что её закрывает', () => {
    const patch = toUpdate({ status: 'done', blocked: true }, row(), NOW);
    expect(patch).toEqual({ status: 'done' });
  });

  it('у уже закрытой задачи блокировка не появляется', () => {
    expect(toUpdate({ blocked: true }, row({ status: 'done' }), NOW)).toEqual({});
  });

  it('открытых задач правило не касается', () => {
    const patch = toUpdate({ status: 'review' }, row({ blocked_since: EARLIER }), NOW);
    expect(patch).toEqual({ status: 'review' });
  });

  it('лишней записи не делает, если отметки и так нет', () => {
    expect(toUpdate({ status: 'done' }, row(), NOW)).toEqual({ status: 'done' });
  });
});

describe('toUpdate: перенос между релизами', () => {
  it('переставляет момент попадания в релиз', () => {
    const patch = toUpdate({ releaseId: OTHER_RELEASE }, row(), NOW);
    expect(patch).toEqual({ release_id: OTHER_RELEASE, added_to_release_at: NOW });
  });

  it('тот же релиз не считается переносом', () => {
    expect(toUpdate({ releaseId: RELEASE }, row(), NOW)).toEqual({});
  });

  it('изъятие из релиза снимает и момент попадания', () => {
    expect(toUpdate({ releaseId: null }, row(), NOW)).toEqual({
      release_id: null,
      added_to_release_at: null,
    });
  });
});

describe('toInsert', () => {
  it('закрытую задачу не создаёт заблокированной', () => {
    const insert = toInsert(
      {
        projectId: PROJECT,
        title: 'Задача',
        status: 'done',
        priority: 'P2',
        estimateH: 4,
        spentH: 0,
        blocked: true,
      },
      ORG,
      NOW,
    );
    expect(insert.blocked_since).toBeNull();
  });

  it('открытую — создаёт', () => {
    const insert = toInsert(
      {
        projectId: PROJECT,
        title: 'Задача',
        status: 'backlog',
        priority: 'P2',
        estimateH: 4,
        spentH: 0,
        blocked: true,
      },
      ORG,
      NOW,
    );
    expect(insert.blocked_since).toBe(NOW);
  });
});

describe('toApiTask', () => {
  it('отдаёт camelCase и приводит числа', () => {
    // Postgres отдаёт numeric строкой — без приведения арифметика на
    // клиенте молча превратилась бы в склейку строк.
    const api = toApiTask(row({ estimate_h: '8.5' as unknown as number }));
    expect(api.estimateH).toBe(8.5);
    expect(api.externalKey).toBe('PAY-101');
    expect(api.blocked).toBe(false);
  });

  it('признак блокировки выводится из отметки', () => {
    expect(toApiTask(row({ blocked_since: EARLIER })).blocked).toBe(true);
  });
});

describe('toApiDependency', () => {
  it('отдаёт пару и тип, без org_id', () => {
    const api = toApiDependency({
      id: '66666666-6666-4666-8666-666666666666',
      org_id: ORG,
      blocker_task_id: 'a',
      blocked_task_id: 'b',
      type: 'blocks',
      created_at: NOW,
    });

    // Организация наружу не уходит: клиент её не спрашивал, а знание о
    // том, в какой организации лежит запись, ему ничего не даёт.
    expect(api).toEqual({
      id: '66666666-6666-4666-8666-666666666666',
      blockerTaskId: 'a',
      blockedTaskId: 'b',
      type: 'blocks',
      createdAt: NOW,
    });
  });
});
