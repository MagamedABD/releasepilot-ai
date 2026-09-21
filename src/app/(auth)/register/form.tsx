'use client';

import { useActionState } from 'react';

import { register } from '../actions';
import { Field, FormError, FormNotice, SubmitButton } from '@/components/form';
import type { FormState } from '@/lib/validation/auth';

const EMPTY: FormState = {};

export function RegisterForm() {
  const [state, action] = useActionState(register, EMPTY);

  // Письмо ушло — форму показывать незачем: повторная отправка создаст
  // второе письмо и сомнение, по какой из ссылок идти.
  if (state.notice) {
    return <FormNotice message={state.notice} />;
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />

      <Field
        label="Имя"
        name="fullName"
        autoComplete="name"
        placeholder="Магамед Абдуллаев"
        errors={state.fields?.fullName}
        required
      />
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
        autoComplete="new-password"
        hint="Не короче восьми символов"
        errors={state.fields?.password}
        required
      />

      <SubmitButton pendingLabel="Создаём…">Создать аккаунт</SubmitButton>
    </form>
  );
}
