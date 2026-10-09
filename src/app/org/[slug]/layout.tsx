import { notFound } from 'next/navigation';

import { AppNav, type NavRelease } from '@/components/nav';
import { createClient } from '@/lib/supabase/server';
import { byStatus } from '@/lib/ui/releases';

/**
 * Каркас всех экранов организации: меню сверху, экран под ним.
 *
 * Список релизов здесь — только для поиска и меню: имя, статус, проект.
 * Метрики не считаются, это дело самих экранов; меню не должно замедлять
 * каждый переход ради чисел, которые оно не показывает.
 *
 * Чужая организация отвечает «не найдено» по той же причине, что и
 * экраны: RLS вернёт пусто, а отказ подтвердил бы, что адрес занят.
 */
export default async function OrgLayout({ params, children }: LayoutProps<'/org/[slug]'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  if (!org) notFound();

  const { data } = await supabase
    .from('releases')
    .select('id, name, status, planned_date, projects(key)')
    .eq('org_id', org.id);

  const releases: NavRelease[] = (data ?? [])
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      plannedDate: r.planned_date,
      projectKey: (r.projects as { key: string } | null)?.key ?? '—',
    }))
    .sort(byStatus);

  return (
    <>
      <AppNav slug={slug} orgName={org.name} releases={releases} />
      {children}
    </>
  );
}
