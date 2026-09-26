/**
 * Экран задач (экран 2 концепции интерфейса).
 *
 * Фильтры живут в адресе, а не в состоянии компонента (FR-09). Причина
 * не в технической красоте: менеджер, увидевший в кокпите «заблокировано
 * 2», нажимает на это число и попадает сюда с готовым фильтром, а ссылку
 * на то, что он увидел, может переслать в переписке. Фильтр, спрятанный
 * в useState, ни переслать, ни открыть из кокпита нельзя.
 *
 * Отсюда же выбор формы: обычная HTML-форма с method="get". Она меняет
 * адрес без единой строки клиентского кода, работает до загрузки JS и
 * оставляет кнопку «назад» осмысленной.
 *
 * Данные страница берёт из базы напрямую, а не через свой же
 * `/api/tasks`: серверный компонент и обработчик маршрута выполняются в
 * одном процессе, и поход по HTTP добавил бы сетевой круг и пересылку
 * cookie ради того, что лежит рядом. Общее у них — выборка `selectTasks`,
 * чтобы фильтры не разошлись.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/states';
import { RISK_CONFIG } from '@/domain/config';
import { isOpenStatus } from '@/domain/metrics';
import { selectTasks, type TaskRow } from '@/lib/data/tasks';
import { createClient } from '@/lib/supabase/server';
import { TASK_PRIORITY, TASK_STATUS, days, hours, plural } from '@/lib/ui/risk';
import { TASK_PRIORITIES, TASK_STATUSES, taskQuerySchema } from '@/lib/validation/task';

export const metadata = { title: 'Задачи — ReleasePilot AI' };

type Filters = Record<string, string>;

/**
 * Момент отсчёта передаётся списку сверху, а не читается им у часов.
 *
 * Причина не только в правиле «компонент не дёргает Date.now при
 * отрисовке». Возраст блокировки — это данные: он получается из
 * `blocked_since` и текущего времени, и время здесь такой же вход, как
 * сама строка. Пока каждый список смотрел на часы сам, таблица и карточки
 * получали два разных «сейчас» — на глаз незаметно, но это две версии
 * одного ответа в пределах одной страницы.
 */
type TaskListProps = {
  rows: TaskRow[];
  teamName: Map<string, string>;
  now: number;
};

/**
 * Значения из адреса приходят как `string | string[] | undefined`.
 *
 * Пустые строки отбрасываются: незаполненный `<select>` отправляет
 * `status=`, и без этой чистки пустое значение дошло бы до схемы и
 * завалило разбор — то есть форма ломала бы саму себя при первом же
 * «все статусы».
 */
function flatten(raw: Record<string, string | string[] | undefined>): Filters {
  const out: Filters = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== '') out[key] = first;
  }
  return out;
}

/** Адрес того же экрана с изменёнными параметрами. */
function href(slug: string, filters: Filters, changes: Filters = {}): string {
  const params = new URLSearchParams({ ...filters, ...changes });
  for (const [key, value] of Object.entries(changes)) {
    if (value === '') params.delete(key);
  }
  const qs = params.toString();
  return `/org/${slug}/tasks${qs ? `?${qs}` : ''}`;
}

