/**
 * Инструменты агента (docs/07-api-and-agent.md, часть 2).
 *
 * Схема у каждого инструмента одна, на zod, и JSON Schema для модели
 * выводится из неё (`z.toJSONSchema`). Писать их раздельно значило бы
 * держать два описания одного входа: модель получала бы одно, а проверка
 * применяла бы другое — и расхождение обнаружилось бы в день, когда
 * модель прислала поле, которого в проверке нет.
 *
 * Деление на читающие и изменяющие (ADR-003, §6) выражено полем `writes`.
 * Изменяющий здесь ровно один — `propose_scenario`, и он не применяет
 * сценарий, а сохраняет его для подтверждения человеком. Эндпоинта
 * применения у агента нет вовсе.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

/** Релиз всегда задаётся явно: «текущего» релиза у диалога нет. */
const releaseId = { release_id: uuid.describe('Идентификатор релиза') };

const extraCapacity = z
  .array(
    z.object({
      team_id: uuid,
      hours: z.number().positive().max(1000),
    }),
  )
  .max(50)
  .optional()
  .describe('Дополнительные часы команде до плановой даты');

const excludeTaskIds = z
  .array(uuid)
  .max(200)
  .optional()
  .describe('Задачи, уходящие из релиза');

export const TOOL_SCHEMAS = {
  get_release_overview: z.object(releaseId),

  get_team_load: z.object(releaseId),

  get_blockers: z.object(releaseId),

  get_critical_chain: z.object(releaseId),

  list_tasks: z.object({
    ...releaseId,
    status: z
      .enum(['backlog', 'in_progress', 'review', 'testing', 'done', 'cancelled'])
      .optional(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    team_id: uuid.optional(),
    blocked: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),

  forecast_completion: z.object({
    ...releaseId,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Дата в виде ГГГГ-ММ-ДД. Без неё — плановая дата релиза'),
  }),

  simulate_scenario: z.object({
    ...releaseId,
    exclude_task_ids: excludeTaskIds,
    extra_capacity: extraCapacity,
  }),

  /*
    Цель задаётся одним из трёх полей, и ровно одним. Объединить их в
    пару «вид цели плюс значение» было бы компактнее, но тогда значение
    стало бы строкой-или-числом, и модель регулярно присылала бы
    «medium» там, где ждут число.
  */
  suggest_scenario: z
    .object({
      ...releaseId,
      target_risk_level: z.enum(['low', 'medium', 'high']).optional(),
      target_risk_score: z.number().min(0).max(100).optional(),
      target_probability: z.number().min(0).max(1).optional(),
      max_tasks: z.number().int().min(1).max(10).optional(),
      allow_p0: z
        .boolean()
        .optional()
        .describe('Разрешить предлагать перенос задач P0. По умолчанию запрещено'),
    })
    .refine(
      (v) =>
        [v.target_risk_level, v.target_risk_score, v.target_probability].filter(
          (x) => x !== undefined,
        ).length === 1,
      { message: 'Укажи ровно одну цель: уровень, скор или вероятность' },
    ),

  get_release_history: z.object({}),

  propose_scenario: z.object({
    ...releaseId,
    title: z.string().trim().min(1).max(200).describe('Короткое название сценария'),
    exclude_task_ids: excludeTaskIds,
    extra_capacity: extraCapacity,
    move_to_release_id: uuid
      .optional()
      .describe('Куда переносятся задачи. Без него они уходят в бэклог'),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  get_release_overview:
    'Состояние релиза: готовность, скор и уровень риска, причины с вкладом каждой, ' +
    'количество задач по статусам, вероятность выпуска в срок. Начинай с него: ' +
    'большинство вопросов о релизе отвечаются этими числами без других инструментов.',
  get_team_load:
    'Загрузка команд релиза: по каждой — остаток работ в часах, ёмкость до плановой ' +
    'даты и их отношение. Используй для вопросов про узкое место и перегруз.',
  get_blockers:
    'Заблокированные задачи релиза: сколько держит каждая, как давно стоит, ' +
    'застарелая ли блокировка.',
  get_critical_chain:
    'Самая длинная цепочка зависимостей релиза и её длина в рабочих днях. ' +
    'Отвечает на вопрос, почему релиз не сделать быстрее, даже добавив людей.',
  list_tasks:
    'Задачи релиза с фильтрами по статусу, приоритету, команде и блокировке. ' +
    'Вызывай, когда нужны конкретные задачи, а не агрегаты: список из трёхсот ' +
    'задач в ответе бесполезен, поэтому ограничивай выборку фильтрами.',
  forecast_completion:
    'Прогноз выпуска методом Монте-Карло: ожидаемая дата, перцентили P50/P80/P95 и ' +
    'вероятность успеть к плановой или к указанной дате. На вопрос «успеем ли к ' +
    'четвергу» отвечай вероятностью из этого инструмента, а не «да» или «нет».',
  simulate_scenario:
    'Пересчитывает метрики релиза при гипотетическом изменении: исключении задач ' +
    'или добавлении часов команде. Данные НЕ изменяются. Используй, чтобы проверить ' +
    'эффект предложения до того, как его советовать: разность «до» и «после» ' +
    'возвращается готовой, считать её самому нельзя.',
  suggest_scenario:
    'Подбирает, какие задачи перенести, чтобы риск опустился до цели, и возвращает ' +
    'эффект в числах. Если цель недостижима переносом, возвращает причину — ' +
    'например, правило эскалации, которое держит уровень независимо от переносов.',
  get_release_history:
    'История поставки организации: доля релизов в срок, средняя задержка по ' +
    'опоздавшим, отклонения по каждому выпущенному релизу.',
  propose_scenario:
    'Сохраняет сценарий и ПРЕДЛАГАЕТ его пользователю. Ничего не применяет: состав ' +
    'релиза и ёмкость не меняются, применяет человек кнопкой в интерфейсе. ' +
    'Вызывай, когда пользователь просит что-то изменить, — вместо отказа.',
};

const WRITES: Record<ToolName, boolean> = {
  get_release_overview: false,
  get_team_load: false,
  get_blockers: false,
  get_critical_chain: false,
  list_tasks: false,
  forecast_completion: false,
  simulate_scenario: false,
  suggest_scenario: false,
  get_release_history: false,
  propose_scenario: true,
};

export type ToolDefinition = {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
  /** Пишет ли инструмент в базу. Изменяющий — только предложение сценария. */
  writes: boolean;
};

/**
 * Описания для Claude API.
 *
 * `io: 'input'` важно: нужна схема того, что присылают, а не того, что
 * выходит после преобразований zod.
 */
export function toolDefinitions(): ToolDefinition[] {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    input_schema: z.toJSONSchema(TOOL_SCHEMAS[name], { io: 'input' }) as Record<string, unknown>,
    writes: WRITES[name],
  }));
}

export function isToolName(name: string): name is ToolName {
  return name in TOOL_SCHEMAS;
}
