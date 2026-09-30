/**
 * Импорт задач из файла CSV или JSON (FR-41, US-29).
 *
 * Главное свойство — частичность. Файл на триста задач с двумя опечатками
 * заводит двести девяносто восемь и объясняет две; отказ целиком означал
 * бы, что импортировать можно только безупречную выгрузку, а безупречных
 * не бывает. Поэтому статус запуска бывает `partial`, а отчёт построчный.
 *
 * Роль проверяет RLS: политика на `import_runs` разрешает запись только
 * владельцу и администратору (миграция 0001), и запуск начинается именно
 * с этой записи. Так право на импорт проверяется до того, как в проект
 * попадёт первая задача, — и проверяет его база, а не маршрут.
 *
 * Пробный прогон (`dryRun`) не пишет ничего, включая сам запуск: попытка
 * посмотреть отчёт не должна оставлять следов в истории импортов.
 */

import { fail, fromPostgres, invalid, ok, unauthorized } from '@/lib/api/http';
import { applyPlan, loadImportState } from '@/lib/data/import';
import { buildPlan } from '@/lib/import/plan';
import { detectFormat, parseImport } from '@/lib/import/parse';
import type { RowError } from '@/lib/import/rows';
import { createClient } from '@/lib/supabase/server';
import { importFieldsSchema } from '@/lib/validation/import';

/**
 * Пределы. Оба — про то, что запрос обязан закончиться.
 *
 * Тело читается в память целиком, а обновление существующих задач идёт
 * по одному запросу на задачу: файл на десять тысяч строк не столько
 * тяжёл, сколько долог, и уложиться в таймаут не сможет. Такой импорт —
 * это фоновая работа, а не ответ на запрос, и честнее отказать сразу,
 * чем оборваться на середине.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 500;

/** В `error_report` попадает столько ошибок: остальное — уже не чтение. */
const MAX_REPORTED = 100;

function sortErrors(errors: RowError[]): RowError[] {
  return [...errors].sort((a, b) => a.line - b.line || (a.field ?? '').localeCompare(b.field ?? ''));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'invalid_form', 'Ожидается форма с файлом (multipart/form-data)');
  }

  const parsedFields = importFieldsSchema.safeParse({
    projectId: form.get('projectId'),
    format: form.get('format') ?? undefined,
    dryRun: form.get('dryRun') ?? undefined,
  });
  if (!parsedFields.success) return invalid(parsedFields.error);
  const { projectId, dryRun } = parsedFields.data;

  const file = form.get('file');
  if (!(file instanceof File)) {
    return fail(422, 'validation_failed', 'Проверьте заполнение полей', {
      file: ['Не приложен файл'],
    });
  }
  if (file.size === 0) {
    return fail(422, 'validation_failed', 'Проверьте заполнение полей', { file: ['Файл пуст'] });
  }
  if (file.size > MAX_BYTES) {
    return fail(413, 'too_large', `Файл больше ${MAX_BYTES / 1024 / 1024} МБ`);
  }

  const format = parsedFields.data.format ?? detectFormat(file.name, file.type);
  if (!format) {
    return fail(422, 'validation_failed', 'Проверьте заполнение полей', {
      file: ['Неизвестный формат: ожидается .csv или .json'],
    });
  }

  // Организация берётся из проекта — по той же причине, что при создании
  // задачи: иначе появился бы импорт, в котором проект принадлежит одной
  // организации, а задачи создаются в другой.
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError) return fromPostgres(projectError);
  if (!project) return fail(422, 'invalid_reference', 'Проект не найден');

  const parsed = parseImport(await file.text(), format);

  /*
    Число записей, которые дал файл. Считается до плана, потому что от
    него считаются пропущенные: «сколько строк не стало задачами» — это
    разность, и выводить её надо из одного источника, иначе сумма в
    отчёте перестанет сходиться при первой же правке слоёв.
  */
  const records = parsed.rows.length + new Set(parsed.errors.map((e) => e.line)).size;
  if (records > MAX_ROWS) {
    return fail(413, 'too_large', `В файле больше ${MAX_ROWS} записей: разделите его на части`);
  }

  const state = await loadImportState(supabase, project.org_id, projectId);
  if (state.error) return fromPostgres(state.error);

  const plan = buildPlan(parsed.rows, state.context);
  const planErrors = [...parsed.errors, ...plan.errors];

  if (dryRun) {
    return ok({
      dryRun: true,
      format,
      status: planErrors.length === 0 ? 'success' : plan.create.length + plan.update.length > 0 ? 'partial' : 'failed',
      stats: {
        records,
        created: plan.create.length,
        updated: plan.update.length,
        dependencies: plan.dependencies.length,
        skipped: records - plan.create.length - plan.update.length,
        errors: planErrors.length,
      },
      errors: sortErrors(planErrors).slice(0, MAX_REPORTED),
    });
  }

  /*
    Запуск создаётся до записи задач и со статусом `running`.

    Порядок не косметический. Во-первых, здесь проверяется право на
    импорт — политикой, а не маршрутом. Во-вторых, обрыв посередине
    оставляет запуск незавершённым, и это видно: запись, созданная
    после, показала бы либо успех, либо ничего.
  */
  const { data: run, error: runError } = await supabase
    .from('import_runs')
    .insert({
      org_id: project.org_id,
      started_by: auth.claims.sub as string,
      source: format,
      status: 'running',
    })
    .select('id')
    .single();

  if (runError?.code === '42501') {
    return fail(403, 'forbidden', 'Импортировать может администратор или владелец');
  }
  if (runError) return fromPostgres(runError);

  const applied = await applyPlan(supabase, plan, state, project.org_id, projectId);
  const errors = sortErrors([...planErrors, ...applied.errors]);
  const written = applied.stats.created + applied.stats.updated;

  const status = applied.fatal
    ? 'failed'
    : errors.length === 0
      ? 'success'
      : written > 0
        ? 'partial'
        : 'failed';

  const stats = {
    records,
    ...applied.stats,
    skipped: records - written,
    errors: errors.length,
  };

  const { error: finishError } = await supabase
    .from('import_runs')
    .update({
      status,
      stats,
      // Отчёт урезается, но число ошибок в `stats` остаётся полным:
      // иначе «показано 100» читалось бы как «их сто».
      error_report: errors.slice(0, MAX_REPORTED),
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id);
  if (finishError) return fromPostgres(finishError);

  return ok({
    runId: run.id,
    dryRun: false,
    format,
    status,
    stats,
    errors: errors.slice(0, MAX_REPORTED),
  });
}
