/**
 * Блоки кокпита: уровень риска, готовность, загрузка команд.
 *
 * Общее правило всех трёх — цвет никогда не несёт смысл в одиночку
 * (NFR-17). Уровень подписан словом, перегрузка названа числом, полоса
 * готовности продублирована процентом. Скриншот в ч/б должен читаться
 * так же, как экран.
 */

import { RISK_LEVEL, plural } from '@/lib/ui/risk';
import type { RiskLevel, TeamLoad } from '@/domain/types';

/**
 * Бейдж уровня риска.
 *
 * Слово «риск» в подписи не лишнее: «высокий» само по себе двусмысленно —
 * высокий может быть и показатель готовности.
 */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const { label, badge, dot } = RISK_LEVEL[level];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${badge}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      Риск {label}
      {score === undefined ? null : <span className="opacity-70">· {score}</span>}
    </span>
  );
}

/**
 * Полоса готовности.
 *
 * Подпись «по трудозатратам» обязательна (FR-17): готовность по часам и
 * по числу задач — разные числа, и подмена одного другим остаётся самым
 * распространённым способом обмануть себя на статусной встрече.
 */
export function Readiness({
  pct,
  byCountPct,
  compact = false,
}: {
  pct: number;
  byCountPct?: number;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={compact ? 'text-lg font-semibold' : 'text-3xl font-semibold'}>{pct}%</span>
        <span className="text-xs opacity-60">по трудозатратам</span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Готовность по трудозатратам"
      >
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {byCountPct === undefined ? null : (
        <p className="mt-1.5 text-xs opacity-50">{byCountPct}% по числу задач</p>
      )}
    </div>
  );
}

/** Число с подписью — из таких собрана строка счётчиков кокпита. */
export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${tone === 'warn' && value !== 0 ? 'text-orange-600 dark:text-orange-400' : ''}`}>
        {value}
      </div>
      <div className="text-xs opacity-60">{label}</div>
    </div>
  );
}

/**
 * Загрузка команд полосами.
 *
 * Отметка 100% нарисована отдельной чертой, а не подразумевается длиной
 * полосы: без неё «перегружен» и «загружен под завязку» выглядят почти
 * одинаково, хотя решения за ними разные.
 */
export function TeamLoadBars({ loads }: { loads: TeamLoad[] }) {
  const shown = loads.filter((t) => t.remainingH > 0 || t.capacityH > 0);
  if (shown.length === 0) {
    return <p className="text-sm opacity-60">Незавершённых работ нет.</p>;
  }

  return (
    <ul className="space-y-3">
      {shown.map((t) => {
        const finite = Number.isFinite(t.load);
        const pct = finite ? Math.round(t.load * 100) : null;
        const over = finite && t.load > 1;
        // Шкала до 150%: полоса в 100% должна занимать две трети, иначе
        // перегрузке некуда расти и все команды выглядят одинаково полными.
        const width = finite ? Math.min((t.load / 1.5) * 100, 100) : 100;

        return (
          <li key={t.teamId}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{t.teamName}</span>
              <span className={over ? 'font-medium text-orange-600 dark:text-orange-400' : 'opacity-70'}>
                {pct === null ? 'нет ёмкости' : `${pct}%`}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className={`h-full rounded-full ${over ? 'bg-orange-500' : 'bg-blue-600'}`}
                style={{ width: `${width}%` }}
              />
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-black/40 dark:bg-white/40"
                style={{ left: '66.6%' }}
              />
            </div>
            <p className="mt-1 text-xs opacity-50">
              {Math.round(t.remainingH)} ч работ при ёмкости {Math.round(t.capacityH)} ч
              {over && finite
                ? ` · перегруз ${Math.round(t.remainingH - t.capacityH)} ч`
                : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Дата вида «5 октября», плюс сколько до неё осталось. */
export function PlannedDate({ date, workingDays }: { date: string; workingDays?: number }) {
  const formatted = new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <span>
      {formatted}
      {workingDays === undefined ? null : (
        <span className="opacity-60">
          {' · '}
          {Math.round(workingDays)} рабочих{' '}
          {plural(Math.round(workingDays), 'день', 'дня', 'дней')}
        </span>
      )}
    </span>
  );
}
