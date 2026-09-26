import { describe, expect, it } from 'vitest';

import { toSnapshot, toTeamKind, type SnapshotRows } from './snapshot';

const NOW = '2026-09-26T12:00:00.000Z';

function rows(patch: Partial<SnapshotRows> = {}): SnapshotRows {
  return {
    release: {
      id: 'rel-1',
      name: '2.14',
      planned_date: '2026-10-05',
      started_at: '2026-09-14T12:00:00+00:00',
    },
    teams: [{ id: 'team-be', name: 'Бэкенд', kind: 'backend' }],
    tasks: [],
    dependencies: [],
    capacity: [],
    ...patch,
  };
}

function task(patch: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    org_id: 'org-1',
    project_id: 'proj-1',
    release_id: 'rel-1',
    external_key: 'PAY-301',
    title: 'Расчёт комиссии при возврате',
    description: null,
    status: 'in_progress' as const,
    priority: 'P1' as const,
    estimate_h: 16,
    spent_h: 4,
    team_id: 'team-be',
    assignee_id: 'person-1',
    added_to_release_at: '2026-09-14T12:00:00+00:00',
    blocked_since: null,
    created_at: NOW,
    updated_at: NOW,
    ...patch,
  };
}

describe('toTeamKind', () => {
  it('сводит шесть видов команд базы к трём видам домена', () => {
    expect(toTeamKind('frontend')).toBe('dev');
    expect(toTeamKind('backend')).toBe('dev');
    expect(toTeamKind('qa')).toBe('qa');
    expect(toTeamKind('analytics')).toBe('other');
    expect(toTeamKind('design')).toBe('other');
    expect(toTeamKind('other')).toBe('other');
  });

  /**
   * Тестирование не должно раствориться среди «прочих»: на нём держится
   * фактор воронки QA. Если однажды кто-то допишет в перечисление базы
   * новое значение и по невнимательности отобразит его в 'qa', расчёт
   * тихо изменится на всех релизах. Проверка фиксирует, что ровно одно
   * значение базы означает тестирование.
   */
  it('единственный вид базы, означающий тестирование, — qa', () => {
    const kinds = ['frontend', 'backend', 'qa', 'analytics', 'design', 'other'] as const;
    expect(kinds.filter((k) => toTeamKind(k) === 'qa')).toEqual(['qa']);
  });
});

describe('toSnapshot', () => {
  it('переносит момент расчёта из аргумента, а не берёт текущее время', () => {
    expect(toSnapshot(rows(), NOW).now).toBe(NOW);
  });

  it('переводит имена колонок в имена полей домена', () => {
    const snap = toSnapshot(rows({ tasks: [task()] }), NOW);
    const [t] = snap.tasks;

    expect(t.key).toBe('PAY-301');
    expect(t.estimateH).toBe(16);
    expect(t.spentH).toBe(4);
    expect(t.teamId).toBe('team-be');
    expect(t.addedToReleaseAt).toBe('2026-09-14T12:00:00+00:00');
    expect(t.blockedSince).toBeNull();
  });

  /**
   * numeric приходит из Postgres строкой в некоторых драйверах и числом в
   * других. Расчёт складывает эти значения, а сложение строк даёт '164'
   * вместо 20 — ошибка, которая не падает, а тихо портит метрику.
   */
  it('приводит часы к числу, даже если база отдала строку', () => {
    const snap = toSnapshot(
      { ...rows({ tasks: [task({ estimate_h: '16.00', spent_h: '4.50' })] }) },
      NOW,
    );
    expect(snap.tasks[0].estimateH).toBe(16);
    expect(snap.tasks[0].spentH).toBe(4.5);
  });

  it('пустой ключ задачи становится undefined, а не пустой строкой', () => {
    const snap = toSnapshot(rows({ tasks: [task({ external_key: null })] }), NOW);
    expect(snap.tasks[0].key).toBeUndefined();
  });

  it('без таблицы праздников календарь пуст, а не сломан', () => {
    expect(toSnapshot(rows(), NOW).calendar.holidays).toEqual([]);
  });

  it('переносит ёмкость команд с приведением часов', () => {
    const snap = toSnapshot(
      rows({
        capacity: [
          {
            team_id: 'team-be',
            period_start: '2026-09-28',
            period_end: '2026-10-02',
            available_hours: 160,
          },
        ],
      }),
      NOW,
    );
    expect(snap.capacity).toEqual([
      {
        teamId: 'team-be',
        periodStart: '2026-09-28',
        periodEnd: '2026-10-02',
        availableHours: 160,
      },
    ]);
  });
});
