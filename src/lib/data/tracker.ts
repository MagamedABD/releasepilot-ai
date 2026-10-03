/**
 * Чтение из Yandex Tracker (FR-40).
 *
 * Единственный модуль проекта, который ходит в чужую систему. Поэтому он
 * отделён от разбора: `src/lib/import/tracker.ts` переводит поля и
 * проверяется на фикстурах, а здесь только запросы и их отказы.
 *
 * **Живого вызова не было.** Корпоративный трекер — чужие данные, и
 * обращаться к нему без решения владельца нельзя. Адреса, заголовки и
 * форма ответа взяты из документации API; при первом живом запуске
 * расхождения возможны, и искать их надо здесь.
 */

import type { TrackerIssue, TrackerLink } from '@/lib/import/tracker';

const BASE = 'https://api.tracker.yandex.net/v2';

export type TrackerAccess = { token: string; orgId: string };

export type TrackerFetchResult =
  | { kind: 'ok'; issues: TrackerIssue[]; links: Record<string, TrackerLink[]> }
  /** Трекер отказал: доступ, очередь, лимит запросов. */
  | { kind: 'error'; status: number; message: string };

function headers(access: TrackerAccess): HeadersInit {
  return {
    Authorization: `OAuth ${access.token}`,
    // Облачная организация и организация Яндекс 360 различаются
    // заголовком; отправляются оба — лишний трекер игнорирует.
    'X-Org-ID': access.orgId,
    'X-Cloud-Org-ID': access.orgId,
    'Content-Type': 'application/json',
  };
}

/**
 * Задачи очереди и их связи.
 *
 * Связи читаются по одной задаче за запрос — так устроено API, пакетного
 * варианта нет. Отсюда и потолок на число задач в запросе: сто задач это
 * сто один запрос, и уложиться в таймаут функции можно, а тысяча — уже
 * фоновая работа, а не ответ на запрос.
 */
export async function fetchQueueIssues(
  access: TrackerAccess,
  queue: string,
  limit: number,
): Promise<TrackerFetchResult> {
  let issues: TrackerIssue[];
  try {
    const res = await fetch(`${BASE}/issues/_search?perPage=${limit}`, {
      method: 'POST',
      headers: headers(access),
      body: JSON.stringify({ filter: { queue } }),
    });

    if (!res.ok) {
      /*
        Текст ошибки трекера наружу не отдаётся: он рассказывает о чужой
        системе и может содержать названия очередей и проектов. Наружу
        уходит код и своя формулировка — по коду видно, что делать.
      */
      return {
        kind: 'error',
        status: res.status,
        message:
          res.status === 401 || res.status === 403
            ? 'Трекер отказал в доступе: проверьте токен и права на очередь'
            : res.status === 404
              ? 'Очередь не найдена'
              : `Трекер ответил ошибкой ${res.status}`,
      };
    }

    issues = (await res.json()) as TrackerIssue[];
  } catch {
    return { kind: 'error', status: 502, message: 'Трекер недоступен' };
  }

  const links: Record<string, TrackerLink[]> = {};
  for (const issue of issues) {
    if (!issue.key) continue;
    try {
      const res = await fetch(`${BASE}/issues/${encodeURIComponent(issue.key)}/links`, {
        headers: headers(access),
      });
      // Отказ на связях одной задачи не отменяет импорт: задача приедет
      // без зависимостей, и это видно — хуже было бы потерять её целиком.
      links[issue.key] = res.ok ? ((await res.json()) as TrackerLink[]) : [];
    } catch {
      links[issue.key] = [];
    }
  }

  return { kind: 'ok', issues, links };
}
