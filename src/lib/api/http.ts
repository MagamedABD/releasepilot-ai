/**
 * Общий вид ответов API.
 *
 * Вынесено в модуль не ради краткости маршрутов, а ради единообразия:
 * когда каждый маршрут придумывает форму ошибки сам, клиент вынужден
 * разбирать три разных формата, и обработка ошибок в нём превращается
 * в набор частных случаев.
 *
 * Форма одна: `{ data }` при успехе, `{ error: { code, message } }` при
 * отказе. `code` — для кода, `message` — для человека.
 */

import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export type ApiError = {
  error: { code: string; message: string; fields?: Record<string, string[]> };
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return NextResponse.json<ApiError>({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

/**
 * Ответ на непрошедшую проверку.
 *
 * 422, а не 400: тело разобралось как JSON и синтаксически корректно —
 * не устроило содержимое. Различие практическое, а не педантичное:
 * на 400 клиенту стоит проверить, что он вообще отправляет, на 422 —
 * показать пользователю, какое поле тот заполнил неверно.
 */
export function invalid(error: ZodError) {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fail(422, 'validation_failed', 'Проверьте заполнение полей', fields);
}

export function unauthorized() {
  return fail(401, 'unauthorized', 'Нужно войти в систему');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверка идентификатора из адреса.
 *
 * Без неё строка вроде `/api/tasks/не-uuid` уходит в запрос, Postgres
 * отвечает «invalid input syntax for type uuid», и наружу выходит 500 —
 * то есть «сломались мы», хотя сломан был адрес. Заодно это избавляет
 * от похода в базу за заведомо ненаходимым.
 *
 * Ответ — «не найдено», а не «неверный формат»: по такому адресу
 * действительно ничего нет, и различать эти случаи незачем.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function notFound() {
  return fail(404, 'not_found', 'Не найдено');
}

/**
 * Разбор тела запроса.
 *
 * Отдельная функция, потому что `request.json()` бросает на пустом или
 * битом теле, и необработанное исключение здесь превратилось бы в 500 —
 * ответ, который говорит «сломались мы», хотя сломался запрос.
 */
export async function readJson(request: Request): Promise<unknown | typeof BAD_JSON> {
  try {
    return await request.json();
  } catch {
    return BAD_JSON;
  }
}

export const BAD_JSON = Symbol('bad-json');

export function badJson() {
  return fail(400, 'invalid_json', 'Тело запроса не разобралось как JSON');
}

/**
 * Ошибка Postgres → ответ HTTP.
 *
 * Коды разбираются поимённо, потому что каждый из них означает разное для
 * вызывающего, а текст исключения наружу не отдаётся (NFR-08): он
 * рассказывает об устройстве базы.
 *
 * Отдельного внимания стоит 42501 — отказ политики RLS. Он отдаётся как
 * 404, а не 403. Честный 403 означал бы «объект есть, но он не ваш», то
 * есть подтверждал бы существование чужих данных тому, кто их угадал.
 * По той же причине страницы отвечают «не найдено» вместо «нет доступа».
 */
export function fromPostgres(error: { code?: string; message?: string } | null) {
  switch (error?.code) {
    case '23505':
      return fail(409, 'conflict', 'Такая запись уже существует');
    case '23503':
      return fail(422, 'invalid_reference', 'Ссылка на несуществующую запись');
    case '23514':
      return fail(422, 'check_failed', 'Значение не прошло проверку на стороне базы');
    case '23502':
      return fail(422, 'missing_field', 'Не заполнено обязательное поле');
    case '42501':
      return notFound();
    case 'P0001':
      // Исключение из триггера: текст писал автор миграции для человека.
      // Единственный случай, когда сообщение базы уместно показать —
      // например, объяснение, почему зависимость создала бы цикл (FR-13).
      return fail(422, 'rejected', error.message ?? 'Операция отклонена');
    default:
      return fail(500, 'internal', 'Не удалось выполнить операцию');
  }
}
