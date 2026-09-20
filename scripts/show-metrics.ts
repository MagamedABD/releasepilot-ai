/**
 * Ручной прогон движка на сценарии из постановки задачи.
 * Нужен для проверки глазами: `npx tsx scripts/show-metrics.ts`.
 */
import { calculateRelease } from '../src/domain/risk';
import { canonicalScenario } from '../src/domain/fixtures';

const m = calculateRelease(canonicalScenario());

console.log('Готовность:', m.readinessPct, '% по трудозатратам |', m.readinessByCountPct, '% по задачам');
console.log('Скор:', m.riskScore, '| уровень по скору:', m.riskLevelByScore, '| итоговый:', m.riskLevel);
console.log('Рабочих дней до релиза:', m.remainingWorkingDays, '| цепочка:', m.criticalChain.days, 'дней');
console.log('Загрузка:', m.teamLoad.map((t) => `${t.teamName} ${Math.round(t.load * 100)}%`).join(' · '));
console.log('Факторы:', m.factors.map((f) => `${f.code}=${f.contribution}`).join(' '));
console.log('Причины:', m.reasons.map((r) => `${r.code}[${r.kind}]`).join(' '));
