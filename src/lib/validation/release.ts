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

/**
 * Плановая дата — календарный день, а не момент.
 *
 * В базе это `date`, и `timestamptz` здесь был бы не точнее, а вреднее:
 * «19 октября 23:00 UTC» для менеджера в Москве — уже двадцатое, и
 * остаток рабочих дней сдвинулся бы на единицу от часового пояса
 * читателя. Формат проверяется строкой, а не `z.coerce.date()`: разбор
 * в `Date` вернул бы момент, который потом пришлось бы обратно
 * приводить к дню — и ровно на этом приведении теряется день.
 */
const plannedDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в виде ГГГГ-ММ-ДД')
  /*
    Существование дня проверяется сборкой и обратным сравнением, а не
    `Date.parse`. Это не перестраховка: `Date.parse('2026-02-30')` не
    возвращает NaN — движок перекатывает тридцатое февраля во второе
    марта. То есть проверка через `Date.parse` пропускала бы такую дату,
    а релиз получал бы плановый срок на два дня позже названного, и
    никто бы не заметил: в базе лежала бы правдоподобная дата.
  */
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    );
  }, 'Такой даты не существует');

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
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectQuery = z.infer<typeof projectQuerySchema>;
