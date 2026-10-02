'use client';

import { ErrorState } from '@/components/states';

/** Ошибка аналитики (NFR-06). */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-8 sm:py-10">
      <ErrorState
        title="Не удалось собрать историю поставки"
        description="Релизы на месте — не удалось получить их с сервера. Попробуйте ещё раз."
        onRetry={reset}
      />
    </div>
  );
}
