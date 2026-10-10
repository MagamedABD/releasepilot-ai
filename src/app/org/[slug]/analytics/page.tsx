import { notFound } from 'next/navigation';

import { Stat } from '@/components/cockpit';
import { EmptyState } from '@/components/states';
import {
  deliveryHistory,
  recurringCauses,
  type DeliveryRecord,
  type RecurringCauses,
} from '@/domain/analytics';
import {
  loadReasonObservations,
  loadReleaseFacts,
  loadSnapshotCoverage,
  type SnapshotCoverage,
} from '@/lib/data/analytics';
import { createClient } from '@/lib/supabase/server';
import { REASON_LABEL, days, plural } from '@/lib/ui/risk';
import { DIRECTION_TONE, direction, signed } from '@/lib/ui/scenario';

export const metadata = { title: 'Аналитика — ReleasePilot AI' };

/**
 * Аналитика поставки (экран 6 концепции, FR-36, FR-38).
 *
 * Экран отвечает на два вопроса: сколько релизов вышло в срок и как
 * менялись задержки. Оба — про факт выпуска, поэтому считаются по самим
 * релизам и доступны сразу.
 *
 * Третий вопрос — какие причины задержек повторяются (FR-37) — здесь
 * честно не отвечен, и экран говорит об этом прямо. Ответ требует знать,
 * что система думала о релизе тогда: сейчас задачи закрыты, блокеры
 * сняты, загрузка обнулилась, и пересчёт по текущему состоянию выдал бы
 * «в прошлом всё было гладко» — историю, которой не было. Источник —
 * ежедневные снимки метрик, и пока их нет, блок показывает, чего не
 * хватает, вместо пустого списка причин: пустой список читался бы как
 * «причин не было».
 */
