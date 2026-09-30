/**
 * Проверка данных релиза и проекта.
 *
 * Чего в схемах нет: `orgId` у релиза, `startedAt` и `releasedAt`.
 * Организация выводится из проекта — иначе появился бы запрос, где
 * проект принадлежит одной организации, а релиз создаётся в другой.
 * Две отметки времени ставит сервер по переходу статуса, и причина у
 * этого не в удобстве — объяснение ниже, у `RELEASE_STATUSES`.
 */

import { z } from 'zod';

import { calendarDate } from './date';

export const RELEASE_STATUSES = [
  'planned',
  'active',
  'released',
  'postponed',
  'cancelled',
] as const;

const uuid = z.string().uuid('Ожидается идентификатор');

const status = z.enum(RELEASE_STATUSES, { message: 'Неизвестный статус релиза' });

const name = z
  .string()
  .trim()
  .min(1, 'Укажите название')
  .max(120, 'Слишком длинное название');

/** Плановая дата — календарный день: объяснение в `./date`. */
const plannedDate = calendarDate;

const releaseFields = {
  name,
  status,
  plannedDate,
};

export const releaseCreateSchema = z.object({
  ...releaseFields,
  projectId: uuid,
  // Умолчание нужно только при создании: новый релиз обязан быть в
  // каком-то статусе, и «запланирован» — единственный, из которого он
  // может честно начаться.
  status: status.default('planned'),
});

/**
 * Изменение релиза.
 *
 * Схема собрана из полей заново, а не через `.partial()` от схемы
 * создания, по той же причине, что и у задачи: `.partial()` не снимает
 * значения по умолчанию, и `PATCH {}` прошёл бы как «вернуть релиз в
 * статус „запланирован“» — то есть выпущенный релиз стал бы
 * запланированным в ответ на запрос без единого поля.
 */
export const releaseUpdateSchema = z
  .object(releaseFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Не указано ни одного поля для изменения',
  });

export const releaseQuerySchema = z.object({
  // Как и у задач — сужение выборки, а не разграничение доступа: доступ
  // закрывает RLS, а параметр отвечает на вопрос «релизы какой именно
  // организации» для того, кто состоит в двух.
  orgId: uuid.optional(),
  projectId: uuid.optional(),
  status: status.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Запрос прогноза.
 *
 * Единственный параметр — дата вопроса «успеем ли к …» (FR-23). Проверяется
 * она тем же правилом, что и плановая, и поэтому бесплатно получает защиту
 * от тридцатого февраля: без неё дата перекатилась бы во второе марта, и
 * вероятность вернулась бы для срока на два дня позже названного.
 *
 * Чего здесь нет: числа итераций и зерна. Итерации — не выбор клиента, а
 * стоимость расчёта на сервере, и `?iterations=10000000` стал бы способом
 * положить сервер запросом на чтение. Зерно не отдаётся по обратной
 * причине: воспроизводимость прогноза — обещание системы, а возможность
 * его переопределить превратила бы обещание в настройку.
 */
export const forecastQuerySchema = z.object({
  targetDate: plannedDate.optional(),
});

/**
 * What-if сценарий (FR-31).
 *
 * Потолки на размер — не про корректность, а про цену: симуляция считает
 * релиз дважды, с Монте-Карло, и запрос на тысячу команд стал бы способом
 * загрузить сервер запросом «на чтение». Двести задач больше любого
 * реального релиза в демо, а команд в организации — единицы.
 *
 * Чего здесь нет: проверки, что задачи и команды принадлежат релизу. Это
 * знает только снимок, и проверяет её домен (`validateScenario`), — схема
 * отвечает за форму, а не за существование.
 */
const scenarioFields = {
  excludeTaskIds: z
    .array(uuid)
    .max(200, 'Слишком много задач в одном сценарии')
    // Повтор не ошибка пользователя, а особенность сборки списка на
    // клиенте; дважды перенести задачу нельзя, так что просто сливаем.
    .transform((ids) => [...new Set(ids)])
    .default([]),
  extraCapacity: z
    .array(
      z.object({
        teamId: uuid,
        hours: z
          .number({ message: 'Ожидается число часов' })
          .positive('Часы должны быть больше нуля')
          .max(1000, 'Слишком много часов для одного релиза'),
      }),
    )
    .max(50, 'Слишком много команд в одном сценарии')
    /*
      Повтор команды, в отличие от повтора задачи, отклоняется: «+10 и
      +20 часов бэкенду» можно прочитать и как 30, и как опечатку в одной
      из строк. Угадывать здесь значит молча посчитать не тот сценарий.
    */
    .refine((items) => new Set(items.map((i) => i.teamId)).size === items.length, {
      message: 'Команда указана дважды',
    })
    .default([]),
};

const notEmpty = [
  (v: { excludeTaskIds: string[]; extraCapacity: unknown[] }) =>
    v.excludeTaskIds.length > 0 || v.extraCapacity.length > 0,
  { message: 'Сценарий пуст: укажите задачи для переноса или дополнительные часы' },
] as const;

export const simulateSchema = z.object(scenarioFields).refine(...notEmpty);

/**
 * Сохранение сценария (FR-35).
 *
 * Сверх симуляции — название и релиз, куда уходят задачи. Для расчёта
 * исходного релиза место назначения безразлично: задача ушла, и всё. Но
 * применение его требует — без него задача окажется вне релизов, в
 * бэклоге, и это тоже законный выбор, поэтому поле необязательно.
 */
export const scenarioCreateSchema = z
  .object({
    ...scenarioFields,
    title: z
      .string()
      .trim()
      .min(1, 'Укажите название сценария')
      .max(200, 'Слишком длинное название'),
    moveToReleaseId: uuid.nullable().default(null),
  })
  .refine(...notEmpty);

/**
 * Ключ проекта: PPT, PAY2, DEV.
 *
 * Ограничение повторяет проверку в базе (`^[A-Z][A-Z0-9]{1,9}$`) и
 * стоит здесь не ради надёжности — база и так не пропустит. Стоит оно
 * ради ответа: без схемы клиент получил бы 422 с текстом про нарушенный
 * `check`-констрейнт, из которого не следует, что именно исправить.
 */
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z][A-Z0-9]{1,9}$/,
    'Ключ — от 2 до 10 знаков: латинские заглавные и цифры, первая буква',
  );

const projectFields = { name, key: projectKey };

export const projectCreateSchema = z.object({
  ...projectFields,
  /*
    Организация здесь приходит от клиента, и это единственное место, где
    так можно.

    У задачи и релиза есть родитель, из которого организацию видно, — у
    проекта родителя нет, и выводить её не из чего. Принимать её от
    клиента безопасно ровно потому, что проверяет её не этот код:
    политика RLS требует `is_org_member(org_id)`, и вставка в чужую
    организацию не проходит на уровне базы. Ответ при этом будет «не
    найдено», а не «запрещено», — чтобы не подтверждать, что организация
    с таким идентификатором есть.
  */
  orgId: uuid,
});

export const projectUpdateSchema = z
  .object(projectFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Не указано ни одного поля для изменения',
  });

export const projectQuerySchema = z.object({
  orgId: uuid.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReleaseCreateInput = z.infer<typeof releaseCreateSchema>;
export type ReleaseUpdateInput = z.infer<typeof releaseUpdateSchema>;
export type ReleaseQuery = z.infer<typeof releaseQuerySchema>;
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;
export type SimulateInput = z.infer<typeof simulateSchema>;
export type ScenarioCreateInput = z.infer<typeof scenarioCreateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectQuery = z.infer<typeof projectQuerySchema>;