export default async function TasksPage({ params, searchParams }: PageProps<'/org/[slug]/tasks'>) {
  const { slug } = await params;
  const filters = flatten(await searchParams);
  const supabase = await createClient();

  // Организации проверки на членство здесь нет намеренно: её делает RLS.
  // Для постороннего выборка вернёт пусто, и страница ответит «не найдено»,
  // а не «нет доступа» — отказ подтверждал бы, что такая организация есть.
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!org) notFound();

  const parsed = taskQuerySchema.safeParse(filters);

  /*
    Неразобранные фильтры — это состояние экрана, а не ошибка сервера.

    Сюда попадают по испорченной ссылке: кто-то переслал адрес, и по
    дороге от него отъели символ. Показать при этом задачи без фильтра
    было бы хуже всего: список выглядел бы правдоподобно и отвечал не на
    тот вопрос, который человек задал в адресе.
  */
  if (!parsed.success) {
    return (
      <Shell slug={slug} orgName={org.name}>
        <EmptyState
          title="Не разобрать фильтры в адресе"
          description="Похоже, ссылка повреждена при пересылке. Откройте список без фильтров и задайте их заново."
          action={
            <Link
              href={`/org/${slug}/tasks`}
              className="inline-block rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Все задачи
            </Link>
          }
        />
      </Shell>
    );
  }

  const query = { ...parsed.data, orgId: org.id };

  const [page, teamsRes, releasesRes] = await Promise.all([
    selectTasks(supabase, query),
    supabase.from('teams').select('id, name').eq('org_id', org.id).order('name'),
    supabase
      .from('releases')
      .select('id, name')
      .eq('org_id', org.id)
      .order('planned_date', { ascending: false }),
  ]);

  // Наружу текст ошибки не идёт (NFR-08) — её подхватит error.tsx рядом.
  if (page.error) throw new Error('Не удалось загрузить задачи');

  const teams = teamsRes.data ?? [];
  const releases = releasesRes.data ?? [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // `at` — момент, на который верна выборка. Возраст блокировки считается
  // от него, а не от часов внутри компонента: см. TaskPage в lib/data/tasks.
  const { rows, total, at: now } = page;
  const from = total === 0 ? 0 : query.offset + 1;
  const to = query.offset + rows.length;
  // Фильтр считается заданным, если в адресе есть что-то кроме страницы.
  const filtered = Object.keys(filters).some((k) => k !== 'limit' && k !== 'offset');

  return (
    <Shell slug={slug} orgName={org.name}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
        <p className="mt-1 text-sm opacity-60">
          {total === 0
            ? filtered
              ? 'Ни одной задачи под такой фильтр'
              : 'Задач пока нет'
            : `Показано ${from}–${to} из ${total} ${plural(total, 'задачи', 'задач', 'задач')}`}
        </p>
      </div>

      <FilterForm slug={slug} filters={filters} teams={teams} releases={releases} />

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Под такой фильтр ничего не попало"
            description="Возможно, условия слишком узкие: например, заблокированные задачи со статусом «готово» не существуют по определению."
            action={
              <Link
                href={`/org/${slug}/tasks`}
                className="inline-block rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Сбросить фильтры
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="В организации нет задач"
            description="Здесь появятся задачи релизов: статус, приоритет, команда и длительность блокировки. Загрузите данные из трекера или создайте задачу через API."
          />
        )
      ) : (
        <>
          <TaskTable rows={rows} teamName={teamName} now={now} />
          <TaskCards rows={rows} teamName={teamName} now={now} />
          <Pager
            slug={slug}
            filters={filters}
            total={total}
            limit={query.limit}
            offset={query.offset}
          />
        </>
      )}
    </Shell>
  );
}

/** Общая обёртка: одна на все состояния, чтобы шапка не прыгала. */
function Shell({
  slug,
  orgName,
  children,
}: {
  slug: string;
  orgName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:py-10">
      <nav className="text-sm opacity-60">
        <Link href={`/org/${slug}`} className="underline-offset-4 hover:underline">
          {orgName}
        </Link>
        <span aria-hidden> · </span>
        <span>задачи</span>
      </nav>
      {children}
    </div>
  );
}

const SELECT_CLASS =
  'w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20';

function FilterForm({
  slug,
  filters,
  teams,
  releases,
}: {
  slug: string;
  filters: Filters;
  teams: { id: string; name: string }[];
  releases: { id: string; name: string }[];
}) {
  /*
    Поля `offset` в форме нет, и это осознанно: при смене фильтра
    страница должна сбрасываться на первую. Иначе человек, стоящий на
    третьей странице, применит фильтр и увидит пустой экран — просто
    потому, что под новое условие подошло меньше строк, чем он пролистал.
  */
  return (
    <form
      method="get"
      action={`/org/${slug}/tasks`}
      className="grid gap-3 rounded-2xl border border-black/10 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/15"
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Поиск по названию</span>
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="например, регресс"
          className={SELECT_CLASS}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Статус</span>
        <select name="status" defaultValue={filters.status ?? ''} className={SELECT_CLASS}>
          <option value="">любой</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS[s]?.label ?? s}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Приоритет</span>
        <select name="priority" defaultValue={filters.priority ?? ''} className={SELECT_CLASS}>
          <option value="">любой</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Блокировка</span>
        <select name="blocked" defaultValue={filters.blocked ?? ''} className={SELECT_CLASS}>
          <option value="">не важно</option>
          <option value="true">только заблокированные</option>
          <option value="false">только незаблокированные</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Команда</span>
        <select name="teamId" defaultValue={filters.teamId ?? ''} className={SELECT_CLASS}>
          <option value="">любая</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium opacity-60">Релиз</span>
        <select name="releaseId" defaultValue={filters.releaseId ?? ''} className={SELECT_CLASS}>
          <option value="">любой</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Применить
        </button>
        <Link
          href={`/org/${slug}/tasks`}
          className="rounded-lg px-3 py-2 text-sm underline-offset-4 opacity-60 hover:underline hover:opacity-100"
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}

