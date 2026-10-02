/**
 * Исполнение инструментов агента.
 *
 * Модуль переводит вызов инструмента в вызовы тех же слоёв, которыми
 * пользуются маршруты: движок считает, слой данных читает, слой
 * представления переводит. Своих расчётов здесь нет ни одного — иначе
 * агент отвечал бы числами, которых нет на экране, и инвариант «агент не
 * считает» (ADR-001) держался бы только на обещании в промпте.
 *
 * Доступ ограничивает RLS: запросы идут клиентом пользователя, и
 * выдуманный моделью идентификатор релиза просто не находится. Это важнее,
 * чем кажется: идентификаторы приходят от модели, то есть в конечном счёте
 * из текста, который ей кто-то прислал. Проверять их список «разрешённых»
 * было бы защитой на честном слове, а RLS отказывает, даже если проверку
 * забыли.
 *
 * Отказ инструмента — не исключение, а результат: он уходит модели как
 * сообщение об ошибке, и она может исправиться (другой идентификатор,
 * другой фильтр). Поэтому исключения здесь не бросаются.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { deliveryHistory } from '@/domain/analytics';
import { RISK_CONFIG } from '@/domain/config';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import { simulate } from '@/domain/scenario';
import { suggestScenario, type SuggestGoal } from '@/domain/suggest';
import type { ReleaseSnapshot, Task } from '@/domain/types';
import { toApiForecast } from '@/lib/api/forecast';
import { toApiMetrics } from '@/lib/api/metrics';
import { problemFields } from '@/lib/api/scenario';
import { loadReleaseFacts } from '@/lib/data/analytics';
import { loadReleaseContext, type ReleaseContext } from '@/lib/data/context';
import { saveScenario } from '@/lib/data/scenario';
import { selectTasks } from '@/lib/data/tasks';
import type { Database } from '@/lib/database.types';

import { taskForModel, untrusted, type ModelTask, type PayloadLevel } from './payload';
import { isToolName, TOOL_SCHEMAS, type ToolName } from './tools';

type Client = SupabaseClient<Database>;

export type AgentContext = {
  supabase: Client;
  /** Организация диалога. Нужна истории поставки: релиз она не задаёт. */
  orgId: string;
  userId: string;
  level: PayloadLevel;
};

export type ToolOutcome =
  | { ok: true; result: unknown }
  /** Текст уходит модели: он должен объяснять, что делать иначе. */
  | { ok: false; error: string };

const NOT_FOUND = 'Релиз не найден. Проверь идентификатор: доступны только релизы организации пользователя.';

function taskIndex(snapshot: ReleaseSnapshot): Map<string, Task> {
  return new Map(snapshot.tasks.map((t) => [t.id, t]));
}

/** Задачи по идентификаторам — в том виде, в каком их можно показать. */
function tasksForModel(
  ids: string[],
  snapshot: ReleaseSnapshot,
  level: PayloadLevel,
): (ModelTask | { id: string })[] {
  const index = taskIndex(snapshot);
  return ids.map((id) => {
    const task = index.get(id);
    return task ? taskForModel(task, level) : { id };
  });
}

async function withContext(
  ctx: AgentContext,
  releaseId: string,
): Promise<{ ok: true; context: ReleaseContext } | { ok: false; error: string }> {
  const result = await loadReleaseContext(ctx.supabase, releaseId);
  if (result.kind === 'error') {
    return { ok: false, error: 'Не удалось прочитать данные релиза.' };
  }
  if (result.kind === 'not_found') return { ok: false, error: NOT_FOUND };
  return { ok: true, context: result.context };
}

/** Метрики с прогнозом: иначе правило LOW_PROBABILITY не срабатывает. */
function metricsWithForecast(context: ReleaseContext) {
  const forecast = forecastRelease(context.snapshot, RISK_CONFIG, {
    completedReleases: context.completedReleases,
  });
  const metrics = calculateRelease(context.snapshot, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });
  return { forecast, metrics };
}

