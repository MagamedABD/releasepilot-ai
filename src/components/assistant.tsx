'use client';

/**
 * Диалог с агентом (экран 5 концепции, FR-24…FR-27).
 *
 * Клиентская часть делает три вещи, и каждая из них — требование, а не
 * удобство:
 *
 * 1. **Читает поток.** Ответ приходит событиями, и первый текст должен
 *    появиться за секунды (NFR-05). `EventSource` здесь не годится — он
 *    умеет только GET, а вопрос уходит телом POST.
 * 2. **Показывает вызовы инструментов.** Менеджер должен видеть, на
 *    основании чего получен ответ: рекомендация без видимого основания
 *    ничем не отличается от догадки.
 * 3. **Показывает предложение карточкой, а не текстом.** Числа в тексте
 *    читаются как мнение модели; карточка с «до» и «после» — это эффект,
 *    посчитанный движком, и кнопка, которую нажимает человек.
 *
 * Чего здесь нет: разбора ответа на «понял ли агент вопрос». Текст
 * показывается как пришёл.
 */

import { useRef, useState } from 'react';

import { SUGGESTED_QUESTIONS, toolFailureLabel, toolLabel } from '@/lib/ui/agent';
import { DIRECTION_TONE, direction, levelChange, signed } from '@/lib/ui/scenario';
import { RISK_LEVEL } from '@/lib/ui/risk';
import type { RiskLevel } from '@/domain/types';

import { ApplyButton } from './scenario';

type ProposalDelta = {
  riskScore?: number;
  riskLevel?: { from: string; to: string };
  probabilityOnTime?: number | null;
  remainingH?: number;
};

type Entry =
  | { kind: 'question'; text: string }
  | { kind: 'answer'; text: string }
  | { kind: 'tool'; name: string; ok: boolean }
  | { kind: 'proposal'; scenarioId: string; title: string; delta: ProposalDelta }
  | { kind: 'error'; message: string };

const levelLabel = (l: string) => RISK_LEVEL[l as RiskLevel]?.label ?? l;

export function Assistant({
  slug,
  orgId,
  releaseId,
  mode,
}: {
  slug: string;
  orgId: string;
  releaseId: string;
  /** Режим известен заранее: пометка «демо» должна стоять до ответа, а не после. */
  mode: 'live' | 'demo' | 'off';
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Идентификатор диалога: приходит первым событием и держит переписку. */
  const sessionId = useRef<string | null>(null);

  const push = (entry: Entry) => setEntries((prev) => [...prev, entry]);

  /** Текст ответа дописывается в последнюю запись, а не плодит новые. */
  const appendAnswer = (chunk: string) =>
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last?.kind === 'answer') {
        return [...prev.slice(0, -1), { kind: 'answer', text: last.text + chunk }];
      }
      return [...prev, { kind: 'answer', text: chunk }];
    });

  async function ask(text: string) {
    if (busy || text.trim() === '') return;
    setBusy(true);
    setDraft('');
    push({ kind: 'question', text });

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          releaseId,
          message: text,
          ...(sessionId.current ? { sessionId: sessionId.current } : {}),
        }),
      });

      /*
        Отказ до начала потока приходит обычным JSON: ассистент не
        настроен, исчерпан предел, не прошла проверка. Показывается он как
        сообщение в диалоге, а не как поломка страницы, — и остальное
        приложение продолжает работать (NFR-07).
      */
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        push({
          kind: 'error',
          message: body?.error?.message ?? 'Ассистент временно недоступен',
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // События разделены пустой строкой; незавершённый хвост остаётся
        // в буфере до следующего чтения — иначе JSON разрывается посреди
        // символа и ломает разбор.
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          handle(JSON.parse(line.slice(6)) as Record<string, unknown>);
        }
      }
    } catch {
      push({ kind: 'error', message: 'Связь с ассистентом прервалась' });
    } finally {
      setBusy(false);
    }
  }

  function handle(event: Record<string, unknown>) {
    switch (event.type) {
      case 'session':
        sessionId.current = String(event.sessionId);
        return;
      case 'text':
        appendAnswer(String(event.text));
        return;
      case 'tool':
        push({ kind: 'tool', name: String(event.name), ok: Boolean(event.ok) });
        return;
      case 'proposal':
        push({
          kind: 'proposal',
          scenarioId: String(event.scenarioId),
          title: String(event.title),
          delta: (event.delta ?? {}) as ProposalDelta,
        });
        return;
      case 'error':
        push({ kind: 'error', message: String(event.message ?? 'Ассистент недоступен') });
        return;
      default:
        return;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {mode === 'demo' ? (
        /*
          Пометка стоит над диалогом всё время, а не только в первом
          ответе. На защите спросят «это настоящий ИИ?» — ответ должен быть
          на экране, а не в памяти докладчика.
        */
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
          <span className="font-medium">Демо-режим.</span> Инструменты и все числа настоящие — из того
          же расчёта, что в кокпите. Модель не вызывается: вопрос разбирается по словам, ответ
          собирается по шаблону.
        </p>
      ) : null}

      <ol className="flex flex-col gap-4">
        {entries.map((entry, i) => (
          <li key={i}>
            <EntryView entry={entry} slug={slug} releaseId={releaseId} />
          </li>
        ))}
      </ol>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 p-5 dark:border-white/20">
          <p className="text-sm font-medium">Спросите о релизе</p>
          <p className="mt-1 text-sm opacity-60">
            Ассистент не считает сам: все числа он берёт из того же расчёта, что показан в
            кокпите, и объясняет их. Изменить состав релиза он не может — только предложить
            сценарий.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => ask(q)}
                disabled={busy}
                className="rounded-full border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="sr-only">Вопрос ассистенту</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            placeholder="Что сейчас угрожает релизу?"
            className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2.5 dark:border-white/20"
          />
        </label>
        <button
          type="submit"
          disabled={busy || draft.trim() === ''}
          aria-busy={busy}
          className="rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Думает…' : 'Спросить'}
        </button>
      </form>
    </div>
  );
}

