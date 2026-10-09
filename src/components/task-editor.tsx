'use client';

/**
 * Создание и правка задачи (FR-06, FR-07, FR-08, FR-13).
 *
 * Форма отправляет данные в `/api/tasks` и не проверяет их сама сверх
 * приведения типов: правила — обязательная оценка больше нуля, отметки
 * блокировки и добавления в релиз — живут в схеме и в `lib/api/task.ts`,
 * и ошибки по полям приходят оттуда же. Своя проверка здесь разошлась бы
 * с серверной при первой правке одной из них.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Field, FormError } from '@/components/form';
import {
  CheckField,
  DangerButton,
  Drawer,
  PrimaryButton,
  SelectField,
  TextAreaField,
  useHydrated,
} from '@/components/editor';
import { callApi } from '@/lib/ui/api';
import { TASK_STATUS } from '@/lib/ui/risk';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/validation/task';

export type Option = { value: string; label: string };

export type EditableTask = {
  id: string;
  projectId: string;
  releaseId: string | null;
  externalKey: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  estimateH: number;
  spentH: number;
  teamId: string | null;
  assigneeId: string | null;
  blocked: boolean;
};

export type TaskLink = { taskId: string; label: string };

type Props = {
  task: EditableTask | null;
  /** Релиз, в который новая задача попадёт по умолчанию, — из фильтра. */
  defaultReleaseId?: string | null;
  projects: Option[];
  releases: Option[];
  teams: Option[];
  members: Option[];
  /** Задачи, с которыми можно связать эту. */
  candidates: Option[];
  blocks: TaskLink[];
  waitsFor: TaskLink[];
  canEdit: boolean;
  closeHref: string;
};

/** Пустое поле формы — это «не задано», а не пустая строка в базе. */
const orNull = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : String(v));
/** Запятая вместо точки — обычное дело для русской раскладки. */
const num = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === '' ? Number.NaN : Number(String(v).replace(',', '.'));

export function TaskEditor(props: Props) {
  const { task, canEdit, closeHref } = props;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [armed, setArmed] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const body = {
      title: String(fd.get('title') ?? ''),
      description: orNull(fd.get('description')),
      externalKey: orNull(fd.get('externalKey')),
      releaseId: orNull(fd.get('releaseId')),
      status: String(fd.get('status')),
      priority: String(fd.get('priority')),
      estimateH: num(fd.get('estimateH')),
      spentH: num(fd.get('spentH')),
      teamId: orNull(fd.get('teamId')),
      assigneeId: orNull(fd.get('assigneeId')),
      blocked: fd.get('blocked') === 'on',
      ...(task ? {} : { projectId: String(fd.get('projectId') ?? '') }),
    };

    setPending(true);
    setMessage(undefined);
    const res = task
      ? await callApi('PATCH', `/api/tasks/${task.id}`, body)
      : await callApi('POST', '/api/tasks', body);
    setPending(false);

    if (!res.ok) {
      setMessage(res.message);
      setFields(res.fields);
      return;
    }
    router.replace(closeHref, { scroll: false });
    router.refresh();
  }

  async function onDelete() {
    if (!task) return;
    setPending(true);
    const res = await callApi('DELETE', `/api/tasks/${task.id}`);
    setPending(false);
    if (!res.ok) {
      setMessage(res.message);
      setArmed(false);
      return;
    }
    router.replace(closeHref, { scroll: false });
    router.refresh();
  }

  return (
    <Drawer
      title={task ? task.title : 'Новая задача'}
      subtitle={task ? (task.externalKey ?? 'Задача') : 'Задачи'}
      closeHref={closeHref}
    >
      {!canEdit ? (
        <p className="rounded-lg border border-black/10 px-3 py-2 text-sm opacity-70 dark:border-white/15">
          Менять задачи может менеджер, администратор или владелец. Вам доступен просмотр.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
          <Field label="Название" name="title" defaultValue={task?.title} errors={fields.title} required />

          <div className="grid gap-4 sm:grid-cols-2">
            {task ? null : (
              <SelectField
                label="Проект"
                name="projectId"
                options={props.projects}
                defaultValue={props.projects[0]?.value}
                errors={fields.projectId}
              />
            )}
            <Field
              label="Ключ"
              name="externalKey"
              defaultValue={task?.externalKey ?? ''}
              placeholder="PAY-123"
              errors={fields.externalKey}
            />
          </div>

          <SelectField
            label="Релиз"
            name="releaseId"
            options={props.releases}
            defaultValue={task ? task.releaseId : props.defaultReleaseId}
            empty="Без релиза"
            errors={fields.releaseId}
            hint={
              task?.releaseId
                ? undefined
                : 'Задача, добавленная в уже идущий релиз, учитывается как дрейф объёма'
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Статус"
              name="status"
              defaultValue={task?.status ?? 'backlog'}
              options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS[s]?.label ?? s }))}
              errors={fields.status}
            />
            <SelectField
              label="Приоритет"
              name="priority"
              defaultValue={task?.priority ?? 'P2'}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
              errors={fields.priority}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Оценка, ч"
              name="estimateH"
              type="text"
              defaultValue={task ? String(task.estimateH) : ''}
              placeholder="8"
              errors={fields.estimateH}
              hint="Обязательна: на ней строится готовность"
              required
            />
            <Field
              label="Потрачено, ч"
              name="spentH"
              type="text"
              defaultValue={task ? String(task.spentH) : '0'}
              errors={fields.spentH}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Команда"
              name="teamId"
              options={props.teams}
              defaultValue={task?.teamId}
              empty="Без команды"
              errors={fields.teamId}
            />
            <SelectField
              label="Ответственный"
              name="assigneeId"
              options={props.members}
              defaultValue={task?.assigneeId}
              empty="Не назначен"
              errors={fields.assigneeId}
            />
          </div>

          <CheckField
            label="Заблокирована"
            name="blocked"
            defaultChecked={task?.blocked}
            hint={task?.blocked ? undefined : 'Время блокировки отсчитывается с момента сохранения'}
          />

          <TextAreaField
            label="Описание"
            name="description"
            defaultValue={task?.description}
            errors={fields.description}
          />
        </fieldset>

        <FormError message={message} />

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/15">
            <PrimaryButton pending={pending} pendingLabel="Сохраняем…">
              {task ? 'Сохранить' : 'Создать задачу'}
            </PrimaryButton>
            {task ? (
              <DangerButton
                label="Удалить задачу"
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

      {task ? (
        <Dependencies
          taskId={task.id}
          candidates={props.candidates}
          blocks={props.blocks}
          waitsFor={props.waitsFor}
          canEdit={canEdit}
        />
      ) : null}
    </Drawer>
  );
}

