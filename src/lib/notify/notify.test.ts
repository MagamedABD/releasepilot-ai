import { describe, expect, it } from 'vitest';

import { detectEscalations, riskRose } from './alerts';
import { digestEmail, riskAlertEmail, type DigestRelease } from './templates';

describe('riskRose', () => {
  it('только переход на уровень выше', () => {
    expect(riskRose('medium', 'high')).toBe(true);
    expect(riskRose('low', 'critical')).toBe(true);
    expect(riskRose('high', 'high')).toBe(false);
    expect(riskRose('critical', 'medium')).toBe(false);
  });

  it('первый снимок — не рост: сравнивать не с чем', () => {
    expect(riskRose(null, 'critical')).toBe(false);
  });
});

describe('detectEscalations', () => {
  it('находит выросшие и называет, откуда и куда', () => {
    const previous = new Map([
      ['a', 'medium'],
      ['b', 'high'],
    ] as const);
    const found = detectEscalations(previous, [
      { releaseId: 'a', level: 'high' as const, name: 'A' },
      { releaseId: 'b', level: 'high' as const, name: 'B' },
      { releaseId: 'new', level: 'critical' as const, name: 'N' },
    ]);
    expect(found).toEqual([{ releaseId: 'a', level: 'high', name: 'A', from: 'medium', to: 'high' }]);
  });
});

const release = (over: Partial<DigestRelease> = {}): DigestRelease => ({
  name: '2.14 — Возвраты',
  level: 'critical',
  lines: ['Релиз «2.14 — Возвраты»: риск критический (86), готовность 8.8%.', 'План — 6 октября.'],
  url: 'https://example.test/org/demo/release/1',
  ...over,
});

describe('digestEmail', () => {
  it('содержит готовность, риск и ссылку — и текстом, и в HTML (US-30)', () => {
    const email = digestEmail('Демо', [release()]);
    expect(email.subject).toContain('критический');
    for (const body of [email.text, email.html]) {
      expect(body).toContain('готовность 8.8%');
      expect(body).toContain('https://example.test/org/demo/release/1');
    }
  });

  it('названия экранируются: тег в имени релиза не становится разметкой', () => {
    const email = digestEmail('Демо', [
      release({ lines: ['Релиз «<img src=x onerror=alert(1)>»: риск низкий.'] }),
    ]);
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img');
  });

  it('без открытых релизов говорит об этом прямо', () => {
    const email = digestEmail('Демо', []);
    expect(email.text).toContain('Открытых релизов нет');
  });
});

describe('riskAlertEmail', () => {
  it('в теме — релиз и переход уровня (US-31)', () => {
    const email = riskAlertEmail({ ...release(), from: 'high' });
    expect(email.subject).toBe('Риск вырос: 2.14 — Возвраты — высокий → критический');
    expect(email.text).toContain('готовность 8.8%');
  });
});
