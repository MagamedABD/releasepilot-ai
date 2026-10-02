import { Skeleton } from '@/components/states';

/** Загрузка шапки (NFR-06). Сам диалог пуст до первого вопроса. */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
