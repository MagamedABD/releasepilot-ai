import { describe, expect, it } from 'vitest';

import { days, hours, plural, reasonText, RISK_LEVEL } from './risk';
import type { RiskReason } from '@/domain/types';

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
