'use client';

import { useActionState } from 'react';

import { login } from '../actions';
import { Field, FormError, SubmitButton } from '@/components/form';
import type { FormState } from '@/lib/validation/auth';

const EMPTY: FormState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(login, EMPTY);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {/* Куда вернуть после входа. Значение проверяется на сервере:
          всё, что пришло из браузера, до проверки недостоверно. */}
      <input type="hidden" name="next" value={next} />

      <FormError message={state.error} />

      <Field
        label="Почта"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        errors={state.fields?.email}
        required
      />
      <Field
        label="Пароль"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state.fields?.password}
        required
      />

      <SubmitButton pendingLabel="Входим…">Войти</SubmitButton>
    </form>
  );
}
