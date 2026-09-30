/**
 * История поставки организации (FR-36, FR-38, US-26, US-28).
 *
 * Отвечает на два вопроса: сколько релизов вышло в срок и как менялись
 * задержки от релиза к релизу. Оба — про факты выпуска, поэтому считаются
 * по релизам и доступны сразу.
 *
 * Третий вопрос — какие причины риска повторяются из релиза в релиз
 * (FR-37) — здесь не отвечен, и это не забывчивость. Ответ на него
 * требует знать, что система думала о релизе в тот момент: сейчас задачи
 * закрыты, блокеры сняты, загрузка обнулилась, и пересчёт по текущему
 * состоянию дал бы «в прошлом всё было хорошо» — историю, которой не
 * было. Источник для него — ежедневные снимки метрик (FR-39), и их охват
 * отдаётся в ответе: пока `snapshots.count` равен нулю, отвечать нечем, и
 * ответ говорит об этом прямо, вместо пустого списка причин, который
 * читался бы как «причин не было».
 *
 * Организация обязательна, в отличие от выборки задач. Там её отсутствие
 * делает список неопрятным, здесь — бессмысленным: доля релизов в срок,
 * посчитанная по двум организациям сразу, не описывает ни одну из них.
 */

import { deliveryHistory } from '@/domain/analytics';
import { fromPostgres, invalid, ok, unauthorized } from '@/lib/api/http';
import { loadReleaseFacts, loadSnapshotCoverage } from '@/lib/data/analytics';
import { createClient } from '@/lib/supabase/server';
import { analyticsQuerySchema } from '@/lib/validation/analytics';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  const parsed = analyticsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return invalid(parsed.error);
  const { orgId } = parsed.data;

  const [factsRes, coverageRes] = await Promise.all([
    loadReleaseFacts(supabase, orgId),
    loadSnapshotCoverage(supabase, orgId),
  ]);
  if (factsRes.error) return fromPostgres(factsRes.error);
  if (coverageRes.error) return fromPostgres(coverageRes.error);

  /*
    Чужая организация даёт пустую историю, а не отказ, и различать их
    незачем: у организации без релизов история тоже пуста. Отдельный
    ответ «нет доступа» подтверждал бы существование организации тому,
    кто угадал её идентификатор.
  */
  return ok({
    orgId,
    delivery: deliveryHistory(factsRes.facts),
    snapshots: coverageRes.coverage,
  });
}