// ── Связи ───────────────────────────────────────────────────────────────────

function Dependencies({
  taskId,
  candidates,
  blocks,
  waitsFor,
  canEdit,
}: {
  taskId: string;
  candidates: Option[];
  blocks: TaskLink[];
  waitsFor: TaskLink[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  // Уже связанные и сама задача из выбора убираются: повторная связь
  // всё равно получит отказ, и лучше не предлагать её вовсе.
  const linked = new Set([taskId, ...blocks.map((l) => l.taskId), ...waitsFor.map((l) => l.taskId)]);
  const free = candidates.filter((c) => !linked.has(c.value));

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const other = String(fd.get('other') ?? '');
    if (!other) return;
    const key = fd.get('direction') === 'blocks' ? 'blocksTaskId' : 'blockedByTaskId';

    setPending(true);
    setMessage(undefined);
    const res = await callApi('POST', `/api/tasks/${taskId}/dependencies`, { [key]: other });
    setPending(false);
    if (!res.ok) {
      setMessage(Object.values(res.fields).flat()[0] ?? res.message);
      return;
    }
    router.refresh();
  }

  async function remove(otherId: string, pathBlocks: boolean) {
    setPending(true);
    setMessage(undefined);
    const q = new URLSearchParams({ [pathBlocks ? 'blocksTaskId' : 'blockedByTaskId']: otherId });
    const res = await callApi('DELETE', `/api/tasks/${taskId}/dependencies?${q}`);
    setPending(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 border-t border-black/10 pt-5 dark:border-white/15">
      <h3 className="text-sm font-semibold">Связи</h3>

      <LinkList title="Ждёт" empty="Ни от чего не зависит" links={waitsFor} canEdit={canEdit} pending={pending} onRemove={(id) => remove(id, false)} />
      <LinkList title="Блокирует" empty="Никого не держит" links={blocks} canEdit={canEdit} pending={pending} onRemove={(id) => remove(id, true)} />

      {canEdit && free.length > 0 ? (
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm sm:w-36">
            <span className="opacity-60">Эта задача</span>
            <select name="direction" className="rounded-lg border border-black/15 bg-transparent px-2 py-2 dark:border-white/20">
              <option value="waits">ждёт</option>
              <option value="blocks">блокирует</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="opacity-60">задачу</span>
            <select name="other" className="min-w-0 rounded-lg border border-black/15 bg-transparent px-2 py-2 dark:border-white/20">
              {free.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending || !hydrated}
            className="rounded-lg border border-black/15 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
          >
            Связать
          </button>
        </form>
      ) : null}

      <FormError message={message} />
    </section>
  );
}

function LinkList({
  title,
  empty,
  links,
  canEdit,
  pending,
  onRemove,
}: {
  title: string;
  empty: string;
  links: TaskLink[];
  canEdit: boolean;
  pending: boolean;
  onRemove: (taskId: string) => void;
}) {
  return (
    <div className="text-sm">
      <p className="opacity-60">{title}</p>
      {links.length === 0 ? (
        <p className="mt-1 opacity-40">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.taskId} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-3 py-1.5 dark:bg-white/[0.06]">
              <span className="min-w-0 truncate">{l.label}</span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRemove(l.taskId)}
                  aria-label={`Убрать связь с ${l.label}`}
                  className="shrink-0 rounded px-1.5 opacity-50 transition hover:opacity-100 disabled:opacity-30"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
