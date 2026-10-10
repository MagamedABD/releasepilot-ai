/**
 * Отправка письма через Resend.
 *
 * Отсутствие ключа — состояние, а не ошибка, как и у ассистента: без
 * почтового сервиса приложение обязано работать целиком, а уведомление о
 * росте риска остаётся в интерфейсе (плашка в кокпите). Поэтому функция
 * не бросает исключений и отвечает, что именно произошло: вызывающему
 * нужно отличать «не настроено» от «сервис отказал».
 *
 * Без SDK намеренно: это один POST, и зависимость ради него тянула бы
 * в сборку больше кода, чем весь модуль уведомлений.
 */

import 'server-only';

import { serverEnv } from '@/lib/env.server';

import type { Email } from './templates';

export type SendResult =
  | { ok: true; sent: number }
  | { ok: false; reason: 'not_configured' | 'no_recipients' | 'failed'; detail?: string };

export function emailConfigured(): boolean {
  return Boolean(serverEnv.RESEND_API_KEY && serverEnv.DIGEST_FROM_EMAIL);
}

export async function sendEmail(to: readonly string[], email: Email): Promise<SendResult> {
  if (!serverEnv.RESEND_API_KEY || !serverEnv.DIGEST_FROM_EMAIL) {
    return { ok: false, reason: 'not_configured' };
  }
  if (to.length === 0) return { ok: false, reason: 'no_recipients' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverEnv.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: serverEnv.DIGEST_FROM_EMAIL,
        // Получатели — в скрытой копии: дайджест уходит всем менеджерам
        // организации, и раскрывать их адреса друг другу незачем.
        to: serverEnv.DIGEST_FROM_EMAIL,
        bcc: to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      // Тело ответа сервиса наружу не идёт (NFR-08) — только в лог.
      console.error(`[notify] Resend ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { ok: false, reason: 'failed', detail: String(res.status) };
    }
    return { ok: true, sent: to.length };
  } catch (e) {
    console.error(`[notify] нет связи с Resend: ${e instanceof Error ? e.message : e}`);
    return { ok: false, reason: 'failed' };
  }
}
