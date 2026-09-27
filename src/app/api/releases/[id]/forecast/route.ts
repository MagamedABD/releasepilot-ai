/**
 * Прогноз даты выпуска одного релиза (FR-21…FR-23, US-16, US-17).
 *
 * Обработчик тонкий по устройству: собрать снимок, узнать длину истории,
 * позвать движок. Ни одной формулы здесь нет и быть не должно — расчёт живёт
 * в `src/domain/forecast.ts` и проверяется без базы, сети и сессии.
 *
 * Как и остальные маршруты, отвечает «не найдено» и на отсутствующий релиз,
 * и на чужой: запрос идёт от лица пользователя, и RLS отдаёт чужую строку
 * пустым результатом (ADR-003).
 */

import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { toApiForecast } from '@/lib/api/forecast';
import { fromPostgres, invalid, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { loadReleaseSnapshot } from '@/lib/data/snapshot';
import { createClient } from '@/lib/supabase/server';
import { forecastQuerySchema } from '@/lib/validation/release';

export async function GET(
  request: Request,
  { params }: RouteContext<'/api/releases/[id]/forecast'>,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = forecastQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);

  /*
    Организация читается отдельным запросом, потому что снимок её не
    содержит: `ReleaseSnapshot` — доменный тип, и знать про организации ему
    незачем. А для длины истории организация нужна: считать завершённые
    релизы «все, какие видно» означало бы у пользователя, состоящего в двух
    организациях, сложить их истории в одну.

    Заодно этот запрос — калитка 404: дальше идти незачем, если релиза нет.
  */
  const { data: release, error: releaseError } = await supabase
    .from('releases')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();

  if (releaseError) return fromPostgres(releaseError);
  if (!release) return notFound();

  // Момент расчёта один на снимок и на прогноз. Возьми их порознь — и на
  // стыке суток снимок посчитался бы от одного дня, а остаток рабочих
  // дней от другого.
  const now = new Date().toISOString();

  const [snapshot, history] = await Promise.all([
    loadReleaseSnapshot(supabase, id, now),
    /*
      История считается по организации, а не по проекту. Коэффициент
      занижения оценок — свойство того, как оценивает эта организация:
      команды в схеме принадлежат ей, а не проекту. По проекту порог
      отсекал бы прогноз у каждого нового проекта в опытной организации,
      то есть ровно там, где история как раз есть.

      Сам релиз из счёта исключён: историей для него служат другие
      релизы, а не он сам.
    */
    supabase
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', release.org_id)
      .eq('status', 'released')
      .neq('id', id),
  ]);

  if (!snapshot) return notFound();
  if (history.error) return fromPostgres(history.error);

  const forecast = forecastRelease(snapshot, RISK_CONFIG, {
    targetDate: parsed.data.targetDate,
    completedReleases: history.count ?? 0,
  });

  return ok(toApiForecast(forecast));
}
