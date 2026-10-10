'use client';

/**
 * Статус для руководства (FR-29): текст и кнопка «скопировать».
 *
 * Текст собирает сервер из чисел движка (`lib/ui/status`); здесь только
 * показ и копирование — статус почти всегда уходит дальше, в письмо или
 * чат, и переписывать его руками значит переписывать с ошибками.
 */

import { useState } from 'react';

import { callApi } from '@/lib/ui/api';

export function StatusCard({
  lines,
  releaseId,
  emailEnabled,
}: {
  lines: string[];
  releaseId: string;
  /** Настроена ли почта на сервере: без неё кнопка только обещала бы. */
  emailEnabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [mail, setMail] = useState<{ state: 'idle' | 'sending' | 'sent' | 'failed'; text?: string }>({
    state: 'idle',
  });

  // Письмо уходит на адрес самой учётной записи — сервер не принимает
  // получателя из запроса (FR-43).
  async function send() {
    setMail({ state: 'sending' });
    const res = await callApi<{ sentTo: string }>('POST', `/api/releases/${releaseId}/digest`);
    setMail(
      res.ok
        ? { state: 'sent', text: `Отправлено на ${res.data.sentTo}` }
        : { state: 'failed', text: res.message },
    );
  }

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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          {emailEnabled ? (
            <button
              type="button"
              onClick={send}
              disabled={mail.state === 'sending'}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
            >
              {mail.state === 'sending' ? 'Отправляем…' : 'Отправить себе на почту'}
            </button>
          ) : null}
          <span className="text-xs opacity-50">
            Числа — из того же расчёта, что в кокпите; текст собран без модели.
          </span>
        </div>
        {mail.text ? (
          <p
            role="status"
            className={`text-sm ${mail.state === 'failed' ? 'text-red-700 dark:text-red-300' : 'opacity-70'}`}
          >
            {mail.text}
          </p>
        ) : !emailEnabled ? (
          <p className="text-xs opacity-50">
            Рассылка на почту не настроена: на сервере не заданы RESEND_API_KEY и DIGEST_FROM_EMAIL.
          </p>
        ) : null}
      </div>
    </details>
  );
}
