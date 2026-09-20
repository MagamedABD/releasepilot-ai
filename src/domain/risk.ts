import { criticalChain } from './chain';
import { RISK_CONFIG, type RiskConfig } from './config';
import {
  calculateTeamLoad,
  collectBlockers,
  countByStatus,
  effortTotals,
  isOpen,
  qaFunnel,
  remainingDays,
  scopeDrift,
  teamCapacityHours,
} from './metrics';
import type {
  FactorValue,
  ReleaseMetrics,
  ReleaseSnapshot,
  RiskLevel,
  RiskReason,
} from './types';

export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const LEVEL_RANK: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function raise(current: RiskLevel, candidate: RiskLevel): RiskLevel {
  return LEVEL_RANK[candidate] > LEVEL_RANK[current] ? candidate : current;
}

function levelByScore(score: number, config: RiskConfig): RiskLevel {
  const { medium, high, critical } = config.levelThresholds;
  if (score >= critical) return 'critical';
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}

/** Округление до двух знаков — иначе в снимках копится дробный мусор. */
function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type CalculateOptions = {
  /**
   * Вероятность выпуска в срок. Передаётся отдельно: прогноз Монте-Карло —
   * самостоятельный расчёт, а движок риска обязан работать и без него.
   */
  probabilityOnTime?: number | null;
};

/**
 * Главная функция движка (ADR-001).
 *
 * Чистая: один и тот же снимок всегда даёт один и тот же результат (FR-19).
 * Никаких обращений к базе, к сети и к `Date.now()` внутри.
 */
export function calculateRelease(
  snapshot: ReleaseSnapshot,
  config: RiskConfig = RISK_CONFIG,
  options: CalculateOptions = {},
): ReleaseMetrics {
  const counts = countByStatus(snapshot.tasks);
  const effort = effortTotals(snapshot.tasks);
  const daysLeft = remainingDays(snapshot);
  const teamLoad = calculateTeamLoad(snapshot, config);
  const blockers = collectBlockers(snapshot, config);
  const chain = criticalChain(snapshot, config);
  const qa = qaFunnel(snapshot, config);
  const drift = scopeDrift(snapshot);
  const probabilityOnTime = options.probabilityOnTime ?? null;

  // ── F1. Дефицит времени ────────────────────────────────────────────────
  const totalCapacityH = snapshot.teams.reduce(
    (sum, team) => sum + teamCapacityHours(snapshot, team.id, config),
    0,
  );
  const demandRatio =
    totalCapacityH > 0
      ? effort.remainingH / totalCapacityH
      : effort.remainingH > 0
        ? Infinity
        : 0;
  const f1 = Number.isFinite(demandRatio)
    ? clamp((demandRatio - config.timeDeficit.zeroAt) / config.timeDeficit.span)
    : 1;

  // ── F2. Перегрузка команд ──────────────────────────────────────────────
  const loads = teamLoad.map((t) => t.load);
  const maxLoad = loads.length > 0 ? Math.max(...loads) : 0;
  const f2 = Number.isFinite(maxLoad)
    ? clamp((maxLoad - config.overload.zeroAt) / config.overload.span)
    : 1;
  const bottleneck = teamLoad.reduce<(typeof teamLoad)[number] | null>(
    (worst, team) => (worst === null || team.load > worst.load ? team : worst),
    null,
  );

  // ── F3. Блокеры ────────────────────────────────────────────────────────
  // Взвешенная доля заблокированных трудозатрат: приоритет задаёт значимость,
  // длительность блокировки — множитель.
  let weightedBlockedH = 0;
  for (const blocker of blockers) {
    const priorityWeight = config.blockerPriorityWeight[blocker.priority];
    const ageWeight =
      config.freshBlockerWeight +
      (1 - config.freshBlockerWeight) *
        clamp(blocker.blockedDays / config.staleBlockerDays);
    weightedBlockedH += blocker.estimateH * priorityWeight * ageWeight;
  }
  const blockedShare =
    effort.remainingH > 0 ? weightedBlockedH / effort.remainingH : 0;
  const f3 = clamp(blockedShare / config.blockedShareForMax);

  // ── F4. Критическая цепочка ────────────────────────────────────────────
  // Последовательность из одной задачи — не цепочка, а просто крупная задача.
  // Её продолжительность уже учтена дефицитом времени и загрузкой команды;
  // засчитывать её ещё и здесь значит наказывать релиз дважды за один факт.
  const hasChain = chain.taskIds.length >= 2;
  const chainDays = hasChain ? chain.days : 0;
  const chainRatio = daysLeft > 0 ? chainDays / daysLeft : chainDays > 0 ? Infinity : 0;
  const f4 = Number.isFinite(chainRatio)
    ? clamp(chainRatio - config.chain.zeroAt)
    : 1;

  // ── F5. QA-воронка ─────────────────────────────────────────────────────
  const f5 = clamp(qa.share);

  // ── F6. Дрейф скоупа ───────────────────────────────────────────────────
  const f6 = clamp(drift.share);

  const factors: FactorValue[] = (
    [
      ['F1', f1],
      ['F2', f2],
      ['F3', f3],
      ['F4', f4],
      ['F5', f5],
      ['F6', f6],
    ] as const
  ).map(([code, value]) => ({
    code,
    value: round(value, 4),
    weight: config.weights[code],
    contribution: round(value * config.weights[code]),
  }));

  const riskScore = round(
    factors.reduce((sum, factor) => sum + factor.contribution, 0),
  );

  const byScore = levelByScore(riskScore, config);
  const { level, escalations } = escalate({
    base: byScore,
    config,
    maxLoad,
    bottleneckName: bottleneck?.teamName ?? null,
    blockers,
    chainDays,
    chainTaskIds: hasChain ? chain.taskIds : [],
    daysLeft,
    probabilityOnTime,
  });

  const factorReasons = buildFactorReasons({
    factors,
    snapshot,
    demandRatio,
    maxLoad,
    bottleneckName: bottleneck?.teamName ?? null,
    blockers,
    chain,
    qa,
    drift,
    daysLeft,
  });

  const openCount = snapshot.tasks.filter(isOpen).length;
  const countable = counts.total;

  return {
    releaseId: snapshot.release.id,
    computedAt: snapshot.now,
    counts,
    effort: {
      totalH: round(effort.totalH),
      doneH: round(effort.doneH),
      remainingH: round(effort.remainingH),
    },
    readinessPct:
      effort.totalH > 0 ? round((effort.doneH / effort.totalH) * 100, 1) : 0,
    readinessByCountPct:
      countable > 0 ? round(((countable - openCount) / countable) * 100, 1) : 0,
    remainingWorkingDays: daysLeft,
    teamLoad: teamLoad.map((team) => ({
      ...team,
      remainingH: round(team.remainingH),
      capacityH: round(team.capacityH),
      load: round(team.load, 4),
    })),
    blockers: blockers.map((blocker) => ({
      ...blocker,
      blockedDays: round(blocker.blockedDays, 2),
    })),
    criticalChain: { taskIds: chain.taskIds, days: round(chain.days) },
    qaFunnel: {
      share: round(qa.share, 4),
      requiredH: round(qa.requiredH),
      capacityH: round(qa.capacityH),
    },
    scopeDrift: { addedH: round(drift.addedH), share: round(drift.share, 4) },
    factors,
    riskScore,
    riskLevel: level,
    riskLevelByScore: byScore,
    // Правила эскалации идут первыми: именно они определили уровень.
    // Внутри групп — по убыванию вклада.
    reasons: [...escalations, ...factorReasons],
    probabilityOnTime,
  };
}

