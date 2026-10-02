/**
 * Применение сохранённого сценария (FR-35, US-25, ADR-003).
 *
 * Работу делает функция `apply_scenario` (миграция 0003) одной
 * транзакцией, разбор её исхода — слой данных, а маршрут переводит разбор
 * в код ответа. Делится это так потому, что применяют сценарий два места:
 * кнопка на экране сценариев и этот эндпоинт. Правила — какой отказ чем
 * считать — обязаны быть одни, иначе экран однажды скажет «уже
 * применён» там, где не хватает роли.
 *
 * Агент этот эндпоинт не вызывает и вызвать не может: инструмента на
 * применение у него нет (docs/07-api-and-agent.md). Изменение данных —
 * всегда нажатие человека.
 */

import { fail, forbidden, fromPostgres, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { applyScenario } from '@/lib/data/scenario';
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

  const result = await applyScenario(supabase, id);

  switch (result.kind) {
    case 'not_found':
      return notFound();
    case 'already_applied':
      return fail(409, 'conflict', 'Сценарий уже применён');
    case 'forbidden':
      return forbidden('Применять сценарии может менеджер, администратор или владелец');
    case 'rejected':
      // Текст писал автор миграции для человека: именно он объясняет,
      // почему применение отклонено — например, что релиз изменился
      // после расчёта сценария.
      return fail(422, 'rejected', result.message);
    case 'error':
      return fromPostgres(result.error);
    case 'ok':
      return ok(result.scenario);
  }
}
