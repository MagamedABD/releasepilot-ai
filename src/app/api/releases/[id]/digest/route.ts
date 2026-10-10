import { fail, isUuid, notFound, ok, unauthorized } from '@/lib/api/http';
import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import { loadReleaseContext } from '@/lib/data/context';
import { env } from '@/lib/env';
import { emailConfigured, sendEmail } from '@/lib/notify/send';
import { digestEmail } from '@/lib/notify/templates';
import { createClient } from '@/lib/supabase/server';
import { executiveStatus } from '@/lib/ui/status';

/**
 * Статус релиза на почту — себе (FR-43, US-30).
 *
 * Письмо уходит только тому, кто нажал кнопку, на адрес его же учётной
 * записи: адрес получателя не принимается из запроса. Иначе маршрут стал
 * бы способом разослать содержимое релиза кому угодно от имени сервиса.
 *
 * Доступ к релизу проверяет RLS — контекст читается от лица пользователя,
 * и чужой релиз отвечает «не найдено».
 */
export async function POST(_request: Request, { params }: RouteContext<'/api/releases/[id]/digest'>) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  if (!emailConfigured()) {
    return fail(503, 'not_configured', 'Почта не настроена: не заданы RESEND_API_KEY и DIGEST_FROM_EMAIL');
  }

  const email = auth.claims.email;
  if (typeof email !== 'string' || !email) {
    return fail(422, 'no_email', 'У учётной записи нет адреса почты');
  }

  const [releaseRes, context] = await Promise.all([
    supabase
      .from('releases')
      .select('id, name, planned_date, organizations(name, slug)')
      .eq('id', id)
      .maybeSingle(),
    loadReleaseContext(supabase, id),
  ]);
  const release = releaseRes.data;
  if (!release || context.kind !== 'ok') return notFound();

  const { snapshot, completedReleases } = context.context;
  const forecast = forecastRelease(snapshot, RISK_CONFIG, { completedReleases });
  const metrics = calculateRelease(snapshot, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });
  const org = release.organizations as { name: string; slug: string } | null;

  const result = await sendEmail(
    [email],
    digestEmail(org?.name ?? 'ReleasePilot', [
      {
        name: release.name,
        level: metrics.riskLevel,
        lines: executiveStatus({
          name: release.name,
          plannedDate: release.planned_date,
          metrics,
          forecast,
        }),
        url: `${env.NEXT_PUBLIC_APP_URL}/org/${org?.slug ?? ''}/release/${release.id}`,
      },
    ]),
  );

  if (!result.ok) return fail(502, 'send_failed', 'Почтовый сервис не принял письмо. Повторите позже.');
  return ok({ sentTo: email });
}
