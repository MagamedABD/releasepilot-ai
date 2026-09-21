import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OrganizationForm } from './form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Новая организация — ReleasePilot AI' };

export default async function OnboardingPage() {
  const supabase = await createClient();

  // Проверять здесь, есть ли уже организация, а не только в proxy:
  // proxy знает лишь, вошёл ли человек. Вернувшегося пользователя
  // с готовой организацией незачем спрашивать, как её назвать.
  //
  // Запрос идёт от лица пользователя, и RLS сам ограничивает выборку
  // его организациями — фильтр по user_id тут был бы не защитой,
  // а её имитацией.
  const { data: memberships } = await supabase
    .from('memberships')
    .select('organizations(slug)')
    .order('created_at', { ascending: true })
    .limit(1);

  const existing = memberships?.[0]?.organizations?.slug;
  if (existing) redirect(`/org/${existing}`);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">Создайте организацию</h1>
        <p className="mb-6 text-sm opacity-60">
          Это рабочее пространство команды: релизы, задачи и прогнозы живут внутри него.
        </p>

        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-white/5">
          <OrganizationForm />
        </div>
      </div>
    </div>
  );
}
