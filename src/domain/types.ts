/**
 * Доменные типы движка риска (ADR-001).
 *
 * Слой намеренно ничего не знает ни о базе, ни о модели: на вход подаётся
 * снимок данных, на выходе — метрики. Отсюда детерминированность,
 * тестируемость и бесплатная what-if симуляция.
 */

/** Дата без времени, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Момент времени в ISO 8601. */
export type IsoDateTime = string;

export type TaskStatus =
  | 'backlog'
  | 'in_progress'
  | 'review'
  | 'testing'
  | 'done'
  | 'cancelled';

export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Вид команды. `qa` выделен отдельно: у тестирования особая роль в воронке. */
export type TeamKind = 'dev' | 'qa' | 'other';

export type Team = {
  id: string;
  name: string;
  kind: TeamKind;
};

export type Task = {
  id: string;
  /** Ключ вида `PPT-311` — для отображения, в расчёте не участвует. */
  key?: string;
  title?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Оценка трудозатрат в часах. Строго положительна (FR-07). */
  estimateH: number;
  spentH?: number;
  teamId: string | null;
  assigneeId?: string | null;
  /** Когда задача попала в релиз. Нужно для фактора дрейфа скоупа. */
  addedToReleaseAt?: IsoDateTime | null;
  /**
   * Момент начала блокировки, а не булев флаг: из отметки времени выводится
   * и признак, и длительность (docs/06-database.md, п. 7).
   */
  blockedSince?: IsoDateTime | null;
};

export type Dependency = {
  blockerTaskId: string;
  blockedTaskId: string;
  type: 'blocks' | 'relates';
};

export type TeamCapacity = {
  teamId: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Номинальные часы за период. Фокус-фактор применяется движком. */
  availableHours: number;
};

export type ReleaseSnapshot = {
  /**
   * Момент расчёта передаётся явно, а не берётся из `Date.now()`.
   * Иначе функция перестаёт быть чистой, а тесты — воспроизводимыми.
   */
  now: IsoDateTime;
  release: {
    id: string;
    name: string;
    plannedDate: IsoDate;
    startedAt: IsoDateTime | null;
  };
  teams: Team[];
  tasks: Task[];
  dependencies: Dependency[];
  capacity: TeamCapacity[];
  /**
   * Выходные считаются по календарю Пн–Пт; сюда попадают только праздники
   * и другие нерабочие дни. Отличие от ADR-001, где предполагался полный
   * список рабочих дней: хранить исключения дешевле, чем перечислять норму.
   */
  calendar: { holidays: IsoDate[] };
};

export type TeamLoad = {
  teamId: string;
  teamName: string;
  /** Остаток незавершённых работ команды, часы. */
  remainingH: number;
  /** Полезная ёмкость до плановой даты с учётом фокус-фактора, часы. */
  capacityH: number;
  /** Доля: 1.35 означает 135%. При нулевой ёмкости и наличии работ — Infinity. */
  load: number;
};

export type BlockerInfo = {
  taskId: string;
  priority: TaskPriority;
  estimateH: number;
  blockedSince: IsoDateTime;
  blockedDays: number;
  /** Дольше `staleBlockerDays` — блокер застарелый. */
  isStale: boolean;
  /** Сколько незавершённых задач релиза ждут эту. */
  blocksCount: number;
};

export type FactorCode = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6';

export type FactorValue = {
  code: FactorCode;
  /** Нормированное значение 0..1. */
  value: number;
  weight: number;
  /** `value × weight` — вклад в скор. */
  contribution: number;
};

export type ReasonCode =
  // факторы
  | 'TIME_DEFICIT'
  | 'TEAM_OVERLOAD'
  | 'BLOCKERS'
  | 'CRITICAL_CHAIN'
  | 'QA_FUNNEL'
  | 'SCOPE_DRIFT'
  // правила эскалации
  | 'CRITICAL_BLOCKER'
  | 'MULTIPLE_P1_BLOCKED'
  | 'CHAIN_EXCEEDS_TIME'
  | 'TEAM_OVERLOAD_RULE'
  | 'LOW_PROBABILITY';

/**
 * Причина риска. Текст здесь отсутствует намеренно: движок отдаёт код и
 * факты, формулировку даёт слой представления или модель (ADR-001, §5).
 */
export type RiskReason = {
  code: ReasonCode;
  /** `factor` — вклад в скор, `escalation` — сработавшее правило уровня. */
  kind: 'factor' | 'escalation';
  severity: 'low' | 'medium' | 'high';
  /** Вклад в скор. У правил эскалации равен нулю — они меняют уровень, не скор. */
  contribution: number;
  facts: Record<string, number | string>;
  taskIds: string[];
};

export type ReleaseMetrics = {
  releaseId: string;
  computedAt: IsoDateTime;

  counts: {
    total: number;
    done: number;
    inProgress: number;
    testing: number;
    blocked: number;
    cancelled: number;
  };

  effort: {
    totalH: number;
    doneH: number;
    remainingH: number;
  };

  /** Готовность по трудозатратам — основная цифра (FR-17). */
  readinessPct: number;
  /** Готовность по количеству задач — привычная, но вводящая в заблуждение. */
  readinessByCountPct: number;

  remainingWorkingDays: number;
  teamLoad: TeamLoad[];
  blockers: BlockerInfo[];
  criticalChain: { taskIds: string[]; days: number };
  qaFunnel: { share: number; requiredH: number; capacityH: number };
  scopeDrift: { addedH: number; share: number };

  factors: FactorValue[];
  riskScore: number;
  riskLevel: RiskLevel;
  /** Уровень строго по скору, до применения правил эскалации. */
  riskLevelByScore: RiskLevel;
  reasons: RiskReason[];

  /** Заполняется, если расчёту передан прогноз. */
  probabilityOnTime: number | null;
};