type EscalationInput = {
  base: RiskLevel;
  config: RiskConfig;
  maxLoad: number;
  bottleneckName: string | null;
  blockers: ReturnType<typeof collectBlockers>;
  chainDays: number;
  chainTaskIds: string[];
  daysLeft: number;
  probabilityOnTime: number | null;
};

/**
 * Правила эскалации (ADR-001, §4).
 *
 * Средневзвешенная сумма усредняет, а Delivery Manager мыслит правилами:
 * «заблокирована критическая задача — значит, горит», независимо от того,
 * как выглядит скор. Правила только поднимают уровень.
 */
function escalate(input: EscalationInput): {
  level: RiskLevel;
  escalations: RiskReason[];
} {
  const { config } = input;
  const triggered: Array<{ reason: RiskReason; target: RiskLevel }> = [];

  const add = (reason: RiskReason, target: RiskLevel) => {
    triggered.push({ reason, target });
  };

  const blockedP0 = input.blockers.filter((b) => b.priority === 'P0');
  if (blockedP0.length > 0) {
    add(
      {
        code: 'CRITICAL_BLOCKER',
        kind: 'escalation',
        severity: 'high',
        contribution: 0,
        facts: { count: blockedP0.length, priority: 'P0' },
        taskIds: blockedP0.map((b) => b.taskId),
      },
      'high',
    );
  }

  const blockedP1 = input.blockers.filter((b) => b.priority === 'P1');
  if (blockedP1.length >= config.escalation.blockedP1ForHigh) {
    add(
      {
        code: 'MULTIPLE_P1_BLOCKED',
        kind: 'escalation',
        severity: 'high',
        contribution: 0,
        facts: { count: blockedP1.length, priority: 'P1' },
        taskIds: blockedP1.map((b) => b.taskId),
      },
      'high',
    );
  }

  if (input.maxLoad >= config.escalation.teamLoadHigh) {
    add(
      {
        code: 'TEAM_OVERLOAD_RULE',
        kind: 'escalation',
        severity: 'high',
        contribution: 0,
        facts: {
          team: input.bottleneckName ?? '—',
          load: round(input.maxLoad, 4),
          threshold: config.escalation.teamLoadHigh,
        },
        taskIds: [],
      },
      'high',
    );
  } else if (input.maxLoad >= config.escalation.teamLoadMedium) {
    add(
      {
        code: 'TEAM_OVERLOAD_RULE',
        kind: 'escalation',
        severity: 'medium',
        contribution: 0,
        facts: {
          team: input.bottleneckName ?? '—',
          load: round(input.maxLoad, 4),
          threshold: config.escalation.teamLoadMedium,
        },
        taskIds: [],
      },
      'medium',
    );
  }

  if (input.chainDays > input.daysLeft) {
    add(
      {
        code: 'CHAIN_EXCEEDS_TIME',
        kind: 'escalation',
        severity: 'high',
        contribution: 0,
        facts: {
          chainDays: round(input.chainDays),
          remainingWorkingDays: input.daysLeft,
        },
        taskIds: input.chainTaskIds,
      },
      'high',
    );
  }

  const probability = input.probabilityOnTime;
  if (probability !== null) {
    if (probability < config.escalation.probabilityCritical) {
      add(
        {
          code: 'LOW_PROBABILITY',
          kind: 'escalation',
          severity: 'high',
          contribution: 0,
          facts: {
            probability: round(probability, 4),
            threshold: config.escalation.probabilityCritical,
          },
          taskIds: [],
        },
        'critical',
      );
    } else if (probability < config.escalation.probabilityHigh) {
      add(
        {
          code: 'LOW_PROBABILITY',
          kind: 'escalation',
          severity: 'high',
          contribution: 0,
          facts: {
            probability: round(probability, 4),
            threshold: config.escalation.probabilityHigh,
          },
          taskIds: [],
        },
        'high',
      );
    }
  }

  const level = triggered.reduce(
    (current, item) => raise(current, item.target),
    input.base,
  );

  // Показываем все сработавшие правила уровня `base` и выше, а не только то,
  // которое подняло уровень первым. Заблокированная P0 остаётся причиной
  // риска и тогда, когда до High уровень уже поднят перегрузкой QA: менеджеру
  // нужны оба факта, а не тот, что оказался раньше в коде.
  const escalations = triggered
    .filter((item) => LEVEL_RANK[item.target] >= LEVEL_RANK[input.base])
    .sort((a, b) => LEVEL_RANK[b.target] - LEVEL_RANK[a.target])
    .map((item) => item.reason);

  return { level, escalations };
}