/**
 * Длительность блокировки словами.
 *
 * Концепция требует «3 дня» вместо галочки, и это не оформление:
 * блокер на три часа и блокер на три дня — разные события, а галочка
 * делает их одинаковыми. Порог застарелости берётся из того же
 * `RISK_CONFIG`, по которому движок считает фактор F3, — иначе экран и
 * расчёт разошлись бы в том, что считать застарелым.
 */
function Blocked({ row, now }: { row: TaskRow; now: number }) {
  // Закрытая задача заблокированной не считается — так же, как в движке.
  if (!row.blocked_since || !isOpenStatus(row.status)) {
    return <span className="opacity-30">—</span>;
  }

  const age = (now - new Date(row.blocked_since).getTime()) / 86_400_000;
  const stale = age >= RISK_CONFIG.staleBlockerDays;

  return (
    <span className={stale ? 'font-medium text-red-700 dark:text-red-300' : ''}>
      {days(age)}
      {stale ? <span className="ml-1 text-xs font-normal">застарел</span> : null}
    </span>
  );
}

function StatusBadge({ status }: { status: TaskRow['status'] }) {
  const s = TASK_STATUS[status] ?? { label: status, badge: '' };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.badge}`}>
      {s.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TaskRow['priority'] }) {
  return (
    <span
      className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-medium ${TASK_PRIORITY[priority] ?? ''}`}
    >
      {priority}
    </span>
  );
}

/** Таблица — от планшета и шире. */
function TaskTable({ rows, teamName, now }: TaskListProps) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-black/10 md:block dark:border-white/15">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide opacity-50 dark:border-white/15">
            <th scope="col" className="px-4 py-3 font-medium">
              Ключ
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Задача
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Статус
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Приоритет
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Команда
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Оценка
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Блокировка
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-black/5 last:border-0 dark:border-white/10"
            >
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs opacity-70">
                {row.external_key ?? '—'}
              </td>
              {/*
                max-w с truncate: без ограничения ширины одна длинная
                строка растягивает таблицу, и появляется горизонтальная
                прокрутка всей страницы вместо обрезки названия.
              */}
              <td className="max-w-xs truncate px-4 py-3" title={row.title}>
                {row.title}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={row.priority} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 opacity-70">
                {row.team_id ? (teamName.get(row.team_id) ?? '—') : '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums opacity-70">
                {hours(Number(row.estimate_h))}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Blocked row={row} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Карточки — на телефоне.
 *
 * Таблица из семи колонок на 375 px не читается: либо всё сжимается до
 * нечитаемого, либо страница уезжает в горизонтальную прокрутку.
 * Концепция прямо требует превращать таблицы в карточки ниже 768 px.
 */
function TaskCards({ rows, teamName, now }: TaskListProps) {
  return (
    <ul className="grid gap-3 md:hidden">
      {rows.map((row) => (
        <li
          key={row.id}
          className="min-w-0 rounded-2xl border border-black/10 p-4 dark:border-white/15"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-mono text-xs opacity-60">{row.external_key ?? '—'}</span>
            <PriorityBadge priority={row.priority} />
          </div>

          <p className="mt-1 font-medium">{row.title}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={row.status} />
            <span className="opacity-60">
              {row.team_id ? (teamName.get(row.team_id) ?? '—') : 'без команды'}
            </span>
            <span className="opacity-60">· {hours(Number(row.estimate_h))}</span>
          </div>

          {row.blocked_since && isOpenStatus(row.status) ? (
            <p className="mt-2 text-sm">
              Заблокирована: <Blocked row={row} now={now} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Постраничная навигация.
 *
 * Ссылками, а не кнопками: страница — это адрес, её должно быть видно в
 * адресной строке, можно открыть в новой вкладке и вернуться назад.
 */
function Pager({
  slug,
  filters,
  total,
  limit,
  offset,
}: {
  slug: string;
  filters: Filters;
  total: number;
  limit: number;
  offset: number;
}) {
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  if (!hasPrev && !hasNext) return null;

  const prevOffset = Math.max(0, offset - limit);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  const linkClass =
    'rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10';

  return (
    <nav className="flex items-center justify-between gap-4" aria-label="Страницы задач">
      {hasPrev ? (
        <Link
          href={href(slug, filters, { offset: prevOffset === 0 ? '' : String(prevOffset) })}
          className={linkClass}
          rel="prev"
        >
          Назад
        </Link>
      ) : (
        <span />
      )}

      <span className="text-sm opacity-60">
        Страница {page} из {pages}
      </span>

      {hasNext ? (
        <Link
          href={href(slug, filters, { offset: String(offset + limit) })}
          className={linkClass}
          rel="next"
        >
          Дальше
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
