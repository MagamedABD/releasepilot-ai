/**
 * Роль текущего пользователя в организации — для интерфейса, не для доступа.
 *
 * Права проверяет RLS (`can_manage`), и кнопка, показанная лишний раз,
 * ничего не открывает: запись всё равно не пройдёт. Роль нужна экрану,
 * чтобы не предлагать действие, которое заведомо закончится отказом.
 */

import type { createClient } from '@/lib/supabase/server';

type Client = Awaited<ReturnType<typeof createClient>>;

/** Роли, которым политики разрешают менять данные проекта. */
const MANAGERS = new Set(['owner', 'admin', 'manager']);

export async function loadRole(supabase: Client, orgId: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

export function canManage(role: string | null): boolean {
  return role !== null && MANAGERS.has(role);
}
