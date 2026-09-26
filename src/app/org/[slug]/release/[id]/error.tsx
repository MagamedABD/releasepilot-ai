'use client';

import { ErrorState } from '@/components/states';

/**
 * Ошибка кокпита (NFR-06).
 *
 * Отдельный файл, а не наследование верхнего: расчёт метрик — самое
 * тяжёлое место страницы, и упасть он может там, где список уже
 * отрисовался. Пользователю важно знать, что сломался именно этот
 * релиз, а не вся организация.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-8 sm:py-10">
      <ErrorState
        title="Не удалось посчитать метрики релиза"
        description="Данные релиза на месте — не удалось получить их с сервера. Попробуйте ещё раз."
        onRetry={reset}
      />
    </div>
  );
}
