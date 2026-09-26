/**
 * Сквозная проверка регистрации, входа и создания организации.
 *
 * Идёт теми же путями, что и приложение: обычный signUp публичным ключом,
 * вход по паролю, вызов RPC от лица пользователя. Служебный ключ берётся
 * только там, где его берёт и настоящий сервер, — для уборки за собой
 * и для взгляда «сверху», чтобы убедиться, что созданное действительно
 * создано, а не просто не вызвало ошибки.
 *
 * Зачем это отдельно от модульных тестов: здесь проверяется не наш код,
 * а то, что происходит между ним и Supabase — триггеры, политики, права
 * на функции. Ни одно из этого не видно ни компилятору, ни vitest.
 *
 * Скрипт создаёт временного пользователя и временную организацию и
 * удаляет их за собой в любом случае, включая падение посередине.
 *
 * Запуск: npm run smoke:auth
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(import.meta.dirname, '..', '.env.local'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = env.SUPABASE_SERVICE_ROLE_KEY;
const SMOKE_EMAIL = env.SMOKE_EMAIL;

if (!URL_BASE || !ANON || !SECRET) {
  console.error('В .env.local не хватает ключей Supabase');
  process.exit(1);
}

/**
 * Адрес для пробной регистрации берётся из .env.local, а не зашит в код.
 *
 * Причина не в гибкости. Supabase проверяет домен и отвергает
 * зарезервированные (`example.com`, `.test`, `.local`) кодом
 * `email_address_invalid` — то есть адрес, который заведомо никому не
 * принадлежит, здесь использовать нельзя. Остаются только настоящие
 * домены, а регистрировать кого попало на чужой адрес недопустимо:
 * при включённом подтверждении на него уйдёт письмо.
 *
 * Поэтому адрес указывает владелец проекта — свой собственный, — и
 * указывает его в файле, которого нет в репозитории. К адресу
 * добавляется метка через плюс: Supabase считает такие адреса разными
 * пользователями, а письма всё равно придут в тот же ящик.
 */
if (!SMOKE_EMAIL) {
  console.error(
    [
      'Нужна переменная SMOKE_EMAIL в .env.local — адрес для пробной регистрации.',
      '',
      'Укажите свой настоящий адрес: зарезервированные домены вроде example.com',
      'Supabase отвергает, а регистрировать пользователя на чужой адрес нельзя.',
      'К адресу будет добавлена метка через плюс, и пользователь удалится сразу.',
      '',
      '  SMOKE_EMAIL=вы@example-настоящий-домен',
    ].join('\n'),
  );
  process.exit(1);
}

/** Уникальный адрес на основе настоящего: local+метка@домен. */
function probeEmail(stamp: number): string {
  const [local, domain] = SMOKE_EMAIL.split('@');
  return `${local}+rp${stamp}@${domain}`;
}

const json = { 'Content-Type': 'application/json' };
const asAnon = { apikey: ANON, Authorization: `Bearer ${ANON}`, ...json };
const asAdmin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...json };
const asUser = (token: string) => ({ apikey: ANON, Authorization: `Bearer ${token}`, ...json });

let failures = 0;
function check(passed: boolean, what: string, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Отказ работать, пока включено подтверждение почты.
 *
 * Не придирчивость, а защита от порчи чужого состояния. Встроенный SMTP
 * Supabase на бесплатном тарифе отправляет два письма в час, и каждый
 * запуск проверки съедал бы половину суточного запаса живой регистрации.
 * Вдобавок сессии при включённом подтверждении не будет, и всё
 * интересное — RPC, политики, журнал — осталось бы непроверенным:
 * скрипт сообщал бы «не пройдено» там, где всё правильно.
 */
async function requireAutoconfirm(): Promise<boolean> {
  const res = await fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: ANON } });
  const settings = (await res.json()) as { mailer_autoconfirm?: boolean };

  if (settings.mailer_autoconfirm) return true;

  console.error(
    [
      'В проекте включено подтверждение почты (mailer_autoconfirm: false).',
      '',
      'Проверка не запускается: письмо расходует лимит встроенного SMTP',
      '(два в час), а сессия всё равно не выдаётся — проверять было бы нечего.',
      '',
      'Authentication → Sign In / Providers → Email → снять «Confirm email».',
    ].join('\n'),
  );
  return false;
}

