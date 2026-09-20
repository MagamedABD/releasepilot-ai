/**
 * Клиент Supabase для браузера.
 *
 * Работает с публичным ключом, то есть все запросы проходят через политики
 * RLS от имени текущего пользователя. Ключ попадает в бандл и виден любому —
 * это нормально и предусмотрено: защита держится на политиках в базе,
 * а не на секретности ключа (ADR-003, принцип 1).
 */

import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';
import type { Database } from '@/lib/database.types';

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
