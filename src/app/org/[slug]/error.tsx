'use client';

import { ErrorState } from '@/components/states';

/**
 * Состояние ошибки списка релизов (NFR-06).
 *
 * Обязан быть клиентским компонентом: `reset` — функция, которую Next
 * передаёт через границу клиента, на сервере её вызвать некому.
 *
 * Объект `error` намеренно не показывается (NFR-08). Он попадает в логи
 * сервера, где нужен разработчику; на экране от текста исключения
 * пользователю пользы нет, а посторонним он рассказывает об устройстве
 * системы.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-8 sm:py-10">
      <ErrorState
        title="Не удалось загрузить релизы"
        description="Похоже, пропала связь с сервером. Данные не потеряны — попробуйте ещё раз."
        onRetry={reset}
      />
    </div>
  );
}
