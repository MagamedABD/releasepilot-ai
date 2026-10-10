import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PlannedDate, Readiness, RiskBadge, Stat } from '@/components/cockpit';
import { ADD_BUTTON } from '@/components/editor';
import { ReleaseEditor } from '@/components/release-editor';
import { EmptyState } from '@/components/states';
import { loadPreviousRiskByRelease } from '@/lib/data/risk-change';
import { canManage, loadRole } from '@/lib/data/role';
import { loadOrgReleases, type ReleaseWithMetrics } from '@/lib/data/snapshot';
import { riskRose } from '@/lib/notify/alerts';
import { createClient } from '@/lib/supabase/server';
import { byUrgency } from '@/lib/ui/releases';
import { RELEASE_STATUS, reasonText } from '@/lib/ui/risk';

export const metadata = { title: 'Релизы — ReleasePilot AI' };

/**
 * Список релизов организации.
 *
 * Обратите внимание, чего здесь нет: проверки «а состоит ли пользователь
 * в этой организации». Она не забыта — её делает RLS. Для постороннего
 * запрос вернёт пустой результат, и страница ответит «не найдено»,
 * а не «доступ запрещён». Разница существенна: отказ подтверждает, что
 * организация с таким адресом есть.
 */
export default async function ReleasesPage({ params, searchParams }: PageProps<'/org/[slug]'>) {
  const { slug } = await params;
  const creating = (await searchParams).release === 'new';
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!org) notFound();

  const [all, role, previousRisk, projectsRes] = await Promise.all([
    loadOrgReleases(supabase, org.id),
    loadRole(supabase, org.id),
    loadPreviousRiskByRelease(supabase, org.id),
    supabase.from('projects').select('id, name, key').eq('org_id', org.id).order('name'),
  ]);
  const releases = all.sort(byUrgency);
  const editable = canManage(role);
  const newHref = `/org/${slug}?release=new`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm opacity-60">
            Релизы{releases.length ? ` · ${releases.length}` : ''}
          </p>
        </div>
        {editable ? (
          <Link href={newHref} scroll={false} className={ADD_BUTTON}>
            + Новый релиз
          </Link>
        ) : null}
      </header>

      {releases.length === 0 ? (
        <EmptyState
          title="Релизов пока нет"
          description="Здесь появится готовность, риск и узкие места по каждому релизу. Создайте релиз или загрузите данные из трекера."
          action={
            editable ? (
              <Link href={newHref} scroll={false} className={ADD_BUTTON}>
                + Создать первый релиз
              </Link>
            ) : undefined
          }
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
              <ReleaseCard
                slug={slug}
                release={r}
                rose={riskRose(previousRisk.get(r.id)?.level ?? null, r.metrics.riskLevel)}
              />
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <ReleaseEditor
          release={null}
          orgId={org.id}
          projects={(projectsRes.data ?? []).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
          canEdit={editable}
          closeHref={`/org/${slug}`}
          afterDeleteHref={`/org/${slug}`}
          releaseBase={`/org/${slug}/release/`}
        />
      ) : null}
    </div>
  );
}

function ReleaseCard({
  slug,
  release,
  rose,
}: {
  slug: string;
  release: ReleaseWithMetrics;
  /** Уровень риска выше, чем во вчерашнем снимке (FR-44). */
  rose: boolean;
}) {
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
          <span className="flex flex-col items-end gap-1">
            <RiskBadge level={m.riskLevel} score={m.riskScore} />
            {rose ? (
              <span className="text-xs font-medium text-red-700 dark:text-red-300">
                ↑ вырос со вчера
              </span>
            ) : null}
          </span>
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
