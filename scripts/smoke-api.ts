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

const env = loadEnv();
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = env.raw.DEMO_EMAIL || 'demo@example.com';
const PASSWORD = env.raw.DEMO_PASSWORD;

if (!PASSWORD) {
  console.error('Нужна переменная DEMO_PASSWORD в .env.local — тот же пароль, что у seed:demo.');
  process.exit(1);
}

let failures = 0;
function check(passed: boolean, what: string, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Cookie сессии в формате `@supabase/ssr`.
 *
 * Имя выводится из ссылки на проект, значение — префикс `base64-` и дальше
 * base64url от JSON сессии. Длинные значения браузер не примет целиком,
 * поэтому библиотека режет их на части с суффиксами `.0`, `.1`; порог взят
 * её же — 3180 символов. Собрано это вручную и намеренно: цель проверки —
 * убедиться, что приложение читает настоящую cookie, а не что библиотека
 * согласна сама с собой.
 */
function sessionCookies(session: Record<string, unknown>): string {
  const ref = new URL(env.url).hostname.split('.')[0];
  const name = `sb-${ref}-auth-token`;
  const encoded =
    'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');

  if (encoded.length <= 3180) return `${name}=${encoded}`;

  const parts: string[] = [];
  for (let i = 0; i < encoded.length; i += 3180) {
    parts.push(`${name}.${parts.length}=${encoded.slice(i, i + 3180)}`);
  }
  return parts.join('; ');
}

type Result = { status: number; body: unknown };

/**
 * Успешный ответ обёрнут: `ok()` отдаёт `{ data }`. Обёртка снимается здесь
 * один раз, чтобы каждая проверка ниже говорила о содержимом, а не о
 * конверте: забытый `.data` даёт `undefined`, а `undefined` тихо проходит
 * половину сравнений.
 */
async function get(path: string, cookie: string): Promise<Result> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const text = await res.text();
  let body: unknown = text;
  try {
    const parsed = JSON.parse(text) as unknown;
    body =
      parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as { data: unknown }).data
        : parsed;
  } catch {
    /* не JSON — оставляем текстом, это само по себе находка */
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`База: ${BASE}\n`);

  console.log('1. Вход по паролю');
  const tok = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = (await tok.json()) as Record<string, unknown>;
  check(Boolean(session.access_token), `сессия для ${EMAIL}`, `HTTP ${tok.status}`);
  if (!session.access_token) {
    console.log('   Демо-данные загружены? npm run seed:demo');
    return;
  }
  const cookie = sessionCookies(session);

  console.log('\n2. Без сессии внутрь не пускают');
  const anon = await get('/api/releases', '');
  check(anon.status === 401, 'список релизов без cookie — 401', `HTTP ${anon.status}`);

  console.log('\n3. Список релизов');
  const list = await get('/api/releases?limit=50', cookie);
  const releases = list.body as { id: string; name: string; status: string }[] | undefined;
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
    teams: { teamName: string; remainingH: number; load: number | null; hasCapacity: boolean }[];
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

  console.log('\n7. Вопрос «успеем ли к …» (FR-23)');
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

  console.log('\n8. Чего быть не должно');
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