function goalFrom(input: {
  target_risk_level?: 'low' | 'medium' | 'high';
  target_risk_score?: number;
  target_probability?: number;
}): SuggestGoal {
  if (input.target_risk_level) return { kind: 'risk_level', target: input.target_risk_level };
  if (input.target_risk_score !== undefined) {
    return { kind: 'risk_score', target: input.target_risk_score };
  }
  // Схема гарантирует, что одна цель задана; этот случай остаётся
  // последним по порядку, а не «на всякий случай».
  return { kind: 'probability', target: input.target_probability as number };
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: AgentContext,
): Promise<ToolOutcome> {
  if (!isToolName(name)) return { ok: false, error: `Инструмента «${name}» нет.` };

  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success) {
    /*
      Ошибка проверки уходит модели почти дословно. Это не утечка
      внутреннего устройства: схему инструмента она и так получила, а без
      причины отказа ей остаётся угадывать, и следующая попытка будет
      такой же.
    */
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'вход'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `Неверный вход инструмента — ${details}` };
  }
  const input = parsed.data as Record<string, unknown>;

  switch (name) {
    case 'get_release_overview': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const { metrics, forecast } = metricsWithForecast(loaded.context);
      return {
        ok: true,
        result: {
          metrics: toApiMetrics(metrics),
          forecast: toApiForecast(forecast),
          history_releases: loaded.context.completedReleases,
        },
      };
    }

    case 'get_team_load': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const metrics = calculateRelease(loaded.context.snapshot);
      return {
        ok: true,
        result: {
          remaining_working_days: metrics.remainingWorkingDays,
          // Команда без ёмкости — не «нулевая загрузка», а отсутствие
          // знания: отношение в этом случае бесконечно, и наружу оно
          // уходит как null с отдельным признаком.
          teams: metrics.teamLoad.map((t) => ({
            team_id: t.teamId,
            team_name: t.teamName,
            remaining_h: t.remainingH,
            capacity_h: t.capacityH,
            load: Number.isFinite(t.load) ? t.load : null,
            has_capacity: Number.isFinite(t.load),
          })),
        },
      };
    }

    case 'get_blockers': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const { snapshot } = loaded.context;
      const metrics = calculateRelease(snapshot);
      const index = taskIndex(snapshot);
      return {
        ok: true,
        result: {
          remaining_working_days: metrics.remainingWorkingDays,
          blockers: metrics.blockers.map((b) => {
            const task = index.get(b.taskId);
            return {
              task: task ? taskForModel(task, ctx.level) : { id: b.taskId },
              blocked_days: b.blockedDays,
              blocks_count: b.blocksCount,
              is_stale: b.isStale,
            };
          }),
        },
      };
    }

    case 'get_critical_chain': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const { snapshot } = loaded.context;
      const metrics = calculateRelease(snapshot);
      return {
        ok: true,
        result: {
          days: metrics.criticalChain.days,
          remaining_working_days: metrics.remainingWorkingDays,
          // Порядок задач и есть цепочка: перестановка сделала бы ответ
          // бессмысленным.
          tasks: tasksForModel(metrics.criticalChain.taskIds, snapshot, ctx.level),
        },
      };
    }

    case 'list_tasks': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const { rows, total, error } = await selectTasks(ctx.supabase, {
        releaseId: input.release_id as string,
        status: input.status as never,
        priority: input.priority as never,
        teamId: input.team_id as string | undefined,
        blocked: input.blocked as boolean | undefined,
        limit: (input.limit as number | undefined) ?? 20,
        offset: 0,
      });
      if (error) return { ok: false, error: 'Не удалось прочитать задачи.' };
      return {
        ok: true,
        result: {
          total,
          shown: rows.length,
          tasks: rows.map((row) =>
            taskForModel(
              {
                id: row.id,
                status: row.status,
                priority: row.priority,
                estimateH: Number(row.estimate_h),
                teamId: row.team_id,
                blockedSince: row.blocked_since,
                key: row.external_key ?? undefined,
                title: row.title,
                description: row.description,
              },
              ctx.level,
            ),
          ),
        },
      };
    }

    case 'forecast_completion': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const forecast = forecastRelease(loaded.context.snapshot, RISK_CONFIG, {
        completedReleases: loaded.context.completedReleases,
        targetDate: input.date as string | undefined,
      });
      return { ok: true, result: toApiForecast(forecast) };
    }

    case 'simulate_scenario': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const result = simulate(
        loaded.context.snapshot,
        {
          excludeTaskIds: (input.exclude_task_ids as string[] | undefined) ?? [],
          extraCapacity: ((input.extra_capacity as { team_id: string; hours: number }[]) ?? []).map(
            (c) => ({ teamId: c.team_id, hours: c.hours }),
          ),
        },
        RISK_CONFIG,
        { completedReleases: loaded.context.completedReleases },
      );

      if (result.kind === 'rejected') {
        /*
          Отказ по существу, а не ошибка ввода: запрос верен, но ответ был
          бы неправдой — например, уносимая задача держит остающиеся
          (FR-33). Модели он уходит разобранным по полям, чтобы она могла
          предложить исправленный сценарий, а не повторить тот же.
        */
        return {
          ok: false,
          error: `Сценарий нельзя посчитать честно: ${JSON.stringify(problemFields(result.problems))}`,
        };
      }

      return {
        ok: true,
        result: {
          before: {
            risk_score: result.before.metrics.riskScore,
            risk_level: result.before.metrics.riskLevel,
            readiness_pct: result.before.metrics.readinessPct,
            probability_on_time: result.before.forecast.probabilityOnTime,
            expected_date: result.before.forecast.expectedDate,
          },
          after: {
            risk_score: result.after.metrics.riskScore,
            risk_level: result.after.metrics.riskLevel,
            readiness_pct: result.after.metrics.readinessPct,
            probability_on_time: result.after.forecast.probabilityOnTime,
            expected_date: result.after.forecast.expectedDate,
          },
          // Разность отдаётся готовой: складывать и вычитать агенту нельзя.
          delta: result.delta,
        },
      };
    }

    case 'suggest_scenario': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;
      const { snapshot, completedReleases } = loaded.context;

      const result = suggestScenario(snapshot, goalFrom(input), RISK_CONFIG, {
        completedReleases,
        maxTasks: (input.max_tasks as number | undefined) ?? 5,
        keepPriorities: input.allow_p0 ? [] : ['P0'],
      });

      if (result.kind === 'already_met') {
        return {
          ok: true,
          result: {
            outcome: 'already_met',
            risk_score: result.before.metrics.riskScore,
            risk_level: result.before.metrics.riskLevel,
          },
        };
      }

      return {
        ok: true,
        result: {
          outcome: result.kind,
          task_ids: result.taskIds,
          groups: result.groups.map((g) => ({
            task: taskForModel(
              {
                id: g.taskId,
                status: 'in_progress',
                priority: g.priority,
                estimateH: g.estimateH,
                teamId: null,
                blockedSince: null,
                key: g.key ?? undefined,
                title: g.title ?? undefined,
              },
              ctx.level,
            ),
            with_task_ids: g.withTaskIds,
            risk_score_after: g.riskScoreAfter,
          })),
          delta: result.delta,
          /*
            Для недостижимой цели это главное поле ответа: уровень могут
            держать правила эскалации, на перенос не реагирующие, —
            например, заблокированная задача P0. Тогда совет не
            «перенести», а «разблокировать», и сказать это должна модель.
          */
          pinned_by:
            result.kind === 'unreachable'
              ? result.pinnedBy.map((r) => ({ code: r.code, facts: r.facts, task_ids: r.taskIds }))
              : [],
        },
      };
    }

    case 'get_release_history': {
      const { facts, error } = await loadReleaseFacts(ctx.supabase, ctx.orgId);
      if (error) return { ok: false, error: 'Не удалось прочитать историю релизов.' };
      const history = deliveryHistory(facts);
      return {
        ok: true,
        result: {
          released: history.released,
          on_time: history.onTime,
          on_time_pct: history.onTimePct,
          // Средняя задержка считается по опоздавшим: досрочные выпуски
          // иначе гасят опоздания, и среднее говорит «всё хорошо» там,
          // где в срок не попадают никогда.
          avg_delay_days: history.avgDelayDays,
          avg_deviation_days: history.avgDeviationDays,
          cancelled: history.cancelled,
          postponed: history.postponed,
          in_flight: history.inFlight,
          records: history.records.map((r) => ({
            release_id: r.releaseId,
            // Имя релиза в корпоративном режиме приходит из трекера —
            // это такой же недоверенный текст, как название задачи.
            name: ctx.level === 'metrics' ? undefined : untrusted(r.name),
            planned_date: r.plannedDate,
            released_date: r.releasedDate,
            deviation_days: r.deviationDays,
            on_time: r.onTime,
          })),
        },
      };
    }

    case 'propose_scenario': {
      const loaded = await withContext(ctx, input.release_id as string);
      if (!loaded.ok) return loaded;

      const saved = await saveScenario(
        ctx.supabase,
        input.release_id as string,
        loaded.context,
        ctx.userId,
        {
          title: input.title as string,
          excludeTaskIds: (input.exclude_task_ids as string[] | undefined) ?? [],
          extraCapacity: ((input.extra_capacity as { team_id: string; hours: number }[]) ?? []).map(
            (c) => ({ teamId: c.team_id, hours: c.hours }),
          ),
          moveToReleaseId: (input.move_to_release_id as string | undefined) ?? null,
        },
      );

      switch (saved.kind) {
        case 'bad_target':
          return { ok: false, error: saved.message };
        case 'rejected':
          return {
            ok: false,
            error: `Сценарий нельзя посчитать честно: ${JSON.stringify(problemFields(saved.problems))}`,
          };
        case 'forbidden':
          return {
            ok: false,
            error: 'У пользователя нет права сохранять сценарии: нужна роль менеджера или выше.',
          };
        case 'error':
          return { ok: false, error: 'Не удалось сохранить сценарий.' };
        case 'ok':
          return {
            ok: true,
            result: {
              scenario_id: saved.scenario.id,
              applied: false,
              /*
                Поле не декоративное. Оно повторяет моделью то, что уже
                сказано в промпте: сценарий сохранён, но не применён.
                Без него «сохранил» легко пересказывается как «сделал», и
                пользователь решит, что состав релиза уже изменился.
              */
              note: 'Сценарий сохранён и показан пользователю. Применить его может только человек кнопкой в интерфейсе.',
              delta: saved.delta,
            },
          };
      }
    }
  }
}