function EntryView({
  entry,
  slug,
  releaseId,
}: {
  entry: Entry;
  slug: string;
  releaseId: string;
}) {
  switch (entry.kind) {
    case 'question':
      return (
        <p className="ml-auto max-w-prose rounded-2xl bg-blue-600 px-4 py-2.5 text-white">
          {entry.text}
        </p>
      );

    case 'answer':
      // Переводы строк сохраняются: ответ построен как «вывод, причины,
      // что делать», и слитый в абзац он теряет именно эту структуру.
      return <p className="max-w-prose whitespace-pre-wrap">{entry.text}</p>;

    case 'tool':
      return (
        <p className="flex items-center gap-2 text-sm opacity-60">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {entry.ok ? toolLabel(entry.name) : toolFailureLabel(entry.name)}
        </p>
      );

    case 'proposal':
      return <ProposalCard entry={entry} slug={slug} releaseId={releaseId} />;

    case 'error':
      return (
        <p
          role="alert"
          className="max-w-prose rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          {entry.message}
        </p>
      );
  }
}

/**
 * Карточка предложения.
 *
 * Числа берутся из события, а не из текста ответа: их посчитал движок при
 * сохранении сценария. Кнопка применения — та же, что на экране
 * сценариев, и действует она от лица пользователя: у агента инструмента
 * применения нет вовсе (ADR-003, §6).
 */
function ProposalCard({
  entry,
  slug,
  releaseId,
}: {
  entry: Extract<Entry, { kind: 'proposal' }>;
  slug: string;
  releaseId: string;
}) {
  const { delta } = entry;

  return (
    <div className="max-w-prose rounded-2xl border border-black/10 p-4 dark:border-white/15">
      <p className="text-xs font-medium uppercase tracking-wide opacity-50">Предложение</p>
      <p className="mt-1 font-medium">{entry.title}</p>

      <dl className="mt-3 flex flex-col gap-1 text-sm">
        {delta.riskLevel ? (
          <Row
            label="Уровень риска"
            value={levelChange(
              delta.riskLevel.from as RiskLevel,
              delta.riskLevel.to as RiskLevel,
              levelLabel,
            )}
            tone={
              delta.riskLevel.from === delta.riskLevel.to
                ? DIRECTION_TONE.same
                : DIRECTION_TONE.better
            }
          />
        ) : null}
        {typeof delta.riskScore === 'number' ? (
          <Row
            label="Скор"
            value={signed(delta.riskScore)}
            tone={DIRECTION_TONE[direction(delta.riskScore, true)]}
          />
        ) : null}
        {typeof delta.probabilityOnTime === 'number' ? (
          <Row
            label="Вероятность в срок"
            value={`${signed(delta.probabilityOnTime * 100, 0)} п. п.`}
            tone={DIRECTION_TONE[direction(delta.probabilityOnTime, false)]}
          />
        ) : null}
        {typeof delta.remainingH === 'number' ? (
          <Row
            label="Остаток работ"
            value={`${signed(delta.remainingH, 0)} ч`}
            tone={DIRECTION_TONE[direction(delta.remainingH, true)]}
          />
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <a
          href={`/org/${slug}/release/${releaseId}/scenarios`}
          className="text-sm underline decoration-dotted underline-offset-4 opacity-70 transition hover:opacity-100"
        >
          Показать в сценариях
        </a>
        <ApplyButton slug={slug} releaseId={releaseId} scenarioId={entry.scenarioId} />
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="opacity-60">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
