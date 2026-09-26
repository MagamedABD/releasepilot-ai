/**
 * Состояния загрузки, ошибки и пустоты (NFR-06).
 *
 * Вынесены в общие компоненты не ради экономии строк, а потому что иначе
 * их забывают. Экран без пустого состояния выглядит готовым ровно до того
 * момента, когда данных не окажется, — и на защите это происходит
 * непременно.
 *
 * Скелетон повторяет форму содержимого, а не крутит спиннер: иначе при
 * появлении данных вёрстка прыгает, и это заметнее самой загрузки.
 */

/** Серый прямоугольник под будущий текст или блок. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-black/10 dark:bg-white/10 ${className}`}
    />
  );
}

/**
 * Пустое состояние.
 *
 * Обязательно отвечает на два вопроса: почему пусто и что сделать дальше.
 * «Нет данных» без продолжения — тупик, в котором пользователь решает,
 * что система сломалась.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-black/15 px-6 py-16 text-center dark:border-white/20">
      <p className="text-base font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm opacity-60">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * Состояние ошибки.
 *
 * Без стектрейсов и кодов (NFR-08): пользователю они бесполезны, а
 * злоумышленнику рассказывают об устройстве системы. Кнопка повтора
 * обязательна — большинство сбоев сетевые и проходят сами.
 */
export function ErrorState({
  title = 'Не удалось загрузить данные',
  description = 'Похоже, пропала связь с сервером. Попробуйте ещё раз — обычно это временно.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-600/30 bg-red-500/5 px-6 py-12 text-center"
    >
      <p className="text-base font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm opacity-70">{description}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Повторить
        </button>
      ) : null}
    </div>
  );
}
