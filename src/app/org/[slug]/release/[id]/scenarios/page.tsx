import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RiskBadge } from '@/components/cockpit';
import { EmptyState } from '@/components/states';
import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { isOpenStatus } from '@/domain/metrics';
import { calculateRelease } from '@/domain/risk';
import { suggestScenario } from '@/domain/suggest';
import type { RiskLevel } from '@/domain/types';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';
import { RISK_LEVEL, hours, plural } from '@/lib/ui/risk';
import {
  DIRECTION_TONE,
  ESCALATION_ADVICE,
  direction,
  lowerLevel,
  pct,
  signed,
} from '@/lib/ui/scenario';

import { ApplyButton, DeltaTable, WhatIfForm, type TaskOption } from './form';

export const metadata = { title: 'Сценарии — ReleasePilot AI' };

/**
 * Экран сценариев (экран 5 варианта Б, FR-31…FR-35).
 *
 * Порядок блоков — это порядок разговора. Сначала «что предлагает
 * система»: подбор считается сразу, без нажатий, потому что пришедший
 * сюда уже видел в кокпите высокий риск и хочет ответ, а не пустую форму.
 * Ниже — ручной перебор для тех случаев, когда у менеджера своя гипотеза.
 * В самом низу — сохранённые сценарии: их применяет человек, и список
 * применённых остаётся историей того, что с релизом делали.
 *
 * Цель подбора — на один уровень ниже текущего. Не «low» и не «ноль»:
 * предложение «перенесите девять задач» верно арифметически и бесполезно
 * практически, а «что убрать, чтобы перестало быть critical» — вопрос,
 * который действительно задают.
 */
