import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from './form';
import { FormError } from '@/components/form';

export const metadata: Metadata = { title: 'Вход — ReleasePilot AI' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // В Next 16 searchParams — промис: страница может начать рендериться
  // раньше, чем станут известны параметры запроса.
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/';

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Вход</h1>
      <p className="mb-6 text-sm opacity-60">Продолжите работу со своими релизами</p>

      {params.error === 'link' ? (
        <div className="mb-4">
          <FormError message="Ссылка из письма больше не действует. Войдите по почте и паролю." />
        </div>
      ) : null}

      <LoginForm next={next} />

      <p className="mt-6 text-center text-sm opacity-70">
        Нет аккаунта?{' '}
        <Link href="/register" className="font-medium text-white underline-offset-4 hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </>
  );
}
