/**
 * Ежедневная запись снимков метрик (FR-39).
 *
 * Запускается планировщиком Vercel по расписанию из `vercel.json`.
 * Открытым быть не может: внутри работает административный клиент,
 * обходящий политики RLS, — то есть маршрут имеет доступ к данным всех
 * организаций сразу. Единственное, что его закрывает, — пароль
 * планировщика, и при незаданном пароле маршрут отказывается работать
 * вовсе, а не пускает всех.
 *
 * GET, потому что планировщик Vercel ходит именно так. Для записи это
 * неправильный метод, и будь маршрут частью публичного API, так делать
 * было бы нельзя. Здесь он часть обслуживания и доступен только
 * планировщику, поэтому выбран его протокол, а не чистота семантики.
 */

import { timingSafeEqual } from 'node:crypto';

import { fail, ok } from '@/lib/api/http';
import { captureSnapshots } from '@/lib/data/capture';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env.server';

export const dynamic = 'force-dynamic';
/** Расчёт по всем организациям не должен обрываться на таймауте. */
export const maxDuration = 60;

/**
 * Сравнение пароля за постоянное время.
 *
 * Обычное `===` на строках выходит из сравнения на первом несовпавшем
 * символе, и по времени ответа пароль подбирается посимвольно. Здесь это
 * скорее дисциплина, чем реальная угроза — но дисциплина дешёвая.
 */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = serverEnv.CRON_SECRET;
  if (!secret) {
    return fail(
      503,
      'not_configured',
      'Запись снимков не настроена: не задан CRON_SECRET',
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !sameSecret(given, secret)) {
    // Без подробностей: отвечать «неверный пароль» значило бы
    // подтверждать, что маршрут настроен и пароль у него другой.
    return fail(401, 'unauthorized', 'Нужна авторизация планировщика');
  }

  const report = await captureSnapshots(createAdminClient());

  /*
    Ошибки отдельных организаций не делают запуск неуспешным: снимок
    одной организации не должен зависеть от данных другой. Но и прятать
    их нельзя — они уходят и в ответ, и в лог, потому что читать ответ
    планировщика некому, а лог смотрят.
  */
  if (report.errors.length > 0) {
    console.error(`[cron/snapshot] ошибки: ${report.errors.join(' | ')}`);
  }

  return ok(report);
}
