-- ============================================================================
-- ReleasePilot AI — начальная схема
-- Миграция 0001. Организации, команды, релизы, задачи, зависимости,
-- ёмкость, снимки метрик, агент, журнал изменений.
--
-- Принцип (ADR-003): запрет по умолчанию. RLS включается на каждой таблице,
-- доступ разрешается только явной политикой.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- быстрый поиск по заголовкам

-- ============================================================================
-- ПЕРЕЧИСЛЕНИЯ
-- ============================================================================

create type app_role        as enum ('owner', 'admin', 'manager', 'lead', 'viewer');
create type team_kind       as enum ('frontend', 'backend', 'qa', 'analytics', 'design', 'other');
create type task_status     as enum ('backlog', 'in_progress', 'review', 'testing', 'done', 'cancelled');
create type task_priority   as enum ('P0', 'P1', 'P2', 'P3');
create type release_status  as enum ('planned', 'active', 'released', 'postponed', 'cancelled');
create type dependency_type as enum ('blocks', 'relates');
create type risk_level      as enum ('low', 'medium', 'high', 'critical');

-- ============================================================================
-- СЛУЖЕБНЫЕ ФУНКЦИИ
-- ============================================================================

-- Автообновление updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Проверки принадлежности. SECURITY DEFINER — обходят RLS, иначе политика
-- на memberships, обращающаяся к memberships, зациклится.
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = p_org and user_id = auth.uid() and role = any(p_roles)
  );
$$;

-- Сокращение: роли, которым разрешено изменять данные проекта
create or replace function public.can_manage(p_org uuid)
returns boolean language sql stable as $$
  select public.has_org_role(p_org, array['owner','admin','manager']::app_role[]);
$$;

-- ============================================================================
-- ОРГАНИЗАЦИИ И ПОЛЬЗОВАТЕЛИ
-- ============================================================================

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Профиль расширяет auth.users, а не заменяет его: собственную
-- аутентификацию не пишем (ADR-003, раздел 10)
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text check (length(trim(full_name)) <= 120),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id)      on delete cascade,
  role        app_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index on memberships (user_id);
create index on memberships (org_id);

-- ============================================================================
-- КОМАНДЫ И ЁМКОСТЬ
-- ============================================================================

create table teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  kind        team_kind not null default 'other',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, name)
);

create table team_members (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  team_id        uuid not null references teams(id)         on delete cascade,
  profile_id     uuid not null references profiles(id)      on delete cascade,
  -- доля времени участника, отдаваемая этой команде
  allocation_pct smallint not null default 100 check (allocation_pct between 1 and 100),
  created_at     timestamptz not null default now(),
  unique (team_id, profile_id)
);

-- Доступные часы команды на период. Основа расчёта загрузки (ADR-001).
create table team_capacity (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  team_id         uuid not null references teams(id)         on delete cascade,
  period_start    date not null,
  period_end      date not null,
  available_hours numeric(8,2) not null check (available_hours >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (period_end >= period_start),
  unique (team_id, period_start, period_end)
);

-- Отсутствия вычитаются из ёмкости (US-08)
create table absences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  profile_id  uuid not null references profiles(id)      on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text check (length(reason) <= 200),
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create index on absences (org_id, start_date, end_date);

-- ============================================================================
-- ПРОЕКТЫ, РЕЛИЗЫ, ЗАДАЧИ
-- ============================================================================

create table projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  key         text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, key)
);

create table releases (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  project_id    uuid not null references projects(id)      on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  status        release_status not null default 'planned',
  planned_date  date not null,
  started_at    timestamptz,
  released_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on releases (org_id, status);
create index on releases (project_id, planned_date);

create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  project_id           uuid not null references projects(id)      on delete cascade,
  release_id           uuid references releases(id)               on delete set null,
  external_key         text,                      -- ключ в исходном трекере
  title                text not null check (length(trim(title)) between 1 and 300),
  description          text,
  status               task_status   not null default 'backlog',
  priority             task_priority not null default 'P2',
  -- Оценка обязательна и положительна: на ней держится весь расчёт (FR-07)
  estimate_h           numeric(6,2) not null check (estimate_h > 0),
  spent_h              numeric(6,2) not null default 0 check (spent_h >= 0),
  team_id              uuid references teams(id)    on delete set null,
  assignee_id          uuid references profiles(id) on delete set null,
  -- Момент попадания в релиз. Позже старта релиза = дрейф скоупа (фактор F6)
  added_to_release_at  timestamptz,
  blocked_since        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, project_id, external_key)
);