export default async function AnalyticsPage({ params }: PageProps<'/org/[slug]/analytics'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  // Чужая организация неотличима от несуществующей — и это намеренно
  // (ADR-003): отказ подтверждал бы, что такой адрес занят.
  if (!org) notFound();

  const [factsRes, coverageRes, observationsRes] = await Promise.all([
    loadReleaseFacts(supabase, org.id),
    loadSnapshotCoverage(supabase, org.id),
    loadReasonObservations(supabase, org.id),
  ]);

  const history = deliveryHistory(factsRes.facts);
  const coverage = coverageRes.coverage;
  const late = new Set(history.records.filter((r) => !r.onTime).map((r) => r.releaseId));
  const recurring = recurringCauses(observationsRes.observations, late);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div>
        <header className="">
          <p className="text-xs font-medium uppercase tracking-wide opacity-50">Аналитика</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm opacity-60">История поставки по выпущенным релизам</p>
        </header>
      </div>

      {history.released === 0 ? (
        <EmptyState
          title="Выпущенных релизов пока нет"
          description="История считается по факту выпуска: как только первый релиз получит дату выпуска, здесь появятся доля в срок и отклонения."
        />
      ) : (
        <>
          <section className="grid gap-6 rounded-2xl border border-black/10 p-5 sm:grid-cols-3 sm:p-6 dark:border-white/15">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{history.onTimePct}%</p>
              <p className="mt-1 text-sm opacity-60">
                в срок — {history.onTime} из {history.released}
              </p>
            </div>
            {/*
              Средняя задержка считается по опоздавшим, а не по всем.
              Досрочные выпуски иначе гасят опоздания: команда, которая
              через релиз то выпускает раньше, то опаздывает, получила бы
              «среднюю задержку 0» — ответ, из которого следует, что всё
              в порядке, тогда как в срок она не попадает никогда.
            */}
            <div>
              <p className="text-3xl font-semibold tabular-nums">
                {history.avgDelayDays === null ? '—' : days(history.avgDelayDays)}
              </p>
              <p className="mt-1 text-sm opacity-60">средняя задержка опоздавших</p>
            </div>
            <div>
              <p className="text-3xl font-semibold tabular-nums">
                {history.avgDeviationDays === null ? '—' : `${signed(history.avgDeviationDays)} д`}
              </p>
              <p className="mt-1 text-sm opacity-60">среднее отклонение со знаком</p>
            </div>
          </section>

          {/*
            Не выпущенные релизы стоят рядом с процентом, а не вместо него:
            отменённый релиз не опаздывает никогда, и доля «в срок» среди
            выпущенных тем лживее, чем больше релизов отменили.
          */}
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Чтобы процент читался честно
            </h2>
            <dl className="mt-3 flex flex-wrap gap-6 sm:gap-10">
              <Stat label="в работе" value={history.inFlight} />
              <Stat label="перенесено" value={history.postponed} />
              <Stat
                label="отменено"
                value={history.cancelled}
                tone={history.cancelled > 0 ? 'warn' : undefined}
              />
              {history.releasedWithoutDate > 0 ? (
                <Stat
                  label="выпущен без даты"
                  value={history.releasedWithoutDate}
                  tone="warn"
                />
              ) : null}
            </dl>
            {history.releasedWithoutDate > 0 ? (
              <p className="mt-3 max-w-prose text-sm opacity-60">
                У релизов со статусом «выпущен» нет даты выпуска. К успевшим они не
                приписаны: это расхождение в данных, и знать о нём важнее, чем получить
                процент, посчитанный на догадке.
              </p>
            ) : null}
          </section>

          {history.worstDelay ? (
            <section>
              <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
                Худший случай
              </h2>
              <p className="mt-3 text-sm">
                <span className="font-medium">{history.worstDelay.name}</span>{' '}
                <span className="opacity-60">
                  ({history.worstDelay.projectKey}) — план {history.worstDelay.plannedDate},
                  выпущен {history.worstDelay.releasedDate}
                </span>{' '}
                <span className={`font-medium tabular-nums ${DIRECTION_TONE.worse}`}>
                  +{history.worstDelay.delayDays}{' '}
                  {plural(history.worstDelay.delayDays, 'день', 'дня', 'дней')}
                </span>
              </p>
            </section>
          ) : null}

          <Dynamics records={history.records} />
        </>
      )}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
          Повторяющиеся причины задержек
        </h2>
        <div className="mt-3">
          {coverage.count === 0 ? (
            <div className="max-w-prose rounded-2xl border border-dashed border-black/15 p-4 text-sm dark:border-white/20">
              <p className="font-medium">Пока считать нечем</p>
              <p className="mt-1 opacity-70">
                Причины берутся из ежедневных снимков метрик: они хранят, что система думала
                о релизе тогда. Сейчас задачи закрыты, блокеры сняты, загрузка обнулилась, и
                пересчёт по текущему состоянию показал бы, что в прошлом всё было гладко, —
                историю, которой не было. Снимков в базе {coverage.count}.
              </p>
            </div>
          ) : (
            <Recurring recurring={recurring} coverage={coverage} />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Повторяющиеся причины и хронические узкие места (FR-37).
 *
 * Рядом с числом релизов стоит число дней: «в трёх релизах» без «сколько
 * держалось» не отличает разовый всплеск от постоянного состояния. Охват
 * снимков показан здесь же — по двум неделям истории вывод слабее, чем по
 * полугоду, и читатель должен видеть, на чём он стоит.
 */
function Recurring({
  recurring,
  coverage,
}: {
  recurring: RecurringCauses;
  coverage: SnapshotCoverage;
}) {
  return (
    <div className="flex flex-col gap-5">
      {recurring.causes.length === 0 ? (
        <p className="text-sm opacity-70">
          За период снимков ни одна причина риска не превышала порог.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {recurring.causes.map((c, i) => (
            <li
              key={c.code}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
            >
              <span className="min-w-0">
                <span className="mr-2 tabular-nums opacity-40">{i + 1}.</span>
                <span className="font-medium">{REASON_LABEL[c.code] ?? c.code}</span>
              </span>
              <span className="text-sm tabular-nums opacity-70">
                {c.releases} из {recurring.releases}{' '}
                {plural(recurring.releases, 'релиза', 'релизов', 'релизов')} · {days(c.days)}
                {c.lateReleases > 0 ? (
                  <span className="text-red-700 dark:text-red-300">
                    {' '}
                    · из них опоздало {c.lateReleases}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {recurring.bottlenecks.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">Хронические узкие места</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {recurring.bottlenecks.map((b) => (
              <li
                key={b.team}
                className="rounded-full border border-black/15 px-3 py-1 text-sm dark:border-white/20"
              >
                {b.team}
                <span className="opacity-60">
                  {' '}
                  · {b.releases} {plural(b.releases, 'релиз', 'релиза', 'релизов')}, {days(b.days)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-sm opacity-60">
        По {coverage.count} {plural(coverage.count, 'снимку', 'снимкам', 'снимкам')} метрик
        {coverage.from && coverage.to
          ? ` с ${coverage.from.slice(0, 10)} по ${coverage.to.slice(0, 10)}`
          : ''}
        . Снимок пишется раз в день по каждому открытому релизу; «дни» — сколько снимков причина
        стояла.
      </p>
    </div>
  );
}

/**
 * Динамика (FR-38).
 *
 * Полоса, а не график: отклонение в днях со знаком читается точнее
 * числом, а форма тренда на шести релизах всё равно не видна. Рисовать
 * линию по шести точкам — делать вид, что данных больше, чем есть.
 */
function Dynamics({ records }: { records: DeliveryRecord[] }) {
  const worst = Math.max(...records.map((r) => Math.abs(r.deviationDays)), 1);

  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
        Как менялись отклонения
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {records.map((r) => {
          const width = Math.round((Math.abs(r.deviationDays) / worst) * 100);
          const tone = direction(r.deviationDays, true);
          return (
            <li key={r.releaseId} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>{' '}
                  <span className="text-xs opacity-50">
                    {r.projectKey} · план {r.plannedDate} → {r.releasedDate}
                  </span>
                </span>
                <span className={`font-medium tabular-nums ${DIRECTION_TONE[tone]}`}>
                  {signed(r.deviationDays, 0)} д
                </span>
              </div>
              {/*
                Полоса от середины: вправо опоздание, влево досрочный
                выпуск. Одинаковая по длине полоса в обе стороны — это и
                есть та картина, которую среднее со знаком скрывает.
              */}
              <div className="flex h-2 items-center gap-px">
                <div className="flex h-full flex-1 justify-end">
                  {r.deviationDays < 0 ? (
                    <div
                      className="h-full rounded-l bg-emerald-600/70"
                      style={{ width: `${width}%` }}
                    />
                  ) : null}
                </div>
                <div aria-hidden className="h-full w-px bg-black/20 dark:bg-white/30" />
                <div className="flex h-full flex-1">
                  {r.deviationDays > 0 ? (
                    <div
                      className="h-full rounded-r bg-red-600/70"
                      style={{ width: `${width}%` }}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
