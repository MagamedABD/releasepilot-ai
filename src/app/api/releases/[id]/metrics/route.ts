/**
 * Метрики, риск и причины по одному релизу (FR-17…FR-20, US-01, US-02).
 *
 * Главный эндпоинт кокпита: всё, что показывает карточка релиза, приходит
 * отсюда одним ответом. Формул здесь нет — они в `src/domain/risk.ts` и
 * проверяются без базы, сети и сессии (ADR-001).
 *
 * Отвечает «не найдено» и на отсутствующий релиз, и на чужой: запрос идёт
 * от лица пользователя, и RLS отдаёт чужую строку пустым результатом
 * (ADR-003).
 */

import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import { toApiMetrics } from '@/lib/api/metrics';
import { fromPostgres, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { loadReleaseContext } from '@/lib/data/context';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/releases/[id]/metrics'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const result = await loadReleaseContext(supabase, id);
  if (result.kind === 'error') return fromPostgres(result.error);
  if (result.kind === 'not_found') return notFound();

  const { snapshot, completedReleases } = result.context;

  /*
    Прогноз считается здесь, хотя у него есть свой эндпоинт, и не ради
    удобства клиента.

    `LOW_PROBABILITY` — одно из правил эскалации уровня риска: вероятность
    ниже порога поднимает релиз до «высокого» или «критического»
    независимо от скора. Не передай вероятность — и правило просто
    никогда не сработает. Тихо: движок в этом случае честно ставит
    `probabilityOnTime: null` и обходит правило, ответ остаётся
    правдоподобным, а уровень риска — заниженным у самого опасного
    релиза. Такую поломку не видно ни в ответе, ни в тесте маршрута.

    Цена вопроса измерена: 5000 итераций укладываются в 5 мс, то есть
    меньше, чем занимает сам запрос к базе. Отдельный эндпоинт при этом
    нужен: там у клиента есть `targetDate` для вопроса «а если к другому
    числу» и распределение по перцентилям, которого в метриках нет.

    При недостатке истории (FR-22) прогноз детерминированный и вероятности
    не даёт — тогда правило не срабатывает, и это правильно: поднимать
    уровень риска по числу, которого мы не считали, нельзя.
  */
  const forecast = forecastRelease(snapshot, RISK_CONFIG, { completedReleases });

  const metrics = calculateRelease(snapshot, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });

  return ok(toApiMetrics(metrics));
}
