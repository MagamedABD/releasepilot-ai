import { Skeleton } from '@/components/states';

/**
 * Состояние загрузки списка (NFR-06).
 *
 * Скелетон повторяет форму карточки релиза, а не показывает спиннер:
 * когда данные приедут, высота блоков не изменится и список не дёрнется.
 * Три карточки, а не одна, — иначе пустая страница с одним прямоугольником
 * читается как «ничего нет», а не как «сейчас будет».
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
        <Skeleton className="h-9 w-20" />
      </header>

      <ul className="grid gap-4" aria-label="Загрузка релизов">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-2xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-2 h-6 w-64 max-w-full" />
                <Skeleton className="mt-2 h-4 w-44" />
              </div>
              <Skeleton className="h-8 w-36 rounded-full" />
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
              </div>
              <div className="flex gap-6 sm:gap-8">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j}>
                    <Skeleton className="h-6 w-8" />
                    <Skeleton className="mt-1 h-3 w-12" />
                  </div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
