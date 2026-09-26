/**
 * Загрузка демонстрационных данных.
 *
 * Один из трёх сценариев, ради которых вообще существует служебный ключ
 * (см. src/lib/supabase/admin.ts). Обычным путём эти данные не создать:
 * организацию положено заводить функцией create_organization от лица
 * пользователя, а здесь нужно положить сразу готовый срез — с историей,
 * зависимостями и отсутствиями.
 *
 * Скрипт не импортирует админский клиент приложения намеренно: тот
 * начинается с `import 'server-only'`, который вне сборщика Next просто
 * падает. Защита, поставленная в прошлый раз, работает и против нас —
 * это правильное её поведение, а не помеха.
 *
 * Запуск идемпотентен: демо-организация и демо-пользователи сначала
 * удаляются, потом создаются заново. Иначе второй прогон упёрся бы
 * в занятый адрес, а третий оставил бы три копии одних и тех же задач.
 *
 * Запуск: npm run seed:demo
 */

import { loadEnv, adminHeaders } from './lib/env';
import { ABSENCES, CAPACITY_WEEKS, PEOPLE, PROJECTS, RELEASES, TEAMS } from './demo-data';

const env = loadEnv();
const H = adminHeaders(env);

const ORG_NAME = 'Демонстрационная организация';
const ORG_SLUG = 'demo';
/** Приставка адресов демо-пользователей. По ней же идёт уборка. */
const MAIL_PREFIX = 'demo.';
const MAIL_DOMAIN = '@example.com';

const OWNER_EMAIL = env.raw.DEMO_EMAIL || `demo${MAIL_DOMAIN}`;
const OWNER_PASSWORD = env.raw.DEMO_PASSWORD;
const OWNER_NAME = 'Демо-менеджер';

if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 8) {
  console.error(
    [
      'Нужна переменная DEMO_PASSWORD в .env.local — пароль демо-аккаунта.',
      '',
      'Он публикуется в README, чтобы проверяющий мог войти, не регистрируясь.',
      'Поэтому пароль не выдумывается скриптом: его выбирает владелец проекта',
      'и понимает, что публикует. Не короче восьми символов.',
    ].join('\n'),
  );
  process.exit(1);
}

// ── Даты ────────────────────────────────────────────────────────────────────
// Всё строится от полуночи сегодняшнего дня по UTC. Смещения в днях, а не
// календарь: демо не должно устаревать (см. комментарий в demo-data.ts).

const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

