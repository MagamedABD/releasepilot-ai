import { describe, expect, it } from 'vitest';

import { anonymizeTask, pseudonym } from './anonymize';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('псевдоним', () => {
  /*
    Устойчивость — не удобство, а условие работоспособности импорта:
    повторная загрузка должна обновлять задачу, а не заводить копию.
    Случайный псевдоним при каждом импорте плодил бы дубли.
  */
  it('устойчив: тот же ключ даёт тот же псевдоним', () => {
    expect(pseudonym(ORG_A, 'PAY-302')).toBe(pseudonym(ORG_A, 'PAY-302'));
  });

  it('различает организации: соль — идентификатор организации', () => {
    expect(pseudonym(ORG_A, 'PAY-302')).not.toBe(pseudonym(ORG_B, 'PAY-302'));
  });

  it('различает задачи', () => {
    expect(pseudonym(ORG_A, 'PAY-302')).not.toBe(pseudonym(ORG_A, 'PAY-303'));
  });

  it('короткий и в верхнем регистре', () => {
    expect(pseudonym(ORG_A, 'PAY-302')).toMatch(/^[0-9A-F]{6}$/);
  });
});

describe('задача без корпоративного текста', () => {
  it('ни ключа, ни названия исходной задачи в результате нет', () => {
    const anon = anonymizeTask(ORG_A, 'PAYWORLD-1234');
    const text = JSON.stringify(anon);
    expect(text).not.toContain('PAYWORLD');
    expect(text).not.toContain('1234');
  });

  it('название остаётся непустым и различимым', () => {
    // Пустое название не прошло бы проверку, а одинаковое превратило бы
    // список блокеров в сто неотличимых строк.
    const a = anonymizeTask(ORG_A, 'PAY-302');
    const b = anonymizeTask(ORG_A, 'PAY-303');
    expect(a.title.length).toBeGreaterThan(6);
    expect(a.title).not.toBe(b.title);
  });

  it('описание удаляется целиком', () => {
    // В нём нет ничего нужного расчёту и больше всего рисков: имена,
    // ссылки на внутренние системы, переписка.
    expect(anonymizeTask(ORG_A, 'PAY-302').description).toBeNull();
  });

  it('ключ сохраняет форму, по которой задача сопоставляется', () => {
    expect(anonymizeTask(ORG_A, 'PAY-302').key).toMatch(/^ANON-[0-9A-F]{6}$/);
  });
});
