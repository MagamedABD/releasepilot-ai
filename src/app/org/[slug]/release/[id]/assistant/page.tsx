import { notFound } from 'next/navigation';

import { Assistant } from '@/components/assistant';
import { RiskBadge } from '@/components/cockpit';
import { StatusCard } from '@/components/status-card';
import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import { loadReleaseContext } from '@/lib/data/context';
import { emailConfigured } from '@/lib/notify/send';
import { createClient } from '@/lib/supabase/server';
import { hours } from '@/lib/ui/risk';
import { probabilityText } from '@/lib/ui/scenario';
import { executiveStatus } from '@/lib/ui/status';

export const metadata = { title: 'Ассистент — ReleasePilot AI' };

/**
 * Экран ассистента (экран 5 концепции).
 *
 * Страница серверная, диалог — клиентский: иначе нельзя ни читать поток,
 * ни дописывать ответ по мере генерации. Сервер здесь отвечает за одно —
 * за шапку с теми же числами, что в кокпите.
 *
 * Числа в шапке стоят не для красоты. Ассистент обязан объяснять расчёт, а
 * не свою картину мира, и человеку нужна возможность сверить: если в
 * ответе «вероятность 38%», то же число должно быть видно на экране. Это
 * инвариант ADR-001, вынесенный в интерфейс.
 */
export default async function AssistantPage({
  params,
}: PageProps<'/org/[slug]/release/[id]/assistant'>) {
  const { slug, id } = await params;
  const supabase = await createClient();

  const [releaseRes, context] = await Promise.all([
    supabase
      .from('releases')
      .select('id, name, org_id, planned_date, organizations(slug)')
      .eq('id', id)
      .maybeSingle(),
    loadReleaseContext(supabase, id),
  ]);

  const release = releaseRes.data;
  if (!release || context.kind !== 'ok') notFound();
  if ((release.organizations as { slug: string } | null)?.slug !== slug) notFound();

  const { snapshot, completedReleases } = context.context;
  const forecast = forecastRelease(snapshot, RISK_CONFIG, { completedReleases });
  const metrics = calculateRelease(snapshot, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pt-6 pb-8 sm:pb-10">
      <div>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide opacity-50">Ассистент</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{release.name}</h1>
            <p className="mt-1 text-sm opacity-60">
              {probabilityText(forecast)} · остаток{' '}
              {hours(metrics.effort.remainingH)} · готовность {metrics.readinessPct.toFixed(1)}%
            </p>
          </div>
          <RiskBadge level={metrics.riskLevel} score={metrics.riskScore} />
        </header>
      </div>

      <StatusCard
        releaseId={id}
        emailEnabled={emailConfigured()}
        lines={executiveStatus({
          name: release.name,
          plannedDate: release.planned_date,
          metrics,
          forecast,
        })}
      />

      <Assistant slug={slug} orgId={release.org_id} releaseId={id} />
    </div>
  );
}
