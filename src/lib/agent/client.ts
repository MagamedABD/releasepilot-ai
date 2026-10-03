/**
 * Клиент Claude API и параметры вызова.
 *
 * Вынесено из маршрута, потому что отсутствие ключа — не ошибка, а
 * состояние: публичное демо может работать вообще без агента, и кокпит,
 * метрики и прогноз обязаны при этом работать полностью (NFR-07). Поэтому
 * здесь не бросается исключение, а возвращается `null`, и маршрут
 * отвечает `ai_unavailable` — ответ, который интерфейс показывает как
 * «ассистент временно недоступен», а не как поломку приложения.
 */

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { serverEnv } from '@/lib/env.server';

let cached: Anthropic | null = null;

export function anthropic(): Anthropic | null {
  if (!serverEnv.ANTHROPIC_API_KEY) return null;
  cached ??= new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  return cached;
}

/**
 * Параметры вызова, одинаковые для всех запросов агента.
 *
 * `thinking: adaptive` — единственный включённый режим размышления у Opus
 * 4.7: `budget_tokens` там отвечает 400, а не игнорируется. Параметров
 * выборки (`temperature`, `top_p`, `top_k`) по той же причине нет вовсе.
 *
 * `effort: high` — не максимум намеренно. Выше платится токенами за
 * глубину, которая этой задаче не нужна: числа уже посчитаны движком, а
 * работа модели — объяснить их и выбрать инструмент.
 */
export const CALL_PARAMS = {
  model: serverEnv.ANTHROPIC_MODEL_MAIN,
  max_tokens: 2048,
  thinking: { type: 'adaptive' as const },
  output_config: { effort: 'high' as const },
};

export type AgentMode = 'live' | 'demo' | 'off';

/**
 * Каким будет ассистент в этом запуске.
 *
 * Решение одно на весь инстанс и зависит только от настроек, а не от
 * вопроса: экран должен заранее знать, показывать ли пометку «демо-режим».
 * Пометка, появляющаяся после ответа, — это уже не честность, а оправдание.
 */
export function agentMode(): AgentMode {
  switch (serverEnv.AGENT_MODE) {
    case 'off':
      return 'off';
    case 'demo':
      return 'demo';
    case 'live':
      // Живую модель просили явно, а ключа нет — значит, ассистент
      // недоступен. Подменять её шаблоном молча нельзя: человек, который
      // включил живой режим, должен видеть, что он не работает.
      return serverEnv.ANTHROPIC_API_KEY ? 'live' : 'off';
    case 'auto':
      return serverEnv.ANTHROPIC_API_KEY ? 'live' : 'demo';
  }
}
