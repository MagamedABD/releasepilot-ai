/**
 * Вызов собственного API из форм.
 *
 * Формы правки идут через те же маршруты, что и внешние клиенты, а не
 * через отдельные server actions: проверка, отметки времени и перевод
 * ошибок базы уже живут там, и вторая копия разошлась бы с первой.
 *
 * Ответ сводится к двум случаям. Ошибка всегда несёт человеческое
 * сообщение и, если сервер назвал поля, — ошибки по полям, ровно в том
 * виде, в каком их ждёт `Field`.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fields: Record<string, string[]> };

export async function callApi<T = unknown>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'Нет связи с сервером. Проверьте сеть и повторите.', fields: {} };
  }

  if (res.status === 204) return { ok: true, data: undefined as T };

  const json = await res.json().catch(() => null);
  // Успешный ответ API всегда завёрнут в `{ data }` (см. lib/api/http).
  if (res.ok) return { ok: true, data: (json as { data: T } | null)?.data as T };

  const error = (json as { error?: { message?: string; fields?: Record<string, string[]> } } | null)
    ?.error;
  return {
    ok: false,
    message:
      res.status === 403 || res.status === 404
        ? (error?.message ?? 'Недостаточно прав для этого действия')
        : (error?.message ?? 'Не удалось сохранить. Повторите попытку.'),
    fields: error?.fields ?? {},
  };
}
