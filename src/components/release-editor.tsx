'use client';

/**
 * Создание и правка релиза (FR-05).
 *
 * Как и форма задачи, ходит в `/api/releases`: отметки старта и выпуска
 * ставит сервер по переходу статуса (`toReleaseUpdate`), и запрет удалять
 * непустой релиз тоже живёт там — форма лишь показывает его ответ.
 *
 * Проект можно завести прямо здесь. Онбординг создаёт только организацию,
 * и без этого первый релиз новой организации было бы негде создать:
 * релиз обязан принадлежать проекту, а отдельного экрана проектов нет.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Field, FormError } from '@/components/form';
import { DangerButton, Drawer, PrimaryButton, SelectField } from '@/components/editor';
import type { Option } from '@/components/task-editor';
import { callApi } from '@/lib/ui/api';
import { RELEASE_STATUS } from '@/lib/ui/risk';
import { RELEASE_STATUSES } from '@/lib/validation/release';

export type EditableRelease = {
  id: string;
  name: string;
  status: string;
  plannedDate: string;
};

const NEW_PROJECT = '__new';

export function ReleaseEditor({
  release,
  orgId,
  projects,
  canEdit,
  closeHref,
  afterDeleteHref,
  releaseBase,
}: {
  release: EditableRelease | null;
  orgId: string;
  projects: Option[];
  canEdit: boolean;
  closeHref: string;
  /** Куда уйти после удаления — экрана удалённого релиза больше нет. */
  afterDeleteHref: string;
  /** Начало адреса кокпита: созданный релиз открывается по нему + id. */
  releaseBase: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [armed, setArmed] = useState(false);
  const [project, setProject] = useState(projects[0]?.value ?? NEW_PROJECT);

  function fail(res: { message: string; fields: Record<string, string[]> }, prefix = '') {
    setMessage(res.message);
    setFields(
      Object.fromEntries(Object.entries(res.fields).map(([k, v]) => [prefix + k, v])),
    );
    setPending(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      plannedDate: String(fd.get('plannedDate') ?? ''),
      status: String(fd.get('status')),
    };

    setPending(true);
    setMessage(undefined);
    setFields({});

    if (release) {
      const res = await callApi('PATCH', `/api/releases/${release.id}`, body);
      if (!res.ok) return fail(res);
      router.replace(closeHref, { scroll: false });
      router.refresh();
      return;
    }

    let projectId = project;
    if (project === NEW_PROJECT) {
      const res = await callApi<{ id: string }>('POST', '/api/projects', {
        orgId,
        name: String(fd.get('projectName') ?? ''),
        key: String(fd.get('projectKey') ?? ''),
      });
      // Ошибки проекта уходят в его поля, а не в поля релиза с тем же
      // именем: «Укажите название» под названием релиза сбило бы с толку.
      if (!res.ok) return fail(res, 'project.');
      projectId = res.data.id;
    }

    const res = await callApi<{ id: string }>('POST', '/api/releases', { ...body, projectId });
    if (!res.ok) return fail(res);
    router.push(`${releaseBase}${res.data.id}`);
    router.refresh();
  }

  async function onDelete() {
    if (!release) return;
    setPending(true);
    const res = await callApi('DELETE', `/api/releases/${release.id}`);
    if (!res.ok) {
      setArmed(false);
      return fail(res);
    }
    router.replace(afterDeleteHref);
    router.refresh();
  }

  return (
    <Drawer
      title={release ? release.name : 'Новый релиз'}
      subtitle={release ? 'Правка релиза' : 'Релизы'}
      closeHref={closeHref}
    >
      {!canEdit ? (
        <p className="rounded-lg border border-black/10 px-3 py-2 text-sm opacity-70 dark:border-white/15">
          Менять релизы может менеджер, администратор или владелец. Вам доступен просмотр.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
          {release ? null : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="projectId" className="text-sm font-medium">
                  Проект
                </label>
                <select
                  id="projectId"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/20"
                >
                  {projects.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value={NEW_PROJECT}>+ Новый проект…</option>
                </select>
              </div>
              {project === NEW_PROJECT ? (
                <div className="grid gap-4 rounded-xl border border-dashed border-black/15 p-4 sm:grid-cols-[1fr_8rem] dark:border-white/20">
                  <Field
                    label="Название проекта"
                    name="projectName"
                    placeholder="Платежи"
                    errors={fields['project.name']}
                  />
                  <Field
                    label="Ключ"
                    name="projectKey"
                    placeholder="PAY"
                    errors={fields['project.key']}
                  />
                </div>
              ) : null}
            </>
          )}

          <Field
            label="Название релиза"
            name="name"
            defaultValue={release?.name}
            placeholder="2.15 — Новые способы оплаты"
            errors={fields.name}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Плановая дата"
              name="plannedDate"
              type="date"
              defaultValue={release?.plannedDate}
              errors={fields.plannedDate}
              required
            />
            <SelectField
              label="Статус"
              name="status"
              defaultValue={release?.status ?? 'planned'}
              options={RELEASE_STATUSES.map((s) => ({ value: s, label: RELEASE_STATUS[s] ?? s }))}
              errors={fields.status}
              hint="«В работе» фиксирует старт: задачи, добавленные позже, — дрейф объёма"
            />
          </div>
        </fieldset>

        <FormError message={message} />

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/15">
            <PrimaryButton pending={pending} pendingLabel="Сохраняем…">
              {release ? 'Сохранить' : 'Создать релиз'}
            </PrimaryButton>
            {release ? (
              <DangerButton
                label="Удалить релиз"
                confirmLabel="Да, удалить"
                pending={pending}
                armed={armed}
                onArm={() => setArmed(true)}
                onCancel={() => setArmed(false)}
                onConfirm={onDelete}
              />
            ) : null}
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}
