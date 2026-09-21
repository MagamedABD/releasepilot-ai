import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Корень приложения — развилка, а не страница.
 *
 * Дойти сюда может только вошедший: гостей proxy заворачивает на /login.
 * Дальше два случая — организация уже есть, тогда сразу в кокпит, или её
 * нет, тогда в онбординг. Показывать вместо этого приветственный экран
 * с кнопкой «перейти» значит добавить лишний клик к каждому входу.
 */
export default async function Home() {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from('memberships')
    .select('organizations(slug)')
    .order('created_at', { ascending: true })
    .limit(1);

  const slug = memberships?.[0]?.organizations?.slug;
  redirect(slug ? `/org/${slug}` : '/onboarding');
}
