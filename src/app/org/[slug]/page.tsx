import { notFound } from 'next/navigation';

import { logout } from '@/app/(auth)/actions';
import { createClient } from '@/lib/supabase/server';

/**
 * Кокпит организации. Пока заглушка: нужна точка, куда возвращаться
 * после входа, и место, где будет видно, что разграничение работает.
 *
 * Обратите внимание, чего здесь нет: проверки «а состоит ли пользователь
 * в этой организации». Она не забыта — её делает RLS. Для постороннего
 * запрос вернёт пустой результат, и страница ответит «не найдено»,
 * а не «доступ запрещён». Разница существенна: отказ подтверждает, что
 * организация с таким адресом есть.
 */
export default async function CockpitPage({ params }: PageProps<'/org/[slug]'>) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!org) notFound();

  const { count: releaseCount } = await supabase
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm opacity-60">/org/{org.slug}</p>
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

      {releaseCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 px-6 py-16 text-center dark:border-white/20">
          <p className="text-base font-medium">Релизов пока нет</p>
          <p className="mx-auto mt-2 max-w-md text-sm opacity-60">
            Здесь появится готовность, риск и узкие места по каждому релизу. Следующий шаг —
            загрузка данных и первый релиз.
          </p>
        </div>
      ) : (
        <p className="text-sm opacity-60">Релизов: {releaseCount}</p>
      )}
    </div>
  );
}
