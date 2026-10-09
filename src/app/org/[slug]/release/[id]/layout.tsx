import { ReleaseNav } from '@/components/nav';
import { createClient } from '@/lib/supabase/server';

/**
 * Вкладки релиза: кокпит, задачи, сценарии, ассистент.
 *
 * Нужны, чтобы между экранами одного релиза переходить напрямую, а не
 * через кокпит. Проверки «релиз существует и лежит в этой организации»
 * здесь нет — её делают сами экраны и отвечают «не найдено»; макет без
 * имени релиза просто не рисует вкладки.
 */
export default async function ReleaseLayout({
  params,
  children,
}: LayoutProps<'/org/[slug]/release/[id]'>) {
  const { slug, id } = await params;
  const supabase = await createClient();

  const { data: release } = await supabase
    .from('releases')
    .select('name')
    .eq('id', id)
    .maybeSingle();

  return (
    <>
      {release ? <ReleaseNav slug={slug} releaseId={id} releaseName={release.name} /> : null}
      {children}
    </>
  );
}