type FactorReasonInput = {
  factors: FactorValue[];
  snapshot: ReleaseSnapshot;
  demandRatio: number;
  maxLoad: number;
  bottleneckName: string | null;
  blockers: ReturnType<typeof collectBlockers>;
  chain: { taskIds: string[]; days: number };
  qa: { share: number; requiredH: number; capacityH: number };
  drift: { addedH: number; share: number };
  daysLeft: number;
};

/**
 * Причины по факторам. Текста здесь нет — только код и факты; формулировку
 * даёт интерфейс или модель (ADR-001, §5).
 */
function buildFactorReasons(input: FactorReasonInput): RiskReason[] {
  const value = (code: FactorValue['code']) =>
    input.factors.find((factor) => factor.code === code)!;

  const severityOf = (factor: FactorValue): RiskReason['severity'] =>
    factor.value >= 0.66 ? 'high' : factor.value >= 0.33 ? 'medium' : 'low';

  const blockedTaskIds = input.blockers.map((b) => b.taskId);

  const candidates: Array<{
    factor: FactorValue;
    code: RiskReason['code'];
    facts: RiskReason['facts'];
    taskIds: string[];
  }> = [
    {
      factor: value('F1'),
      code: 'TIME_DEFICIT',
      facts: {
        demandRatio: round(input.demandRatio, 4),
        remainingWorkingDays: input.daysLeft,
      },
      taskIds: [],
    },
    {
      factor: value('F2'),
      code: 'TEAM_OVERLOAD',
      facts: {
        team: input.bottleneckName ?? '—',
        load: round(input.maxLoad, 4),
      },
      taskIds: [],
    },
    {
      factor: value('F3'),
      code: 'BLOCKERS',
      facts: {
        blockedCount: input.blockers.length,
        staleCount: input.blockers.filter((b) => b.isStale).length,
      },
      taskIds: blockedTaskIds,
    },
    {
      factor: value('F4'),
      code: 'CRITICAL_CHAIN',
      facts: {
        chainDays: round(input.chain.days),
        chainLength: input.chain.taskIds.length,
        remainingWorkingDays: input.daysLeft,
      },
      taskIds: input.chain.taskIds,
    },
    {
      factor: value('F5'),
      code: 'QA_FUNNEL',
      facts: {
        requiredH: round(input.qa.requiredH),
        capacityH: round(input.qa.capacityH),
        share: round(input.qa.share, 4),
      },
      taskIds: [],
    },
    {
      factor: value('F6'),
      code: 'SCOPE_DRIFT',
      facts: { addedH: round(input.drift.addedH), share: round(input.drift.share, 4) },
      taskIds: [],
    },
  ];

  return candidates
    .filter((candidate) => candidate.factor.contribution > 0)
    .map((candidate) => ({
      code: candidate.code,
      kind: 'factor' as const,
      severity: severityOf(candidate.factor),
      contribution: candidate.factor.contribution,
      facts: candidate.facts,
      taskIds: candidate.taskIds,
    }))
    .sort((a, b) => b.contribution - a.contribution);
}
