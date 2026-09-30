-- ============================================================================
-- ReleasePilot AI — применение what-if сценария
-- Миграция 0003. FR-35, US-25, ADR-003.
--
-- Применение сценария — не одна запись, а четыре: задачи уходят из релиза,
-- командам добавляется ёмкость, сценарий помечается применённым, факт
-- попадает в журнал. Сделай это несколькими запросами из приложения — и
-- сбой посередине оставит релиз наполовину изменённым, а журнал без
-- записи о том, кто это сделал. Поэтому здесь одна функция и одна
-- транзакция, как и у создания организации в 0002.
-- ============================================================================

-- SECURITY INVOKER, а не DEFINER, — в отличие от create_organization.
-- Там функция делала то, чего политики не разрешают никому (вставку в
-- organizations). Здесь всё, что она делает, менеджер вправе сделать и
-- руками: RLS продолжает работать внутри функции, и ошибка в ней не
-- сможет изменить чужую организацию даже в принципе.
create or replace function public.apply_scenario(p_scenario uuid)
returns scenarios
language plpgsql security invoker set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_org      uuid;
  v_s        scenarios;
  v_release  releases;
  v_exclude  uuid[];
  v_move     uuid;
  v_capacity jsonb;
  v_start    date;
  v_msg      text;
  v_before   jsonb;
  v_after    jsonb;
