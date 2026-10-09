'use client';

/**
 * Статус для руководства (FR-29): текст и кнопка «скопировать».
 *
 * Текст собирает сервер из чисел движка (`lib/ui/status`); здесь только
 * показ и копирование — статус почти всегда уходит дальше, в письмо или
 * чат, и переписывать его руками значит переписывать с ошибками.
 */

import { useState } from 'react';

export function StatusCard({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (нет разрешения или небезопасный адрес) —
      // текст остаётся на экране, его можно выделить руками.
    }
  }

  return (
    <details className="group rounded-2xl border border-black/10 dark:border-white/15">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-medium">
        <span>Статус для руководства</span>
        <span className="text-xs font-normal opacity-50 group-open:hidden">показать</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-black/10 px-5 py-4 dark:border-white/15">
        <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <span className="text-xs opacity-50">
            Числа — из того же расчёта, что в кокпите; текст собран без модели.
          </span>
        </div>
      </div>
    </details>
  );
}
