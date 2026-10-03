/**
 * Сквозная проверка эндпоинтов от лица вошедшего пользователя.
 *
 * Зачем это отдельно от модульных тестов. Тесты проверяют домен и слои
 * перевода на фикстурах — без базы, сети и сессии, и это их сила. Но между
 * ними и работающим приложением лежит то, чего в них не видно: разбор
 * параметров, чтение сессии из cookie, политики RLS, формат ответа. Каждая
 * из этих вещей ломается тихо — ответ остаётся валидным JSON.
 *
 * Почему именно cookie, а не заголовок с токеном. Серверный клиент
 * приложения читает сессию только из cookie (`src/lib/supabase/server.ts`),
 * и `Authorization: Bearer` он игнорирует. Проверка, которая ходила бы с
 * заголовком, отвечала бы на вопрос, которого никто не задаёт: настоящий
 * браузер приходит с cookie. Поэтому здесь она собирается в том же
 * формате, в котором её пишет `@supabase/ssr`.
 *
 * Данные нужны демонстрационные: сначала `npm run seed:demo`. Запись не
 * делается — только чтение, так что прогон ничего не портит.
 *
 * Запуск: npm run smoke:api (рядом должен работать npm run dev)
 */

import { loadEnv } from './lib/env';
import { request, sessionCookies, signIn } from './lib/session';

const env = loadEnv();
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = env.raw.DEMO_EMAIL || 'demo@example.com';
const PASSWORD = env.raw.DEMO_PASSWORD;

if (!PASSWORD) {
  console.error('Нужна переменная DEMO_PASSWORD в .env.local — тот же пароль, что у seed:demo.');
  process.exit(1);
}

const { get, post, form } = request(BASE);

