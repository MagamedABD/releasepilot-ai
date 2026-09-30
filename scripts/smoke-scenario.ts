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

const { get, post, del, form } = request(BASE);

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

type Window = { team: string; from: string; to: string };
const created = {
  releases: [] as string[],
  capacity: [] as Window[],
  runs: [] as string[],
};

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
  created.capacity.push({ team: team.id, from, to: planned });
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

  console.log('\n6. Связи задач (FR-13)');
  type Dep = { blockerTaskId: string; blockedTaskId: string; type: string };
  const deps = await get(`/api/tasks/${hub.id}/dependencies`, cookie);
  check(
    deps.status === 200 && (deps.body as Dep[]).some((d) => d.blockedTaskId === held.id),
    'связи задачи отданы обеими сторонами',
    `HTTP ${deps.status}`,
  );

  // Обратная связь замкнула бы кольцо из двух звеньев. Ловит это триггер
  // в базе, а не приложение: проверка в приложении читает граф до
  // вставки и расходится с чужой параллельной вставкой.
  const cycle = await post(`/api/tasks/${held.id}/dependencies`, cookie, { blocksTaskId: hub.id });
  check(cycle.status === 409, 'цикл отклонён — 409, а не 500', `HTTP ${cycle.status}`);

  const self = await post(`/api/tasks/${hub.id}/dependencies`, cookie, { blocksTaskId: hub.id });
  check(self.status === 422, 'зависимость от себя названа полем — 422', `HTTP ${self.status}`);

  const added = await post(`/api/tasks/${hub.id}/dependencies`, cookie, {
    blockedByTaskId: free.id,
  });
  const dep = added.body as Dep;
  check(
    added.status === 201 && dep?.blockerTaskId === free.id && dep?.blockedTaskId === hub.id,
    'направление «зависит от» сохранено как пара',
    `HTTP ${added.status}`,
  );
  const twice = await post(`/api/tasks/${hub.id}/dependencies`, cookie, {
    blockedByTaskId: free.id,
  });
  check(twice.status === 409, 'повтор той же связи — 409', `HTTP ${twice.status}`);

  const removed = await del(`/api/tasks/${hub.id}/dependencies?blockedByTaskId=${free.id}`, cookie);
  check(removed.status === 204, 'связь снята — 204', `HTTP ${removed.status}`);
  const again2 = await del(`/api/tasks/${hub.id}/dependencies?blockedByTaskId=${free.id}`, cookie);
  check(again2.status === 204, 'повторное снятие — тоже 204', `HTTP ${again2.status}`);
  const left = await get(`/api/tasks/${hub.id}/dependencies`, cookie);
  check(
    (left.body as Dep[]).every((d) => d.blockerTaskId !== free.id),
    'снятой связи в списке нет',
  );

  console.log('\n7. Ёмкость команды (FR-17)');
  /*
    Окно берётся заведомо далёкое и своё: запись на окно расчёта уже
    существует у демо-данных, а PUT её заменяет — и демо-картина, на
    которой держится показ, изменилась бы молча.
  */
  const capFrom = isoDay(200);
  const capTo = isoDay(230);
  const put = (hours: number, cookieValue = cookie, body?: unknown) =>
    get(`/api/teams/${team.id}/capacity`, cookieValue, {
      method: 'PUT',
      body: JSON.stringify(body ?? { periodStart: capFrom, periodEnd: capTo, availableHours: hours }),
    });

  type Cap = { id: string; availableHours: number; periodStart: string; periodEnd: string };
  const first = await put(80);
  created.capacity.push({ team: team.id, from: capFrom, to: capTo });
  check(
    first.status === 200 && (first.body as Cap)?.availableHours === 80,
    'ёмкость задана: 80ч',
    `HTTP ${first.status}`,
  );

  // Ровно то, чем PUT отличается от применения сценария: замена, не
  // сложение. Если бы часы складывались, «задать 50» давало бы 130.
  const second = await put(50);
  check(
    second.status === 200 && (second.body as Cap)?.availableHours === 50,
    'повторный PUT заменил часы, а не сложил',
    `HTTP ${second.status}: ${(second.body as Cap)?.availableHours}ч`,
  );
  check(
    (first.body as Cap)?.id === (second.body as Cap)?.id,
    'запись та же — адресуется тройкой «команда, начало, конец»',
  );

  const listed = await get(
    `/api/teams/${team.id}/capacity?from=${capFrom}&to=${capTo}`,
    cookie,
  );
  check(
    (listed.body as Cap[])?.filter((c) => c.periodStart === capFrom).length === 1,
    'в выборке по рамкам она одна',
  );

  const flipped = await put(10, cookie, {
    periodStart: capTo,
    periodEnd: capFrom,
    availableHours: 10,
  });
  check(flipped.status === 422, 'перевёрнутый период — 422', `HTTP ${flipped.status}`);
  const anonPut = await put(10, '');
  check(anonPut.status === 401, 'PUT без cookie — 401', `HTTP ${anonPut.status}`);

  console.log('\n8. Импорт из файла: запись (FR-41)');
  /*
    Пробный прогон проверяется в smoke:api — он ничего не пишет. Здесь
    проверяется то, что пробным прогоном проверить нельзя: что задачи
    действительно заводятся, что повторная загрузка того же файла
    обновляет их, а не удваивает, и что запуск импорта попадает в
    историю. Задачи заводятся в релиз проверки, поэтому уборка их унесёт.
  */
  const importCsv = (estimate: string) =>
    [
      'ключ;название;оценка;статус;команда;релиз;blocks',
      `IMP-${stamp}-1;Импортированный блокер;${estimate};в работе;${team.name};smoke ${stamp};IMP-${stamp}-2`,
      `IMP-${stamp}-2;Импортированная зависимая;4;открыта;${team.name};smoke ${stamp};`,
    ].join('\n');

  const upload = (text: string) => {
    const body = new FormData();
    body.set('file', new File([text], 'tasks.csv', { type: 'text/csv' }));
    body.set('projectId', demo.project_id);
    return form('/api/import/file', cookie, body);
  };

  type Report = {
    runId: string;
    status: string;
    stats: { records: number; created: number; updated: number; dependencies: number; skipped: number; errors: number };
    errors: { line: number; message: string }[];
  };

  const imported = await upload(importCsv('8'));
  const firstRun = imported.body as Report;
  if (firstRun?.runId) created.runs.push(firstRun.runId);
  check(
    imported.status === 200 && firstRun?.status === 'success' && firstRun.stats.created === 2,
    `импортировано ${firstRun?.stats?.created} задач`,
    `HTTP ${imported.status}, статус ${firstRun?.status}`,
  );
  check(firstRun?.stats?.dependencies === 1, 'связь из файла создана');

  const [impTask] = await admin<
    { id: string; release_id: string; team_id: string; estimate_h: number; status: string }[]
  >(`tasks?external_key=eq.IMP-${stamp}-1&select=id,release_id,team_id,estimate_h,status`);
  check(
    impTask?.release_id === source.id && impTask?.team_id === team.id,
    'релиз и команда найдены по именам из файла',
  );
  check(impTask?.status === 'in_progress', 'статус «в работе» переведён в свой');

  // Повторная загрузка того же файла с другой оценкой: задачи те же,
  // обновлённые. Если бы импорт заводил их заново, внешний ключ упёрся бы
  // в уникальное ограничение — или, хуже, задачи удвоились бы.
  const again3 = await upload(importCsv('12'));
  const repeatRun = again3.body as Report;
  if (repeatRun?.runId) created.runs.push(repeatRun.runId);
  check(
    repeatRun?.stats?.created === 0 && repeatRun?.stats?.updated === 2,
    `повтор обновил ${repeatRun?.stats?.updated}, создал ${repeatRun?.stats?.created}`,
    `статус ${repeatRun?.status}`,
  );
  const [reimported] = await admin<{ estimate_h: number }[]>(
    `tasks?external_key=eq.IMP-${stamp}-1&select=estimate_h`,
  );
  check(Number(reimported?.estimate_h) === 12, 'оценка обновилась до 12ч');

  const runs = await admin<{ status: string; stats: { created: number }; error_report: unknown }[]>(
    `import_runs?id=eq.${firstRun?.runId}&select=status,stats,error_report`,
  );
  check(
    runs[0]?.status === 'success' && runs[0]?.stats?.created === 2,
    'запуск импорта записан в историю со статистикой',
  );

  // Файл с ошибкой: годная строка проходит, плохая объясняется, статус
  // становится partial — и запуск это фиксирует.
  const mixed = await upload(
    [
      'ключ;название;оценка;команда',
      `IMP-${stamp}-3;Годная;5;${team.name}`,
      `IMP-${stamp}-4;С чужой командой;5;Девопс`,
    ].join('\n'),
  );
  const mixedRun = mixed.body as Report;
  if (mixedRun?.runId) created.runs.push(mixedRun.runId);
  check(
    mixedRun?.status === 'partial' && mixedRun.stats.created === 1 && mixedRun.stats.errors === 1,
    'частичный импорт: одна заведена, одна объяснена',
    `статус ${mixedRun?.status}`,
  );
  // Задача без релиза уборкой не унесётся — удаляем по ключу отдельно.
  await admin(`tasks?external_key=eq.IMP-${stamp}-3`, { method: 'DELETE' });

  console.log('\n9. Чего быть не должно');
  const anon = await post(`/api/scenarios/${scenarioId}/apply`, '');
  check(anon.status === 401, 'без cookie — 401', `HTTP ${anon.status}`);
  const absent = await post('/api/scenarios/00000000-0000-4000-8000-000000000000/apply', cookie);
  check(absent.status === 404, 'неизвестный сценарий — 404', `HTTP ${absent.status}`);
}

/** Уборка. Идёт всегда: временные данные не должны пережить упавшую проверку. */
async function cleanup() {
  for (const { team, from, to } of created.capacity) {
    await admin(`team_capacity?team_id=eq.${team}&period_start=eq.${from}&period_end=eq.${to}`, { method: 'DELETE' });
  }
  if (created.runs.length) {
    // Запуски импорта, в отличие от журнала изменений, политикой на
    // удаление закрыты не намеренно: это история настроек, и оставлять в
    // ней следы проверки незачем.
    await admin(`import_runs?id=in.(${created.runs.join(',')})`, { method: 'DELETE' });
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
