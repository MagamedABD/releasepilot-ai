'use client';

import { ErrorState } from '@/components/states';

/**
 * Ошибка экрана сценариев (NFR-06).
 *
 * Отдельно от кокпита: здесь считается не только расчёт релиза, но и
 * подбор — а он прогоняет симуляцию десятки раз. Если упал он, данные
 * релиза в порядке, и пользователю важно знать, что повторить стоит
 * именно этот экран.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-8 sm:py-10">
      <ErrorState
        title="Не удалось посчитать сценарии"
        description="Состав релиза на месте — не удалось получить расчёт с сервера. Попробуйте ещё раз."
        onRetry={reset}
      />
    </div>
  );
}
