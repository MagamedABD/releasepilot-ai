/**
 * Сквозная проверка жизненного цикла сценария: сохранить → применить.
 *
 * Отдельно от smoke-api.ts по одной причине: та проверка только читает и
 * может гоняться сколько угодно, а эта пишет. Применённый сценарий
 * переносит задачи и добавляет ёмкость, и на демо-релизе это испортило бы
 * картину, на которой держится показ. Поэтому здесь свой временный релиз:
 * он создаётся от лица сервера, проверяется от лица пользователя через
 * настоящие маршруты и удаляется в конце — даже если проверка упала.
 *
 * Остаётся одно: записи в журнале изменений. Журнал только дописывается,
 * политик на удаление нет намеренно (ADR-003), и проверка не должна быть
 * исключением из правила, которое она проверяет.
 *
 * Запуск: npm run smoke:scenario (рядом должен работать npm run dev,
 * в базе применена миграция 0003)
 */

import { adminHeaders, loadEnv } from './lib/env';
import { request, sessionCookies, signIn } from './lib/session';

const env = loadEnv();
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = env.raw.DEMO_EMAIL || 'demo@example.com';
const PASSWORD = env.raw.DEMO_PASSWORD;
const H = adminHeaders(env);

if (!PASSWORD) {
  console.error('Нужна переменная DEMO_PASSWORD в .env.local — тот же пароль, что у seed:demo.');
  process.exit(1);
}

const { get, post } = request(BASE);

