/**
 * Вход и запросы от лица пользователя для сквозных проверок.
 *
 * Вынесено из smoke-api.ts, когда появилась вторая проверка
 * (smoke-scenario.ts): cookie собирается нетривиально, и две копии этой
 * сборки разошлись бы при первой же правке формата.
 */

import type { ScriptEnv } from './env';

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
export function sessionCookies(env: ScriptEnv, session: Record<string, unknown>): string {
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

/** Вход по паролю. Возвращает сессию целиком: из неё собирается cookie. */
export async function signIn(
  env: ScriptEnv,
  email: string,
  password: string,
): Promise<{ status: number; session: Record<string, unknown> }> {
  const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, session: (await res.json()) as Record<string, unknown> };
}

export type Result = { status: number; body: unknown };

/**
 * Успешный ответ обёрнут: `ok()` отдаёт `{ data }`. Обёртка снимается здесь
 * один раз, чтобы каждая проверка говорила о содержимом, а не о конверте:
 * забытый `.data` даёт `undefined`, а `undefined` тихо проходит половину
 * сравнений.
 */
export function request(base: string) {
  async function get(path: string, cookie: string, init: RequestInit = {}): Promise<Result> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { cookie, 'Content-Type': 'application/json' },
    });
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

  function post(path: string, cookie: string, body?: unknown): Promise<Result> {
    return get(path, cookie, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function del(path: string, cookie: string): Promise<Result> {
    return get(path, cookie, { method: 'DELETE' });
  }

  /**
   * Отправка формы.
   *
   * Отдельно от `post`, потому что `Content-Type` для multipart ставит
   * сам fetch — вместе с границей частей. Задай его руками, и тело
   * станет нечитаемым: границы в заголовке и в теле разойдутся.
   */
  async function form(path: string, cookie: string, data: FormData): Promise<Result> {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie }, body: data });
    const text = await res.text();
    let body: unknown = text;
    try {
      const parsed = JSON.parse(text) as unknown;
      body =
        parsed && typeof parsed === 'object' && 'data' in parsed
          ? (parsed as { data: unknown }).data
          : parsed;
    } catch {
      /* не JSON — оставляем текстом */
    }
    return { status: res.status, body };
  }

  return { get, post, del, form };
}