begin
  if v_user is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  -- Роль проверяется до блокировки строки, и порядок здесь не случаен.
  -- `select … for update` под RLS требует права на изменение: участник без
  -- роли менеджера получил бы «не найдено» на сценарий, который он только
  -- что видел в списке. Честный ответ ему — «нет прав», а не «нет такого».
  select org_id into v_org from scenarios where id = p_scenario;
  if not found then
    raise exception 'Сценарий не найден' using errcode = 'P0002';
  end if;

  if not public.can_manage(v_org) then
    raise exception 'Применять сценарии может менеджер, администратор или владелец'
      using errcode = '42501';
  end if;

  -- Блокировка закрывает гонку двух одновременных «Применить»: второй
  -- вызов дождётся первого и увидит заполненный applied_at.
  select * into v_s from scenarios where id = p_scenario for update;

  if v_s.applied_at is not null then
    raise exception 'Сценарий уже применён' using errcode = 'P0001';
  end if;

  select * into v_release from releases where id = v_s.release_id;
  if v_release.status in ('released', 'cancelled') then
    raise exception 'Релиз уже выпущен или отменён — менять его состав поздно'
      using errcode = 'P0001';
  end if;

  v_exclude := array(
    select (jsonb_array_elements_text(coalesce(v_s.payload -> 'excludeTaskIds', '[]')))::uuid
  );
  v_move := nullif(v_s.payload ->> 'moveToReleaseId', '')::uuid;
  v_capacity := coalesce(v_s.payload -> 'extraCapacity', '[]');

  -- ── Проверки повторяются здесь, хотя сценарий уже прошёл симуляцию ────
  -- Между расчётом и нажатием «Применить» проходит время, и релиз успевает
  -- измениться: задачу закрыли, перенесли, на переносимую задачу завязали
  -- новую. Эффект в сценарии посчитан для того релиза, а применяется к
  -- этому, и молча применить его значило бы выдать старые цифры за новые.

  select string_agg(coalesce(t.external_key, x::text), ', ') into v_msg
    from unnest(v_exclude) x
    left join tasks t on t.id = x
   where t.id is null
      or t.release_id is distinct from v_s.release_id
      or t.status in ('done', 'cancelled');
  if v_msg is not null then
    raise exception 'Релиз изменился после расчёта сценария: % уже нет в релизе или задача закрыта. Пересчитайте сценарий', v_msg
      using errcode = 'P0001';
  end if;

  -- FR-33: блокер, который держит остающиеся в релизе задачи, не уходит.
  select string_agg(distinct coalesce(b.external_key, b.id::text), ', ') into v_msg
    from task_dependencies d
    join tasks b on b.id = d.blocked_task_id
   where d.type = 'blocks'
     and d.blocker_task_id = any(v_exclude)
     and not (d.blocked_task_id = any(v_exclude))
     and b.release_id = v_s.release_id
     and b.status not in ('done', 'cancelled');
  if v_msg is not null then
    raise exception 'Переносимые задачи держат остающиеся в релизе: %. Перенесите их вместе или пересчитайте сценарий', v_msg
      using errcode = 'P0001';
  end if;

  if v_move is not null then
    if v_move = v_s.release_id then
      raise exception 'Задачи переносятся в тот же релиз, из которого уходят'
        using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from releases r
       where r.id = v_move and r.org_id = v_s.org_id and r.status in ('planned', 'active')
    ) then
      raise exception 'Релиз, в который переносятся задачи, не найден или уже закрыт'
        using errcode = 'P0001';
    end if;
  end if;

  -- Окно ёмкости то же, что у движка: с завтрашнего дня по плановую дату.
  -- День берётся в UTC, как и в src/domain/calendar.ts, иначе запись о
  -- ёмкости начиналась бы днём раньше или позже, чем её считал расчёт.
  v_start := (now() at time zone 'utc')::date + 1;

  if jsonb_array_length(v_capacity) > 0 then
    if v_release.planned_date < v_start then
      raise exception 'Плановая дата уже прошла — дополнительные часы добавить не к чему'
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_capacity) c
       where not exists (
         select 1 from teams tm
          where tm.id = (c ->> 'teamId')::uuid and tm.org_id = v_s.org_id
       )
    ) then
      raise exception 'Команда из сценария больше не существует. Пересчитайте сценарий'
        using errcode = 'P0001';
    end if;
  end if;

  -- ── Состояние «до» для журнала ────────────────────────────────────────
  -- Пишется то, что меняется, а не весь релиз: журнал должен отвечать на
  -- вопрос «что именно сделало это нажатие» и позволять откатить его руками.
  v_before := jsonb_build_object(
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'key', t.external_key,
               'release_id', t.release_id, 'added_to_release_at', t.added_to_release_at)), '[]')
        from tasks t where t.id = any(v_exclude)
    ),
    'capacity', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team_id', tc.team_id, 'period_start', tc.period_start,
               'period_end', tc.period_end, 'available_hours', tc.available_hours)), '[]')
        from team_capacity tc
       where tc.period_start = v_start and tc.period_end = v_release.planned_date
         and tc.team_id in (select (c ->> 'teamId')::uuid from jsonb_array_elements(v_capacity) c)
    )
  );

  -- ── Изменения ─────────────────────────────────────────────────────────
  -- Момент попадания в релиз обновляется у перенесённой задачи: для
  -- целевого релиза она новая, и дрейф скоупа там должен её увидеть.
  update tasks
     set release_id = v_move,
         added_to_release_at = case when v_move is null then null else now() end
   where id = any(v_exclude);

  -- Запись на то же окно уже может быть — от прошлого сценария или от
  -- планирования. Часы складываются, а не затирают её: «добавить 40 часов»
  -- не должно означать «оставить ровно 40».
  insert into team_capacity (org_id, team_id, period_start, period_end, available_hours)
  select v_s.org_id, (c ->> 'teamId')::uuid, v_start, v_release.planned_date, (c ->> 'hours')::numeric
    from jsonb_array_elements(v_capacity) c
  on conflict (team_id, period_start, period_end)
  do update set available_hours = team_capacity.available_hours + excluded.available_hours;

  update scenarios
     set applied_at = now(), applied_by = v_user
   where id = p_scenario
  returning * into v_s;

  v_after := jsonb_build_object(
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'key', t.external_key,
               'release_id', t.release_id, 'added_to_release_at', t.added_to_release_at)), '[]')
        from tasks t where t.id = any(v_exclude)
    ),
    'capacity', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team_id', tc.team_id, 'period_start', tc.period_start,
               'period_end', tc.period_end, 'available_hours', tc.available_hours)), '[]')
        from team_capacity tc
       where tc.period_start = v_start and tc.period_end = v_release.planned_date
         and tc.team_id in (select (c ->> 'teamId')::uuid from jsonb_array_elements(v_capacity) c)
    ),
    'scenario', jsonb_build_object('title', v_s.title, 'payload', v_s.payload, 'result', v_s.result)
  );

  insert into audit_log (org_id, actor_id, entity, entity_id, action, before, after)
  values (v_s.org_id, v_user, 'scenario', v_s.id, 'apply', v_before, v_after);

  return v_s;
end;
$$;

revoke execute on function public.apply_scenario(uuid) from public, anon;
grant  execute on function public.apply_scenario(uuid) to authenticated;

comment on function public.apply_scenario is
  'Применяет сохранённый what-if сценарий одной транзакцией: перенос задач, ёмкость, отметка о применении, запись в журнал. SECURITY INVOKER: RLS действует внутри';
