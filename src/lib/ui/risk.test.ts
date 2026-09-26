import { describe, expect, it } from 'vitest';

import { days, hours, plural, reasonHref, reasonText, RISK_LEVEL } from './risk';
import type { RiskReason } from '@/domain/types';
import { taskQuerySchema } from '@/lib/validation/task';

describe('plural', () => {
  it('различает три формы русского числительного', () => {
    const f = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;
    expect(f(1)).toBe('1 задача');
    expect(f(2)).toBe('2 задачи');
    expect(f(5)).toBe('5 задач');
  });

  /**
   * Одиннадцать–четырнадцать — исключение, на котором ломается наивная
   * реализация «по последней цифре»: 11 оканчивается на 1, но форма
   * множественная. Ошибка не падает, а просто выглядит безграмотно.
   */
  it('обрабатывает исключение 11–14', () => {
    for (const n of [11, 12, 13, 14, 111, 112]) {
      expect(plural(n, 'задача', 'задачи', 'задач')).toBe('задач');
    }
  });

  it('ноль и круглые десятки берут форму множественного числа', () => {
    for (const n of [0, 5, 20, 100]) {
      expect(plural(n, 'день', 'дня', 'дней')).toBe('дней');
    }
    expect(plural(21, 'день', 'дня', 'дней')).toBe('день');
    expect(plural(22, 'день', 'дня', 'дней')).toBe('дня');
  });
});

describe('days и hours', () => {
  /**
   * Движок считает дни дробными — деление часов на ёмкость целого числа
   * не даёт. На экране такая точность лишняя и выглядит как ошибка.
   */
  it('округляет дробные дни движка', () => {
    expect(days(13.08)).toBe('13 дней');
    expect(days(7.08)).toBe('7 дней');
  });

  /**
   * Главное, ради чего округление сделано функцией, а не подставлено по
   * месту: склонение обязано получать целое. Наивное
   * `${n} ${plural(n, …)}` на 2.08 даёт «2.08 дней» — и число кривое,
   * и форма неверная.
   */
  it('склоняет по округлённому числу, а не по дробному', () => {
    expect(days(2.08)).toBe('2 дня');
    expect(days(1.4)).toBe('1 день');
    expect(days(0.6)).toBe('1 день');
  });

  it('часы тоже целые', () => {
    expect(hours(62.4)).toBe('62 ч');
    expect(hours(116)).toBe('116 ч');
  });
});

describe('RISK_LEVEL', () => {
  /**
   * Цвет — дублирующий канал, не основной (NFR-17). Проверка следит за
   * тем, что у каждого уровня есть слово: разметка может потерять класс
   * при правке стилей, и тогда уровень останется читаем.
   */
  it('у каждого уровня есть название словом', () => {
    expect(RISK_LEVEL.low.label).toBe('низкий');
    expect(RISK_LEVEL.medium.label).toBe('средний');
    expect(RISK_LEVEL.high.label).toBe('высокий');
    expect(RISK_LEVEL.critical.label).toBe('критический');
  });
});

function reason(patch: Partial<RiskReason>): RiskReason {
  return {
    code: 'BLOCKERS',
    kind: 'factor',
    severity: 'medium',
    contribution: 10,
    facts: {},
    taskIds: [],
    ...patch,
  };
}

