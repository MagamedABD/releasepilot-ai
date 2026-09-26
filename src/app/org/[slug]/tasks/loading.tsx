/**
 * Скелетон экрана задач.
 *
 * Повторяет раскладку: шапка, блок фильтров, затем строки. Спиннер на его
 * месте был бы короче, но при появлении данных вёрстка прыгала бы — и
 * прыжок заметнее самой загрузки.
 *
 * Строк восемь, а не одна: экран задач почти всегда приходит длинным, и
 * скелетон из одной строки обещает короткий список, после чего страница
 * дёргается вниз.
 */

import { Skeleton } from '@/components/states';

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:py-10">
      <Skeleton className="h-4 w-40" />

      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>

      <div className="grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/15">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i}>
            <Skeleton className="mb-1 h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-black/10 dark:border-white/15">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-black/5 px-4 py-3.5 last:border-0 dark:border-white/10"
          >
            <Skeleton className="h-4 w-16 shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
            <Skeleton className="hidden h-5 w-8 shrink-0 sm:block" />
            <Skeleton className="hidden h-4 w-24 shrink-0 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
