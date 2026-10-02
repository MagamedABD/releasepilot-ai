'use server';

/**
 * Действия экрана сценариев.
 *
 * Действия, а не запросы к своему же API: так же сделано создание
 * организации, и причина та же — страница и так на сервере, и лишний
 * круг через HTTP добавил бы второй путь проверки входа. Общий с API
 * слой при этом сохранён: считает и записывает `src/lib/data/scenario.ts`,
 * поэтому эффект, который увидит пользователь, и эффект, который отдаст
 * эндпоинт, — одно и то же число.
 */

import { revalidatePath } from 'next/cache';

import { RISK_CONFIG } from '@/domain/config';
import { simulate } from '@/domain/scenario';
import { problemFields } from '@/lib/api/scenario';
import { loadReleaseContext } from '@/lib/data/context';
import { applyScenario, saveScenario } from '@/lib/data/scenario';
import { createClient } from '@/lib/supabase/server';
import { scenarioCreateSchema, simulateSchema } from '@/lib/validation/release';

export type ScenarioSummary = {
  riskScore: number;
  riskLevel: string;
  readinessPct: number;
  remainingH: number;
  criticalChainDays: number;
  probabilityOnTime: number | null;
  expectedDate: string | null;
};

export type SimulationView = {
  before: ScenarioSummary;
  after: ScenarioSummary;
  delta: {
    riskScore: number;
    readinessPct: number;
    remainingH: number;
    criticalChainDays: number;
    probabilityOnTime: number | null;
    levelFrom: string;
    levelTo: string;
  };
};

export type ScenarioFormState = {
  error?: string;
  /** Отказ по существу: по полям, как в API (FR-33 и остальные). */
  problems?: Record<string, string[]>;
  simulation?: SimulationView;
  /** Что было выбрано — чтобы форма не обнулялась после отправки. */
  selected?: { taskIds: string[]; capacity: Record<string, number>; title: string };
  savedId?: string;
};

/** Поля формы читаются один раз: разбор у расчёта и у сохранения общий. */
function readForm(formData: FormData) {
  const taskIds = formData.getAll('exclude').map(String);
  const capacity: { teamId: string; hours: number }[] = [];
  const byTeam: Record<string, number> = {};

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('capacity:')) continue;
    const hours = Number(String(value).replace(',', '.'));
    // Пустое поле — это «не добавляем часов», а не ноль: ноль прошёл бы
    // дальше и попал бы в сценарий записью «добавить 0 часов».
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const teamId = key.slice('capacity:'.length);
    byTeam[teamId] = hours;
    capacity.push({ teamId, hours });
  }

  return {
    taskIds,
    capacity,
    byTeam,
    title: String(formData.get('title') ?? '').trim(),
    intent: String(formData.get('intent') ?? 'simulate'),
  };
}

export async function runScenario(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const releaseId = String(formData.get('releaseId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const form = readForm(formData);
  const selected = { taskIds: form.taskIds, capacity: form.byTeam, title: form.title };

  const base = { excludeTaskIds: form.taskIds, extraCapacity: form.capacity };

  const parsed =
    form.intent === 'save'
      ? scenarioCreateSchema.safeParse({ ...base, title: form.title, moveToReleaseId: null })
      : simulateSchema.safeParse(base);

  if (!parsed.success) {
    const problems: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (problems[key] ??= []).push(issue.message);
    }
    return { problems, selected };
  }

  const supabase = await createClient();
  const context = await loadReleaseContext(supabase, releaseId);
  if (context.kind !== 'ok') {
    return { error: 'Релиз не найден или недоступен', selected };
  }

  if (form.intent === 'save') {
    const { data: auth } = await supabase.auth.getClaims();
    if (!auth?.claims) return { error: 'Нужно войти в систему', selected };

    const saved = await saveScenario(
      supabase,
      releaseId,
      context.context,
      auth.claims.sub as string,
      { ...base, title: form.title, moveToReleaseId: null },
    );

    switch (saved.kind) {
      case 'rejected':
        return { problems: problemFields(saved.problems), selected };
      case 'bad_target':
        return { error: saved.message, selected };
      case 'forbidden':
        return {
          error: 'Сохранять сценарии может менеджер, администратор или владелец',
          selected,
        };
      case 'error':
        return { error: 'Не удалось сохранить сценарий', selected };
      case 'ok':
        revalidatePath(`/org/${slug}/release/${releaseId}/scenarios`);
        return { savedId: saved.scenario.id, simulation: toView(saved), selected };
    }
  }

  const result = simulate(context.context.snapshot, base, RISK_CONFIG, {
    completedReleases: context.context.completedReleases,
  });
  if (result.kind === 'rejected') {
    return { problems: problemFields(result.problems), selected };
  }

  return { simulation: toView(result), selected };
}

type Side = {
  metrics: {
    riskScore: number;
    riskLevel: string;
    readinessPct: number;
    effort: { remainingH: number };
    criticalChain: { days: number };
  };
  forecast: { probabilityOnTime: number | null; expectedDate: string | null };
};

function toView(result: {
  before: Side;
  after: Side;
  delta: {
    riskScore: number;
    readinessPct: number;
    remainingH: number;
    criticalChainDays: number;
    probabilityOnTime: number | null;
    riskLevel: { from: string; to: string };
  };
}): SimulationView {
  const side = (s: Side): ScenarioSummary => ({
    riskScore: s.metrics.riskScore,
    riskLevel: s.metrics.riskLevel,
    readinessPct: s.metrics.readinessPct,
    remainingH: s.metrics.effort.remainingH,
    criticalChainDays: s.metrics.criticalChain.days,
    probabilityOnTime: s.forecast.probabilityOnTime,
    expectedDate: s.forecast.expectedDate,
  });

  return {
    before: side(result.before),
    after: side(result.after),
    delta: {
      riskScore: result.delta.riskScore,
      readinessPct: result.delta.readinessPct,
      remainingH: result.delta.remainingH,
      criticalChainDays: result.delta.criticalChainDays,
      probabilityOnTime: result.delta.probabilityOnTime,
      levelFrom: result.delta.riskLevel.from,
      levelTo: result.delta.riskLevel.to,
    },
  };
}

export type ApplyState = { error?: string; appliedId?: string };

/**
 * Применение.
 *
 * Отдельным действием, а не частью формы расчёта: применяет человек, и
 * нажатие должно быть отдельным, осознанным — не «ещё одной кнопкой» в
 * форме, где только что считали варианты.
 */
export async function applyScenarioAction(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const scenarioId = String(formData.get('scenarioId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const releaseId = String(formData.get('releaseId') ?? '');

  const supabase = await createClient();
  const result = await applyScenario(supabase, scenarioId);

  switch (result.kind) {
    case 'not_found':
      return { error: 'Сценарий не найден' };
    case 'already_applied':
      return { error: 'Сценарий уже применён' };
    case 'forbidden':
      return { error: 'Применять сценарии может менеджер, администратор или владелец' };
    case 'rejected':
      // Текст из функции базы: он объясняет, что именно изменилось в
      // релизе после расчёта сценария.
      return { error: result.message };
    case 'error':
      return { error: 'Не удалось применить сценарий' };
    case 'ok':
      // Состав релиза изменился — метрики кокпита и список задач больше
      // не те, что лежат в кэше.
      revalidatePath(`/org/${slug}/release/${releaseId}`);
      revalidatePath(`/org/${slug}/release/${releaseId}/scenarios`);
      revalidatePath(`/org/${slug}/tasks`);
      return { appliedId: scenarioId };
  }
}
