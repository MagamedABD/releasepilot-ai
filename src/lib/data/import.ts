/**
 * Импорт: чтение состояния проекта и применение плана.
 *
 * Здесь единственная часть импорта, которая знает про базу. Разбор файла,
 * перевод значений и построение плана — чистые и лежат в `src/lib/import`;
 * сюда приходит готовый план, и остаётся выполнить его и посчитать, что
 * получилось.
 *
 * Транзакции здесь нет, и это осознанно. Postgres-функция, как у
 * применения сценария, дала бы всё-или-ничего, но импорт по смыслу
 * частичный: файл на триста задач с двумя опечатками должен завести
 * двести девяносто восемь (FR-41). Всё-или-ничего превратило бы отчёт об
 * ошибках в единственный ответ «ничего не импортировано».
 *
 * Цена решения: обрыв посередине оставляет часть задач записанной. Отчёт
 * поэтому пишется в `import_runs` тем же вызовом, и запуск со статусом
 * `running` виден как незавершённый — а не выглядит успешным.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import {
  toTaskInsert,
  toTaskUpdate,
  type ExistingTask,
  type ImportContext,
  type ImportPlan,
} from '@/lib/import/plan';
import type { RowError } from '@/lib/import/rows';

type Client = SupabaseClient<Database>;

/** Текущее состояние задачи — нужно, чтобы не переписать отметки времени. */
type CurrentTask = { id: string; release_id: string | null; blocked_since: string | null };

export type ImportState = {
  context: ImportContext;
  current: Map<string, CurrentTask>;
  error: PostgrestError | null;
};

/**
 * Состояние проекта до импорта.
 *
 * Команды берутся по организации, релизы и задачи — по проекту: имя
 * релиза уникально в пределах проекта, и искать его шире значило бы
 * связать задачу с одноимённым релизом соседнего проекта.
 */
export async function loadImportState(
  supabase: Client,
  orgId: string,
  projectId: string,
): Promise<ImportState> {
  const [teamsRes, releasesRes, tasksRes] = await Promise.all([
    supabase.from('teams').select('id, name').eq('org_id', orgId),
    supabase.from('releases').select('id, name').eq('project_id', projectId),
    supabase
      .from('tasks')
      .select('id, external_key, release_id, blocked_since')
      .eq('project_id', projectId)
      .not('external_key', 'is', null),
  ]);

  const error = teamsRes.error ?? releasesRes.error ?? tasksRes.error ?? null;
  const empty = { teams: [], releases: [], existing: [] };
  if (error) return { context: empty, current: new Map(), error };

  const existing: ExistingTask[] = [];
  const current = new Map<string, CurrentTask>();
  for (const t of tasksRes.data ?? []) {
    if (!t.external_key) continue;
    existing.push({ id: t.id, key: t.external_key });
    current.set(t.external_key, {
      id: t.id,
      release_id: t.release_id,
      blocked_since: t.blocked_since,
    });
  }

  return {
    context: {
      teams: teamsRes.data ?? [],
      releases: releasesRes.data ?? [],
      existing,
    },
    current,
    error: null,
  };
}

export type ImportStats = {
  created: number;
  updated: number;
  dependencies: number;
};

export type ApplyResult = {
  stats: ImportStats;
  /** Ошибки, добавившиеся при записи: отказы базы по конкретным строкам. */
  errors: RowError[];
  /** Отказ, из-за которого дальше идти нельзя (нет прав, сломалась связь). */
  fatal: PostgrestError | null;
};

