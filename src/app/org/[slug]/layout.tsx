import { notFound } from 'next/navigation';

import { Sidebar, type SidebarRelease } from '@/components/sidebar';
import { createClient } from '@/lib/supabase/server';

/**
 * Каркас экранов организации: боковое меню и содержимое.
 *
 * Меню собирается здесь, на сервере, потому что для него нужны данные:
 * название организации и её открытые релизы. Подсветку текущего пункта
 * делает уже клиент (`Sidebar`) — сервер в макете адреса дочерней
 * страницы не знает.
 *
 * Запросы идут от лица пользователя, и чужая организация, как и на
 * страницах, даёт «не найдено»: RLS отдаёт её пустым результатом.
 */

/** Срочные сверху: идущие, затем запланированные, затем отложенные. */
const STATUS_ORDER: Record<string, number> = { active: 0, planned: 1, postponed: 2 };

export default async function OrgLayout({ children, params }: LayoutProps<'/org/[slug]'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  if (!org) notFound();

  const { data: rows } = await supabase
    .from('releases')
    .select('id, name, status, planned_date')
    .eq('org_id', org.id)
    .in('status', ['active', 'planned', 'postponed']);

  const releases: SidebarRelease[] = (rows ?? [])
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.planned_date.localeCompare(b.planned_date),
    )
    .map((r) => ({ id: r.id, name: r.name, status: r.status }));

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <Sidebar slug={slug} orgName={org.name} releases={releases} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
