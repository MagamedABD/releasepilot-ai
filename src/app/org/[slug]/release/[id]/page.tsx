import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PlannedDate, Readiness, RiskBadge, Stat, TeamLoadBars } from '@/components/cockpit';
import { calculateRelease } from '@/domain/risk';
import { loadReleaseSnapshot } from '@/lib/data/snapshot';
import { createClient } from '@/lib/supabase/server';
import { RELEASE_STATUS, RISK_LEVEL, days, hours, plural, reasonHref, reasonText, reasonWeight } from '@/lib/ui/risk';
import type { Task } from '@/domain/types';

export const metadata = { title: 'Релиз — ReleasePilot AI' };

/**
 * Кокпит релиза (экран 1 концепции интерфейса).
 *
 * Порядок блоков повторяет порядок вопросов менеджера, а не структуру
 * данных: сначала вывод — уровень риска и готовность рядом, потому что
 * поодиночке они лгут (78% готовности выглядят спокойно, пока не видно,
 * что риск высокий). Только ниже идут числа, из которых вывод получен,
 * и в самом низу — подробности по блокерам и командам.
 *
 * Проверки членства в организации здесь нет по той же причине, что и в
 * списке: её делает RLS, и для постороннего запрос вернёт пусто, а
 * страница — «не найдено». Отказ вместо пустоты подтвердил бы, что релиз
 * с таким идентификатором существует.
 */
export default async function ReleasePage({ params }: PageProps<'/org/[slug]/release/[id]'>) {
  const { slug, id } = await params;
  const supabase = await createClient();

  // Строка релиза и снимок независимы — берём разом. Снимок не содержит
  // статуса и проекта: движку они не нужны, а экрану нужны.
  const [releaseRes, snapshot] = await Promise.all([
    supabase
      .from('releases')
      .select('id, name, status, planned_date, released_at, projects(key), organizations(slug)')
      .eq('id', id)
      .maybeSingle(),
    loadReleaseSnapshot(supabase, id),
  ]);

  const release = releaseRes.data;
  if (!release || !snapshot) notFound();

  // Релиз существует, но лежит в другой организации: адрес собран вручную
  // или остался от переезда. Для пользователя это «не найдено» — по этому
  // адресу действительно ничего нет.
  if ((release.organizations as { slug: string } | null)?.slug !== slug) notFound();

  const m = calculateRelease(snapshot);
  const done = release.status === 'released' || release.status === 'cancelled';
  const byId = new Map<string, Task>(snapshot.tasks.map((t) => [t.id, t]));
  const projectKey = (release.projects as { key: string } | null)?.key ?? '—';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div>
        <Link
          href={`/org/${slug}`}
          className="text-sm opacity-60 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          ← Все релизы
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide opacity-50">
              {projectKey} · {RELEASE_STATUS[release.status] ?? release.status}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{release.name}</h1>
            <p className="mt-1 text-sm opacity-60">
              План:{' '}
              <PlannedDate
                date={release.planned_date}
                workingDays={done ? undefined : m.remainingWorkingDays}
              />
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {done ? (
              <span className="rounded-full border border-black/15 px-3 py-1 text-sm opacity-60 dark:border-white/20">
                {RELEASE_STATUS[release.status]}
              </span>
            ) : (
              <RiskBadge level={m.riskLevel} score={m.riskScore} />
            )}
            {/*
              Ссылка на сценарии стоит рядом с уровнем риска намеренно:
              вопрос «что с этим делать» возникает ровно в тот момент,
              когда человек увидел, что риск высокий.
            */}
            <Link
              href={`/org/${slug}/release/${id}/scenarios`}
              className="text-sm underline decoration-dotted underline-offset-4 opacity-70 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Сценарии и подбор →
            </Link>
            <Link
              href={`/org/${slug}/release/${id}/assistant`}
              className="text-sm underline decoration-dotted underline-offset-4 opacity-70 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Спросить ассистента →
            </Link>
          </div>
        </header>
      </div>

      {/*
        Готовность и трудозатраты рядом. Проценты без часов позволяют
        обмануть себя: 78% от сорока часов и от четырёхсот — разные новости.
      */}
      <section className="grid gap-6 rounded-2xl border border-black/10 p-5 sm:grid-cols-2 sm:p-6 dark:border-white/15">
        <Readiness pct={m.readinessPct} byCountPct={m.readinessByCountPct} />
        <dl className="flex flex-wrap items-end gap-6 sm:justify-end sm:gap-8">
          <Stat label="часов всего" value={Math.round(m.effort.totalH)} />
          <Stat label="сделано" value={Math.round(m.effort.doneH)} />
          <Stat label="осталось" value={Math.round(m.effort.remainingH)} />
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">Задачи</h2>
        <dl className="mt-3 flex flex-wrap gap-6 sm:gap-10">
          <Stat label="всего" value={m.counts.total} />
          <Stat label="готово" value={m.counts.done} />
          <Stat label="в работе" value={m.counts.inProgress} />
          <Stat label="тестирование" value={m.counts.testing} />
          <Stat label="заблокировано" value={m.counts.blocked} tone="warn" />
          <Stat label="отменено" value={m.counts.cancelled} />
        </dl>
      </section>

      {done ? null : (
        <>
          <Reasons metrics={m} slug={slug} releaseId={release.id} />
          <Blockers metrics={m} byId={byId} />

          <section>
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Загрузка команд
            </h2>
            <div className="mt-3">
              <TeamLoadBars loads={m.teamLoad} />
            </div>
          </section>

          <Details metrics={m} />
        </>
      )}
    </div>
  );
}

