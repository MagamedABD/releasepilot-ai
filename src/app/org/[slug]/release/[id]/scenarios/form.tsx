'use client';

/**
 * Форма «что если» и кнопка применения.
 *
 * Клиентская часть здесь нужна ровно для двух вещей: показать результат
 * расчёта, не уходя со страницы, и не потерять отмеченные задачи после
 * отправки. Всё остальное делает сервер.
 *
 * Расчёт и сохранение — одна форма с двумя кнопками, а не две формы.
 * Иначе отмеченные задачи пришлось бы держать в двух местах и
 * синхронизировать, а расхождение между ними означало бы, что сохранён
 * не тот сценарий, который посчитали, — худшая из возможных ошибок на
 * этом экране.
 */

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/form';
import { DIRECTION_TONE, direction, levelChange, pct, signed } from '@/lib/ui/scenario';
import { RISK_LEVEL, hours } from '@/lib/ui/risk';
import type { RiskLevel } from '@/domain/types';

import {
  applyScenarioAction,
  runScenario,
  type ApplyState,
  type ScenarioFormState,
  type SimulationView,
} from './actions';

export type TaskOption = {
  id: string;
  key: string | null;
  title: string | null;
  estimateH: number;
  teamName: string | null;
  priority: string;
  blocked: boolean;
};

export type TeamOption = { id: string; name: string };

const levelLabel = (l: string) => RISK_LEVEL[l as RiskLevel]?.label ?? l;