export default async function ScenariosPage({
  params,
}: PageProps<'/org/[slug]/release/[id]/scenarios'>) {
  const { slug, id } = await params;
  const supabase = await createClient();

  const [releaseRes, context, scenariosRes] = await Promise.all([
    supabase
      .from('releases')
      .select('id, name, status, planned_date, organizations(slug)')
      .eq('id', id)
      .maybeSingle(),
    loadReleaseContext(supabase, id),
    supabase
      .from('scenarios')
      .select('id, title, result, applied_at, created_at')
      .eq('release_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const release = releaseRes.data;
  if (!release || context.kind !== 'ok') notFound();
  // Релиз есть, но в другой организации: по этому адресу для пользователя
  // действительно ничего нет (ADR-003).
  if ((release.organizations as { slug: string } | null)?.slug !== slug) notFound();

  const { snapshot, completedReleases } = context.context;
  const forecast = forecastRelease(snapshot, RISK_CONFIG, { completedReleases });
  const metrics = calculateRelease(snapshot, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });

  const closed = release.status === 'released' || release.status === 'cancelled';
  const teams = snapshot.teams.map((t) => ({ id: t.id, name: t.name }));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const tasks: TaskOption[] = snapshot.tasks
    .filter((t) => isOpenStatus(t.status))
    .sort((a, b) => b.estimateH - a.estimateH)
    .map((t) => ({
      id: t.id,
      key: t.key ?? null,
      title: t.title ?? null,
      estimateH: t.estimateH,
      teamName: t.teamId ? (teamName.get(t.teamId) ?? null) : null,
      priority: t.priority,
      blocked: t.blockedSince !== null,
    }));

  const goalLevel = lowerLevel(metrics.riskLevel);
  const suggestion = goalLevel
    ? suggestScenario(snapshot, { kind: 'risk_level', target: goalLevel }, RISK_CONFIG, {
        completedReleases,
      })
    : null;

  const suggested =
    suggestion && suggestion.kind !== 'already_met' ? suggestion.taskIds : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div>
        <Link
          href={`/org/${slug}/release/${id}`}
          className="text-sm opacity-60 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          ← Кокпит релиза
        </Link>
        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide opacity-50">Сценарии</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{release.name}</h1>
            <p className="mt-1 text-sm opacity-60">
              Вероятность выпуска в срок {pct(forecast.probabilityOnTime)} · остаток{' '}
              {hours(metrics.effort.remainingH)}
            </p>
          </div>
          <RiskBadge level={metrics.riskLevel} score={metrics.riskScore} />
        </header>
      </div>

      {closed ? (
        <EmptyState
          title="Релиз закрыт"
          description="Сценарии считаются для открытых релизов: менять состав выпущенного или отменённого релиза поздно."
        />
      ) : (
        <>
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Что предлагает система
            </h2>
            <div className="mt-3">
              {suggestion === null ? (
                <p className="text-sm opacity-60">
                  Риск уже низкий — снижать нечего.
                </p>
              ) : suggestion.kind === 'already_met' ? (
                <p className="text-sm opacity-60">
                  Уровень уже ниже {RISK_LEVEL[goalLevel as RiskLevel].label.toLowerCase()} —
                  переносить нечего.
                </p>
              ) : suggestion.kind === 'ok' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm">
                    Чтобы уровень опустился до{' '}
                    <span className="font-medium">
                      {RISK_LEVEL[goalLevel as RiskLevel].label}
                    </span>
                    , достаточно убрать{' '}
                    {plural(suggestion.taskIds.length, 'задачу', 'задачи', 'задач')}:
                  </p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {suggestion.groups.map((g) => (
                      <li key={g.taskId} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{g.key ?? g.taskId.slice(0, 8)}</span>
                        <span className="opacity-80">{g.title ?? 'без названия'}</span>
                        <span className="text-xs opacity-50">
                          {g.priority} · {hours(g.estimateH)}
                          {g.withTaskIds.length > 0
                            ? ` · вместе с ${plural(g.withTaskIds.length, 'зависимой задачей', 'зависимыми задачами', 'зависимыми задачами')}`
                            : ''}
                        </span>
                        <span
                          className={`text-xs font-medium tabular-nums ${DIRECTION_TONE.better}`}
                        >
                          скор → {g.riskScoreAfter.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm opacity-60">
                    Набор уже отмечен в форме ниже — посчитайте его и сохраните, если согласны.
                  </p>
                  <DeltaTable
                    view={{
                      before: summary(suggestion.before),
                      after: summary(suggestion.after),
                      delta: {
                        riskScore: suggestion.delta.riskScore,
                        readinessPct: suggestion.delta.readinessPct,
                        remainingH: suggestion.delta.remainingH,
                        criticalChainDays: suggestion.delta.criticalChainDays,
                        probabilityOnTime: suggestion.delta.probabilityOnTime,
                        levelFrom: suggestion.delta.riskLevel.from,
                        levelTo: suggestion.delta.riskLevel.to,
                      },
                    }}
                  />
                </div>
              ) : (
                /*
                  Главный случай, ради которого у подбора есть отдельный
                  ответ «недостижимо»: уровень держат правила эскалации, на
                  перенос не реагирующие. Совет тогда не «перенести», а
                  «разблокировать», и экран обязан сказать это прямо, а не
                  показать пустой список.
                */
                <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                  <p className="font-medium">
                    Переносом задач уровень до{' '}
                    {RISK_LEVEL[goalLevel as RiskLevel].label.toLowerCase()} не опустить
                  </p>
                  <p className="opacity-80">
                    {suggestion.pinnedBy.length > 0
                      ? 'Уровень держат правила, на состав релиза не реагирующие:'
                      : 'Ни один перенос не снижает скор достаточно.'}
                  </p>
                  {suggestion.pinnedBy.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {suggestion.pinnedBy.map((r) => (
                        <li key={r.code}>{ESCALATION_ADVICE[r.code] ?? r.code}</li>
                      ))}
                    </ul>
                  ) : null}
                  {suggestion.delta ? (
                    <p className="opacity-80">
                      Лучшее, что нашлось: скор{' '}
                      <span className="font-medium tabular-nums">
                        {signed(suggestion.delta.riskScore)}
                      </span>{' '}
                      при переносе{' '}
                      {plural(suggestion.taskIds.length, 'задачи', 'задач', 'задач')}.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Своя гипотеза
            </h2>
            <div className="mt-3">
              {tasks.length === 0 ? (
                <EmptyState
                  title="В релизе нет открытых задач"
                  description="Убирать нечего: все задачи закрыты или отменены."
                />
              ) : (
                <WhatIfForm
                  slug={slug}
                  releaseId={id}
                  tasks={tasks}
                  teams={teams}
                  suggested={suggested}
                />
              )}
            </div>
          </section>
        </>
      )}

      <SavedScenarios
        slug={slug}
        releaseId={id}
        closed={closed}
        rows={scenariosRes.data ?? []}
      />
    </div>
  );
}

type Side = {
  metrics: {
    riskScore: number;
    riskLevel: RiskLevel;
    readinessPct: number;
    effort: { remainingH: number };
    criticalChain: { days: number };
  };
  forecast: { probabilityOnTime: number | null; expectedDate: string | null };
};

function summary(side: Side) {
  return {
    riskScore: side.metrics.riskScore,
    riskLevel: side.metrics.riskLevel,
    readinessPct: side.metrics.readinessPct,
    remainingH: side.metrics.effort.remainingH,
    criticalChainDays: side.metrics.criticalChain.days,
    probabilityOnTime: side.forecast.probabilityOnTime,
    expectedDate: side.forecast.expectedDate,
  };
}

/** Сохранённый эффект: то, что обещал сценарий в момент сохранения. */
type SavedResult = {
  before?: { riskScore?: number; riskLevel?: string };
  after?: { riskScore?: number; riskLevel?: string };
  delta?: { riskScore?: number; remainingH?: number };
} | null;

function SavedScenarios({
  slug,
  releaseId,
  closed,
  rows,
}: {
  slug: string;
  releaseId: string;
  closed: boolean;
  rows: { id: string; title: string; result: unknown; applied_at: string | null; created_at: string }[];
}) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
        Сохранённые сценарии
      </h2>
      <div className="mt-3">
        {rows.length === 0 ? (
          <EmptyState
            title="Сценариев пока нет"
            description="Посчитайте вариант выше и сохраните его — сохранённый сценарий можно применить одним нажатием, и он запомнит обещанный эффект."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
            {rows.map((row) => {
              const result = row.result as SavedResult;
              const deltaScore = result?.delta?.riskScore;
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">{row.title}</p>
                    <p className="mt-1 text-sm opacity-60">
                      {/*
                        Показывается эффект, посчитанный при сохранении, а
                        не пересчитанный сейчас: сценарий обещал именно
                        это, и подменять обещание свежим расчётом значило
                        бы незаметно менять то, на что человек согласился.
                      */}
                      {typeof deltaScore === 'number' ? (
                        <>
                          обещанный эффект: скор{' '}
                          <span
                            className={`font-medium tabular-nums ${
                              DIRECTION_TONE[direction(deltaScore, true)]
                            }`}
                          >
                            {signed(deltaScore)}
                          </span>
                        </>
                      ) : (
                        'эффект не сохранён'
                      )}
                      {' · '}
                      {new Date(row.created_at).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  {row.applied_at ? (
                    <span className="rounded-full border border-black/15 px-3 py-1 text-sm opacity-60 dark:border-white/20">
                      Применён {new Date(row.applied_at).toLocaleDateString('ru-RU')}
                    </span>
                  ) : closed ? (
                    <span className="text-sm opacity-50">релиз закрыт</span>
                  ) : (
                    <ApplyButton slug={slug} releaseId={releaseId} scenarioId={row.id} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
