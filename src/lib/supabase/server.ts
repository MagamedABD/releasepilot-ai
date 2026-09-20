/**
 * Клиент Supabase для серверных компонентов, Server Actions и роутов API.
 *
 * Ключ тот же публичный, что и в браузере, — и это не упрощение.
 * Сессия берётся из cookie, запросы идут от имени пользователя, политики
 * RLS применяются ровно так же. Серверный код не получает никаких
 * привилегий просто потому, что он серверный: повышение прав — это всегда
 * осознанный шаг через admin.ts, а не побочный эффект места выполнения.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import type { Database } from '@/lib/database.types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Серверный компонент не может писать cookie — это ограничение
            // React, а не ошибка. Обновлением сессии занимается middleware,
            // поэтому здесь достаточно промолчать.
          }
        },
      },
    },
  );
}

/**
 * Текущий пользователь или null.
 *
 * Именно getUser, а не getSession: getSession читает cookie и верит ей
 * на слово, тогда как getUser проверяет токен на сервере Supabase.
 * Для решений о доступе годится только второй вариант.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