let failures = 0;
function check(passed: boolean, what: string, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

/** Запрос к базе от лица сервера: подготовка и уборка, не предмет проверки. */
async function admin<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, Prefer: 'return=representation' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

type Row = { id: string };

const created = { releases: [] as string[], capacity: null as null | { team: string; from: string; to: string } };

async function main() {
  console.log(`База: ${BASE}\n`);

  console.log('1. Подготовка временного релиза');
  const [demo] = await admin<{ id: string; org_id: string; project_id: string }[]>(
    'releases?status=eq.active&select=id,org_id,project_id&limit=1',
  );
  if (!demo) {
    console.log('   Активного демо-релиза нет. npm run seed:demo');
    failures += 1;
    return;
  }
  const [team] = await admin<{ id: string; name: string }[]>(
    `teams?org_id=eq.${demo.org_id}&select=id,name&limit=1`,
  );

  const from = isoDay(1);
  const planned = isoDay(21);
  // Запись ёмкости на это окно проверка создаст и потом удалит. Если такая
  // уже есть, удалить пришлось бы чужую — значит, дальше не идём.
  const existing = await admin<Row[]>(
    `team_capacity?team_id=eq.${team.id}&period_start=eq.${from}&period_end=eq.${planned}&select=id`,
  );
  if (existing.length) {
    console.log(`   У команды уже есть ёмкость на окно ${from}…${planned}; проверка её не тронет.`);
    failures += 1;
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19);
  const [source, target] = await admin<Row[]>('releases', {
    method: 'POST',
    body: JSON.stringify([
      {
        org_id: demo.org_id, project_id: demo.project_id, name: `smoke ${stamp}`,
        status: 'active', planned_date: planned, started_at: new Date().toISOString(),
      },
      {
        org_id: demo.org_id, project_id: demo.project_id, name: `smoke ${stamp} → цель`,
        status: 'planned', planned_date: isoDay(42), started_at: null,
      },
    ]),
  });
  created.releases.push(source.id, target.id);

  const taskRow = (title: string) => ({
    org_id: demo.org_id, project_id: demo.project_id, release_id: source.id,
    title, status: 'in_progress', priority: 'P2', estimate_h: 8, team_id: team.id,
  });
  const [hub, held, free] = await admin<Row[]>('tasks', {
    method: 'POST',
    body: JSON.stringify([taskRow('smoke: блокер'), taskRow('smoke: ждёт блокер'), taskRow('smoke: свободная')]),
  });
  await admin('task_dependencies', {
    method: 'POST',
    body: JSON.stringify({ org_id: demo.org_id, blocker_task_id: hub.id, blocked_task_id: held.id, type: 'blocks' }),
  });
  console.log(`   релиз «smoke ${stamp}», три задачи, команда «${team.name}»`);

  console.log('\n2. Вход');
  const { status, session } = await signIn(env, EMAIL, PASSWORD);
  check(Boolean(session.access_token), `сессия для ${EMAIL}`, `HTTP ${status}`);
  if (!session.access_token) return;
  const cookie = sessionCookies(env, session);
  const userId = (session.user as { id: string }).id;

  console.log('\n3. Сохранение');
  const blocked = await post(`/api/releases/${source.id}/scenarios`, cookie, {
    title: 'Убрать блокер', excludeTaskIds: [hub.id],
  });
  check(blocked.status === 422, 'блокер остающейся задачи не сохраняется (FR-33)', `HTTP ${blocked.status}`);

  const save = await post(`/api/releases/${source.id}/scenarios`, cookie, {
    title: 'Перенести свободную и дать часов',
    excludeTaskIds: [free.id],
    extraCapacity: [{ teamId: team.id, hours: 16 }],
    moveToReleaseId: target.id,
  });
  type Saved = {
    scenario: { id: string; applied_at: string | null; result: { delta: { remainingH: number } } };
    simulation: { delta: { remainingH: number } };
  };
  const saved = save.body as Saved;
  check(save.status === 201, 'сценарий сохранён', `HTTP ${save.status}`);
  // В базе лежит эффект, посчитанный сервером, и он тот же, что в ответе.
  check(
    saved?.scenario?.result?.delta?.remainingH === -8 &&
      saved.simulation.delta.remainingH === -8,
    'обещанный эффект записан: остаток −8ч',
  );

  const list = await get(`/api/releases/${source.id}/scenarios`, cookie);
  check(
    list.status === 200 && (list.body as Row[]).some((s) => s.id === saved?.scenario?.id),
    'сценарий виден в списке релиза',
  );

  console.log('\n4. Применение');
  const scenarioId = saved?.scenario?.id;
  const apply = await post(`/api/scenarios/${scenarioId}/apply`, cookie);
  const applied = apply.body as { applied_at: string | null; applied_by: string | null };
  check(apply.status === 200 && Boolean(applied?.applied_at), 'применён', `HTTP ${apply.status}`);
  check(applied?.applied_by === userId, 'применивший записан');

  const [moved] = await admin<{ release_id: string | null; added_to_release_at: string | null }[]>(
    `tasks?id=eq.${free.id}&select=release_id,added_to_release_at`,
  );
  check(moved?.release_id === target.id, 'задача переехала в релиз назначения');
  // Для целевого релиза задача новая: дрейф скоупа там должен её увидеть.
  check(Boolean(moved?.added_to_release_at), 'момент попадания в релиз обновлён');

  const capacity = await admin<{ available_hours: number }[]>(
    `team_capacity?team_id=eq.${team.id}&period_start=eq.${from}&period_end=eq.${planned}&select=available_hours`,
  );
  created.capacity = { team: team.id, from, to: planned };
  check(
    capacity.length === 1 && Number(capacity[0].available_hours) === 16,
    `ёмкость ${from}…${planned}: +16ч`,
  );

  const audit = await admin<{ actor_id: string; before: unknown; after: unknown }[]>(
    `audit_log?entity=eq.scenario&entity_id=eq.${scenarioId}&action=eq.apply&select=actor_id,before,after`,
  );
  check(
    audit.length === 1 && audit[0].actor_id === userId && Boolean(audit[0].before) && Boolean(audit[0].after),
    'в журнале одна запись с «до» и «после»',
  );

  const again = await post(`/api/scenarios/${scenarioId}/apply`, cookie);
  check(again.status === 409, 'повторное применение — 409', `HTTP ${again.status}`);

  console.log('\n5. Релиз изменился после расчёта');
  const stale = await post(`/api/releases/${source.id}/scenarios`, cookie, {
    title: 'Перенести блокер вместе с зависимой', excludeTaskIds: [hub.id, held.id],
  });
  const staleId = (stale.body as Saved)?.scenario?.id;
  check(stale.status === 201, 'сохранён, пока задачи открыты', `HTTP ${stale.status}`);
  // Пока сценарий лежал, зависимую задачу закрыли.
  await admin(`tasks?id=eq.${held.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
  const late = await post(`/api/scenarios/${staleId}/apply`, cookie);
  const message = (late.body as { error?: { message: string } })?.error?.message ?? '';
  check(
    late.status === 422 && message.includes('Релиз изменился'),
    'применение отклонено с объяснением',
    `HTTP ${late.status}: ${message}`,
  );
  const [untouched] = await admin<{ release_id: string | null }[]>(`tasks?id=eq.${hub.id}&select=release_id`);
  check(untouched?.release_id === source.id, 'транзакция откатилась: блокер остался на месте');

  console.log('\n6. Чего быть не должно');
  const anon = await post(`/api/scenarios/${scenarioId}/apply`, '');
  check(anon.status === 401, 'без cookie — 401', `HTTP ${anon.status}`);
  const absent = await post('/api/scenarios/00000000-0000-4000-8000-000000000000/apply', cookie);
  check(absent.status === 404, 'неизвестный сценарий — 404', `HTTP ${absent.status}`);
}

/** Уборка. Идёт всегда: временные данные не должны пережить упавшую проверку. */
async function cleanup() {
  if (created.capacity) {
    const { team, from, to } = created.capacity;
    await admin(`team_capacity?team_id=eq.${team}&period_start=eq.${from}&period_end=eq.${to}`, { method: 'DELETE' });
  }
  if (created.releases.length) {
    const ids = created.releases.join(',');
    // У задач связь с релизом `on delete set null`: удаление релиза их не
    // уносит, поэтому сначала задачи (связи уйдут каскадом), потом релизы
    // (сценарии уйдут каскадом).
    await admin(`tasks?release_id=in.(${ids})`, { method: 'DELETE' });
    await admin(`releases?id=in.(${ids})`, { method: 'DELETE' });
  }
  console.log('\nВременные данные удалены (записи журнала остаются — он только дописывается).');
}

main()
  .catch((e) => {
    failures += 1;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n${msg}`);
    if (msg.includes('fetch failed')) console.error('Рядом должен работать npm run dev.');
    if (msg.includes('apply_scenario')) console.error('Применена ли миграция 0003?');
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      failures += 1;
      console.error(`Уборка не удалась: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nНе пройдено: ${failures}.`);
    process.exit(failures === 0 ? 0 : 1);
  });
