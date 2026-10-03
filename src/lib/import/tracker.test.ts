import { describe, expect, it } from 'vitest';

import { durationToHours, mapTrackerIssues, type TrackerIssue } from './tracker';

const ORG = '11111111-1111-4111-8111-111111111111';

const issue = (over: Partial<TrackerIssue> = {}): TrackerIssue => ({
  key: 'PAYWORLD-100',
  summary: 'Интеграция с процессингом',
  description: 'Созвон с Ивановым, детали в конфлюенсе',
  status: { key: 'inProgress' },
  priority: { key: 'critical' },
  estimation: 'P1D',
  queue: { key: 'PAYWORLD' },
  ...over,
});

describe('длительность ISO-8601 в часах', () => {
  /*
    `P1DT4H` — это 12 часов, а не 28: день оценки в трекере равен рабочему
    дню. Ошибка здесь масштабирует все оценки сразу, и ни один тест
    расчёта этого бы не заметил — релиз просто выглядел бы вдвое тяжелее.
  */
  it('день считается рабочим, неделя — пятью днями', () => {
    expect(durationToHours('P1D')).toBe(8);
    expect(durationToHours('P1DT4H')).toBe(12);
    expect(durationToHours('P1W')).toBe(40);
    expect(durationToHours('PT30M')).toBe(0.5);
    expect(durationToHours('P1WT2H30M')).toBe(42.5);
  });

  it('пусто и мусор дают null, а не ноль', () => {
    // Ноль прошёл бы дальше как настоящая оценка и обнулил бы готовность.
    expect(durationToHours(undefined)).toBeNull();
    expect(durationToHours('')).toBeNull();
    expect(durationToHours('полтора дня')).toBeNull();
  });
});

describe('перевод задач трекера', () => {
  it('статусы и приоритеты трекера переводятся в свои', () => {
    const { rows, errors } = mapTrackerIssues([issue()], {}, { orgId: ORG });
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'in_progress', priority: 'P1', estimateH: 8 });
  });

  it('незнакомый статус отклоняет задачу и называет его', () => {
    // Ключи статусов настраиваются в каждой очереди, поэтому список
    // заведомо неполон — но угадывать по похожести нельзя.
    const { rows, errors } = mapTrackerIssues(
      [issue({ status: { key: 'waitingForLegal' } })],
      {},
      { orgId: ORG },
    );
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain('waitingForLegal');
  });

  it('задача без оценки не импортируется, а попадает в отчёт', () => {
    const { rows, errors } = mapTrackerIssues(
      [issue({ estimation: undefined })],
      {},
      { orgId: ORG },
    );
    expect(rows).toEqual([]);
    expect(errors[0].field).toBe('estimation');
  });

  it('команда берётся по очереди', () => {
    const { rows } = mapTrackerIssues([issue()], {}, {
      orgId: ORG,
      teamByQueue: { PAYWORLD: 'Бэкенд' },
    });
    expect(rows[0].teamName).toBe('Бэкенд');
  });

  /*
    Направление связи. `inward` означает, что объект держит эту задачу;
    перепутать — значит построить критическую цепочку задом наперёд,
    причём молча: цифры останутся правдоподобными.
  */
  it('держащая задача попадает в blocks, а зависящая — нет', () => {
    const links = {
      'PAYWORLD-100': [
        { type: { id: 'depends' }, direction: 'inward', object: { key: 'PAYWORLD-7' } },
        { type: { id: 'depends' }, direction: 'outward', object: { key: 'PAYWORLD-9' } },
        { type: { id: 'relates' }, direction: 'inward', object: { key: 'PAYWORLD-5' } },
      ],
    };
    const { rows } = mapTrackerIssues([issue()], links, { orgId: ORG, anonymize: false });
    expect(rows[0].blocks).toEqual(['PAYWORLD-7']);
  });
});

describe('анонимизация включена по умолчанию (FR-42)', () => {
  it('ни названия, ни описания, ни ключа очереди в результате нет', () => {
    const { rows } = mapTrackerIssues([issue()], {}, { orgId: ORG });
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain('Интеграция');
    expect(text).not.toContain('Иванов');
    expect(text).not.toContain('PAYWORLD');
    expect(rows[0].description).toBeNull();
  });

  it('структура сохраняется: часы, статус, приоритет на месте', () => {
    // Утекает текст, а не числа: по ним расчёт риска получается тот же.
    const { rows } = mapTrackerIssues([issue({ spent: 'PT6H' })], {}, { orgId: ORG });
    expect(rows[0]).toMatchObject({
      status: 'in_progress',
      priority: 'P1',
      estimateH: 8,
      spentH: 6,
    });
  });

  it('ключи в связях тоже псевдонимизируются', () => {
    // Иначе анонимизация текста оказалась бы напрасной: исходные ключи
    // остались бы в зависимостях.
    const links = {
      'PAYWORLD-100': [
        { type: { id: 'depends' }, direction: 'inward', object: { key: 'PAYWORLD-7' } },
      ],
    };
    const { rows } = mapTrackerIssues([issue()], links, { orgId: ORG });
    expect(rows[0].blocks[0]).toMatch(/^ANON-[0-9A-F]{6}$/);
  });

  it('выключается явно, и тогда текст проходит как есть', () => {
    const { rows } = mapTrackerIssues([issue()], {}, { orgId: ORG, anonymize: false });
    expect(rows[0].title).toBe('Интеграция с процессингом');
    expect(rows[0].key).toBe('PAYWORLD-100');
  });
});
