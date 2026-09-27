/**
 * Подготовка, общая для расчётных эндпоинтов релиза.
 *
 * Снимок и длина истории нужны вместе трём маршрутам — метрикам, прогнозу
 * и what-if. Собраны они здесь не ради экономии строк, а потому что
 * «история» — это правило, а не запрос: считаются выпущенные релизы
 * организации, кроме самого этого релиза. Оставь правило в маршрутах, и
 * достаточно одной правки в одном из них, чтобы метрики и прогноз начали
 * отвечать про разную историю — расхождение, которое не поймает ни один
 * тест маршрута, потому что порознь оба будут правы.
 *
 * Слой данных не знает про HTTP: вместо ответов возвращается разбор
 * случаев, а в код состояния его переводит маршрут (ADR-003).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { ReleaseSnapshot } from '@/domain/types';
import type { Database } from '@/lib/database.types';

import { loadReleaseSnapshot } from './snapshot';

type Client = SupabaseClient<Database>;

export type ReleaseContext = {
  snapshot: ReleaseSnapshot;
  orgId: string;
  /**
   * Сколько выпущенных релизов есть у организации помимо этого. От числа
   * зависит метод прогноза (FR-22).
   *
   * Почему по организации, а не по проекту: коэффициент занижения оценок —
   * свойство того, как оценивает эта организация. Команды в схеме
   * принадлежат ей, а не проекту, и порог по проекту отсекал бы прогноз у
   * каждого нового проекта в опытной организации — то есть ровно там, где
   * история как раз есть.
   *
   * Почему не «все выпущенные, какие видно»: у пользователя, состоящего в
   * двух организациях, это сложило бы две истории в одну.
   */
  completedReleases: number;
};

export type ReleaseContextResult =
  | { kind: 'ok'; context: ReleaseContext }
  | { kind: 'not_found' }
  | { kind: 'error'; error: PostgrestError };

/**
 * Момент расчёта передаётся снаружи и один на всё. Возьми его порознь для
 * снимка и для прогноза — и на стыке суток снимок посчитался бы от одного
 * дня, а остаток рабочих дней от другого.
 *
 * Отсутствующий релиз и чужой дают один и тот же `not_found`: запрос идёт
 * от лица пользователя, и RLS отдаёт чужую строку пустым результатом.
 */
export async function loadReleaseContext(
  supabase: Client,
  releaseId: string,
  now: string = new Date().toISOString(),
): Promise<ReleaseContextResult> {
  /*
    Организация читается отдельным запросом, потому что снимок её не
    отдаёт: `ReleaseSnapshot` — доменный тип, и знать про организации ему
    незачем. Строка релиза при этом читается дважды — здесь и внутри
    сборки снимка; это чтение по первичному ключу, и платить за него
    дешевле, чем связывать доменный снимок с понятием организации.

    Заодно этот запрос — калитка 404: дальше идти незачем, если релиза нет.
  */
  const { data: release, error } = await supabase
    .from('releases')
    .select('id, org_id')
    .eq('id', releaseId)
    .maybeSingle();

  if (error) return { kind: 'error', error };
  if (!release) return { kind: 'not_found' };

  const [snapshot, history] = await Promise.all([
    loadReleaseSnapshot(supabase, releaseId, now),
    supabase
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', release.org_id)
      .eq('status', 'released')
      .neq('id', releaseId),
  ]);

  if (history.error) return { kind: 'error', error: history.error };
  if (!snapshot) return { kind: 'not_found' };

  return {
    kind: 'ok',
    context: {
      snapshot,
      orgId: release.org_id,
      completedReleases: history.count ?? 0,
    },
  };
}
