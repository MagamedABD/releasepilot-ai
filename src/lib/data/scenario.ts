/**
 * Сохранение сценария: один путь на маршрут и на агента.
 *
 * Сценарии сохраняются из двух мест — человеком через
 * `POST /api/releases/:id/scenarios` и агентом инструментом
 * `propose_scenario`. Порядок действий у них обязан быть один: проверить
 * релиз назначения, посчитать эффект на сервере, записать сценарий вместе
 * с посчитанным эффектом.
 *
 * Будь это написано дважды, разойтись могла бы любая из трёх частей, и
 * самая опасная — вторая: агенту достаточно было бы прислать `result`
 * самому, и кнопка «Применить» показывала бы эффект, которого никто не
 * считал. Поэтому эффект здесь считается всегда и только из снимка.
 *
 * HTTP этот модуль не знает: он разбирает случаи, а переводит их в коды
 * ответа вызывающий.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import { RISK_CONFIG } from '@/domain/config';
import { simulate, type ScenarioProblem, type ScenarioSide, type ScenarioDelta } from '@/domain/scenario';
import { toScenarioResult } from '@/lib/api/scenario';
import type { Database } from '@/lib/database.types';

import type { ReleaseContext } from './context';

type Client = SupabaseClient<Database>;
type ScenarioRow = Database['public']['Tables']['scenarios']['Row'];

export type SaveScenarioInput = {
  title: string;
  excludeTaskIds: string[];
  extraCapacity: { teamId: string; hours: number }[];
  moveToReleaseId: string | null;
};

export type SaveScenarioResult =
  | {
      kind: 'ok';
      scenario: ScenarioRow;
      before: ScenarioSide;
      after: ScenarioSide;
      delta: ScenarioDelta;
    }
  /** Сценарий нельзя посчитать честно: разбор причин — в домене. */
  | { kind: 'rejected'; problems: ScenarioProblem[] }
  /** Релиз назначения не найден, закрыт или совпадает с исходным. */
  | { kind: 'bad_target'; message: string }
  /** Политика не разрешила запись: роли не хватает. */
  | { kind: 'forbidden' }
  | { kind: 'error'; error: PostgrestError };

export async function saveScenario(
  supabase: Client,
  releaseId: string,
  context: ReleaseContext,
  userId: string,
  input: SaveScenarioInput,
): Promise<SaveScenarioResult> {
  const { snapshot, orgId, completedReleases } = context;

  if (input.moveToReleaseId) {
    if (input.moveToReleaseId === releaseId) {
      return {
        kind: 'bad_target',
        message: 'Задачи переносятся в тот же релиз, из которого уходят',
      };
    }
    /*
      Та же организация и открытый статус. Проверяется здесь, а не при
      применении, потому что иначе отказ пришёл бы после того, как
      пользователь поверил сохранённому эффекту.
    */
    const { data: target, error } = await supabase
      .from('releases')
      .select('id')
      .eq('id', input.moveToReleaseId)
      .eq('org_id', orgId)
      .in('status', ['planned', 'active'])
      .maybeSingle();
    if (error) return { kind: 'error', error };
    if (!target) {
      return { kind: 'bad_target', message: 'Релиз назначения не найден или уже закрыт' };
    }
  }

  const simulation = simulate(
    snapshot,
    { excludeTaskIds: input.excludeTaskIds, extraCapacity: input.extraCapacity },
    RISK_CONFIG,
    { completedReleases },
  );
  if (simulation.kind === 'rejected') {
    return { kind: 'rejected', problems: simulation.problems };
  }

  const { data: scenario, error } = await supabase
    .from('scenarios')
    .insert({
      org_id: orgId,
      release_id: releaseId,
      created_by: userId,
      title: input.title,
      payload: {
        excludeTaskIds: input.excludeTaskIds,
        extraCapacity: input.extraCapacity,
        moveToReleaseId: input.moveToReleaseId,
      },
      result: toScenarioResult(simulation),
    })
    .select('*')
    .single();

  // Релиз пользователь видит — значит, отказ политики здесь означает
  // нехватку роли, а не чужие данные.
  if (error?.code === '42501') return { kind: 'forbidden' };
  if (error) return { kind: 'error', error };

  return {
    kind: 'ok',
    scenario,
    before: simulation.before,
    after: simulation.after,
    delta: simulation.delta,
  };
}
