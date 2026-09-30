/**
 * Применение сохранённого сценария (FR-35, US-25, ADR-003).
 *
 * Вся работа — в функции `apply_scenario` (миграция 0003): перенос задач,
 * ёмкость, отметка о применении и запись в журнал одной транзакцией.
 * Маршрут только переводит её исход в код ответа.
 *
 * Агент этот эндпоинт не вызывает и вызвать не может: у него нет
 * инструмента на применение (docs/07-api-and-agent.md). Изменение данных —
 * всегда нажатие человека.
 */

import {
  fail,
  forbidden,
  fromPostgres,
  isUuid,
  notFound,
  ok,
  unauthorized,
} from '@/lib/api/http';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  _request: Request,
  { params }: RouteContext<'/api/scenarios/[id]/apply'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  // Предварительное чтение — ради честных кодов, а не ради защиты: защиту
  // держат RLS и проверки в функции. Невидимый сценарий — 404, уже
  // применённый — 409, и оба ответа не требуют открывать транзакцию.
  const { data: scenario, error: readError } = await supabase
    .from('scenarios')
    .select('id, applied_at')
    .eq('id', id)
    .maybeSingle();
  if (readError) return fromPostgres(readError);
  if (!scenario) return notFound();
  if (scenario.applied_at) return fail(409, 'conflict', 'Сценарий уже применён');

  const { data, error } = await supabase.rpc('apply_scenario', { p_scenario: id });

  if (error?.code === '42501') {
    return forbidden('Применять сценарии может менеджер, администратор или владелец');
  }
  if (error?.code === 'P0002') return notFound();
  // P0001 — отказ по существу с текстом для человека: релиз изменился
  // после расчёта, блокер держит остающиеся задачи и т. п. `fromPostgres`
  // отдаёт его как 422 с сообщением функции.
  if (error) return fromPostgres(error);

  return ok(data);
}
