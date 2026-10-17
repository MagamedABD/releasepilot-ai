import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('жирный и код — отдельные куски, остальное текст', () => {
    expect(parseInline('Узкое место — **Бэкенд**, см. `PAY-302`.')).toEqual([
      { kind: 'text', text: 'Узкое место — ' },
      { kind: 'bold', text: 'Бэкенд' },
      { kind: 'text', text: ', см. ' },
      { kind: 'code', text: 'PAY-302' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('незакрытая пометка остаётся текстом — ответ приходит потоком', () => {
    expect(parseInline('риск **крити')).toEqual([{ kind: 'text', text: 'риск **крити' }]);
  });

  it('HTML не превращается в разметку', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('подряд идущие пункты — один список, между абзацами пустая строка', () => {
    const blocks = parseMarkdown('Остатки:\n\n- **Бэкенд** — 116 ч\n- Фронтенд — 42 ч\n\nИтог.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    const list = blocks[1];
    expect(list.kind === 'list' && list.items).toHaveLength(2);
    expect(list.kind === 'list' && list.ordered).toBe(false);
  });

  it('нумерованный список отличается от маркированного', () => {
    const [list] = parseMarkdown('1. Снять блокер\n2. Перенести задачи');
    expect(list).toMatchObject({ kind: 'list', ordered: true });
  });

  it('заголовок становится жирной строкой', () => {
    const [p] = parseMarkdown('## Итог');
    expect(p).toEqual({ kind: 'paragraph', inline: [{ kind: 'bold', text: 'Итог' }] });
  });
});
