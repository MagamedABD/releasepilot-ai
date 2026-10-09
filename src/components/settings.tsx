'use client';

/**
 * Экран настроек: команды и их ёмкость, отсутствия, импорт (FR-10, FR-11,
 * FR-41).
 *
 * Все изменения идут через API — те же маршруты, что у внешних клиентов,
 * — и после каждого экран перечитывается с сервера (`router.refresh`).
 * Своего состояния данных у компонентов нет: иначе после правки на экране
 * осталась бы версия, которую клиент считает верной, а не та, что легла в
 * базу.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useHydrated } from '@/components/editor';
import { FormError, FormNotice } from '@/components/form';
import type { Option } from '@/components/task-editor';
import { callApi } from '@/lib/ui/api';
import { hours } from '@/lib/ui/risk';
import { TEAM_KINDS } from '@/lib/validation/team';

export const TEAM_KIND_LABEL: Record<string, string> = {
  frontend: 'фронтенд',
  backend: 'бэкенд',
  qa: 'тестирование',
  analytics: 'аналитика',
  design: 'дизайн',
  other: 'другое',
};

const INPUT =
  'rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/20';
const BUTTON =
  'rounded-lg border border-black/15 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';
const PRIMARY =
  'rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50';
const REMOVE =
  'shrink-0 rounded px-1.5 text-base leading-none opacity-50 transition hover:opacity-100 disabled:opacity-30';

/**
 * Общий ход любой правки: вызов, ошибка или перечитывание экрана.
 * Возвращает `true` при успехе — форме, чтобы очистить поля.
 */
function useAction() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function run(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<boolean> {
    setPending(true);
    setError(undefined);
    const res = await callApi(method, url, body);
    setPending(false);
    if (!res.ok) {
      // Ошибка поля важнее общей фразы «проверьте заполнение»: она
      // говорит, что именно не так.
      setError(Object.values(res.fields).flat()[0] ?? res.message);
      return false;
    }
    router.refresh();
    return true;
  }

  return { run, pending: pending || !hydrated, error };
}

const num = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === '' ? Number.NaN : Number(String(v).replace(',', '.'));

// ── Команды ─────────────────────────────────────────────────────────────────

export type SettingsTeam = {
  id: string;
  name: string;
  kind: string;
  members: { profileId: string; name: string; allocationPct: number }[];
  capacity: {
    periodStart: string;
    periodEnd: string;
    availableHours: number;
    /** За вычетом отсутствий — то, что видит расчёт. */
    netHours: number;
  }[];
};

export function TeamsSection({
  orgId,
  teams,
  people,
  canEdit,
  today,
}: {
  orgId: string;
  teams: SettingsTeam[];
  people: Option[];
  canEdit: boolean;
  /** Граница «прошлых» периодов — с сервера, чтобы не зависеть от часов браузера. */
  today: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {teams.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
          Команд пока нет. Без команд загрузка не считается: задачам некуда отнести часы.
        </p>
      ) : (
        teams.map((t) => (
          <TeamCard key={t.id} team={t} people={people} canEdit={canEdit} today={today} />
        ))
      )}
      {canEdit ? <NewTeam orgId={orgId} /> : null}
    </div>
  );
}