/** Запись идёт частями: один запрос на тысячу строк упирается в лимиты. */
const CHUNK = 50;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function applyPlan(
  supabase: Client,
  plan: ImportPlan,
  state: ImportState,
  orgId: string,
  projectId: string,
  now: string = new Date().toISOString(),
): Promise<ApplyResult> {
  const errors: RowError[] = [];
  const stats: ImportStats = { created: 0, updated: 0, dependencies: 0 };

  /** Ключ задачи → её идентификатор. Пополняется по мере создания. */
  const ids = new Map<string, string>(state.context.existing.map((t) => [t.key, t.id]));

  // ── Новые задачи ────────────────────────────────────────────────────
  for (const part of chunks(plan.create)) {
    const { data, error } = await supabase
      .from('tasks')
      .insert(part.map((e) => toTaskInsert(e, orgId, projectId, now)))
      .select('id, external_key');

    if (error) {
      // Нехватка прав — не построчная ошибка, и продолжать нечего.
      if (error.code === '42501') return { stats, errors, fatal: error };
      /*
        Отказ пакета относится ко всем его строкам: какая именно
        нарушила ограничение, PostgREST не сообщает. Называются все
        строки пакета — это честнее, чем назвать одну наугад, и
        пятьдесят строк в отчёте лучше, чем «импорт не удался».
      */
      for (const e of part) {
        errors.push({
          line: e.row.line,
          field: null,
          message: `База отклонила запись: ${error.message}`,
        });
      }
      continue;
    }

    stats.created += data?.length ?? 0;
    for (const row of data ?? []) {
      if (row.external_key) ids.set(row.external_key, row.id);
    }
  }

  // ── Существующие задачи ─────────────────────────────────────────────
  /*
    По одной, а не пакетом. Обновление у каждой своё: отметки времени
    зависят от текущего значения (см. `toTaskUpdate`), а пакетный upsert
    в PostgREST требует одинакового набора колонок во всех строках — и
    строки, где отметку менять не нужно, получили бы в неё null.
    Параллельность ограничена размером части, чтобы не открывать триста
    соединений разом.
  */
  for (const part of chunks(plan.update, 10)) {
    const results = await Promise.all(
      part.map(async (entry) => {
        const currentRow = state.current.get(entry.row.key);
        if (!currentRow) return { entry, error: null, missing: true };
        const { error } = await supabase
          .from('tasks')
          .update(toTaskUpdate(entry, currentRow, now))
          .eq('id', currentRow.id);
        return { entry, error, missing: false };
      }),
    );

    for (const r of results) {
      if (r.missing) continue;
      if (r.error) {
        if (r.error.code === '42501') return { stats, errors, fatal: r.error };
        errors.push({
          line: r.entry.row.line,
          field: null,
          message: `База отклонила изменение: ${r.error.message}`,
        });
        continue;
      }
      stats.updated += 1;
    }
  }

  // ── Связи ───────────────────────────────────────────────────────────
  const rows = plan.dependencies
    .map((d) => ({
      line: d.line,
      row: {
        org_id: orgId,
        blocker_task_id: ids.get(d.blockerKey),
        blocked_task_id: ids.get(d.blockedKey),
        type: 'blocks' as const,
      },
      keys: `${d.blockerKey} → ${d.blockedKey}`,
    }))
    .filter((d) => d.row.blocker_task_id && d.row.blocked_task_id);

  for (const part of chunks(rows)) {
    const { error } = await supabase
      .from('task_dependencies')
      .upsert(
        part.map((d) => d.row as { org_id: string; blocker_task_id: string; blocked_task_id: string; type: 'blocks' }),
        { onConflict: 'blocker_task_id,blocked_task_id', ignoreDuplicates: true },
      );

    if (!error) {
      stats.dependencies += part.length;
      continue;
    }
    if (error.code === '42501') return { stats, errors, fatal: error };

    /*
      Пакет отклонён — почти всегда из-за цикла (триггер
      `prevent_dependency_cycle`). Одна замкнувшая связь не должна
      отменять остальные, поэтому пакет переигрывается по одной: так
      находится именно та строка, которая замыкает кольцо, и в отчёт
      попадает она, а не весь файл. Второй проход делается только при
      отказе, так что на здоровом файле он не стоит ничего.
    */
    for (const d of part) {
      const single = await supabase
        .from('task_dependencies')
        .upsert([d.row as { org_id: string; blocker_task_id: string; blocked_task_id: string; type: 'blocks' }], {
          onConflict: 'blocker_task_id,blocked_task_id',
          ignoreDuplicates: true,
        });
      if (single.error) {
        errors.push({
          line: d.line,
          field: 'blocks',
          message:
            single.error.code === '23514'
              ? `Связь ${d.keys} замкнула бы цикл и не создана`
              : `Связь ${d.keys} не создана: ${single.error.message}`,
        });
      } else stats.dependencies += 1;
    }
  }

  /*
    Пропущенных здесь не считается: их число — это «сколько записей файла
    не стало задачами», и вывести его можно только зная, сколько записей
    файл вообще дал. Считает его маршрут вычитанием, чтобы сумма
    сходилась по построению, а не по договорённости между двумя слоями.
  */
  return { stats, errors, fatal: null };
}
