'use client';

import { useActionState, useState } from 'react';

import { createOrganization } from './actions';
import { Field, FormError, SubmitButton } from '@/components/form';
import { slugify } from '@/lib/slug';
import type { FormState } from '@/lib/validation/auth';

const EMPTY: FormState = {};

export function OrganizationForm() {
  const [state, action] = useActionState(createOrganization, EMPTY);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Пока человек не трогал адрес, он следует за названием. Как только
  // тронул — перестаёт: затирать то, что пользователь напечатал сам,
  // хуже, чем не подсказать вовсе.
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />

      <Field
        label="Название организации"
        name="name"
        placeholder="Платёжный шлюз"
        value={name}
        onChange={(v) => {
          setName(v);
          if (!slugEdited) setSlug(slugify(v));
        }}
        errors={state.fields?.name}
        required
      />

      <Field
        label="Адрес"
        name="slug"
        prefix="/org/"
        placeholder="platezhnyy-shlyuz"
        value={slug}
        onChange={(v) => {
          setSlugEdited(true);
          setSlug(slugify(v));
        }}
        hint="Латиница, цифры и дефис. Виден в ссылках на релизы."
        errors={state.fields?.slug}
        required
      />

      <SubmitButton pendingLabel="Создаём…">Создать организацию</SubmitButton>
    </form>
  );
}
