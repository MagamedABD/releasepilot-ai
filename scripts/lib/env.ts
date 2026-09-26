/**
 * Чтение .env.local для служебных скриптов.
 *
 * Скрипты запускаются через tsx, а не Next.js, и переменные окружения им
 * никто не подставляет. Полноценный dotenv ради пяти строк разбора не
 * нужен, а вот повторять эти пять строк в каждом скрипте — нужно ещё
 * меньше: третья копия и стала поводом вынести их сюда.
 *
 * Модуль намеренно не использует `@/lib/env` приложения: там zod-схема
 * под серверные переменные Next и `import 'server-only'`, который вне
 * сборщика просто падает.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ScriptEnv = {
  url: string;
  anonKey: string;
  secretKey: string;
  /** Остальные значения файла — для необязательных переменных вроде SMOKE_EMAIL. */
  raw: Record<string, string>;
};

function parse(): Record<string, string> {
  const path = resolve(import.meta.dirname, '..', '..', '.env.local');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`Не найден файл ${path}. Скопируйте .env.example и заполните.`);
    process.exit(1);
  }

  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function loadEnv(): ScriptEnv {
  const raw = parse();
  const url = raw.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = raw.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !secretKey) {
    console.error('В .env.local не хватает ключей Supabase');
    process.exit(1);
  }

  return { url, anonKey, secretKey, raw };
}

/** Заголовки запроса от лица сервера. Обходят RLS — см. src/lib/supabase/admin.ts. */
export function adminHeaders(env: ScriptEnv) {
  return {
    apikey: env.secretKey,
    Authorization: `Bearer ${env.secretKey}`,
    'Content-Type': 'application/json',
  };
}
