import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi } from './api';

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('callApi', () => {
  it('разворачивает успешный ответ из { data }', async () => {
    respond(201, { data: { id: 'r1' } });
    expect(await callApi('POST', '/api/releases', {})).toEqual({ ok: true, data: { id: 'r1' } });
  });

  it('204 — успех без данных', async () => {
    respond(204);
    expect(await callApi('DELETE', '/api/tasks/1')).toEqual({ ok: true, data: undefined });
  });

  it('отдаёт сообщение и ошибки по полям', async () => {
    respond(422, {
      error: { code: 'validation_failed', message: 'Проверьте заполнение полей', fields: { title: ['Укажите название'] } },
    });
    expect(await callApi('POST', '/api/tasks', {})).toEqual({
      ok: false,
      message: 'Проверьте заполнение полей',
      fields: { title: ['Укажите название'] },
    });
  });

  it('сбой сети — понятное сообщение, а не исключение', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const res = await callApi('PATCH', '/api/tasks/1', {});
    expect(res.ok).toBe(false);
  });
});