type Metrics = ReturnType<typeof calculateRelease>;

/**
 * «Почему риск такой».
 *
 * Причины отсортированы движком по вкладу, и порядок сохраняется как есть:
 * менеджер читает сверху вниз и первой видит ту, с которой имеет смысл
 * начать. У правил эскалации вклад нулевой — вместо «вклад 0» подписано,
 * что правило поднимает уровень, иначе строка выглядела бы безобидной.
 *
 * Причина, за которой стоит конкретная выборка задач, ведёт на неё ссылкой:
 * прочитав «2 задачи заблокированы», менеджер захочет увидеть эти две, и
 * повторять фильтр руками он не должен. Ссылка есть не у каждой строки —
 * см. `reasonHref`.
 */
function Reasons({
  metrics,
  slug,
  releaseId,
}: {
  metrics: Metrics;
  slug: string;
  releaseId: string;
}) {
  if (metrics.reasons.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">Причины риска</h2>
        <p className="mt-3 text-sm opacity-60">
          Ни один фактор не превысил порог. Скор {metrics.riskScore} — риск держится на общем
          остатке работ.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
        Почему риск {RISK_LEVEL[metrics.riskLevel].label}
      </h2>
      <ol className="mt-3 space-y-2">
        {metrics.reasons.map((r, i) => {
          const href = reasonHref(r, slug, releaseId);

          return (
            <li
              key={`${r.code}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
            >
              <span className="text-sm">
                <span className="mr-2 opacity-40">{i + 1}</span>
                {href ? (
                  <Link href={href} className="underline underline-offset-4 hover:opacity-70">
                    {reasonText(r)}
                  </Link>
                ) : (
                  reasonText(r)
                )}
              </span>
              <span className="text-xs opacity-50">{reasonWeight(r)}</span>
            </li>
          );
        })}
      </ol>
      {metrics.riskLevel === metrics.riskLevelByScore ? null : (
        <p className="mt-2 text-xs opacity-50">
          По скору уровень был бы другим — его поднял сработавший порог, а не сумма факторов.
        </p>
      )}
    </section>
  );
}

/**
 * Блокеры.
 *
 * Длительность блокировки важнее самого факта: задача, стоящая час, и
 * задача, стоящая неделю, требуют разных действий. Поэтому в строке —
 * дни, а не галочка (концепция интерфейса, экран 2).
 */
function Blockers({ metrics, byId }: { metrics: Metrics; byId: Map<string, Task> }) {
  if (metrics.blockers.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
        Блокеры · {metrics.blockers.length}
      </h2>
      <ul className="mt-3 space-y-2">
        {metrics.blockers.map((b) => {
          const task = byId.get(b.taskId);
          return (
            <li
              key={b.taskId}
              className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="rounded border border-black/15 px-1.5 py-0.5 text-xs font-medium dark:border-white/20">
                  {b.priority}
                </span>
                <span className="text-sm font-medium">{task?.key ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate text-sm opacity-70">
                  {task?.title ?? 'Задача вне снимка'}
                </span>
              </div>
              <p className="mt-1.5 text-xs opacity-60">
                Стоит {days(b.blockedDays)}
                {b.isStale ? <span className="text-orange-600 dark:text-orange-400"> · застарелый</span> : null}
                {b.blocksCount > 0
                  ? ` · держит ${b.blocksCount} ${plural(b.blocksCount, 'задачу', 'задачи', 'задач')}`
                  : ' · никого не держит'}
                {` · ${hours(b.estimateH)}`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Три расчёта, которые иначе остались бы только внутри скора.
 *
 * Они выведены отдельно потому, что менеджер проверяет ими доверие к
 * оценке: цифру, которую нельзя разложить, на статусной встрече защищать
 * нечем.
 */
function Details({ metrics: m }: { metrics: Metrics }) {
  return (
    <section className="grid gap-4 sm:grid-cols-3">
      <Detail
        title="Критическая цепочка"
        value={days(m.criticalChain.days)}
        note={`${m.criticalChain.taskIds.length} ${plural(m.criticalChain.taskIds.length, 'задача', 'задачи', 'задач')} подряд · ${days(m.remainingWorkingDays)} до даты`}
      />
      <Detail
        title="Воронка тестирования"
        value={hours(m.qaFunnel.requiredH)}
        note={`при ёмкости ${hours(m.qaFunnel.capacityH)} · ${Math.round(m.qaFunnel.share * 100)}% работ релиза`}
      />
      <Detail
        title="Дрейф объёма"
        value={hours(m.scopeDrift.addedH)}
        note={`добавлено после старта · ${Math.round(m.scopeDrift.share * 100)}% объёма`}
      />
    </section>
  );
}

function Detail({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/15">
      <p className="text-xs font-medium uppercase tracking-wide opacity-50">{title}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs opacity-60">{note}</p>
    </div>
  );
}
