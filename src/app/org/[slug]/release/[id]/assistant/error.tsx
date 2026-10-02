'use client';

import { ErrorState } from '@/components/states';

/**
 * Ошибка экрана ассистента (NFR-06).
 *
 * Сюда попадает только отказ самой страницы — расчёт шапки. Отказ
 * ассистента страницу не ломает: он показывается сообщением внутри
 * диалога, потому что остальное приложение при недоступной модели обязано
 * работать полностью (NFR-07).
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-8 sm:py-10">
      <ErrorState
        title="Не удалось открыть диалог"
        description="Данные релиза на месте — не удалось получить их с сервера. Попробуйте ещё раз."
        onRetry={reset}
      />
    </div>
  );
}