function NewTeam({ orgId }: { orgId: string }) {
  const { run, pending, error } = useAction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ok = await run('POST', '/api/teams', {
      orgId,
      name: String(fd.get('name') ?? ''),
      kind: String(fd.get('kind')),
    });
    if (ok) form.reset();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-2xl border border-dashed border-black/15 p-4 dark:border-white/20">
      <p className="text-sm font-medium">Новая команда</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input name="name" placeholder="Название" aria-label="Название команды" className={`${INPUT} flex-1`} />
        <select name="kind" aria-label="Вид команды" defaultValue="other" className={INPUT}>
          {TEAM_KINDS.map((k) => (
            <option key={k} value={k}>
              {TEAM_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={PRIMARY}>
          Создать
        </button>
      </div>
      <FormError message={error} />
    </form>
  );
}

function TeamCard({
  team,
  people,
  canEdit,
  today,
}: {
  team: SettingsTeam;
  people: Option[];
  canEdit: boolean;
  today: string;
}) {
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // Ёмкость обычно заводят понедельно, и за полгода набирается под
  // тридцать строк. Нужны текущие и будущие — прошлые свёрнуты.
  const current = team.capacity
    .filter((c) => c.periodEnd >= today)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const past = team.capacity.filter((c) => c.periodEnd < today);
  const shown = showPast ? [...current, ...past] : current;
  const free = people.filter((p) => !team.members.some((m) => m.profileId === p.value));

  async function rename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ok = await run('PATCH', `/api/teams/${team.id}`, {
      name: String(fd.get('name') ?? ''),
      kind: String(fd.get('kind')),
    });
    if (ok) setEditing(false);
  }

  async function addMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ok = await run('PUT', `/api/teams/${team.id}/members`, {
      profileId: String(fd.get('profileId') ?? ''),
      allocationPct: num(fd.get('allocationPct')),
    });
    if (ok) form.reset();
  }

  async function addCapacity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ok = await run('PUT', `/api/teams/${team.id}/capacity`, {
      periodStart: String(fd.get('periodStart') ?? ''),
      periodEnd: String(fd.get('periodEnd') ?? ''),
      availableHours: num(fd.get('availableHours')),
    });
    if (ok) form.reset();
  }

  return (
    <section className="rounded-2xl border border-black/10 p-5 dark:border-white/15">
      {editing ? (
        <form onSubmit={rename} className="flex flex-col gap-2 sm:flex-row">
          <input name="name" defaultValue={team.name} aria-label="Название команды" className={`${INPUT} flex-1`} />
          <select name="kind" defaultValue={team.kind} aria-label="Вид команды" className={INPUT}>
            {TEAM_KINDS.map((k) => (
              <option key={k} value={k}>
                {TEAM_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className={PRIMARY}>
            Сохранить
          </button>
          <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
            Отмена
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{team.name}</h3>
            <p className="text-sm opacity-60">{TEAM_KIND_LABEL[team.kind] ?? team.kind}</p>
          </div>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
                Переименовать
              </button>
              {armed ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run('DELETE', `/api/teams/${team.id}`)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Да, удалить
                  </button>
                  <button type="button" onClick={() => setArmed(false)} className={BUTTON}>
                    Отмена
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setArmed(true)}
                  className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-300"
                >
                  Удалить
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
      {armed ? (
        <p className="mt-2 text-sm opacity-70">
          Ёмкость и состав удалятся вместе с командой, задачи останутся — без команды.
        </p>
      ) : null}

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide opacity-50">Состав</h4>
          {team.members.length === 0 ? (
            <p className="text-sm opacity-50">Никого. Без состава отпуска не уменьшают ёмкость.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {team.members.map((m) => (
                <li key={m.profileId} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-3 py-1.5 text-sm dark:bg-white/[0.06]">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums opacity-60">{m.allocationPct}%</span>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Убрать ${m.name} из команды`}
                        onClick={() =>
                          run('DELETE', `/api/teams/${team.id}/members?profileId=${m.profileId}`)
                        }
                        className={REMOVE}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && free.length > 0 ? (
            <form onSubmit={addMember} className="flex flex-wrap gap-2">
              <select name="profileId" aria-label="Кого добавить" className={`${INPUT} min-w-0 flex-1`}>
                {free.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                name="allocationPct"
                defaultValue="100"
                aria-label="Доля времени, %"
                title="Доля времени, отдаваемая команде, %"
                className={`${INPUT} w-16 text-right`}
              />
              <button type="submit" disabled={pending} className={BUTTON}>
                Добавить
              </button>
            </form>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide opacity-50">Ёмкость по периодам</h4>
          {shown.length === 0 && past.length === 0 ? (
            <p className="text-sm opacity-50">
              Не задана. Загрузка команды не считается, пока не известно, сколько у неё часов.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {shown.map((c) => (
                <li key={`${c.periodStart}-${c.periodEnd}`} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-3 py-1.5 text-sm dark:bg-white/[0.06]">
                  <span className="tabular-nums">
                    {c.periodStart} — {c.periodEnd}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums" title="Номинально / за вычетом отсутствий">
                      {c.netHours < c.availableHours ? (
                        <>
                          <span className="line-through opacity-40">{hours(c.availableHours)}</span>{' '}
                          {hours(c.netHours)}
                        </>
                      ) : (
                        hours(c.availableHours)
                      )}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Удалить ёмкость ${c.periodStart} — ${c.periodEnd}`}
                        onClick={() =>
                          run(
                            'DELETE',
                            `/api/teams/${team.id}/capacity?periodStart=${c.periodStart}&periodEnd=${c.periodEnd}`,
                          )
                        }
                        className={REMOVE}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="text-sm opacity-50">На текущие даты не задана.</li>
              ) : null}
            </ul>
          )}
          {past.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="self-start text-sm underline decoration-dotted underline-offset-4 opacity-60 hover:opacity-100"
            >
              {showPast ? 'Скрыть прошлые периоды' : `Показать прошлые периоды (${past.length})`}
            </button>
          ) : null}
          {canEdit ? (
            <form onSubmit={addCapacity} className="flex flex-wrap gap-2">
              <input type="date" name="periodStart" aria-label="Начало периода" className={INPUT} />
              <input type="date" name="periodEnd" aria-label="Конец периода" className={INPUT} />
              <input name="availableHours" placeholder="часов" aria-label="Часов за период" className={`${INPUT} w-20 text-right`} />
              <button type="submit" disabled={pending} className={BUTTON}>
                Задать
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <FormError message={error} />
    </section>
  );
}

// ── Отсутствия ──────────────────────────────────────────────────────────────

export type SettingsAbsence = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

export function AbsencesSection({
  orgId,
  absences,
  people,
  canEdit,
}: {
  orgId: string;
  absences: SettingsAbsence[];
  people: Option[];
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const reason = String(fd.get('reason') ?? '').trim();
    const ok = await run('POST', '/api/absences', {
      orgId,
      profileId: String(fd.get('profileId') ?? ''),
      startDate: String(fd.get('startDate') ?? ''),
      endDate: String(fd.get('endDate') ?? ''),
      reason: reason || null,
    });
    if (ok) form.reset();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm opacity-70">
        Рабочие дни отсутствия вычитаются из ёмкости каждой команды человека — пропорционально
        доле, которую он ей отдаёт. Кокпит, прогноз и сценарии считают уже с вычетом.
      </p>

      {absences.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
          Отсутствий не отмечено.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {absences.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-2 text-sm dark:border-white/15">
              <span className="min-w-0">
                <span className="font-medium">{a.name}</span>
                <span className="opacity-60">
                  {' '}
                  · {a.startDate} — {a.endDate}
                  {a.reason ? ` · ${a.reason}` : ''}
                </span>
              </span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Удалить отсутствие ${a.name}`}
                  onClick={() => run('DELETE', `/api/absences/${a.id}`)}
                  className={REMOVE}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && people.length > 0 ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-2xl border border-dashed border-black/15 p-4 dark:border-white/20">
          <p className="text-sm font-medium">Отметить отсутствие</p>
          <div className="flex flex-wrap gap-2">
            <select name="profileId" aria-label="Кто" className={`${INPUT} min-w-0 flex-1`}>
              {people.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input type="date" name="startDate" aria-label="С" className={INPUT} />
            <input type="date" name="endDate" aria-label="По" className={INPUT} />
          </div>
          <div className="flex flex-wrap gap-2">
            <input name="reason" placeholder="Причина, необязательно" aria-label="Причина" className={`${INPUT} min-w-0 flex-1`} />
            <button type="submit" disabled={pending} className={PRIMARY}>
              Отметить
            </button>
          </div>
        </form>
      ) : null}

      <FormError message={error} />
    </div>
  );
}

// ── Импорт ──────────────────────────────────────────────────────────────────

type ImportReport = {
  dryRun: boolean;
  status: 'success' | 'partial' | 'failed';
  stats: Record<string, number>;
  errors: { line: number; field: string | null; message: string }[];
};

const STATUS_TEXT: Record<ImportReport['status'], string> = {
  success: 'без ошибок',
  partial: 'частично — часть строк отклонена',
  failed: 'ни одна строка не принята',
};

const STAT_LABEL: Record<string, string> = {
  records: 'записей в файле',
  created: 'создано',
  updated: 'обновлено',
  dependencies: 'связей',
  skipped: 'пропущено',
  errors: 'ошибок',
};

/**
 * Импорт задач из CSV или JSON (FR-41).
 *
 * Сначала «Проверить» — тот же разбор без записи (`dryRun`), и только
 * потом «Импортировать». Это не перестраховка интерфейса: импорт
 * частичный, и узнать, что из трёхсот строк сорок отклонены, лучше до
 * того, как двести шестьдесят уже легли в базу.
 */
export function ImportSection({ projects, canImport }: { projects: Option[]; canImport: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<ImportReport>();

  async function send(form: HTMLFormElement, dryRun: boolean) {
    const fd = new FormData(form);
    fd.set('dryRun', String(dryRun));
    setPending(true);
    setError(undefined);
    let res: Response;
    try {
      res = await fetch('/api/import/file', { method: 'POST', body: fd });
    } catch {
      setPending(false);
      setError('Нет связи с сервером. Проверьте сеть и повторите.');
      return;
    }
    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      const e = json?.error;
      setError((e?.fields && Object.values(e.fields as Record<string, string[]>).flat()[0]) ?? e?.message ?? 'Не удалось выполнить импорт');
      setReport(undefined);
      return;
    }
    setReport(json.data as ImportReport);
    if (!dryRun) router.refresh();
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
        Задачи импортируются в проект, а проектов пока нет. Создайте первый релиз — проект можно
        завести прямо в его форме.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm opacity-70">
        CSV (разделитель «,» или «;») или JSON. Обязательные колонки: <code>key</code>,{' '}
        <code>title</code>, <code>estimate_h</code>; русские названия колонок тоже понимаются.
        Задача с уже существующим ключом обновляется, а не дублируется.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(e.currentTarget, true);
        }}
        className="flex flex-col gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/15"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <select name="projectId" aria-label="Проект" className={INPUT}>
            {projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="file"
            name="file"
            accept=".csv,.json,text/csv,application/json"
            aria-label="Файл"
            onChange={() => setReport(undefined)}
            className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-lg file:border file:border-black/15 file:bg-transparent file:px-3 file:py-2 file:text-sm dark:file:border-white/20"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending || !hydrated} className={BUTTON}>
            {pending ? 'Проверяем…' : 'Проверить'}
          </button>
          {report?.dryRun && report.status !== 'failed' ? (
            <button
              type="button"
              disabled={pending || !canImport}
              title={canImport ? undefined : 'Импорт доступен администратору и владельцу'}
              onClick={(e) => send(e.currentTarget.form!, false)}
              className={PRIMARY}
            >
              Импортировать
            </button>
          ) : null}
        </div>
        {!canImport ? (
          <p className="text-sm opacity-60">
            Проверить файл может любой участник, импортировать — администратор или владелец.
          </p>
        ) : null}
      </form>

      <FormError message={error} />

      {report ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/15">
          {report.dryRun ? (
            <p className="text-sm font-medium">Проверка: {STATUS_TEXT[report.status]}. В базу ничего не записано.</p>
          ) : (
            <FormNotice message={`Импорт выполнен: ${STATUS_TEXT[report.status]}.`} />
          )}
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {Object.entries(report.stats).map(([k, v]) => (
              <div key={k}>
                <dt className="opacity-60">
                  {report.dryRun && (k === 'created' || k === 'updated')
                    ? `будет ${STAT_LABEL[k]}`
                    : (STAT_LABEL[k] ?? k)}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {report.errors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide opacity-50">
                    <th className="py-1 pr-4 font-medium">Строка</th>
                    <th className="py-1 pr-4 font-medium">Колонка</th>
                    <th className="py-1 font-medium">Что не так</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e, i) => (
                    <tr key={i} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-1.5 pr-4 tabular-nums">{e.line}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{e.field ?? '—'}</td>
                      <td className="py-1.5">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
