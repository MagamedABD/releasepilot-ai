import { describe, expect, it } from 'vitest';

import { toApiRelease, toReleaseInsert, toReleaseUpdate } from './release';
import type { Database } from '@/lib/database.types';

type ReleaseRow = Database['public']['Tables']['releases']['Row'];

const NOW = '2026-09-27T10:00:00.000Z';
const EARLIER = '2026-09-01T10:00:00.000Z';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

function row(over: Partial<ReleaseRow> = {}): ReleaseRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    org_id: ORG,
    project_id: PROJECT,
    name: 'Платежи 2.4',
    status: 'planned',
    planned_date: '2026-10-19',
    started_at: null,
    released_at: null,
    created_at: EARLIER,
    updated_at: EARLIER,
    ...over,
  };
}

/**
 * Главный инвариант этого файла: момент старта ставится один раз.
 *
 * На нём держится фактор F6 — дрейф объёма. Движок считает дрейфом
 * задачи, попавшие в релиз позже его старта. Сдвинь старт вперёд, и
 * ранее добавленные задачи окажутся добавленными «до старта», а дрейф
 * обнулится: релиз, который дважды откладывали, выглядел бы аккуратнее
 * того, который не откладывали ни разу.
 */
describe('toReleaseUpdate: момент старта', () => {
  it('ставится при первом переходе в работу', () => {
    expect(toReleaseUpdate({ status: 'active' }, row(), NOW)).toEqual({
      status: 'active',
      started_at: NOW,
    });
  });

  it('не сдвигается при возврате из «отложен» в работу', () => {
    const patch = toReleaseUpdate(
      { status: 'active' },
      row({ status: 'postponed', started_at: EARLIER }),
      NOW,
    );
    expect(patch).toEqual({ status: 'active' });
    expect(patch.started_at).toBeUndefined();
  });

  it('не ставится при переходе в статус, который не «в работе»', () => {
    expect(toReleaseUpdate({ status: 'postponed' }, row(), NOW)).toEqual({ status: 'postponed' });
  });
});

describe('toReleaseUpdate: дата выпуска', () => {
  it('ставится при переходе в «выпущен»', () => {
    expect(
      toReleaseUpdate({ status: 'released' }, row({ status: 'active', started_at: EARLIER }), NOW),
    ).toEqual({ status: 'released', released_at: NOW });
  });

  /**
   * Релиз, помеченный выпущенным по ошибке и возвращённый в работу, не
   * должен сохранить дату выпуска: кокпит закрывает расчёты по статусу, и
   * такая дата осталась бы записью о выпуске, которого не было.
   */
  it('снимается при уходе из «выпущен»', () => {
    expect(
      toReleaseUpdate(
        { status: 'active' },
        row({ status: 'released', started_at: EARLIER, released_at: EARLIER }),
        NOW,
      ),
    ).toEqual({ status: 'active', released_at: null });
  });

  it('у отменённого релиза даты выпуска не появляется', () => {
    const patch = toReleaseUpdate({ status: 'cancelled' }, row({ status: 'active' }), NOW);
    expect(patch).toEqual({ status: 'cancelled' });
  });
});

/**
 * Пустой патч — не мелочь: маршрут по нему понимает, что писать нечего.
 * Выполни он UPDATE, и `updated_at` сдвинулся бы по запросу, который
 * ничего не изменил, — а по `updated_at` читают, когда релиз трогали.
 */
describe('toReleaseUpdate: совпавшие значения', () => {
  it('не попадают в патч', () => {
    expect(
      toReleaseUpdate(
        { name: 'Платежи 2.4', plannedDate: '2026-10-19', status: 'planned' },
        row(),
        NOW,
      ),
    ).toEqual({});
  });

  it('изменённое поле попадает, совпавшее — нет', () => {
    expect(toReleaseUpdate({ name: 'Платежи 2.5', status: 'planned' }, row(), NOW)).toEqual({
      name: 'Платежи 2.5',
    });
  });
});

describe('toReleaseInsert', () => {
  it('у сразу активного релиза моментом старта считает создание', () => {
    const insert = toReleaseInsert(
      { projectId: PROJECT, name: 'Платежи 2.4', status: 'active', plannedDate: '2026-10-19' },
      ORG,
      NOW,
    );
    expect(insert.started_at).toBe(NOW);
  });

  /**
   * Историю переносят не в день выпуска, поэтому «сейчас» здесь было бы
   * выдумкой: настоящая дата выпуска системе неизвестна.
   */
  it('дату выпуска при создании не придумывает', () => {
    const insert = toReleaseInsert(
      { projectId: PROJECT, name: 'Платежи 2.0', status: 'released', plannedDate: '2026-05-19' },
      ORG,
      NOW,
    );
    expect(insert.released_at).toBeNull();
    expect(insert.started_at).toBeNull();
  });

  it('у запланированного релиза обе отметки пусты', () => {
    const insert = toReleaseInsert(
      { projectId: PROJECT, name: 'Платежи 2.4', status: 'planned', plannedDate: '2026-10-19' },
      ORG,
      NOW,
    );
    expect(insert.started_at).toBeNull();
    expect(insert.released_at).toBeNull();
  });
});

describe('toApiRelease', () => {
  it('отдаёт camelCase и не отдаёт организацию', () => {
    const api = toApiRelease(row({ started_at: EARLIER }));
    expect(api).toMatchObject({
      projectId: PROJECT,
      plannedDate: '2026-10-19',
      startedAt: EARLIER,
      releasedAt: null,
    });
    expect('org_id' in api).toBe(false);
  });
});