describe('reasonText', () => {
  it('называет величину, а не только факт', () => {
    expect(
      reasonText(reason({ code: 'TEAM_OVERLOAD', facts: { team: 'Тестирование', load: 1.15 } })),
    ).toBe('Команда «Тестирование» загружена на 115%');
  });

  it('упоминает застарелые блокеры отдельно от свежих', () => {
    expect(reasonText(reason({ facts: { blockedCount: 1, staleCount: 1 } }))).toBe(
      '1 задача заблокирована, из них 1 застарелая',
    );
    expect(reasonText(reason({ facts: { blockedCount: 3, staleCount: 0 } }))).toBe(
      '3 задачи заблокированы',
    );
  });

  it('объясняет нехватку времени по цепочке словами, а не числом', () => {
    expect(
      reasonText(
        reason({
          code: 'CHAIN_EXCEEDS_TIME',
          kind: 'escalation',
          facts: { chainDays: 13, remainingWorkingDays: 6 },
        }),
      ),
    ).toContain('релиз не успевает по зависимостям');
  });

  /**
   * Неизвестный код не должен обрушить экран: движок могут дополнить
   * новым правилом раньше, чем сюда допишут формулировку.
   */
  it('неизвестный код отдаётся как есть, а не ломает страницу', () => {
    expect(reasonText(reason({ code: 'НЕЧТО_НОВОЕ' as RiskReason['code'] }))).toBe('НЕЧТО_НОВОЕ');
  });
});

/**
 * Ссылка обязана вести туда, куда обещает.
 *
 * Проверяется не только форма адреса, но и то, что экран задач его
 * примет: параметры разбираются той же схемой, что стоит на входе
 * страницы. Это и есть смысл теста — `reasonHref` и `taskQuerySchema`
 * лежат в разных слоях и правятся в разное время, а разойдясь, дадут
 * ссылку, которая молча открывает список без фильтра.
 */
describe('reasonHref', () => {
  const SLUG = 'demo';
  const RELEASE = '1b88d25b-644d-4189-9f78-19a723a0fe5f';
  const TEAM = 'fa37cea8-7dce-4be5-b89b-acffa34dd1d8';

  const query = (href: string) =>
    taskQuerySchema.parse(Object.fromEntries(new URL(href, 'http://localhost').searchParams));

  it('у блокеров сужает выборку до заблокированных задач релиза', () => {
    const href = reasonHref(reason({ code: 'BLOCKERS' }), SLUG, RELEASE)!;
    expect(href.startsWith(`/org/${SLUG}/tasks?`)).toBe(true);
    expect(query(href)).toMatchObject({ releaseId: RELEASE, blocked: true });
  });

  it('у критического блокера добавляет приоритет, о котором говорит текст', () => {
    const p0 = reasonHref(reason({ code: 'CRITICAL_BLOCKER', kind: 'escalation' }), SLUG, RELEASE)!;
    expect(query(p0)).toMatchObject({ releaseId: RELEASE, blocked: true, priority: 'P0' });

    const p1 = reasonHref(
      reason({ code: 'MULTIPLE_P1_BLOCKED', kind: 'escalation' }),
      SLUG,
      RELEASE,
    )!;
    expect(query(p1)).toMatchObject({ releaseId: RELEASE, blocked: true, priority: 'P1' });
  });

  it('у перегруза команды фильтрует по команде, а не по её названию', () => {
    const href = reasonHref(
      reason({ code: 'TEAM_OVERLOAD', facts: { team: 'Тестирование', teamId: TEAM, load: 1.15 } }),
      SLUG,
      RELEASE,
    )!;
    expect(query(href)).toMatchObject({ releaseId: RELEASE, teamId: TEAM });
  });

  /**
   * Узкого места может не быть — тогда фильтровать не по чему. Ссылка на
   * весь релиз тут притворилась бы ответом на вопрос «какие именно».
   */
  it('без идентификатора команды ссылки нет', () => {
    expect(
      reasonHref(reason({ code: 'TEAM_OVERLOAD', facts: { team: '—', load: 1.15 } }), SLUG, RELEASE),
    ).toBeNull();
  });

  /**
   * Причины про релиз целиком ссылки не получают: выборка под них либо
   * совпадает со всем релизом, либо невыразима фильтрами экрана.
   */
  it('причины о релизе целиком остаются без ссылки', () => {
    for (const code of ['TIME_DEFICIT', 'CRITICAL_CHAIN', 'QA_FUNNEL', 'SCOPE_DRIFT', 'LOW_PROBABILITY'] as const) {
      expect(reasonHref(reason({ code }), SLUG, RELEASE)).toBeNull();
    }
  });
});
