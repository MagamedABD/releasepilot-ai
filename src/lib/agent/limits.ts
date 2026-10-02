/**
 * Суточный предел обращений к агенту (ADR-003, §6).
 *
 * Считаются вопросы пользователя за сутки, а не ответы и не токены.
 * Токены точнее описывали бы расход, но предел по ним непредсказуем для
 * человека: один и тот же вопрос то проходит, то нет, в зависимости от
 * того, сколько инструментов понадобилось модели. Предел по числу
 * вопросов объясним в одной строке — и именно его видно в интерфейсе.
 *
 * Чужие сообщения сюда не попадают: политика на `agent_messages` открывает
 * только свои диалоги, и даже владелец организации чужую переписку не
 * видит.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

export type UsageCheck = {
  used: number;
  limit: number;
  allowed: boolean;
};

/** Начало суток по UTC — как и весь расчёт (src/domain/calendar.ts). */
function startOfDayUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function checkDailyLimit(
  supabase: Client,
  limit: number,
  now: Date = new Date(),
): Promise<{ check: UsageCheck; error: PostgrestError | null }> {
  const { count, error } = await supabase
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', startOfDayUtc(now));

  if (error) {
    /*
      Ошибка чтения счётчика не должна открывать шлюз. Не посчитали —
      значит, не знаем, и разрешать «на всякий случай» нельзя: именно в
      этом состоянии предел и обходят.
    */
    return { check: { used: 0, limit, allowed: false }, error };
  }

  const used = count ?? 0;
  return { check: { used, limit, allowed: used < limit }, error: null };
}
