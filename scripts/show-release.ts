/**
 * Прогон движка риска на настоящих строках базы.
 *
 * scripts/show-metrics.ts считает тот же движок на фикстуре из постановки
 * задачи. Здесь проверяется другое и более важное: что путь «база →
 * снимок → метрики» вообще сходится. Фикстура написана под домен и потому
 * подходит ему по определению; строки базы — нет, и любое расхождение
 * имён, единиц или перечислений всплывёт именно тут.
 *
 * Служебный ключ берётся не ради обхода политик, а потому что у скрипта
 * нет сессии пользователя. Данные читаются только демонстрационные.
 *
 * Запуск: npm run show:release
 */

import { createClient } from '@supabase/supabase-js';

import { loadEnv } from './lib/env';
import { loadReleaseSnapshot } from '../src/lib/data/snapshot';
import { calculateRelease } from '../src/domain/risk';
import type { Database } from '../src/lib/database.types';

const env = loadEnv();
const supabase = createClient<Database>(env.url, env.secretKey, {
  auth: { persistSession: false },
});

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function main() {
  const { data: releases, error } = await supabase
    .from('releases')
    .select('id, name, status, planned_date, projects(key)')
    .order('planned_date');

  if (error) throw new Error(error.message);
  if (!releases?.length) {
    console.log('В базе нет релизов. Загрузите демо-данные: npm run seed:demo');
    return;
  }

  for (const r of releases) {
    const snapshot = await loadReleaseSnapshot(supabase, r.id);
    if (!snapshot) {
      console.log(`\n${r.name} — снимок не собран`);
      continue;
    }

    const m = calculateRelease(snapshot);
    const key = (r.projects as { key: string } | null)?.key ?? '—';

    console.log(`\n── ${key} · ${r.name} · ${r.status} · план ${r.planned_date}`);
    console.log(
      `   готовность ${m.readinessPct}% по часам (${m.readinessByCountPct}% по задачам)` +
        ` · задач ${m.counts.total}, готово ${m.counts.done}`,
    );
    console.log(
      `   риск ${m.riskScore} → ${m.riskLevel}` +
        (m.riskLevel === m.riskLevelByScore ? '' : ` (по скору был ${m.riskLevelByScore})`),
    );
    console.log(`   рабочих дней до даты: ${m.remainingWorkingDays}, цепочка: ${m.criticalChain.days}`);

    const load = m.teamLoad
      .filter((t) => t.remainingH > 0)
      .map((t) => `${t.teamName} ${Number.isFinite(t.load) ? pct(t.load) : '∞'}`)
      .join(' · ');
    if (load) console.log(`   загрузка: ${load}`);

    if (m.blockers.length) {
      const b = m.blockers
        .map((x) => `${x.taskId.slice(0, 8)} ${x.blockedDays}д держит ${x.blocksCount}${x.isStale ? ' (застарелый)' : ''}`)
        .join(' · ');
      console.log(`   блокеры: ${b}`);
    }
    if (m.scopeDrift.addedH > 0) {
      console.log(`   дрейф объёма: +${m.scopeDrift.addedH}ч (${pct(m.scopeDrift.share)})`);
    }
    if (m.reasons.length) {
      console.log(`   причины: ${m.reasons.map((x) => `${x.code}[${x.kind}]`).join(' ')}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
