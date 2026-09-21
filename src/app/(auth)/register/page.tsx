import type { Metadata } from 'next';
import Link from 'next/link';

import { RegisterForm } from './form';

export const metadata: Metadata = { title: 'Регистрация — ReleasePilot AI' };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Регистрация</h1>
      <p className="mb-6 text-sm opacity-60">Минута — и можно заводить первый релиз</p>

      <RegisterForm />

      <p className="mt-6 text-center text-sm opacity-70">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
          Войти
        </Link>
      </p>
    </>
  );
}
