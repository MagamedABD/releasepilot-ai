import Link from 'next/link';
import { notFound } from 'next/navigation';

import { logout } from '@/app/(auth)/actions';
import { PlannedDate, Readiness, RiskBadge, Stat } from '@/components/cockpit';
import { EmptyState } from '@/components/states';
import { loadOrgReleases, type ReleaseWithMetrics } from '@/lib/data/snapshot';
import { createClient } from '@/lib/supabase/server';
import { RELEASE_STATUS, reasonText } from '@/lib/ui/risk';

export const metadata = { title: 'Релизы — ReleasePilot AI' };

/**
 * Порядок релизов на экране.
 *
 * Не по дате. Менеджер открывает список, чтобы узнать, где горит, а не
 * чтобы посмотреть календарь. Поэтому сверху идут идущие релизы, ниже
 * запланированные, в самом низу выпущенные и отменённые — про них решение
 * уже принято.
 *
 * Внутри группы — по скору, а не по уровню. Уровень грубый: два релиза
 * могут оба оказаться «высокими» при скорах 39 и 8, и тогда список,
 * отсортированный по уровню, поставит их рядом как равные. Скор разводит.
 */
const STATUS_ORDER: Record<string, number> = {
  active: 0,
  planned: 1,
  postponed: 2,
  released: 3,
  cancelled: 4,
};

function byUrgency(a: ReleaseWithMetrics, b: ReleaseWithMetrics): number {
  const order = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (order !== 0) return order;
  const score = b.metrics.riskScore - a.metrics.riskScore;
  if (score !== 0) return score;
  return a.plannedDate.localeCompare(b.plannedDate);
}

/**
 * Список релизов организации.
 *
 * Обратите внимание, чего здесь нет: проверки «а состоит ли пользователь
 * в этой организации». Она не забыта — её делает RLS. Для постороннего
 * запрос вернёт пустой результат, и страница ответит «не найдено»,
 * а не «доступ запрещён». Разница существенна: отказ подтверждает, что
 * организация с таким адресом есть.
 */
export default async function ReleasesPage({ params }: PageProps<'/org/[slug]'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!org) notFound();

  const releases = (await loadOrgReleases(supabase, org.id)).sort(byUrgency);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm opacity-60">
            Релизы{releases.length ? ` · ${releases.length}` : ''}
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Выйти
          </button>
        </form>
      </header>

      {releases.length === 0 ? (
        <EmptyState
          title="Релизов пока нет"
          description="Здесь появится готовность, риск и узкие места по каждому релизу. Создайте релиз или загрузите данные из трекера."
        />
      ) : (
        /*
          `min-w-0` на элементе списка обязателен, и это не подстраховка.
          У элемента grid по умолчанию `min-width: auto`, то есть он не
          сжимается уже своего min-content. Заголовок карточки обрезается
          через `truncate`, а это `white-space: nowrap`, и его min-content
          равен полной ширине названия релиза. Без обнуления длинное имя
          распирает карточку, и на узком экране появляется горизонтальная
          прокрутка — при том что сам `truncate` выглядит рабочим.
        */
        <ul className="grid gap-4">
          {releases.map((r) => (
            <li key={r.id} className="min-w-0">
              <ReleaseCard slug={slug} release={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReleaseCard({ slug, release }: { slug: string; release: ReleaseWithMetrics }) {
  const m = release.metrics;
  const done = release.status === 'released' || release.status === 'cancelled';
  // Главная причина — та, что даёт наибольший вклад. Движок уже отсортировал.
  const top = m.reasons[0];

  return (
    <Link
      href={`/org/${slug}/release/${release.id}`}
      className="block rounded-2xl border border-black/10 p-5 transition hover:border-black/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/15 dark:hover:border-white/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide opacity-50">
            {release.projectKey} · {RELEASE_STATUS[release.status] ?? release.status}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold">{release.name}</h2>
          <p className="mt-1 text-sm opacity-60">
            План:{' '}
            <PlannedDate
              date={release.plannedDate}
              workingDays={done ? undefined : m.remainingWorkingDays}
            />
          </p>
        </div>
        {done ? (
          <span className="rounded-full border border-black/15 px-3 py-1 text-sm opacity-60 dark:border-white/20">
            {RELEASE_STATUS[release.status]}
          </span>
        ) : (
          <RiskBadge level={m.riskLevel} score={m.riskScore} />
        )}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Readiness pct={m.readinessPct} byCountPct={m.readinessByCountPct} compact />

        <dl className="flex gap-6 text-left sm:gap-8">
          <Stat label="всего" value={m.counts.total} />
          <Stat label="готово" value={m.counts.done} />
          <Stat label="в работе" value={m.counts.inProgress} />
          <Stat label="блок" value={m.counts.blocked} tone="warn" />
        </dl>
      </div>

      {top && !done ? (
        <p className="mt-4 border-t border-black/10 pt-3 text-sm opacity-70 dark:border-white/10">
          {reasonText(top)}
          {m.reasons.length > 1 ? (
            <span className="opacity-60"> · и ещё {m.reasons.length - 1}</span>
          ) : null}
        </p>
      ) : null}
    </Link>
  );
}