export function WhatIfForm({
  slug,
  releaseId,
  tasks,
  teams,
  suggested,
}: {
  slug: string;
  releaseId: string;
  tasks: TaskOption[];
  teams: TeamOption[];
  /** Набор из подбора: форма открывается с ним уже отмеченным. */
  suggested: string[];
}) {
  const [state, action] = useActionState<ScenarioFormState, FormData>(runScenario, {});
  const checked = new Set(state.selected?.taskIds ?? suggested);
  const capacity = state.selected?.capacity ?? {};

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="releaseId" value={releaseId} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Убрать из релиза</legend>
        <p className="text-sm opacity-60">
          Задача уходит из расчёта целиком. Блокер, который держит остающиеся задачи, убрать
          нельзя — расчёт откажется и скажет, кого он держит.
        </p>
        <ul className="mt-1 flex flex-col divide-y divide-black/5 dark:divide-white/10">
          {tasks.map((task) => (
            <li key={task.id} className="py-2">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="exclude"
                  value={task.id}
                  defaultChecked={checked.has(task.id)}
                  className="mt-1 size-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="font-medium">{task.key ?? task.id.slice(0, 8)}</span>{' '}
                  <span className="opacity-80">{task.title ?? 'без названия'}</span>
                  <span className="mt-0.5 block text-xs opacity-50">
                    {task.priority} · {hours(task.estimateH)} · {task.teamName ?? 'без команды'}
                    {task.blocked ? ' · заблокирована' : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Добавить часов команде</legend>
        <p className="text-sm opacity-60">
          Часы номинальные, до плановой даты. Фокус-фактор применит расчёт — иначе часы «сверху»
          оказались бы полезнее своих.
        </p>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <label key={team.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="opacity-80">{team.name}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  name={`capacity:${team.id}`}
                  min={0}
                  max={1000}
                  step={4}
                  defaultValue={capacity[team.id] ?? ''}
                  placeholder="0"
                  className="w-24 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-right tabular-nums dark:border-white/20"
                />
                <span className="opacity-50">ч</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Problems problems={state.problems} />
      <FormError message={state.error} />

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="submit"
          name="intent"
          value="simulate"
          className="rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700"
        >
          Посчитать
        </button>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="opacity-60">Название сценария</span>
          <input
            name="title"
            defaultValue={state.selected?.title ?? ''}
            placeholder="Перенести оплату частями"
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          />
        </label>
        {/*
          Сохранение отдельной кнопкой и без применения: сохранённый
          сценарий — это предложение с посчитанным эффектом, а менять
          состав релиза человек решает отдельным нажатием.
        */}
        <button
          type="submit"
          name="intent"
          value="save"
          className="rounded-lg border border-black/15 px-4 py-2.5 font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Сохранить
        </button>
      </div>

      {state.savedId ? (
        <FormNotice message="Сценарий сохранён. Применить его можно в списке ниже." />
      ) : null}

      {state.simulation ? <DeltaTable view={state.simulation} /> : null}
    </form>
  );
}

function Problems({ problems }: { problems?: Record<string, string[]> }) {
  if (!problems) return null;
  const all = Object.entries(problems).flatMap(([field, messages]) =>
    messages.map((m) => ({ field, m })),
  );
  if (all.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <p className="font-medium">Сценарий нельзя посчитать честно</p>
      <ul className="mt-1 list-disc pl-5">
        {all.map((item, i) => (
          <li key={`${item.field}-${i}`}>{item.m}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «До» и «после» рядом.
 *
 * Разность берётся из расчёта, а не вычитается здесь. Разница не
 * косметическая: вычитание на экране однажды разошлось бы с округлением
 * сервера, и пользователь увидел бы «−12.4» там, где сохранено «−12.3».
 */
export function DeltaTable({ view }: { view: SimulationView }) {
  const rows = [
    {
      label: 'Скор риска',
      before: view.before.riskScore.toFixed(1),
      after: view.after.riskScore.toFixed(1),
      delta: signed(view.delta.riskScore),
      tone: DIRECTION_TONE[direction(view.delta.riskScore, true)],
    },
    {
      label: 'Уровень',
      before: levelLabel(view.before.riskLevel),
      after: levelLabel(view.after.riskLevel),
      delta: levelChange(
        view.delta.levelFrom as RiskLevel,
        view.delta.levelTo as RiskLevel,
        levelLabel,
      ),
      tone:
        view.delta.levelFrom === view.delta.levelTo
          ? DIRECTION_TONE.same
          : DIRECTION_TONE.better,
    },
    {
      label: 'Вероятность в срок',
      before: pct(view.before.probabilityOnTime),
      after: pct(view.after.probabilityOnTime),
      delta:
        view.delta.probabilityOnTime === null
          ? '—'
          : signed(view.delta.probabilityOnTime * 100, 0),
      tone: DIRECTION_TONE[direction(view.delta.probabilityOnTime ?? 0, false)],
    },
    {
      label: 'Готовность',
      before: `${view.before.readinessPct.toFixed(1)}%`,
      after: `${view.after.readinessPct.toFixed(1)}%`,
      delta: signed(view.delta.readinessPct),
      tone: DIRECTION_TONE[direction(view.delta.readinessPct, false)],
    },
    {
      label: 'Остаток работ',
      before: hours(view.before.remainingH),
      after: hours(view.after.remainingH),
      delta: `${signed(view.delta.remainingH, 0)} ч`,
      tone: DIRECTION_TONE[direction(view.delta.remainingH, true)],
    },
    {
      label: 'Критическая цепочка',
      before: `${view.before.criticalChainDays.toFixed(1)} д`,
      after: `${view.after.criticalChainDays.toFixed(1)} д`,
      delta: `${signed(view.delta.criticalChainDays, 1)} д`,
      tone: DIRECTION_TONE[direction(view.delta.criticalChainDays, true)],
    },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-black/10 dark:border-white/15">
      <table className="w-full text-sm">
        <caption className="px-4 pt-4 text-left text-sm opacity-60">
          Ожидаемая дата: {view.before.expectedDate ?? '—'} → {view.after.expectedDate ?? '—'}
        </caption>
        <thead>
          <tr className="text-left opacity-50">
            <th scope="col" className="px-4 py-2 font-medium">
              Показатель
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              До
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              После
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Разница
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/10">
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="px-4 py-2 text-left font-normal opacity-80">
                {row.label}
              </th>
              <td className="px-4 py-2 tabular-nums">{row.before}</td>
              <td className="px-4 py-2 tabular-nums">{row.after}</td>
              <td className={`px-4 py-2 font-medium tabular-nums ${row.tone}`}>{row.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Кнопка применения.
 *
 * Своё состояние у каждой: отказ относится к одному сценарию, и показать
 * его надо рядом с ним, а не общим сообщением сверху, из которого
 * непонятно, какой именно сценарий не применился.
 */
export function ApplyButton({
  slug,
  releaseId,
  scenarioId,
}: {
  slug: string;
  releaseId: string;
  scenarioId: string;
}) {
  const [state, action] = useActionState<ApplyState, FormData>(applyScenarioAction, {});

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="releaseId" value={releaseId} />
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <SubmitButton pendingLabel="Применяем…">Применить</SubmitButton>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
