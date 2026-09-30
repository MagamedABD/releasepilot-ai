/**
 * Проверка данных задачи.
 *
 * Как и схемы форм, живут отдельно от маршрутов: тело запроса приходит
 * из сети, и до разбора схемой достоверным не считается ничего.
 *
 * Отдельно стоит сказать, чего в схемах нет. В них нет `orgId`,
 * `blockedSince` и `addedToReleaseAt` — три поля, которые клиенту
 * писать нельзя. Причины у каждого свои, и объяснены они по месту.
 */

import { z } from 'zod';

export const TASK_STATUSES = [
  'backlog',
  'in_progress',
  'review',
  'testing',
  'done',
  'cancelled',
] as const;

export const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

const uuid = z.string().uuid('Ожидается идентификатор');

/**
 * Оценка в часах.
 *
 * Ноль разрешён, отрицательное — нет: на оценках строится готовность,
 * и одна задача с оценкой −40 бесшумно сдвинет процент по всему релизу.
 * Верхняя граница нужна по той же причине: 100 000 часов — это опечатка,
 * а не задача, но в расчёт она войдёт как настоящая.
 */
const hours = z
  .number({ message: 'Ожидается число часов' })
  .min(0, 'Часы не бывают отрицательными')
  .max(10_000, 'Похоже на опечатку: слишком много часов');

/**
 * Блокировка задаётся флагом, а не отметкой времени, и это не упрощение
 * ради удобства.
 *
 * Движок считает блокер застарелым по тому, сколько он висит
 * (`staleBlockerDays`, фактор F3). Если бы клиент присылал
 * `blockedSince` сам, любой вызов мог бы задним числом объявить
 * блокировку вчерашней — и отчёт о риске стал бы тем, что удобно
 * показать, а не тем, что есть. Момент ставит сервер.
 */
const status = z.enum(TASK_STATUSES, { message: 'Неизвестный статус задачи' });
const priority = z.enum(TASK_PRIORITIES, { message: 'Неизвестный приоритет' });

/**
 * Поля задачи без значений по умолчанию.
 *
 * Умолчания сознательно вынесены в схему создания и не входят сюда —
 * см. объяснение у `taskUpdateSchema`.
 */
const taskFields = {
  releaseId: uuid.nullish(),
  title: z.string().trim().min(1, 'Укажите название').max(200, 'Слишком длинное название'),
  description: z.string().trim().max(5000, 'Слишком длинное описание').nullish(),
  externalKey: z.string().trim().max(40, 'Слишком длинный ключ').nullish(),
  status,
  priority,
  estimateH: hours,
  spentH: hours,
  teamId: uuid.nullish(),
  assigneeId: uuid.nullish(),
  blocked: z.boolean(),
};

export const taskCreateSchema = z.object({
  ...taskFields,
  projectId: uuid,
  // Умолчания нужны только при создании: у новой задачи эти поля обязаны
  // чем-то быть, и разумнее подставить их, чем требовать от вызывающего.
  status: status.default('backlog'),
  priority: priority.default('P2'),
  spentH: hours.default(0),
  blocked: z.boolean().default(false),
});

/**
 * Изменение задачи.
 *
 * Схема собрана из полей заново, а не получена из схемы создания через
 * `.partial()`, и это принципиально. `.partial()` делает поля
 * необязательными, но не снимает с них значения по умолчанию: пустой
 * объект проходит такую схему и выходит из неё заполненным — статус
 * `backlog`, приоритет `P2`, `spentH` 0, `blocked` false.
 *
 * Дальше по коду эти значения неотличимы от присланных вызывающим, и
 * `PATCH {}` не «ничего не меняет», а сбрасывает готовую задачу в
 * начальное состояние и снимает с неё блокировку. Ошибка тем неприятнее,
 * что выглядит безобидно: запрос отвечает 200, и ответ содержит
 * правдоподобную задачу.
 *
 * Пустой объект отвергается отдельно: PATCH без единого поля почти всегда
 * означает опечатку в имени поля или потерянное тело запроса, и ответить
 * на него «успех» значит дать вызывающему поверить, что правка применилась.
 */
export const taskUpdateSchema = z
  .object(taskFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Не указано ни одного поля для изменения',
  });

/**
 * Параметры выборки.
 *
 * Приходят строками из query-строки, поэтому числа и булевы значения
 * приводятся явно. `limit` ограничен сверху: без потолка любой вызов
 * `?limit=1000000` становится способом уронить сервер, ничего не взломав.
 */
export const taskQuerySchema = z.object({
  /*
    Организация здесь — сужение выборки, а не разграничение доступа.

    Разница принципиальная. Доступ закрывает RLS, и без этого параметра
    ничего не «утекает»: пользователь и так видит только свои
    организации. Но если он состоит в двух, экран задач одной из них
    показал бы задачи обеих — правильный по доступу и неверный по смыслу
    ответ, потому что адрес спрашивал про конкретную организацию.

    Именно поэтому параметр необязательный: забыть его можно, и это
    ничего не открывает. Будь он защитой, необязательным он быть не мог.
  */
  orgId: uuid.optional(),
  releaseId: uuid.optional(),
  projectId: uuid.optional(),
  teamId: uuid.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  blocked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;

/**
 * Связь между задачами (FR-13).
 *
 * Направление задаётся полем, а не порядком аргументов. В карточке задачи
 * добавляют связи обеих сторон — «блокирует» и «зависит от», — и если бы
 * тело содержало просто `taskId`, направление пришлось бы додумывать из
 * адреса. Додуманное направление ошибочно ровно в половине случаев, и
 * ошибка эта тихая: связь создастся, просто наоборот.
 *
 * Ровно одно из двух полей, не оба: связь между парой задач одна, и
 * присланные вместе `blocksTaskId` и `blockedByTaskId` означают либо
 * попытку создать цикл из двух звеньев, либо путаницу в клиенте. Оба
 * случая честнее отклонить, чем выбрать одно поле на своё усмотрение.
 *
 * `relates` симметрична по смыслу, но хранится теми же колонками, поэтому
 * направление требуется и для неё — и остаётся неважным.
 */
export const DEPENDENCY_TYPES = ['blocks', 'relates'] as const;

export const dependencyCreateSchema = z
  .object({
    /** Задача из адреса блокирует эту. */
    blocksTaskId: uuid.optional(),
    /** Задача из адреса ждёт эту. */
    blockedByTaskId: uuid.optional(),
    type: z.enum(DEPENDENCY_TYPES, { message: 'Неизвестный тип связи' }).default('blocks'),
  })
  .refine((v) => Boolean(v.blocksTaskId) !== Boolean(v.blockedByTaskId), {
    message: 'Укажите ровно одно поле: blocksTaskId или blockedByTaskId',
  })
  /*
    Два необязательных поля на входе — одна пара значений на выходе.

    Без этого маршруту пришлось бы всюду писать `blocksTaskId ?? blockedByTaskId`
    и убеждать типы, что хоть одно из них есть. Проверка выше это уже
    гарантирует, но знает о ней только она сама, поэтому здесь же и
    приводится к виду, в котором гарантия выражена типом.
  */
  .transform((v) => ({
    type: v.type,
    otherTaskId: (v.blocksTaskId ?? v.blockedByTaskId) as string,
    /** Держит ли задача из адреса вторую — или наоборот. */
    pathTaskBlocks: v.blocksTaskId !== undefined,
  }));

export type DependencyCreateInput = z.infer<typeof dependencyCreateSchema>;
