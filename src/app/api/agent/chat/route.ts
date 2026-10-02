/**
 * Диалог с агентом: SSE-стрим (FR-24…FR-27, US-19…US-22).
 *
 * Поток, а не один ответ, по простой причине: цикл инструментов занимает
 * секунды, и всё это время пустой экран выглядит поломкой. Поэтому наружу
 * уходят события — текст по мере генерации, имена вызванных инструментов,
 * итог с расходом токенов.
 *
 * Что здесь не делается:
 *
 * — **Не считается.** Движок посчитал метрики, инструменты их отдают,
 *   модель объясняет. После ответа числа сверяются с тем, что модели
 *   давали (FR-25); расхождение пишется в лог, а не прячется.
 * — **Не меняются данные.** Единственный изменяющий инструмент сохраняет
 *   сценарий для подтверждения человеком. Эндпоинта применения у агента
 *   нет (ADR-003, §6).
 * — **Не падает кокпит.** Нет ключа, модель недоступна, исчерпан предел —
 *   это ответы `ai_unavailable` и `rate_limited`, а не пятисотые: при
 *   отказе ассистента остальное приложение работает полностью (NFR-07).
 */

import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';

import { anthropic, CALL_PARAMS } from '@/lib/agent/client';
import { executeTool, type AgentContext } from '@/lib/agent/execute';
import { checkDailyLimit } from '@/lib/agent/limits';
import { MAX_TOOL_ITERATIONS, systemPrompt } from '@/lib/agent/prompt';
import { toolDefinitions } from '@/lib/agent/tools';
import { verifyAnswer } from '@/lib/agent/verify';
import { badJson, BAD_JSON, fail, fromPostgres, invalid, readJson, unauthorized } from '@/lib/api/http';
import type { Json } from '@/lib/database.types';
import { serverEnv } from '@/lib/env.server';
import { createClient } from '@/lib/supabase/server';
import { agentChatSchema } from '@/lib/validation/agent';

/** Сколько прошлых сообщений диалога уходит в модель. */
const HISTORY_LIMIT = 20;

/**
 * Вызов инструмента для журнала диалога.
 *
 * `input` типизирован как Json и приведением: пришёл он от модели по
 * сети, то есть уже является разобранным JSON, — но система типов об
 * этом не знает, а записывать вместо него строку значило бы потерять
 * структуру ровно там, где её потом читают при разборе инцидента.
 */
