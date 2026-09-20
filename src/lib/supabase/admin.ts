/**
 * Административный клиент Supabase. ОБХОДИТ ВСЕ ПОЛИТИКИ RLS.
 *
 * Допустимые сценарии — и никакие другие:
 *   • загрузка демо-данных и импорт из трекера;
 *   • фоновый расчёт и запись снимков метрик (release_snapshots закрыта
 *     на запись для всех ролей, писать туда может только сервер);
 *   • обслуживающие задачи по расписанию.
 *
 * Запрещено обслуживать этим клиентом обычные пользовательские запросы.
 * Соблазн понятен: с ним всё работает сразу, без разбирательств с
 * политиками. Цена — потеря разграничения доступа целиком, потому что
 * данные всех организаций становятся равнодоступны, и единственной
 * преградой остаётся внимательность автора каждого конкретного запроса.
 */

import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import { serverEnv } from '@/lib/env.server';
import type { Database } from '@/lib/database.types';

export function createAdminClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // Админский клиент не имеет пользователя и не должен обзаводиться
        // сессией: любое сохранение или обновление токена здесь — признак
        // того, что его используют не по назначению.
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
