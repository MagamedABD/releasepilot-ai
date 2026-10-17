/**
 * Ответ модели с разметкой: абзацы, списки, жирный, код.
 *
 * Строит элементы из разобранных блоков (`lib/ui/markdown`) и ни в какой
 * момент не вставляет строку как HTML — каждый символ ответа остаётся
 * текстом, что бы модель ни написала.
 */

import { parseMarkdown, type Inline } from '@/lib/ui/markdown';

function InlineView({ parts }: { parts: Inline[] }) {
  return parts.map((p, i) =>
    p.kind === 'bold' ? (
      <strong key={i} className="font-semibold">
        {p.text}
      </strong>
    ) : p.kind === 'code' ? (
      <code key={i} className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/10">
        {p.text}
      </code>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={i} className="whitespace-pre-wrap">
              <InlineView parts={block.inline} />
            </p>
          );
        }
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={i} className={`flex flex-col gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
            {block.items.map((item, j) => (
              <li key={j}>
                <InlineView parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