create index on tasks (org_id, release_id);
create index on tasks (org_id, status);
create index on tasks (team_id);
create index on tasks (assignee_id);
create index on tasks (release_id) where blocked_since is not null;
create index on tasks using gin (title gin_trgm_ops);   -- поиск, NFR-02

-- ============================================================================
-- ЗАВИСИМОСТИ
-- ============================================================================

create table task_dependencies (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  blocker_task_id  uuid not null references tasks(id) on delete cascade,
  blocked_task_id  uuid not null references tasks(id) on delete cascade,
  type             dependency_type not null default 'blocks',
  created_at       timestamptz not null default now(),
  check (blocker_task_id <> blocked_task_id),          -- задача не блокирует себя
  unique (blocker_task_id, blocked_task_id)
);

create index on task_dependencies (blocked_task_id);
create index on task_dependencies (blocker_task_id);

-- Запрет циклов (FR-13). Без него расчёт критической цепочки зациклится.
-- Проверяем на уровне БД, а не приложения: ограничение целостности данных
-- должно жить там, где живут данные.
create or replace function public.prevent_dependency_cycle()
returns trigger language plpgsql as $$
begin
  if new.type <> 'blocks' then
    return new;
  end if;

  -- Если от заблокированной задачи уже достижима блокирующая — возникнет цикл
  if exists (
    with recursive reachable(task_id) as (
      select new.blocked_task_id
      union
      select d.blocked_task_id
        from task_dependencies d
        join reachable r on d.blocker_task_id = r.task_id
       where d.type = 'blocks'
    )
    select 1 from reachable where task_id = new.blocker_task_id
  ) then
    raise exception 'Циклическая зависимость: задача % уже зависит от задачи %',
      new.blocker_task_id, new.blocked_task_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_dependency_cycle
  before insert or update on task_dependencies
  for each row execute function public.prevent_dependency_cycle();

-- ============================================================================
-- СНИМКИ МЕТРИК — основа истории и трендов (FR-39)
-- ============================================================================

create table release_snapshots (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  release_id        uuid not null references releases(id)      on delete cascade,
  captured_at       timestamptz not null default now(),
  readiness_pct     numeric(5,2) not null check (readiness_pct between 0 and 100),
  risk_score        numeric(5,2) not null check (risk_score between 0 and 100),
  risk_level        risk_level   not null,
  probability_on_time numeric(4,3) check (probability_on_time between 0 and 1),
  -- Полный ReleaseMetrics: факторы, причины, загрузка команд.
  -- Храним снимком, чтобы история не переписывалась при изменении формул.
  metrics           jsonb not null,
  created_at        timestamptz not null default now()
);

create index on release_snapshots (release_id, captured_at desc);

-- ============================================================================
-- WHAT-IF СЦЕНАРИИ
-- ============================================================================

