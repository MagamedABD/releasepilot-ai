'use client';

import { useFormStatus } from 'react-dom';

/**
 * Поле ввода с подписью и сообщением об ошибке.
 *
 * Ошибка связана с полем через aria-describedby, а не просто нарисована
 * рядом: без этого пользователь экранного диктора услышит «поле почта»
 * и не узнает, что с ним что-то не так.
 */
export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  placeholder,
  defaultValue,
  value,
  onChange,
  prefix,
  errors,
  hint,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Управляемое значение — для полей, которые заполняются сами. */
  value?: string;
  onChange?: (value: string) => void;
  /** Неизменяемая приставка слева, например адрес сайта перед именем. */
  prefix?: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
}) {
  const hasError = Boolean(errors?.length);
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  const frame = [
    'flex items-center rounded-lg border text-base transition',
    'focus-within:ring-2 focus-within:ring-offset-1',
    hasError
      ? 'border-red-500 focus-within:ring-red-500'
      : 'border-black/15 focus-within:ring-brand dark:border-white/20',
  ].join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {/* Рамку рисует обёртка, а не сам input: иначе приставку слева
          некуда поместить, не разорвав поле надвое визуально. */}
      <div className={frame}>
        {prefix ? (
          <span className="select-none py-2 pl-3 text-base opacity-50">{prefix}</span>
        ) : null}
        <input
          id={name}
          name={name}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : hint ? hintId : undefined}
          className={[
            'w-full bg-transparent py-2 pr-3 outline-none',
            prefix ? 'pl-0.5' : 'pl-3',
          ].join(' ')}
        />
      </div>
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errors!.join('. ')}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm opacity-60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Кнопка отправки, знающая о состоянии формы.
 *
 * useFormStatus берёт признак отправки у ближайшей формы, поэтому
 * состояние загрузки не надо хранить и передавать вручную. Кнопка
 * блокируется — это и есть защита от повторной отправки: иначе
 * нетерпеливый двойной клик создаёт две организации вместо одной.
 */
export function SubmitButton({ children, pendingLabel }: { children: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-2 rounded-lg bg-brand px-4 py-2.5 font-medium text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Общая ошибка формы — та, что не относится ни к одному полю. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
    >
      {message}
    </p>
  );
}

/** Сообщение об успехе, когда перехода никуда не происходит. */
export function FormNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-800 dark:text-green-300"
    >
      {message}
    </p>
  );
}
