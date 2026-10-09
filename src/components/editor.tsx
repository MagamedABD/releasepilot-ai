'use client';

/**
 * Каркас форм правки: боковая панель и поля, которых нет в `form.tsx`.
 *
 * Панель, а не отдельная страница: правка задачи — короткое действие
 * посреди работы со списком, и уводить человека с отфильтрованного списка
 * ради неё значит заставить потом искать место, где он был. Открытость
 * панели живёт в адресе (`?task=…`), поэтому кнопка «назад» её закрывает,
 * а ссылкой на задачу можно поделиться.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

export function Drawer({
  title,
  subtitle,
  closeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Куда вернуться при закрытии — тот же адрес без параметра панели. */
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') router.replace(closeHref, { scroll: false });
    }
    window.addEventListener('keydown', onKey);
    // Фокус в панель: иначе Tab продолжает ходить по странице под ней.
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [router, closeHref]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) router.replace(closeHref, { scroll: false });
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-background shadow-2xl outline-none sm:border-l sm:border-black/10 sm:dark:border-white/15"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-black/10 bg-background px-5 py-4 dark:border-white/15">
          <div className="min-w-0">
            {subtitle ? (
              <p className="text-xs font-medium uppercase tracking-wide opacity-50">{subtitle}</p>
            ) : null}
            <h2 className="mt-0.5 truncate text-lg font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={() => router.replace(closeHref, { scroll: false })}
            aria-label="Закрыть"
            className={`rounded-lg px-2 py-1 text-lg leading-none opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10 ${FOCUS}`}
          >
            ×
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-6 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

const CONTROL =
  'w-full rounded-lg border bg-transparent px-3 py-2 text-base outline-none transition focus:ring-2 focus:ring-offset-1';

function frame(hasError: boolean) {
  return hasError
    ? 'border-red-500 focus:ring-red-500'
    : 'border-black/15 focus:ring-blue-500 dark:border-white/20';
}

function FieldShell({
  label,
  name,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {errors?.length ? (
        <p id={`${name}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errors.join('. ')}
        </p>
      ) : hint ? (
        <p className="text-sm opacity-60">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
  errors,
  hint,
  empty,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  errors?: string[];
  hint?: string;
  /** Подпись пустого варианта; без неё пустого варианта нет. */
  empty?: string;
}) {
  const hasError = Boolean(errors?.length);
  return (
    <FieldShell label={label} name={name} errors={errors} hint={hint}>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ''}
        aria-invalid={hasError || undefined}
        className={`${CONTROL} ${frame(hasError)}`}
      >
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  errors,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  errors?: string[];
  hint?: string;
}) {
  const hasError = Boolean(errors?.length);
  return (
    <FieldShell label={label} name={name} errors={errors} hint={hint}>
      <textarea
        id={name}
        name={name}
        rows={4}
        defaultValue={defaultValue ?? ''}
        aria-invalid={hasError || undefined}
        className={`${CONTROL} ${frame(hasError)} resize-y`}
      />
    </FieldShell>
  );
}

export function CheckField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 size-4 accent-blue-600"
      />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="block text-sm opacity-60">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Ожила ли страница: на сервере и до гидратации — нет.
 *
 * Пока React не подключился, форма отправилась бы браузером сама —
 * обычным GET на текущий адрес, со всеми полями в строке запроса. Это и
 * не сохраняет ничего, и выносит содержимое задачи в адрес и историю.
 * Неактивная до гидратации кнопка отправки отключает и Enter в полях:
 * при неактивной кнопке по умолчанию браузер форму не отправляет.
 */
const noop = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function PrimaryButton({
  children,
  pending,
  pendingLabel,
  type = 'submit',
  onClick,
}: {
  children: string;
  pending?: boolean;
  pendingLabel?: string;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  const hydrated = useHydrated();
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending || !hydrated}
      aria-busy={pending}
      className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/**
 * Удаление в два нажатия.
 *
 * Первое нажатие только спрашивает. Отдельного диалога нет намеренно:
 * подтверждение стоит на месте кнопки, и промахнуться по нему, не
 * прочитав вопроса, нельзя.
 */
export function DangerButton({
  label,
  confirmLabel,
  pending,
  armed,
  onArm,
  onConfirm,
  onCancel,
}: {
  label: string;
  confirmLabel: string;
  pending?: boolean;
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!armed) {
    return (
      <button
        type="button"
        onClick={onArm}
        className={`rounded-lg px-3 py-2 text-sm text-red-700 transition hover:bg-red-500/10 dark:text-red-300 ${FOCUS}`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={`rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60 ${FOCUS}`}
      >
        {pending ? 'Удаляем…' : confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className={`rounded-lg px-3 py-2 text-sm opacity-70 transition hover:opacity-100 ${FOCUS}`}
      >
        Отмена
      </button>
    </span>
  );
}

/** Ссылка-кнопка «добавить» в шапке экрана. */
export const ADD_BUTTON = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 ${FOCUS}`;
