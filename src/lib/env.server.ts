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
  ANTHROPIC_MODEL_MAIN: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_MODEL_LIGHT: z.string().default('claude-haiku-4-5'),
  AGENT_DAILY_LIMIT: z.coerce.number().int().positive().default(50),
});

const parsed = schema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_MODE: process.env.APP_MODE,
  LLM_PAYLOAD_LEVEL: process.env.LLM_PAYLOAD_LEVEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL_MAIN: process.env.ANTHROPIC_MODEL_MAIN,
  ANTHROPIC_MODEL_LIGHT: process.env.ANTHROPIC_MODEL_LIGHT,
  AGENT_DAILY_LIMIT: process.env.AGENT_DAILY_LIMIT,
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
