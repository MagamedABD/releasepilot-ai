/**
 * Серверные переменные окружения. Содержат секреты.
 *
 * ВАЖНО: этот модуль нельзя импортировать из клиентских компонентов.
 * Запрет обеспечен импортом server-only: при попытке затянуть файл
 * в браузерный бандл падает сборка, а не выполнение. Разница
 * принципиальна — проверка во время выполнения сообщила бы об утечке
 * уже после того, как секрет уехал пользователю.
 *
 * Технически Next и так не подставит в бандл переменную без префикса
 * NEXT_PUBLIC_ — в браузере она окажется undefined. Но полагаться на это
 * как на меру безопасности нельзя: это особенность сборщика, а не гарантия.
 */

import 'server-only';

import { z } from 'zod';

const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'секретный ключ Supabase не задан'),
  APP_MODE: z.enum(['demo', 'corporate']).default('demo'),
  LLM_PAYLOAD_LEVEL: z.enum(['metrics', 'titles', 'full']).default('metrics'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /**
   * Адрес совместимого с Anthropic сервера вместо облачного Claude API —
   * например, локальная Ollama (`http://localhost:11434`). Задан — агент
   * работает на локальной модели без ключа и без оплаты токенов.
   */
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  /**
   * Две модели, а не одна: рассуждение о релизе и переформулировка
   * реплики стоят по-разному, и платить за вторую как за первую незачем.
   *
   * MAIN ведёт разбор — там, где ошибка в выводе дороже лишних токенов.
   * Opus 4.7 меняет правила вызова: `temperature`, `top_p`, `top_k` и
   * `budget_tokens` дают 400, а не молча игнорируются, и содержимое
   * размышлений приходит пустым, пока не задан `display: 'summarized'`.
   * Учтено в слое агента — здесь важно, что строка идентификатора точная
   * и без суффикса даты.
   */
  ANTHROPIC_MODEL_MAIN: z.string().default('claude-opus-4-7'),
  ANTHROPIC_MODEL_LIGHT: z.string().default('claude-haiku-4-5'),
  AGENT_DAILY_LIMIT: z.coerce.number().int().positive().default(50),
  /**
   * Пароль планировщика для ежедневной записи снимков метрик (FR-39).
   *
   * Необязателен намеренно: локальная разработка без него обходится, а
   * маршрут при незаданном пароле отвечает «не настроено» и ничего не
   * делает. Открывать его без пароля нельзя — снимки пишутся
   * административным клиентом, в обход политик.
   */
  CRON_SECRET: z.string().min(16, 'пароль планировщика короче 16 символов').optional(),
  /**
   * Доступ к Yandex Tracker (FR-40). Необязательны, и это не поблажка:
   * в режиме demo их не должно быть вовсе — ADR-002 запрещает публичному
   * демо касаться корпоративного источника. Маршрут импорта проверяет и
   * режим, и наличие доступа, и отказывает по отдельности.
   */
  TRACKER_OAUTH_TOKEN: z.string().optional(),
  TRACKER_ORG_ID: z.string().optional(),
  /**
   * Почта (FR-43, FR-44). Необязательны: без них письма не уходят, а
   * уведомление о росте риска остаётся плашкой в кокпите. Отправитель —
   * адрес на домене, подтверждённом в Resend; иначе сервис отвергнет
   * письмо. Форма «Имя <адрес>» допустима, поэтому это строка, а не email.
   */
  RESEND_API_KEY: z.string().optional(),
  DIGEST_FROM_EMAIL: z.string().optional(),
});

/**
 * Пустая строка в .env — это «не задано», а не значение.
 *
 * `cp .env.example .env.local` оставляет `CRON_SECRET=` пустым, и без
 * этого правила необязательная переменная падала бы на проверке длины —
 * а вместе с ней каждый маршрут, импортирующий этот модуль, включая
 * ассистента.
 */
const unset = (v: string | undefined) => (v === '' ? undefined : v);

const parsed = schema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_MODE: process.env.APP_MODE,
  LLM_PAYLOAD_LEVEL: process.env.LLM_PAYLOAD_LEVEL,
  ANTHROPIC_API_KEY: unset(process.env.ANTHROPIC_API_KEY),
  ANTHROPIC_BASE_URL: unset(process.env.ANTHROPIC_BASE_URL),
  ANTHROPIC_MODEL_MAIN: process.env.ANTHROPIC_MODEL_MAIN,
  ANTHROPIC_MODEL_LIGHT: process.env.ANTHROPIC_MODEL_LIGHT,
  AGENT_DAILY_LIMIT: process.env.AGENT_DAILY_LIMIT,
  CRON_SECRET: unset(process.env.CRON_SECRET),
  TRACKER_OAUTH_TOKEN: unset(process.env.TRACKER_OAUTH_TOKEN),
  TRACKER_ORG_ID: unset(process.env.TRACKER_ORG_ID),
  RESEND_API_KEY: unset(process.env.RESEND_API_KEY),
  DIGEST_FROM_EMAIL: unset(process.env.DIGEST_FROM_EMAIL),
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Не заданы серверные переменные окружения:\n${details}`);
}

export const serverEnv = parsed.data;

/**
 * Режим corporate открывает доступ к реальному трекеру (ADR-002).
 * Публичный демо-инстанс обязан оставаться в demo.
 */
export const isCorporate = serverEnv.APP_MODE === 'corporate';
