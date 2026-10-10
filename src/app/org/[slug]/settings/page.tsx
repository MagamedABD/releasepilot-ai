import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AbsencesSection,
  ImportSection,
  TeamsSection,
  TrackerImportSection,
  type SettingsAbsence,
  type SettingsTeam,
} from '@/components/settings';
import { RISK_CONFIG } from '@/domain/config';
import { netCapacity } from '@/domain/capacity';
import { canManage, loadRole } from '@/lib/data/role';
import { isCorporate } from '@/lib/env.server';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Настройки — ReleasePilot AI' };

const TABS = [
  { key: 'teams', label: 'Команды и ёмкость' },
  { key: 'absences', label: 'Отсутствия' },
  { key: 'import', label: 'Импорт' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Импорт запускают только admin и выше — так требует политика import_runs. */
const IMPORTERS = new Set(['owner', 'admin']);

/**
 * Настройки организации (экран 8 из ТЗ): команды и их состав, ёмкость по
 * периодам, отсутствия, импорт задач.
 *
 * Смотреть может любой участник — это те же данные, из которых считается
 * загрузка в кокпите, и человеку полезно видеть, откуда взялись 173%.
 * Править — менеджер и выше; кнопок правки остальные не видят, а запись в
 * любом случае закрывает RLS.
 */
export default async function SettingsPage({ params, searchParams }: PageProps<'/org/[slug]/settings'>) {
  const { slug } = await params;
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'teams';
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  if (!org) notFound();

  const [role, teamsRes, membersRes, capacityRes, peopleRes, absencesRes, projectsRes] =
    await Promise.all([
      loadRole(supabase, org.id),
      supabase.from('teams').select('id, name, kind').eq('org_id', org.id).order('name'),
      supabase.from('team_members').select('team_id, profile_id, allocation_pct').eq('org_id', org.id),
      supabase
        .from('team_capacity')
        .select('team_id, period_start, period_end, available_hours')
        .eq('org_id', org.id)
        .order('period_start', { ascending: false }),
      supabase.from('memberships').select('user_id, profiles(full_name)').eq('org_id', org.id),
      supabase
        .from('absences')
        .select('id, profile_id, start_date, end_date, reason')
        .eq('org_id', org.id)
        .order('start_date', { ascending: false }),
      supabase.from('projects').select('id, name, key').eq('org_id', org.id).order('name'),
    ]);

  // Ошибка чтения — состояние экрана, его покажет error.tsx (NFR-06, NFR-08).
  if (teamsRes.error || capacityRes.error) throw new Error('Не удалось загрузить настройки');

  const name = new Map(
    (peopleRes.data ?? []).map((p) => [
      p.user_id,
      (p.profiles as { full_name: string | null } | null)?.full_name || 'Без имени',
    ]),
  );
  const people = [...name]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  const members = (membersRes.data ?? []).map((m) => ({
    teamId: m.team_id,
    profileId: m.profile_id,
    allocationPct: m.allocation_pct,
  }));
  const absenceRows = (absencesRes.data ?? []).map((a) => ({
    profileId: a.profile_id,
    startDate: a.start_date,
    endDate: a.end_date,
  }));

  const nominal = (capacityRes.data ?? []).map((c) => ({
    teamId: c.team_id,
    periodStart: c.period_start,
    periodEnd: c.period_end,
    availableHours: Number(c.available_hours),
  }));
  // Та же функция, что в расчёте: экран показывает ровно те часы, которые
  // видит движок, а не свою версию вычета.
  const net = netCapacity(nominal, members, absenceRows, RISK_CONFIG.workingHoursPerDay);

  const teams: SettingsTeam[] = (teamsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    members: members
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ profileId: m.profileId, name: name.get(m.profileId) ?? 'Без имени', allocationPct: m.allocationPct }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    capacity: nominal
      .map((c, i) => ({ ...c, netHours: net[i].availableHours }))
      .filter((c) => c.teamId === t.id),
  }));

  const absences: SettingsAbsence[] = (absencesRes.data ?? []).map((a) => ({
    id: a.id,
    name: name.get(a.profile_id) ?? 'Без имени',
    startDate: a.start_date,
    endDate: a.end_date,
    reason: a.reason,
  }));

  const editable = canManage(role);
  const canImport = role !== null && IMPORTERS.has(role);
  const projectOptions = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: `${p.key} · ${p.name}`,
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:py-10">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide opacity-50">Настройки</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{org.name}</h1>
        {!editable ? (
          <p className="mt-1 text-sm opacity-60">
            Менять настройки может менеджер, администратор или владелец. Вам доступен просмотр.
          </p>
        ) : null}
      </header>

      <nav aria-label="Разделы настроек" className="-mx-4 flex gap-1 overflow-x-auto border-b border-black/10 px-4 dark:border-white/15">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/org/${slug}/settings${t.key === 'teams' ? '' : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              tab === t.key ? 'border-foreground font-medium' : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'teams' ? (
        <TeamsSection
          orgId={org.id}
          teams={teams}
          people={people}
          canEdit={editable}
          today={new Date().toISOString().slice(0, 10)}
        />
      ) : tab === 'absences' ? (
        <AbsencesSection orgId={org.id} absences={absences} people={people} canEdit={editable} />
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">Из файла</h2>
            <ImportSection projects={projectOptions} canImport={canImport} />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-50">
              Из Yandex Tracker
            </h2>
            <TrackerImportSection
              projects={projectOptions}
              canImport={canImport}
              available={isCorporate}
            />
          </section>
        </div>
      )}
    </div>
  );
}
