/**
 * Рассылка по итогам ежедневного прогона: оповещения о росте риска каждый
 * день, дайджест — раз в неделю.
 *
 * Получатели — те, кто отвечает за релизы: владелец, администраторы,
 * менеджеры. Наблюдателям письма не идут: уведомление призывает
 * действовать, а действовать могут только они.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrgCapture } from '@/lib/data/capture';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { byUrgency } from '@/lib/ui/releases';
import { executiveStatus } from '@/lib/ui/status';

import { riskRose } from './alerts';
import { emailConfigured, sendEmail } from './send';
import { digestEmail, riskAlertEmail, type DigestRelease } from './templates';

type Admin = SupabaseClient<Database>;

export type DispatchReport = {
  configured: boolean;
  alerts: number;
  digests: number;
  errors: string[];
};

const RECIPIENT_ROLES = ['owner', 'admin', 'manager'] as const;

/** Адреса менеджеров организации. Берутся из auth — в профиле почты нет. */
async function recipients(admin: Admin, orgId: string): Promise<string[]> {
  const { data } = await admin
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .in('role', [...RECIPIENT_ROLES]);

  const emails: string[] = [];
  for (const m of data ?? []) {
    const { data: found } = await admin.auth.admin.getUserById(m.user_id);
    const email = found.user?.email;
    // Адреса на example.com — демо-персонажи посева: писать им некуда.
    if (email && !email.endsWith('@example.com')) emails.push(email);
  }
  return emails;
}

/** Дайджест уходит по понедельникам: статус на неделю, а не ежедневный шум. */
export function isDigestDay(now: Date): boolean {
  return now.getUTCDay() === 1;
}

export async function dispatchNotifications(
  admin: Admin,
  captures: readonly OrgCapture[],
  now: Date = new Date(),
): Promise<DispatchReport> {
  const report: DispatchReport = { configured: emailConfigured(), alerts: 0, digests: 0, errors: [] };
  if (!report.configured) return report;

  for (const capture of captures) {
    const { data: org } = await admin
      .from('organizations')
      .select('name, slug')
      .eq('id', capture.orgId)
      .maybeSingle();
    if (!org) continue;

    const items = [...capture.releases]
      .sort((a, b) => byUrgency(a.release, b.release))
      .map((r) => {
        const item: DigestRelease = {
          name: r.release.name,
          level: r.metrics.riskLevel,
          lines: executiveStatus({
            name: r.release.name,
            plannedDate: r.release.plannedDate,
            metrics: r.metrics,
            forecast: r.forecast,
          }),
          url: `${env.NEXT_PUBLIC_APP_URL}/org/${org.slug}/release/${r.release.id}`,
        };
        return { item, previousLevel: r.previousLevel };
      });

    const rose = items.filter((i) => riskRose(i.previousLevel, i.item.level));
    const digest = isDigestDay(now);
    if (rose.length === 0 && !digest) continue;

    const to = await recipients(admin, capture.orgId);
    if (to.length === 0) continue;

    for (const r of rose) {
      const res = await sendEmail(to, riskAlertEmail({ ...r.item, from: r.previousLevel! }));
      if (res.ok) report.alerts += 1;
      else report.errors.push(`${capture.orgId}: оповещение — ${res.reason}`);
    }

    if (digest) {
      const res = await sendEmail(to, digestEmail(org.name, items.map((i) => i.item)));
      if (res.ok) report.digests += 1;
      else report.errors.push(`${capture.orgId}: дайджест — ${res.reason}`);
    }
  }

  return report;
}
