/**
 * Импорт задач из Yandex Tracker (FR-40, FR-42, ADR-002).
 *
 * Отличий от файлового импорта два, и оба про доступ, а не про разбор:
 *
 * 1. **Режим.** Работает только при `APP_MODE=corporate`. Публичное демо
 *    не должно касаться корпоративного источника ни при какой
 *    конфигурации — ADR-002, и это проверяется до всего остального.
 * 2. **Анонимизация** включена по умолчанию (FR-42): в базу уезжают
 *    структура и числа, а названия, описания и ключи очередей — нет.
 *    Отключается явным флагом, и асимметрия тут намеренная: утёкшее
 *    название задачи обратно не спрячешь, а псевдонимизированное можно
 *    переимпортировать.
 *
 * Дальше путь общий с файловым импортом: план, проверка ссылок, запись,
 * построчный отчёт. Свой путь записи означал бы, что правила «что
 * отклонять» у двух источников разойдутся — а они одни.
 *
 * **Живьём не проверялся.** Обращение к корпоративному трекеру требует
 * решения владельца данных, и без него проверены только отказы: режим,
 * отсутствие доступа, проверка входа. Это записано в ограничениях, а не
 * выдано за работающее.
 */

import {
  badJson,
  BAD_JSON,
  fail,
  fromPostgres,
  invalid,
  ok,
  readJson,
  unauthorized,
} from '@/lib/api/http';
import { applyPlan, loadImportState } from '@/lib/data/import';
import { fetchQueueIssues } from '@/lib/data/tracker';
import { buildPlan } from '@/lib/import/plan';
import type { RowError } from '@/lib/import/rows';
import { mapTrackerIssues } from '@/lib/import/tracker';
import { isCorporate, serverEnv } from '@/lib/env.server';
import { createClient } from '@/lib/supabase/server';
import { trackerImportSchema } from '@/lib/validation/tracker';

/** Столько ошибок попадает в отчёт; полное их число остаётся в `stats`. */
const MAX_REPORTED = 100;

function sortErrors(errors: RowError[]): RowError[] {
  return [...errors].sort((a, b) => a.line - b.line || (a.field ?? '').localeCompare(b.field ?? ''));
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return unauthorized();

  /*
    Режим проверяется первым и до чтения тела. Отказ здесь не зависит ни
    от прав, ни от содержимого запроса: в демо-режиме этого эндпоинта как
    бы не существует, и выяснять что-то дальше незачем.
  */
  if (!isCorporate) {
    return fail(
      409,
      'mode_required',
      'Импорт из трекера работает только в корпоративном режиме (APP_MODE=corporate). ' +
        'Публичное демо работает на синтетических данных.',
    );
  }

  const token = serverEnv.TRACKER_OAUTH_TOKEN;
  const orgId = serverEnv.TRACKER_ORG_ID;
  if (!token || !orgId) {
    return fail(
      503,
      'not_configured',
      'Доступ к трекеру не настроен: нужны TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID',
    );
  }

  const body = await readJson(request);
  if (body === BAD_JSON) return badJson();

  const parsed = trackerImportSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;

  // Организация берётся из проекта — как и в файловом импорте: иначе
  // появился бы запрос, в котором проект принадлежит одной организации,
  // а задачи создаются в другой.
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', input.projectId)
    .maybeSingle();
  if (projectError) return fromPostgres(projectError);
  if (!project) return fail(422, 'invalid_reference', 'Проект не найден');

  const fetched = await fetchQueueIssues({ token, orgId }, input.queue, input.limit);
  if (fetched.kind === 'error') {
    /*
      502 на любой отказ трекера, включая отказ в доступе. Не 401 и не
      403: вызывающий этот эндпоинт вошёл и права имеет, а не подошёл
      токен у нас — значит, сломана настройка на нашей стороне, и
      перекладывать её на пользователя кодом «нет доступа» неверно.
      Что именно случилось, говорит сообщение.
    */
    return fail(502, 'tracker_unavailable', fetched.message);
  }

  const mapped = mapTrackerIssues(fetched.issues, fetched.links, {
    orgId: project.org_id,
    anonymize: input.anonymize,
    releaseName: input.releaseName,
    teamByQueue: input.teamByQueue,
  });

  const state = await loadImportState(supabase, project.org_id, input.projectId);
  if (state.error) return fromPostgres(state.error);

  const plan = buildPlan(mapped.rows, state.context);
  const planErrors = [...mapped.errors, ...plan.errors];
  const records = fetched.issues.length;

  if (input.dryRun) {
    return ok({
      dryRun: true,
      source: 'tracker',
      queue: input.queue,
      anonymized: input.anonymize,
      status:
        planErrors.length === 0
          ? 'success'
          : plan.create.length + plan.update.length > 0
            ? 'partial'
            : 'failed',
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

  // Право на импорт проверяет политика на `import_runs`: писать туда
  // может только владелец или администратор, и запуск начинается именно
  // с этой записи — до того, как в проект попадёт первая задача.
  const { data: run, error: runError } = await supabase
    .from('import_runs')
    .insert({
      org_id: project.org_id,
      started_by: auth.claims.sub as string,
      source: 'tracker',
      status: 'running',
    })
    .select('id')
    .single();

  if (runError?.code === '42501') {
    return fail(403, 'forbidden', 'Импортировать может администратор или владелец');
  }
  if (runError) return fromPostgres(runError);

  const applied = await applyPlan(supabase, plan, state, project.org_id, input.projectId);
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
      stats: { ...stats, queue: input.queue, anonymized: input.anonymize },
      error_report: errors.slice(0, MAX_REPORTED),
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id);
  if (finishError) return fromPostgres(finishError);

  return ok({
    runId: run.id,
    source: 'tracker',
    queue: input.queue,
    anonymized: input.anonymize,
    status,
    stats,
    errors: errors.slice(0, MAX_REPORTED),
  });
}
