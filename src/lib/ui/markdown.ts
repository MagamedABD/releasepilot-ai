/**
 * Разбор ответа модели в блоки для показа (абзацы, списки, жирный, код).
 *
 * Модель пишет Markdown, а экран показывал его как есть — со звёздочками и
 * дефисами. Полноценная библиотека здесь лишняя: нужна малая часть
 * синтаксиса. И главное — разбор возвращает данные, а не HTML. Текст
 * ответа может нести куски задач из трекера, то есть чужой ввод, и
 * вставлять его разметкой (`dangerouslySetInnerHTML`) значило бы открыть
 * дорогу внедрению скриптов. Здесь же любой символ остаётся текстом.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

/** `**жирный**` и `` `код` ``; незакрытая пометка остаётся текстом. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'code', text: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Строки группируются в блоки: подряд идущие пункты — один список,
 * остальное — абзацы, разделённые пустой строкой. Ответ приходит потоком,
 * поэтому разбор обязан терпеть оборванный на полуслове текст.
 */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'list', ...list });
      list = null;
    }
  };

  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;

    if (item) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(item[1]));
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      // Заголовки «## Итог» — просто жирная строка: отдельный размер
      // шрифта в узкой колонке ответа только ломает ритм.
      const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
      paragraph.push(heading ? `**${heading[1].replace(/\*\*/g, '')}**` : line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
