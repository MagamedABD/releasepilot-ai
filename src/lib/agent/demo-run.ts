/**
 * Исполнение демо-режима: вызвать инструменты, собрать ответ, сообщить события.
 *
 * Отделено от `demo.ts` потому, что здесь база: инструменты ходят в неё от
 * лица пользователя, а названия задач берутся из снимка релиза. Разбор
 * вопроса и сборка текста остаются чистыми и проверяются без базы.
 *
 * События те же, что у живой модели: `tool` на каждый вызов, `proposal` на
 * сохранённый сценарий, `text` с ответом. Экрану не нужно знать, кто
 * отвечает, — кроме пометки режима, которую он показывает заранее.
 */

import { loadReleaseContext } from '@/lib/data/context';
import type { Json } from '@/lib/database.types';
import { lowerLevel } from '@/lib/ui/scenario';

import { classifyQuestion, composeAnswer, INTENT_TOOLS, type TaskNames } from './demo';
import { executeTool, type AgentContext } from './execute';
import type { ToolName } from './tools';

type Send = (event: unknown) => void;

export type DemoTurn = {
  answer: string;
  toolResults: unknown[];
  toolCalls: { name: string; input: Json; ok: boolean }[];
};

export async function runDemoTurn(
  question: string,
  releaseId: string | undefined,
  ctx: AgentContext,
  send: Send,
): Promise<DemoTurn> {
  const intent = classifyQuestion(question);
  const toolResults: unknown[] = [];
  const toolCalls: DemoTurn['toolCalls'] = [];
  const results: Partial<Record<ToolName, unknown>> = {};

  const finish = (answer: string): DemoTurn => {
    // Ответ уходит абзацами, а не одним куском: экран дописывает его по
    // мере прихода, и так он читается так же, как живой.
    for (const part of answer.split(/(\n\n)/)) send({ type: 'text', text: part });
    return { answer, toolResults, toolCalls };
  };

  if (!releaseId && intent !== 'history') {
    return finish('Откройте ассистента со страницы релиза — тогда я смогу посмотреть его состояние.');
  }

  const names: TaskNames = new Map();
  if (releaseId) {
    const loaded = await loadReleaseContext(ctx.supabase, releaseId);
    if (loaded.kind === 'ok') {
      for (const t of loaded.context.snapshot.tasks) {
        names.set(t.id, { key: t.key ?? null, title: t.title ?? null });
      }
    }
  }

  const call = async (name: ToolName, input: Record<string, unknown>) => {
    const outcome = await executeTool(name, input, ctx);
    toolCalls.push({ name, input: input as Json, ok: outcome.ok });
    send({ type: 'tool', name, ok: outcome.ok });
    if (outcome.ok) {
      results[name] = outcome.result;
      toolResults.push(outcome.result);
    }
    return outcome;
  };

  for (const name of INTENT_TOOLS[intent]) {
    if (name === 'suggest_scenario') {
      const overview = results.get_release_overview as
        | { metrics: { riskLevel: 'low' | 'medium' | 'high' | 'critical' } }
        | undefined;
      const goal = overview ? lowerLevel(overview.metrics.riskLevel) : null;
      // Риск уже низкий — подбирать нечего, и вызывать инструмент с
      // заведомо выполненной целью значило бы изображать работу.
      if (!goal || goal === 'critical') break;
      await call(name, { release_id: releaseId, target_risk_level: goal });
      continue;
    }

    if (name === 'propose_scenario') {
      const suggest = results.suggest_scenario as
        | { outcome: string; task_ids?: string[] }
        | undefined;
      // Предложение сохраняется только тогда, когда подбор нашёл план.
      // Сохранять «недостижимо» нечего: применять было бы нечего.
      if (suggest?.outcome !== 'ok' || !suggest.task_ids?.length) break;
      const outcome = await call(name, {
        release_id: releaseId,
        title: 'Предложение ассистента',
        exclude_task_ids: suggest.task_ids,
      });
      if (outcome.ok) {
        const r = outcome.result as { scenario_id: string; delta: unknown };
        send({
          type: 'proposal',
          scenarioId: r.scenario_id,
          title: 'Предложение ассистента',
          delta: r.delta,
        });
      }
      continue;
    }

    await call(name, name === 'get_release_history' ? {} : { release_id: releaseId });
  }

  const answer = composeAnswer(intent, results, names);
  return finish(
    answer ||
      'Не удалось собрать ответ: инструменты не вернули данных. Проверьте, что релиз открыт и доступен.',
  );
}