let failures = 0;
function check(passed: boolean, what: string, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`База: ${BASE}\n`);

  console.log('1. Вход по паролю');
  const { status: authStatus, session } = await signIn(env, EMAIL, PASSWORD);
  check(Boolean(session.access_token), `сессия для ${EMAIL}`, `HTTP ${authStatus}`);
  if (!session.access_token) {
    console.log('   Демо-данные загружены? npm run seed:demo');
    return;
  }
  const cookie = sessionCookies(env, session);

  console.log('\n2. Без сессии внутрь не пускают');
  const anon = await get('/api/releases', '');
  check(anon.status === 401, 'список релизов без cookie — 401', `HTTP ${anon.status}`);

  console.log('\n3. Список релизов');
  const list = await get('/api/releases?limit=50', cookie);
  const releases = list.body as
    | { id: string; name: string; status: string; projectId: string }[]
    | undefined;
  check(list.status === 200 && Array.isArray(releases), 'отдан список', `HTTP ${list.status}`);
  if (!releases?.length) {
    console.log('   Релизов нет. npm run seed:demo');
    return;
  }
  check(releases.length >= 9, `релизов ${releases.length}`, 'ожидалось не меньше девяти');

  // Активный релиз — витрина движка, на нём проверяется всё интересное.
  const target = releases.find((r) => r.status === 'active') ?? releases[0];
  console.log(`   считаем по «${target.name}»`);

  console.log('\n4. Метрики, риск, причины');
  const m = await get(`/api/releases/${target.id}/metrics`, cookie);
  type Metrics = {
    riskScore: number;
    riskLevel: string;
    readinessPct: number;
    probabilityOnTime: number | null;
    factors: { code: string }[];
    reasons: { code: string; kind: string }[];
    teamLoad: { teamName: string; load: number | null; hasCapacity: boolean }[];
    blockers: unknown[];
    criticalChain: { days: number };
  };
  const metrics = m.body as Metrics;
  check(m.status === 200, 'метрики отданы', `HTTP ${m.status}`);
  check(metrics?.factors?.length === 6, 'все шесть факторов на месте');
  check(
    typeof metrics?.riskScore === 'number' && ['low', 'medium', 'high', 'critical'].includes(metrics.riskLevel),
    `риск ${metrics?.riskScore} → ${metrics?.riskLevel}`,
  );
  check(
    metrics?.teamLoad?.every((t) => (t.hasCapacity ? typeof t.load === 'number' : t.load === null)),
    'загрузка команд и признак ёмкости согласованы',
  );
  /*
    Главное здесь. Вероятность в метриках не украшение: по ней срабатывает
    правило эскалации LOW_PROBABILITY. Не посчитай маршрут прогноз — поле
    было бы `null`, ответ остался бы правдоподобным, а уровень риска у
    самого опасного релиза — заниженным.
  */
  check(
    typeof metrics?.probabilityOnTime === 'number',
    `вероятность дошла до движка риска: ${metrics?.probabilityOnTime}`,
  );
  console.log(
    `     готовность ${metrics?.readinessPct}% · цепочка ${metrics?.criticalChain?.days}д · ` +
      `блокеров ${metrics?.blockers?.length} · причины ${metrics?.reasons?.map((r) => r.code).join(' ')}`,
  );

  console.log('\n5. Прогноз');
  const f = await get(`/api/releases/${target.id}/forecast`, cookie);
  type Forecast = {
    method: string;
    reachable: boolean;
    probabilityOnTime: number | null;
    expectedDate: string | null;
    expectedWorkingDays: number | null;
    percentiles: { probability: number; date: string | null }[];
    iterations: number;
  };
  const forecast = f.body as Forecast;
  check(f.status === 200, 'прогноз отдан', `HTTP ${f.status}`);
  check(forecast?.method === 'monte_carlo', `метод ${forecast?.method}`, 'истории хватает');
  check(forecast?.reachable === true, 'срок достижим, дни — число');
  // Сравнение с требованием «это число»: иначе `undefined === undefined`
  // прошло бы как совпадение, и проверка врала бы ровно там, где нужна.
  check(
    typeof forecast?.probabilityOnTime === 'number' &&
      forecast.probabilityOnTime === metrics?.probabilityOnTime,
    'вероятность в метриках и в прогнозе — одно и то же число',
  );
  console.log(
    `     ожидание ${forecast?.expectedDate} (${forecast?.expectedWorkingDays}д) · ` +
      forecast?.percentiles?.map((p) => `P${p.probability * 100} ${p.date}`).join(' · '),
  );

  console.log('\n6. Узкие выборки');
  const tl = await get(`/api/releases/${target.id}/team-load`, cookie);
  type TeamLoadView = {
    remainingWorkingDays: number;
    teams: {
      teamId: string;
      teamName: string;
      remainingH: number;
      load: number | null;
      hasCapacity: boolean;
    }[];
  };
  const teamLoad = tl.body as TeamLoadView;
  check(tl.status === 200, 'загрузка команд отдана', `HTTP ${tl.status}`);
  // Те же числа, что и в метриках: узкая выборка не должна считать иначе.
  check(
    teamLoad?.teams?.length === metrics?.teamLoad?.length &&
      teamLoad.teams.every((t, i) => t.load === metrics.teamLoad[i].load),
    'совпадает с загрузкой из метрик',
  );
  console.log(
    `     ${teamLoad?.remainingWorkingDays}д в запасе · ` +
      teamLoad?.teams
        ?.map((t) => `${t.teamName} ${t.hasCapacity ? `${Math.round((t.load ?? 0) * 100)}%` : 'нет ёмкости'}`)
        .join(' · '),
  );

  const bl = await get(`/api/releases/${target.id}/blockers`, cookie);
  type BlockersView = {
    blockers: { task: { id: string; key: string | null; title: string | null }; blockedDays: number; blocksCount: number; isStale: boolean }[];
    criticalChain: { days: number; tasks: { key: string | null; title: string | null }[] };
  };
  const blockers = bl.body as BlockersView;
  check(bl.status === 200, 'блокеры отданы', `HTTP ${bl.status}`);
  check(
    blockers?.blockers?.length === metrics?.blockers?.length,
    'блокеров столько же, сколько в метриках',
  );
  /*
    Главное, ради чего этот эндпоинт отдельный: задачи названы. По списку
    UUID экран блокеров нечитаем, а названия лежат в том же снимке.
  */
  check(
    blockers?.blockers?.every((b) => b.task.key !== null && b.task.title !== null),
    'у каждого блокера есть ключ и название',
  );
  check(
    blockers?.criticalChain?.tasks?.length > 0 &&
      blockers.criticalChain.tasks.every((t) => t.key !== null),
    `критическая цепочка названа: ${blockers?.criticalChain?.tasks?.length} задач`,
  );
  for (const b of blockers?.blockers ?? []) {
    console.log(
      `     ${b.task.key} ${b.task.title} — ${b.blockedDays}д, держит ${b.blocksCount}${b.isStale ? ', застарелый' : ''}`,
    );
  }

  console.log('\n7. Команды и ёмкость (FR-17)');
  type TeamRef = { id: string; orgId: string; name: string; kind: string };
  const tms = await get('/api/teams', cookie);
  const teams = tms.body as TeamRef[];
  check(tms.status === 200 && teams?.length > 0, `команды отданы: ${teams?.length}`, `HTTP ${tms.status}`);

  /*
    Каждая команда из загрузки должна быть в справочнике. Расхождение
    означало бы, что экран загрузки называет команды, которых в настройках
    нет, — и настроить им ёмкость было бы негде.
  */
  const known = new Set(teams?.map((t) => t.id));
  check(
    teamLoad?.teams?.every((t) => known.has(t.teamId)),
    'команды из загрузки есть в справочнике',
  );

  const loaded = teamLoad?.teams?.find((t) => t.hasCapacity);
  const today = new Date().toISOString().slice(0, 10);
  const cap = await get(`/api/teams/${loaded?.teamId}/capacity?from=${today}`, cookie);
  type CapacityRow = { teamId: string; periodStart: string; periodEnd: string; availableHours: number };
  const rows = cap.body as CapacityRow[];
  check(cap.status === 200, 'ёмкость команды отдана', `HTTP ${cap.status}`);
  // Загрузка посчиталась — значит, ёмкость на это окно задана, и эндпоинт
  // обязан её показать. Иначе экран сказал бы «ёмкость не задана» там, где
  // расчёт её только что использовал.
  check(
    rows?.length > 0 && rows.every((r) => r.teamId === loaded?.teamId),
    `у команды «${loaded?.teamName}» есть запись на окно расчёта`,
  );
  for (const r of rows ?? []) {
    console.log(`     ${r.periodStart}…${r.periodEnd}: ${r.availableHours}ч`);
  }

  const flipped = await get(
    `/api/teams/${loaded?.teamId}/capacity?from=2026-12-31&to=2026-01-01`,
    cookie,
  );
  check(flipped.status === 422, 'перевёрнутые рамки — 422', `HTTP ${flipped.status}`);
  const noTeam = await get('/api/teams/00000000-0000-4000-8000-000000000000/capacity', cookie);
  check(noTeam.status === 404, 'неизвестная команда — 404', `HTTP ${noTeam.status}`);
  const noAuth = await get('/api/teams', '');
  check(noAuth.status === 401, 'справочник без cookie — 401', `HTTP ${noAuth.status}`);

  console.log('\n8. История поставки (FR-36, FR-38)');
  const orgId = teams?.[0]?.orgId;
  type Delivery = {
    delivery: {
      released: number;
      onTime: number;
      onTimePct: number | null;
      avgDelayDays: number | null;
      avgDeviationDays: number | null;
      worstDelay: { name: string; delayDays: number } | null;
      cancelled: number;
      postponed: number;
      inFlight: number;
      releasedWithoutDate: number;
      records: { name: string; plannedDate: string; releasedDate: string; deviationDays: number }[];
    };
    snapshots: { count: number; from: string | null; to: string | null };
  };
  const an = await get(`/api/analytics/releases?orgId=${orgId}`, cookie);
  const { delivery, snapshots } = an.body as Delivery;
  check(an.status === 200, 'история отдана', `HTTP ${an.status}`);
  /*
    Прогноз выше выбрал метод monte_carlo, а он требует истории. Значит,
    выпущенные релизы есть, и аналитика обязана их видеть: расхождение
    означало бы, что «историей» два эндпоинта называют разное.
  */
  check(
    delivery?.released > 0 && delivery.records.length === delivery.released,
    `выпущенных релизов ${delivery?.released}, столько же записей`,
  );
  check(
    delivery?.records?.every((r, i, all) => i === 0 || all[i - 1].releasedDate <= r.releasedDate),
    'записи идут по порядку выпуска — это и есть динамика',
  );
  // Средняя задержка считается по опоздавшим: без опоздавших она ноль,
  // с опоздавшими — строго больше нуля, и никогда не отрицательна.
  const late = delivery?.records?.filter((r) => r.deviationDays > 0).length ?? 0;
  check(
    late === 0 ? delivery?.avgDelayDays === 0 : (delivery?.avgDelayDays ?? 0) > 0,
    `опоздавших ${late}, средняя задержка ${delivery?.avgDelayDays}д`,
  );
  console.log(
    `     в срок ${delivery?.onTime}/${delivery?.released} (${delivery?.onTimePct}%) · ` +
      `отклонение ${delivery?.avgDeviationDays}д · отменено ${delivery?.cancelled} · в работе ${delivery?.inFlight}`,
  );
  if (delivery?.worstDelay) {
    console.log(`     худший: ${delivery.worstDelay.name} — ${delivery.worstDelay.delayDays}д`);
  }
  for (const r of delivery?.records ?? []) {
    console.log(
      `     ${r.name}: план ${r.plannedDate} → ${r.releasedDate} (${r.deviationDays > 0 ? '+' : ''}${r.deviationDays}д)`,
    );
  }
  /*
    Охват снимков отдаётся рядом с историей намеренно. Повторяющиеся
    причины задержек (FR-37) считаются по снимкам, и пока их нет, ответ
    говорит «нечем», а не отдаёт пустой список, который читался бы как
    «причин не было».
  */
  check(
    typeof snapshots?.count === 'number',
    `снимков метрик ${snapshots?.count}`,
    snapshots?.count === 0 ? 'причины задержек ждут ежедневной записи (FR-39)' : `${snapshots?.from}…${snapshots?.to}`,
  );

  const noOrg = await get('/api/analytics/releases', cookie);
  check(noOrg.status === 422, 'без организации — 422, а не история двух сразу', `HTTP ${noOrg.status}`);
  const alien = await get(
    '/api/analytics/releases?orgId=00000000-0000-4000-8000-000000000000',
    cookie,
  );
  check(
    alien.status === 200 && (alien.body as Delivery)?.delivery?.released === 0,
    'чужая организация — пустая история, а не отказ',
    `HTTP ${alien.status}`,
  );

  console.log('\n9. Вопрос «успеем ли к …» (FR-23)');
  // Чем позже дата, тем выше вероятность. Немонотонность означала бы, что
  // распределение считается не по одному и тому же прогону.
  const probes = [0, 7, 21, 60].map((d) => {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() + d);
    return dt.toISOString().slice(0, 10);
  });
  const answers: number[] = [];
  for (const date of probes) {
    const r = await get(`/api/releases/${target.id}/forecast?targetDate=${date}`, cookie);
    const p = (r.body as Forecast)?.probabilityOnTime;
    answers.push(typeof p === 'number' ? p : -1);
    console.log(`     к ${date}: ${typeof p === 'number' ? `${Math.round(p * 100)}%` : '—'}`);
  }
  check(
    answers.every((p, i) => p >= 0 && (i === 0 || p >= answers[i - 1])),
    'вероятность не убывает с отдалением срока',
  );

  console.log('\n10. Импорт из файла: пробный прогон (FR-41)');
  /*
    Пробный прогон ничего не пишет, поэтому проверяется здесь, вместе с
    остальным чтением. Настоящая запись — в smoke:scenario.

    Файл собран так, чтобы в нём было и хорошее, и плохое: две годные
    строки, строка без названия, строка с неизвестной командой и строка с
    повторным ключом. Отчёт обязан назвать каждую по номеру и колонке.
  */
  const stamp = Date.now();
  const csv = [
    'ключ;название;оценка;статус;приоритет;команда;blocks',
    `SMOKE-${stamp}-1;Первая годная;8;в работе;critical;Тестирование;SMOKE-${stamp}-2`,
    `SMOKE-${stamp}-2;Вторая годная;4,5;In Progress;major;;`,
    `SMOKE-${stamp}-3;;2;;;;`,
    `SMOKE-${stamp}-4;С чужой командой;3;;;Девопс;`,
    `SMOKE-${stamp}-1;Повтор ключа;1;;;;`,
  ].join('\n');

  const body = new FormData();
  body.set('file', new File([csv], 'tasks.csv', { type: 'text/csv' }));
  body.set('projectId', target.projectId);
  body.set('dryRun', 'true');
  const dry = await form('/api/import/file', cookie, body);
  type Report = {
    dryRun: boolean;
    status: string;
    stats: {
      records: number;
      created: number;
      updated: number;
      dependencies: number;
      skipped: number;
      errors: number;
    };
    errors: { line: number; field: string | null; message: string }[];
  };
  const report = dry.body as Report;
  check(dry.status === 200 && report?.dryRun === true, 'отчёт получен', `HTTP ${dry.status}`);
  check(report?.status === 'partial', `статус ${report?.status}`, 'часть строк годна, часть нет');
  // Арифметика отчёта должна сходиться по построению: пропущено — это
  // разность, а не отдельно посчитанное число.
  check(
    report?.stats?.records === 5 &&
      report.stats.created === 2 &&
      report.stats.skipped === report.stats.records - report.stats.created - report.stats.updated,
    `записей ${report?.stats?.records}, годных ${report?.stats?.created}, пропущено ${report?.stats?.skipped}`,
  );
  check(
    report?.stats?.dependencies === 1,
    'связь из колонки blocks разрешилась внутри файла',
  );
  check(
    report?.errors?.map((e) => `${e.line}:${e.field}`).join(' ') === '4:title 5:team 6:key',
    'каждая плохая строка названа по номеру и колонке',
    report?.errors?.map((e) => `${e.line}:${e.field}`).join(' '),
  );
  for (const e of report?.errors ?? []) {
    console.log(`     строка ${e.line} · ${e.field ?? '—'} · ${e.message}`);
  }

  // Пробный прогон обязан быть бесследным: ни задач, ни запусков.
  const after = await get(`/api/tasks?q=SMOKE-${stamp}`, cookie);
  check(
    (after.body as unknown[])?.length === 0,
    'пробный прогон ничего не записал',
    `найдено ${(after.body as unknown[])?.length}`,
  );

  const noFile = new FormData();
  noFile.set('projectId', target.projectId);
  const noFileRes = await form('/api/import/file', cookie, noFile);
  check(noFileRes.status === 422, 'без файла — 422', `HTTP ${noFileRes.status}`);

  const wrongType = new FormData();
  wrongType.set('file', new File(['ключ\nPAY-1'], 'tasks.txt', { type: 'text/plain' }));
  wrongType.set('projectId', target.projectId);
  const unknown = await form('/api/import/file', cookie, wrongType);
  check(unknown.status === 422, 'неизвестное расширение — 422', `HTTP ${unknown.status}`);

  const anonImport = new FormData();
  anonImport.set('projectId', target.projectId);
  const anonRes = await form('/api/import/file', '', anonImport);
  check(anonRes.status === 401, 'импорт без cookie — 401', `HTTP ${anonRes.status}`);

  console.log('\n11. What-if (FR-31, FR-33)');
  type Side = {
    metrics: { riskScore: number; riskLevel: string; teamLoad: { teamId: string; load: number | null }[] };
    forecast: { probabilityOnTime: number | null; expectedDate: string | null };
  };
  type Simulation = {
    before: Side;
    after: Side;
    delta: { riskScore: number; probabilityOnTime: number | null; expectedWorkingDays: number | null };
  };
  type MetricsWithIds = { teamLoad: { teamId: string; teamName: string; load: number | null; hasCapacity: boolean }[] };

  // Часы — самой загруженной команде из тех, у кого ёмкость вообще есть:
  // это первое, что предложил бы менеджер, и эффект должен быть виден.
  const busiest = [...((metrics as unknown as MetricsWithIds)?.teamLoad ?? [])]
    .filter((t) => t.hasCapacity)
    .sort((a, b) => (b.load ?? 0) - (a.load ?? 0))[0];
  const sc = await post(`/api/releases/${target.id}/simulate`, cookie, {
    extraCapacity: [{ teamId: busiest?.teamId, hours: 40 }],
  });
  const simulation = sc.body as Simulation;
  check(sc.status === 200, `+40ч команде «${busiest?.teamName}» посчитано`, `HTTP ${sc.status}`);
  // «До» обязано совпадать с карточкой: иначе дельта мерила бы разницу
  // двух расчётов, а не эффект сценария.
  check(
    typeof simulation?.before?.metrics?.riskScore === 'number' &&
      simulation.before.metrics.riskScore === metrics?.riskScore &&
      simulation.before.forecast.probabilityOnTime === metrics?.probabilityOnTime,
    '«до» совпадает с метриками релиза',
  );
  check(
    typeof simulation?.delta?.riskScore === 'number' && simulation.delta.riskScore <= 0,
    `скор ${simulation?.before?.metrics?.riskScore} → ${simulation?.after?.metrics?.riskScore} ` +
      `(${simulation?.delta?.riskScore})`,
    'дополнительные часы не могут поднять риск',
  );
  console.log(
    `     вероятность ${simulation?.before?.forecast?.probabilityOnTime} → ${simulation?.after?.forecast?.probabilityOnTime}` +
      ` · дата ${simulation?.before?.forecast?.expectedDate} → ${simulation?.after?.forecast?.expectedDate}`,
  );

  // FR-33: блокер, который держит остающиеся задачи, перенести нельзя.
  const holder = blockers?.blockers?.find((b) => b.blocksCount > 0);
  if (holder) {
    const rej = await post(`/api/releases/${target.id}/simulate`, cookie, {
      excludeTaskIds: [holder.task.id],
    });
    const code = (rej.body as { error?: { code: string } })?.error?.code;
    check(
      rej.status === 422 && code === 'scenario_rejected',
      `перенос ${holder.task.key} отклонён: держит ${holder.blocksCount}`,
      `HTTP ${rej.status} ${code}`,
    );
  }

  const empty = await post(`/api/releases/${target.id}/simulate`, cookie, {});
  check(empty.status === 422, 'пустой сценарий — 422', `HTTP ${empty.status}`);
  const anonSim = await post(`/api/releases/${target.id}/simulate`, '', { excludeTaskIds: [] });
  check(anonSim.status === 401, 'симуляция без cookie — 401', `HTTP ${anonSim.status}`);

  console.log('\n12. Ассистент: отказ не ломает приложение (NFR-07)');
  /*
    Ключа Claude API в окружении нет, и это не пропуск проверки, а сама
    проверка: публичное демо должно работать без агента. Отказ обязан
    выглядеть как «ассистент недоступен», а не как пятисотая, и всё
    остальное обязано продолжать работать.
  */
  const noAuthChat = await post('/api/agent/chat', '', { orgId, message: 'Что с релизом?' });
  check(noAuthChat.status === 401, 'диалог без cookie — 401', `HTTP ${noAuthChat.status}`);

  const emptyQuestion = await post('/api/agent/chat', cookie, { orgId, message: '   ' });
  check(emptyQuestion.status === 422, 'пустой вопрос — 422', `HTTP ${emptyQuestion.status}`);

  const chat = await post('/api/agent/chat', cookie, {
    orgId,
    releaseId: target.id,
    message: 'Что сейчас угрожает релизу?',
  });
  const chatError = (chat.body as { error?: { code: string; message: string } })?.error;
  check(
    chat.status === 503 && chatError?.code === 'ai_unavailable',
    'без ключа — ai_unavailable, а не пятисотая',
    `HTTP ${chat.status} ${chatError?.code ?? ''}`,
  );
  check(
    Boolean(chatError?.message?.includes('работают')),
    'ответ сообщает, что остальное приложение работает',
    chatError?.message,
  );

  // Буквальная проверка NFR-07: после отказа ассистента кокпит жив.
  const stillAlive = await get(`/api/releases/${target.id}/metrics`, cookie);
  check(stillAlive.status === 200, 'метрики после отказа ассистента — 200', `HTTP ${stillAlive.status}`);

  console.log('\n13. Импорт из трекера: режим (ADR-002)');
  /*
    Проверка целиком про отказ, и это единственное, что здесь можно
    проверить честно: демо работает в режиме demo, а эндпоинт в нём не
    должен делать ничего — ни ходить в трекер, ни читать тело запроса.
    Корпоративный путь живьём не проверялся: это чужие данные.
  */
  const tracker = await post('/api/import/tracker', cookie, {
    projectId: target.projectId,
    queue: 'PPT',
  });
  const trackerError = (tracker.body as { error?: { code: string; message: string } })?.error;
  check(
    tracker.status === 409 && trackerError?.code === 'mode_required',
    'в демо-режиме импорт из трекера отклонён',
    `HTTP ${tracker.status} ${trackerError?.code ?? ''}`,
  );
  check(
    Boolean(trackerError?.message?.includes('синтетических')),
    'отказ объясняет, почему так, а не просто запрещает',
    trackerError?.message,
  );

  console.log('\n14. Чего быть не должно');
  const bad = await get(`/api/releases/${target.id}/forecast?targetDate=2026-02-30`, cookie);
  check(bad.status === 422, 'тридцатое февраля отклонено, а не перекатано в март', `HTTP ${bad.status}`);

  const notUuid = await get('/api/releases/не-идентификатор/metrics', cookie);
  check(notUuid.status === 404, 'мусор вместо идентификатора — 404', `HTTP ${notUuid.status}`);

  // Существующий, но чужой релиз выглядит так же, как несуществующий:
  // RLS отдаёт чужую строку пустым результатом, и подтверждать её
  // существование отказом мы не должны (ADR-003).
  const absent = await get('/api/releases/00000000-0000-4000-8000-000000000000/metrics', cookie);
  check(absent.status === 404, 'неизвестный релиз — 404, не 403', `HTTP ${absent.status}`);
}

main()
  .catch((e) => {
    failures += 1;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n${msg}`);
    if (msg.includes('fetch failed')) console.error('Рядом должен работать npm run dev.');
  })
  .then(() => {
    console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nНе пройдено: ${failures}.`);
    process.exit(failures === 0 ? 0 : 1);
  });
