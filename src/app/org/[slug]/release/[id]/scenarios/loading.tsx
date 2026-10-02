import { Skeleton } from '@/components/states';

/**
 * Загрузка (NFR-06).
 *
 * Скелетон той же формы, что и содержимое: заголовок, блок подбора,
 * форма. Иначе при появлении данных страница скачет, и это читается как
 * сбой, хотя всё в порядке.
 *
 * Ждать здесь приходится дольше, чем на других экранах, и это не
 * недоработка: подбор прогоняет симуляцию по каждому кандидату, а каждая
 * симуляция — это два расчёта релиза с Монте-Карло.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="h-36 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
