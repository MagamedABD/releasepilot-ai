/**
 * Публичные переменные окружения.
 *
 * Этот модуль безопасно импортировать где угодно, включая клиентские
 * компоненты: в нём нет ни одного секрета. Серверные переменные живут
 * отдельно, в env.server.ts, и туда нельзя попасть из браузерного кода.
 *
 * Зачем проверка вместо прямого process.env: опечатка в имени переменной
 * или незаполненное значение на деплое проявились бы не при старте,
 * а первым же запросом к базе — с невнятным «Invalid API key» в консоли
 * у пользователя. Лучше упасть сразу и с текстом, объясняющим, что делать.
 */

import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('должен быть полный URL проекта Supabase'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'ключ выглядит обрезанным — проверьте, что скопирован целиком'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

// Обращение строго по литеральным именам: Next подставляет значения
// NEXT_PUBLIC_* в бандл на этапе сборки, и динамический доступ
// вида process.env[name] работать не будет.
const parsed = schema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Не заданы публичные переменные окружения:\n${details}\n` +
      'Заполните .env.local по образцу .env.example.',
  );
}

export const env = parsed.data;