async function main() {
  if (!(await requireAutoconfirm())) {
    failures += 1;
    return;
  }

  const stamp = Date.now();
  const email = probeEmail(stamp);
  const password = `probe-parol-${stamp}`;
  const slug = `probe-${stamp}`;

  let userId = '';
  let orgId = '';

  try {
    console.log('1. Регистрация обычным путём');
    const signUp = await fetch(`${URL_BASE}/auth/v1/signup`, {
      method: 'POST',
      headers: asAnon,
      body: JSON.stringify({ email, password, data: { full_name: 'Пробный Пользователь' } }),
    });
    const signUpBody = await signUp.json();
    check(signUp.ok, 'signUp принят', `HTTP ${signUp.status}`);

    if (!signUp.ok) {
      console.log(`     ответ: ${JSON.stringify(signUpBody)}`);
      // Дальше идти бессмысленно: всё остальное опирается на пользователя
      return;
    }

    userId = signUpBody.user?.id ?? signUpBody.id;
    const immediateSession: string | undefined = signUpBody.access_token;
    check(
      Boolean(immediateSession),
      'сессия выдана сразу',
      immediateSession ? 'подтверждение почты выключено' : 'включено подтверждение почты',
    );

    console.log('2. Триггер handle_new_user');
    const prof = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${userId}&select=id,full_name`, {
      headers: asAdmin,
    });
    const profRows = (await prof.json()) as { full_name: string | null }[];
    check(profRows.length === 1, 'профиль создан базой, а не приложением');
    check(profRows[0]?.full_name === 'Пробный Пользователь', 'имя перенесено из метаданных');

    console.log('3. Вход по почте и паролю');
    const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: asAnon,
      body: JSON.stringify({ email, password }),
    });
    const tokBody = await tok.json();
    const token: string = tokBody.access_token ?? '';
    check(Boolean(token), 'выдан токен доступа', `HTTP ${tok.status}`);
    if (!token) return;

    console.log('4. Создание организации через RPC');
    const rpc = await fetch(`${URL_BASE}/rest/v1/rpc/create_organization`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({ p_name: 'Пробная организация', p_slug: slug }),
    });
    const org = await rpc.json();
    check(rpc.ok && org?.slug === slug, 'организация создана', `HTTP ${rpc.status}`);
    orgId = org?.id ?? '';
    if (!orgId) return;

    console.log('5. Что видит пользователь под RLS');
    const mem = await fetch(`${URL_BASE}/rest/v1/memberships?select=role,organizations(slug)`, {
      headers: asUser(token),
    });
    const memRows = (await mem.json()) as { role: string; organizations: { slug: string } | null }[];
    check(memRows.length === 1, 'ровно одно участие');
    check(memRows[0]?.role === 'owner', 'создатель стал владельцем');
    check(memRows[0]?.organizations?.slug === slug, 'вложенная выборка отдаёт связанную строку');

    const audit = await fetch(
      `${URL_BASE}/rest/v1/audit_log?select=action,entity&org_id=eq.${orgId}`,
      { headers: asUser(token) },
    );
    const auditRows = (await audit.json()) as { action: string; entity: string }[];
    check(
      auditRows.length === 1 && auditRows[0].action === 'create',
      'создание записано в журнал той же транзакцией',
    );

    console.log('6. Чего пользователю нельзя');
    const dup = await fetch(`${URL_BASE}/rest/v1/rpc/create_organization`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({ p_name: 'Дубль', p_slug: slug }),
    });
    const dupBody = await dup.json();
    check(dupBody?.code === '23505', 'занятый адрес отклонён с распознаваемым кодом', `HTTP ${dup.status}`);

    const direct = await fetch(`${URL_BASE}/rest/v1/organizations`, {
      method: 'POST',
      headers: asUser(token),
      body: JSON.stringify({ name: 'Мимо функции', slug: `${slug}-direct` }),
    });
    check(direct.status === 401 || direct.status === 403, 'вставка в обход RPC запрещена политиками', `HTTP ${direct.status}`);

    console.log('7. Что видит посторонний');
    const guest = await fetch(`${URL_BASE}/rest/v1/organizations?slug=eq.${slug}&select=id`, {
      headers: asAnon,
    });
    const guestRows = await guest.json();
    // Важно именно это: не отказ, а пустота. Отказ подтвердил бы, что
    // организация с таким адресом существует.
    check(
      Array.isArray(guestRows) && guestRows.length === 0,
      'чужая организация не видна и не подтверждена отказом',
      `HTTP ${guest.status}`,
    );
  } finally {
    console.log('8. Уборка');
    if (orgId) {
      const d = await fetch(`${URL_BASE}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: asAdmin,
      });
      check(d.ok, 'временная организация удалена', `HTTP ${d.status}`);
    }
    if (userId) {
      const d = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: asAdmin,
      });
      check(d.ok, 'временный пользователь удалён', `HTTP ${d.status}`);
    }
  }
}

main()
  .catch((e) => {
    failures += 1;
    console.error(e instanceof Error ? e.message : e);
  })
  .then(() => {
    console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nНе пройдено: ${failures}.`);
    process.exit(failures === 0 ? 0 : 1);
  });