type ToolCallRecord = { name: string; input: Json; ok: boolean };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();
  const userId = auth.claims.sub as string;

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = agentChatSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  /*
    Предел проверяется до создания диалога и до обращения к модели: иначе
    исчерпавший его пользователь всё равно оплачивал бы запрос, а в
    истории оставались бы пустые диалоги.
  */
  const { check, error: limitError } = await checkDailyLimit(
    supabase,
    serverEnv.AGENT_DAILY_LIMIT,
  );
  if (limitError) return fromPostgres(limitError);
  if (!check.allowed) {
    return fail(
      429,
      'rate_limited',
      `Исчерпан суточный предел обращений к ассистенту: ${check.limit}. Остальное приложение работает.`,
    );
  }

  const client = anthropic();
  if (!client) {
    return fail(
      503,
      'ai_unavailable',
      'Ассистент не настроен: не задан ключ Claude API. Метрики, прогноз и сценарии работают без него.',
    );
  }

  // ── Диалог ──────────────────────────────────────────────────────────
  let sessionId = input.sessionId ?? null;
  if (sessionId) {
    // Чужой диалог RLS отдаёт пустым результатом — то есть «не найдено»,
    // и начинать вместо него новый нельзя: вопрос ушёл бы не туда.
    const { data, error } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return fromPostgres(error);
    if (!data) return fail(404, 'not_found', 'Диалог не найден');
  } else {
    const { data, error } = await supabase
      .from('agent_sessions')
      .insert({
        org_id: input.orgId,
        user_id: userId,
        release_id: input.releaseId ?? null,
        // Заголовок диалога ставит лёгкая модель отдельным вызовом —
        // пока его нет, диалог называется первым вопросом.
        title: input.message.slice(0, 120),
      })
      .select('id')
      .single();
    if (error) return fromPostgres(error);
    sessionId = data.id;
  }

  const { data: history, error: historyError } = await supabase
    .from('agent_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (historyError) return fromPostgres(historyError);

  const messages: MessageParam[] = (history ?? [])
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content as string,
    }));
  messages.push({ role: 'user', content: input.message });

  const { error: userMessageError } = await supabase.from('agent_messages').insert({
    org_id: input.orgId,
    session_id: sessionId,
    role: 'user',
    content: input.message,
  });
  if (userMessageError) return fromPostgres(userMessageError);

  const agentContext: AgentContext = {
    supabase,
    orgId: input.orgId,
    userId,
    level: serverEnv.LLM_PAYLOAD_LEVEL,
  };

  /*
    Кэширование статической части. Системный промпт и описания
    инструментов между запросами не меняются, поэтому помечаются
    кэшируемыми; динамика (вопрос и результаты инструментов) идёт после
    них. Метка ставится на последнем инструменте: кэшируется префикс до
    неё, а не отдельный блок.
  */
  const tools = toolDefinitions().map((t, i, all) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as { type: 'object' },
    ...(i === all.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let answer = '';
      const toolResults: unknown[] = [];
      const toolCalls: ToolCallRecord[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        send({ type: 'session', sessionId });

        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
          const run = client.messages.stream({
            ...CALL_PARAMS,
            system: [
              {
                type: 'text',
                text: systemPrompt(agentContext.level),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools,
            messages,
          });

          run.on('text', (delta) => {
            answer += delta;
            send({ type: 'text', text: delta });
          });

          const message = await run.finalMessage();
          inputTokens += message.usage.input_tokens;
          outputTokens += message.usage.output_tokens;

          if (message.stop_reason !== 'tool_use') break;

          /*
            Ответ модели возвращается в диалог целиком, включая блоки
            размышления с подписями: без них следующий запрос цикла
            теряет связность, а подпись нельзя ни восстановить, ни
            подделать.
          */
          messages.push({ role: 'assistant', content: message.content });

          const results: ContentBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== 'tool_use') continue;

            const outcome = await executeTool(block.name, block.input, agentContext);
            toolCalls.push({
              name: block.name,
              input: (block.input ?? null) as Json,
              ok: outcome.ok,
            });
            send({ type: 'tool', name: block.name, ok: outcome.ok });

            if (outcome.ok) toolResults.push(outcome.result);
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: outcome.ok ? JSON.stringify(outcome.result) : outcome.error,
              // Отказ помечается как ошибка, а не подаётся как результат:
              // иначе модель пересказывает текст отказа как факт о релизе.
              ...(outcome.ok ? {} : { is_error: true }),
            });
          }

          if (results.length === 0) break;
          messages.push({ role: 'user', content: results });
        }

        /*
          Сверка чисел (FR-25). Не прерывает ответ — он уже отдан, — и
          пользователю не показывается: смысл в том, чтобы поймать
          систематическую ошибку, а не выиграть отдельный случай.
        */
        const check = verifyAnswer(answer, toolResults);
        if (check.unsupported.length > 0) {
          console.warn(
            `[agent] числа вне результатов инструментов: ${check.unsupported.join(', ')} ` +
              `(диалог ${sessionId})`,
          );
        }

        await supabase.from('agent_messages').insert({
          org_id: input.orgId,
          session_id: sessionId,
          role: 'assistant',
          content: answer,
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });

        send({
          type: 'done',
          usage: { inputTokens, outputTokens, toolCalls: toolCalls.length },
          // Поле отдаётся наружу для отладки и для теста: показывать его
          // пользователю интерфейс не обязан.
          unsupportedNumbers: check.unsupported,
        });
      } catch (e) {
        /*
          Отказ модели — не поломка приложения. Наружу уходит код, по
          которому интерфейс показывает «ассистент временно недоступен», а
          подробность остаётся в логе: текст исключения SDK рассказывает
          об устройстве запроса (NFR-08).
        */
        console.error('[agent]', e instanceof Error ? e.message : e);
        send({
          type: 'error',
          code: 'ai_unavailable',
          message: 'Ассистент временно недоступен. Метрики и прогноз работают.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      // Прокси иначе буферизует поток, и стрим превращается в один
      // ответ в конце — то есть во всё то, от чего он нужен.
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
