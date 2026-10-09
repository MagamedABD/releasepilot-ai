import { notFound, redirect } from 'next/navigation';

import { loadOrgReleases } from '@/lib/data/snapshot';
import { createClient } from '@/lib/supabase/server';
import { byUrgency } from '@/lib/ui/releases';

/**
 * Кнопка «AI-ассистент» из меню, когда релиз не выбран.
 *
 * Ассистент всегда разбирает конкретный релиз, поэтому отдельного экрана
 * «ассистент вообще» нет: человек попадает в диалог по самому горящему
 * релизу — тому, что стоит первым в списке. Из кокпита релиза меню ведёт
 * сразу в его ассистента, сюда не заходя.
 */
export default async function AssistantEntry({ params }: PageProps<'/org/[slug]/assistant'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!org) notFound();

  const [top] = (await loadOrgReleases(supabase, org.id)).sort(byUrgency);
  redirect(top ? `/org/${slug}/release/${top.id}/assistant` : `/org/${slug}`);
}
