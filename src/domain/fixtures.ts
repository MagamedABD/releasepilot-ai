import type {
  Dependency,
  ReleaseSnapshot,
  Task,
  TaskPriority,
  TaskStatus,
  Team,
  TeamCapacity,
} from './types';

/**
 * Фабрики снимков для тестов. Держатся рядом с движком намеренно: сценарии
 * здесь — это исполняемая формулировка требований, а не вспомогательный код.
 */

export const TEAMS: Team[] = [
  { id: 'team-fe', name: 'Frontend', kind: 'dev' },
  { id: 'team-be', name: 'Backend', kind: 'dev' },
  { id: 'team-qa', name: 'QA', kind: 'qa' },
];

type TaskInput = Partial<Task> & { id: string };

export function task(input: TaskInput): Task {
  return {
    status: 'in_progress' as TaskStatus,
    priority: 'P2' as TaskPriority,
    estimateH: 8,
    teamId: 'team-fe',
    blockedSince: null,
    addedToReleaseAt: null,
    ...input,
  };
}

export function capacity(
  teamId: string,
  availableHours: number,
  periodStart = '2026-09-21',
  periodEnd = '2026-09-25',
): TeamCapacity {
  return { teamId, periodStart, periodEnd, availableHours };
}

export function blocks(blockerTaskId: string, blockedTaskId: string): Dependency {
  return { blockerTaskId, blockedTaskId, type: 'blocks' };
}

export function snapshot(overrides: Partial<ReleaseSnapshot> = {}): ReleaseSnapshot {
  return {
    now: '2026-09-20T09:00:00.000Z',
    release: {
      id: 'rel-1',
      name: 'Release 2026.09.24',
      plannedDate: '2026-09-24',
      startedAt: '2026-09-07T00:00:00.000Z',
    },
    teams: TEAMS,
    tasks: [],
    dependencies: [],
    capacity: [],
    calendar: { holidays: [] },
    ...overrides,
  };
}

/**
 * Сценарий из постановки задачи заказчика:
 * QA загружен на 135%, две критические задачи заблокированы,
 * одна backend-задача блокирует три frontend-задачи,
 * часть задач не успевает пройти тестирование.
 *
 * Экспертная оценка Delivery Manager для этой картины — **High**.
 * Именно на ней калибровался движок (ADR-001, §4).
 */
export function canonicalScenario(): ReleaseSnapshot {
  const tasks: Task[] = [
    // Завершённая часть релиза — даёт готовность около 78% по трудозатратам.
    ...Array.from({ length: 12 }, (_, i) =>
      task({
        id: `done-${i}`,
        key: `PPT-1${i}`,
        status: 'done',
        estimateH: 28,
        teamId: i % 2 === 0 ? 'team-fe' : 'team-be',
      }),
    ),

    // Две критические задачи заблокированы.
    task({
      id: 'blocked-p0-a',
      key: 'PPT-301',
      priority: 'P0',
      estimateH: 8,
      teamId: 'team-be',
      blockedSince: '2026-09-16T10:00:00.000Z',
    }),
    task({
      id: 'blocked-p0-b',
      key: 'PPT-302',
      priority: 'P0',
      estimateH: 6,
      teamId: 'team-fe',
      blockedSince: '2026-09-18T10:00:00.000Z',
    }),

    // Backend-задача, от которой зависят три frontend-задачи.
    task({ id: 'be-hub', key: 'PPT-311', estimateH: 16, teamId: 'team-be', priority: 'P1' }),
    task({ id: 'fe-1', key: 'PPT-320', estimateH: 8 }),
    task({ id: 'fe-2', key: 'PPT-321', estimateH: 6 }),
    task({ id: 'fe-3', key: 'PPT-322', estimateH: 5 }),

    // Очередь тестирования: QA физически не успевает.
    task({ id: 'qa-1', key: 'PPT-330', estimateH: 14, teamId: 'team-qa', status: 'testing' }),
    task({ id: 'qa-2', key: 'PPT-331', estimateH: 14, teamId: 'team-qa', status: 'testing' }),
    task({ id: 'qa-3', key: 'PPT-332', estimateH: 7.1, teamId: 'team-qa' }),

    // Задача, добавленная уже после старта релиза, — дрейф скоупа.
    task({
      id: 'late-1',
      key: 'PPT-402',
      estimateH: 10,
      teamId: 'team-fe',
      addedToReleaseAt: '2026-09-15T00:00:00.000Z',
    }),
  ];

  return snapshot({
    tasks,
    dependencies: [blocks('be-hub', 'fe-1'), blocks('be-hub', 'fe-2'), blocks('be-hub', 'fe-3')],
    capacity: [
      // Период 21–25 сентября, пять рабочих дней; до плановой даты попадают
      // четыре из них. Фокус-фактор применяет движок.
      capacity('team-fe', 100),
      capacity('team-be', 80),
      capacity('team-qa', 50),
    ],
  });
}
