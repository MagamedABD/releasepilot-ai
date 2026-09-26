import { Skeleton } from '@/components/states';

/** Скелетон кокпита: та же раскладка, что и у готовой страницы (NFR-06). */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:py-10">
      <div>
        <Skeleton className="h-4 w-28" />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-8 w-72 max-w-full" />
            <Skeleton className="mt-2 h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-36 rounded-full" />
        </div>
      </div>

      <section className="grid gap-6 rounded-2xl border border-black/10 p-5 sm:grid-cols-2 sm:p-6 dark:border-white/15">
        <div>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          <Skeleton className="mt-2 h-3 w-36" />
        </div>
        <div className="flex flex-wrap items-end gap-6 sm:justify-end sm:gap-8">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-6 w-12" />
              <Skeleton className="mt-1 h-3 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <Skeleton className="h-3 w-20" />
        <div className="mt-3 flex flex-wrap gap-6 sm:gap-10">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <Skeleton className="h-6 w-8" />
              <Skeleton className="mt-1 h-3 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <Skeleton className="h-3 w-36" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </section>
    </div>
  );
}
