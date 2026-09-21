/**
 * Оболочка страниц входа и регистрации.
 *
 * Скобки в имени папки — группа маршрутов: она нужна, чтобы дать этим
 * страницам общий вид, но не добавлять сегмент в адрес. Страница лежит
 * в (auth)/login, а открывается как /login — и список PUBLIC_PATHS
 * в proxy.ts менять не приходится.
 */

import Link from 'next/link';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center">
          <span className="text-lg font-semibold tracking-tight">ReleasePilot AI</span>
          <span className="mt-1 block text-sm opacity-60">Управление релизами</span>
        </Link>

        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-white/5">
          {children}
        </div>
      </div>
    </div>
  );
}