function shift(days: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
/** Дата вида 2026-09-21. */
const day = (offset: number) => shift(offset).toISOString().slice(0, 10);
/** Отметка времени. Полдень, чтобы разница в часовых поясах не сдвигала день. */
const at = (offset: number) => {
  const d = shift(offset);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
};

/** Понедельник текущей недели — от него отсчитываются периоды ёмкости. */
function mondayOffset(): number {
  const wd = TODAY.getUTCDay(); // 0 — воскресенье
  return wd === 0 ? -6 : 1 - wd;
}

// ── Обращения к базе ────────────────────────────────────────────────────────

async function rest<T = unknown>(
  path: string,
  init: RequestInit & { returning?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...H };
  if (init.returning) headers.Prefer = 'return=representation';

  const res = await fetch(`${env.url}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ([] as unknown as T);
}

async function insert<T = { id: string }>(table: string, rows: object[]): Promise<T[]> {
  if (rows.length === 0) return [];
  return rest<T[]>(table, { method: 'POST', body: JSON.stringify(rows), returning: true });
}

async function auth<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.url}/auth/v1/${path}`, { ...init, headers: H });
  const text = await res.text();
  if (!res.ok) throw new Error(`auth ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ── Уборка прошлого прогона ─────────────────────────────────────────────────

async function wipe(): Promise<void> {
  const orgs = await rest<{ id: string }[]>(`organizations?slug=eq.${ORG_SLUG}&select=id`);
  for (const org of orgs) {
    // Каскад по внешним ключам уносит команды, проекты, релизы и задачи.
    await rest(`organizations?id=eq.${org.id}`, { method: 'DELETE' });
  }

  const { users } = await auth<{ users: { id: string; email: string }[] }>(
    'admin/users?per_page=200',
  );
  const mine = users.filter(
    (u) =>
      u.email === OWNER_EMAIL ||
      (u.email?.startsWith(MAIL_PREFIX) && u.email.endsWith(MAIL_DOMAIN)),
  );
  for (const u of mine) {
    await auth(`admin/users/${u.id}`, { method: 'DELETE' });
  }

  console.log(`  убрано: организаций ${orgs.length}, пользователей ${mine.length}`);
}

// ── Загрузка ────────────────────────────────────────────────────────────────

async function createUser(email: string, password: string, fullName: string): Promise<string> {
  const user = await auth<{ id: string }>('admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  return user.id;
}

async function main() {
  console.log('1. Уборка прошлого прогона');
  await wipe();

  console.log('2. Организация и люди');
  const [org] = await insert<{ id: string }>('organizations', [
    { name: ORG_NAME, slug: ORG_SLUG },
  ]);

  const ownerId = await createUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME);
  const personId: Record<string, string> = {};
  for (const p of PEOPLE) {
    // Пароль демо-персонажей не используется: входить под ними не нужно,
    // они существуют ради имён в задачах и отсутствий. Но поле обязательно,
    // поэтому значение делается заведомо непригодным для входа.
    personId[p.key] = await createUser(
      `${MAIL_PREFIX}${p.key}${MAIL_DOMAIN}`,
      `no-login-${crypto.randomUUID()}`,
      p.name,
    );
  }
  console.log(`  пользователей: ${PEOPLE.length + 1} (профили создал триггер)`);

  await insert('memberships', [
    { org_id: org.id, user_id: ownerId, role: 'owner' },
    ...PEOPLE.map((p) => ({ org_id: org.id, user_id: personId[p.key], role: p.role })),
  ]);

  console.log('3. Команды и ёмкость');
  const teams = await insert<{ id: string; name: string }>(
    'teams',
    TEAMS.map((t) => ({ org_id: org.id, name: t.name, kind: t.kind })),
  );
  const teamId: Record<string, string> = {};
  for (const t of TEAMS) {
    teamId[t.key] = teams.find((x) => x.name === t.name)!.id;
  }

  await insert(
    'team_members',
    PEOPLE.map((p) => ({
      org_id: org.id,
      team_id: teamId[p.team],
      profile_id: personId[p.key],
      allocation_pct: p.allocation ?? 100,
    })),
  );

  const capacityRows: object[] = [];
  const mon = mondayOffset();
  for (let w = CAPACITY_WEEKS.from; w <= CAPACITY_WEEKS.to; w += 1) {
    const start = mon + w * 7;
    for (const t of TEAMS) {
      capacityRows.push({
        org_id: org.id,
        team_id: teamId[t.key],
        period_start: day(start),
        period_end: day(start + 4), // рабочая неделя, Пн–Пт
        available_hours: t.weeklyHours,
      });
    }
  }
  await insert('team_capacity', capacityRows);
  console.log(`  команд: ${TEAMS.length}, периодов ёмкости: ${capacityRows.length}`);

  await insert(
    'absences',
    ABSENCES.map((a) => ({
      org_id: org.id,
      profile_id: personId[a.person],
      start_date: day(a.fromIn),
      end_date: day(a.toIn),
      reason: a.reason,
    })),
  );

  console.log('4. Проекты, релизы, задачи');
  const projects = await insert<{ id: string; key: string }>(
    'projects',
    PROJECTS.map((p) => ({ org_id: org.id, name: p.name, key: p.key })),
  );
  const projectId: Record<string, string> = {};
  for (const p of projects) projectId[p.key] = p.id;

  let taskCount = 0;
  let depCount = 0;

  for (const r of RELEASES) {
    const [release] = await insert<{ id: string }>('releases', [
      {
        org_id: org.id,
        project_id: projectId[r.project],
        name: r.name,
        status: r.status,
        planned_date: day(r.plannedIn),
        started_at: r.startedDaysAgo === undefined ? null : at(-r.startedDaysAgo),
        released_at: r.releasedDaysAgo === undefined ? null : at(-r.releasedDaysAgo),
      },
    ]);

    const rows = r.tasks.map((t) => ({
      org_id: org.id,
      project_id: projectId[r.project],
      release_id: release.id,
      external_key: t.key,
      title: t.title,
      status: t.status,
      priority: t.priority,
      estimate_h: t.estimateH,
      spent_h: t.spentH ?? 0,
      team_id: teamId[t.team],
      assignee_id: t.assignee ? personId[t.assignee] : null,
      added_to_release_at:
        t.addedAfterStartDays !== undefined && r.startedDaysAgo !== undefined
          ? at(-r.startedDaysAgo + t.addedAfterStartDays)
          : r.startedDaysAgo !== undefined
            ? at(-r.startedDaysAgo)
            : null,
      blocked_since: t.blockedDaysAgo === undefined ? null : at(-t.blockedDaysAgo),
    }));

    const created = await insert<{ id: string; external_key: string }>('tasks', rows);
    taskCount += created.length;

    const byKey: Record<string, string> = {};
    for (const t of created) byKey[t.external_key] = t.id;

    if (r.deps?.length) {
      await insert(
        'task_dependencies',
        r.deps.map(([blocker, blocked]) => ({
          org_id: org.id,
          blocker_task_id: byKey[blocker],
          blocked_task_id: byKey[blocked],
          type: 'blocks',
        })),
      );
      depCount += r.deps.length;
    }
  }

  console.log(`  релизов: ${RELEASES.length}, задач: ${taskCount}, зависимостей: ${depCount}`);

  console.log('\nГотово.');
  console.log(`  Организация: /org/${ORG_SLUG}`);
  console.log(`  Вход: ${OWNER_EMAIL}`);
}

main().catch((e) => {
  console.error('\nЗагрузка прервана:', e instanceof Error ? e.message : e);
  console.error('Данные могли остаться наполовину — повторный запуск уберёт их сам.');
  process.exit(1);
});