create table scenarios (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  release_id  uuid not null references releases(id)      on delete cascade,
  created_by  uuid references profiles(id) on delete set null,
  title       text not null check (length(trim(title)) between 1 and 200),
  payload     jsonb not null,   -- excludeTaskIds, moveToReleaseId, extraCapacity
  result      jsonb,            -- before / after / delta
  applied_at  timestamptz,
  applied_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index on scenarios (release_id, created_at desc);

-- ============================================================================
-- AI-АГЕНТ
-- ============================================================================

create table agent_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id)      on delete cascade,
  release_id  uuid references releases(id) on delete set null,
  title       text check (length(title) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on agent_sessions (user_id, created_at desc);

create table agent_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id)  on delete cascade,
  session_id    uuid not null references agent_sessions(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant', 'tool')),
  content       text,
  tool_calls    jsonb,
  -- Учёт расхода: контроль стоимости и лимитов (ADR-003, раздел 6)
  input_tokens  integer check (input_tokens  >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at    timestamptz not null default now()
);

create index on agent_messages (session_id, created_at);

-- ============================================================================
-- ИМПОРТ
-- ============================================================================

create table import_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  started_by    uuid references profiles(id) on delete set null,
  source        text not null check (source in ('tracker', 'csv', 'json')),
  status        text not null default 'running'
                check (status in ('running', 'success', 'partial', 'failed')),
  stats         jsonb,   -- создано / обновлено / пропущено
  error_report  jsonb,   -- построчные ошибки (FR-41)
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index on import_runs (org_id, started_at desc);

-- ============================================================================
-- ЖУРНАЛ ИЗМЕНЕНИЙ — только добавление (ADR-003, раздел 7)
-- ============================================================================

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,
  entity      text not null,           -- 'task' | 'release' | 'scenario' | ...
  entity_id   uuid,
  action      text not null,           -- 'create' | 'update' | 'delete' | 'apply'
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

create index on audit_log (org_id, created_at desc);
create index on audit_log (entity, entity_id);

-- ============================================================================
-- ТРИГГЕРЫ updated_at
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','teams','team_capacity','projects',
    'releases','tasks','agent_sessions'
  ] loop
    execute format(
      'create trigger trg_touch_%1$s before update on %1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Включаем на КАЖДОЙ таблице. Таблица без политики недоступна никому —
-- это и есть «запрет по умолчанию» (ADR-003, принцип 1).
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','memberships','teams','team_members',
    'team_capacity','absences','projects','releases','tasks',
    'task_dependencies','release_snapshots','scenarios','agent_sessions',
    'agent_messages','import_runs','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- --- Организации --------------------------------------------------------
create policy org_select on organizations for select
  using (public.is_org_member(id));

create policy org_update on organizations for update
  using (public.has_org_role(id, array['owner','admin']::app_role[]));

create policy org_delete on organizations for delete
  using (public.has_org_role(id, array['owner']::app_role[]));

-- --- Профили ------------------------------------------------------------
-- Видно себя и коллег по организациям; редактировать можно только себя
create policy profile_select on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

create policy profile_update on profiles for update using (id = auth.uid());
create policy profile_insert on profiles for insert with check (id = auth.uid());

-- --- Членство -----------------------------------------------------------
create policy membership_select on memberships for select
  using (user_id = auth.uid() or public.is_org_member(org_id));

create policy membership_write on memberships for all
  using      (public.has_org_role(org_id, array['owner','admin']::app_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::app_role[]));

-- --- Справочники и рабочие данные ---------------------------------------
-- Чтение — любому участнику организации. Изменение — manager и выше.
do $$
declare t text;
begin
  foreach t in array array[
    'teams','team_members','team_capacity','absences','projects',
    'releases','tasks','task_dependencies','scenarios'
  ] loop
    execute format(
      'create policy %1$s_select on %1$I for select using (public.is_org_member(org_id))', t);
    execute format(
      'create policy %1$s_write on %1$I for all
         using (public.can_manage(org_id))
         with check (public.can_manage(org_id))', t);
  end loop;
end $$;

-- --- Снимки метрик: читают все, пишет только сервер ----------------------
create policy snapshot_select on release_snapshots for select
  using (public.is_org_member(org_id));

-- --- Импорт: запускают admin и выше --------------------------------------
create policy import_select on import_runs for select
  using (public.is_org_member(org_id));

create policy import_write on import_runs for all
  using      (public.has_org_role(org_id, array['owner','admin']::app_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::app_role[]));

-- --- Диалоги с агентом: строго приватны ----------------------------------
-- Переписка видна только автору, даже владельцу организации
create policy agent_session_own on agent_sessions for all
  using      (user_id = auth.uid() and public.is_org_member(org_id))
  with check (user_id = auth.uid() and public.is_org_member(org_id));

create policy agent_message_own on agent_messages for all
  using (exists (
    select 1 from agent_sessions s
    where s.id = agent_messages.session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from agent_sessions s
    where s.id = agent_messages.session_id and s.user_id = auth.uid()
  ));

-- --- Журнал изменений: только чтение и только добавление -----------------
-- Политик update и delete нет намеренно: журнал нельзя подчистить
create policy audit_select on audit_log for select
  using (public.has_org_role(org_id, array['owner','admin','manager']::app_role[]));

create policy audit_insert on audit_log for insert
  with check (public.is_org_member(org_id));

-- ============================================================================
-- КОММЕНТАРИИ К КЛЮЧЕВЫМ ПОЛЯМ
-- ============================================================================

comment on column tasks.estimate_h is
  'Оценка трудозатрат в часах. Обязательна: на ней строится расчёт готовности, загрузки и риска';
comment on column tasks.added_to_release_at is
  'Момент добавления в релиз. Позже releases.started_at — дрейф скоупа, фактор F6 в ADR-001';
comment on column tasks.blocked_since is
  'Начало блокировки. Длительность влияет на фактор F3 и признак застарелого блокера';
comment on table  release_snapshots is
  'Ежедневные снимки метрик. Хранятся как jsonb, чтобы история не переписывалась при изменении формул расчёта';
comment on table  audit_log is
  'Журнал изменений. Только добавление: политики update и delete отсутствуют намеренно';
