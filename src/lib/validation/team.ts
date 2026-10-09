/**
 * Проверка данных команд и их ёмкости.
 *
 * Ёмкость — единственное, что здесь пишется, и писать её опаснее, чем
 * кажется. На ней держится загрузка команд (F2 в ADR-001), и завышенная
 * ёмкость не ломает расчёт, а делает его успокаивающим: перегруза не
 * находится ни у кого. Поэтому проверки ниже сторожат не формат, а
 * правдоподобие.
 */

import { z } from 'zod';

import { calendarDate } from './date';

export const TEAM_KINDS = [
  'frontend',
  'backend',
  'qa',
  'analytics',
  'design',
  'other',
] as const;

const uuid = z.string().uuid('Ожидается идентификатор');

export const teamQuerySchema = z.object({
  /*
    Организация — сужение выборки, а не разграничение доступа: та же
    причина, что у выборки задач. Пользователь в двух организациях иначе
    увидел бы команды обеих в списке, который спрашивал про одну.
  */
  orgId: uuid.optional(),
  kind: z.enum(TEAM_KINDS, { message: 'Неизвестный вид команды' }).optional(),
});

/**
 * Рамки выборки ёмкости.
 *
 * Пересечение, а не вложение: запись с 1 по 30 сентября относится к
 * вопросу «что у команды в середине месяца», хотя ни одна её граница в
 * запрошенный отрезок не попадает. Условие на вложение отсеяло бы именно
 * ту запись, из которой расчёт берёт часы.
 */
export const capacityQuerySchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'Начало рамки позже её конца',
  });

/**
 * Часы на период.
 *
 * Верхняя граница нужна не для порядка. Ёмкость стоит в знаменателе
 * загрузки, и один лишний ноль в ней означает загрузку в десять раз
 * меньше настоящей: ни одного перегруза, ни одной причины риска по
 * команде — отчёт, в котором всё хорошо. Двадцать человек за квартал
 * дают около 9600 часов, так что сто тысяч — это опечатка.
 */
const availableHours = z
  .number({ message: 'Ожидается число часов' })
  .min(0, 'Часы не бывают отрицательными')
  .max(100_000, 'Похоже на опечатку: слишком много часов для одной команды');

/**
 * Задание ёмкости на период.
 *
 * PUT, а не PATCH или POST: запись адресуется тройкой «команда, начало,
 * конец» (уникальный ключ в миграции 0001), и повторный вызов с теми же
 * границами должен приводить к тому же состоянию, а не заводить вторую
 * запись и не складывать часы. Сложение — отдельная операция, и она есть:
 * применение сценария добавляет часы к существующей записи, потому что
 * «дать команде ещё 40 часов» и «у команды 40 часов» — разные события.
 */
export const capacityPutSchema = z
  .object({
    periodStart: calendarDate,
    periodEnd: calendarDate,
    availableHours,
  })
  /*
    Порядок границ проверяется и здесь, и в базе. Дублирование осознанно:
    в базе это ограничение целостности (оно обязано быть там, где живут
    данные), а здесь — сообщение о том, какое поле заполнено неверно.
    Без схемы пользователь получил бы отказ проверки без указания поля.
  */
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: 'Конец периода раньше его начала',
    path: ['periodEnd'],
  });

export type TeamQuery = z.infer<typeof teamQuerySchema>;
export type CapacityQuery = z.infer<typeof capacityQuerySchema>;
export type CapacityPutInput = z.infer<typeof capacityPutSchema>;

// ── Правка команд, состава и отсутствий (FR-10, FR-11) ──────────────────────

const teamName = z
  .string()
  .trim()
  .min(1, 'Укажите название')
  .max(80, 'Слишком длинное название');
const teamKind = z.enum(TEAM_KINDS, { message: 'Неизвестный вид команды' });

/**
 * Организация приходит от клиента — как у проекта, и по той же причине:
 * у команды нет родителя, из которого её можно вывести. Подменить её
 * нельзя: вставку в чужую организацию не пропустит политика RLS.
 */
export const teamCreateSchema = z.object({
  orgId: uuid,
  name: teamName,
  kind: teamKind.default('other'),
});

export const teamUpdateSchema = z
  .object({ name: teamName, kind: teamKind })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Не указано ни одного поля для изменения',
  });

/**
 * Участник команды. Доля — сколько своего времени человек отдаёт этой
 * команде: по ней отпуск уменьшает ёмкость каждой из его команд.
 */
export const memberPutSchema = z.object({
  profileId: uuid,
  allocationPct: z
    .number({ message: 'Ожидается процент' })
    .int('Процент — целое число')
    .min(1, 'Доля — от 1 до 100%')
    .max(100, 'Доля — от 1 до 100%')
    .default(100),
});

export const memberDeleteSchema = z.object({ profileId: uuid });

export const capacityDeleteSchema = z.object({
  periodStart: calendarDate,
  periodEnd: calendarDate,
});

export const absenceCreateSchema = z
  .object({
    orgId: uuid,
    profileId: uuid,
    startDate: calendarDate,
    endDate: calendarDate,
    reason: z.string().trim().max(200, 'Слишком длинная причина').nullish(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'Конец отсутствия раньше его начала',
    path: ['endDate'],
  });

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;
export type MemberPutInput = z.infer<typeof memberPutSchema>;
export type AbsenceCreateInput = z.infer<typeof absenceCreateSchema>;
