-- ============================================================================
-- ReleasePilot AI — онбординг
-- Миграция 0002. Автосоздание профиля при регистрации и создание
-- организации вместе с её владельцем одной транзакцией.
--
-- Закрывает две дыры, обнаруженные после применения 0001:
--   1. profiles ссылается на auth.users, но никто её не заполнял;
--   2. у organizations не было политики insert, из-за чего первый
--      пользователь не мог создать организацию в принципе.
-- ============================================================================

-- ============================================================================
-- 1. ПРОФИЛЬ ПРИ РЕГИСТРАЦИИ
-- ============================================================================

-- Supabase создаёт строку в auth.users сам. Наш profiles — расширение этой
-- строки прикладными полями (ADR-003, раздел 10): собственную аутентификацию
-- не пишем, но и хранить своё во внутренней таблице auth не имеем права.
--
-- SECURITY DEFINER обязателен: триггер срабатывает в момент, когда auth.uid()
-- ещё не установлен, а на profiles включён force row level security —
-- политика profile_insert (id = auth.uid()) отклонила бы вставку.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (id) do nothing;   -- повторный вызов не должен ломать регистрацию
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Профили уже зарегистрированных пользователей, если такие есть.
-- Миграция должна приводить базу в нужное состояние, а не только
-- обслуживать будущие события.
insert into public.profiles (id, full_name)
select u.id, nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), '')
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null;

-- ============================================================================
-- 2. СОЗДАНИЕ ОРГАНИЗАЦИИ
-- ============================================================================

-- Политику insert на organizations намеренно НЕ добавляем.
--
-- Создание организации — не вставка строки, а событие с тремя последствиями:
-- появляется организация, её автор становится владельцем, факт попадает
-- в журнал. Разрешить клиенту первое, надеясь, что он не забудет про
-- остальные два, — значит допустить организацию без владельца, то есть
-- недоступную никому, включая создателя.
--
-- Поэтому операция закрыта в функцию и выполняется одной транзакцией.
-- Клиент вызывает её через RPC; прямая вставка остаётся запрещённой.

-- Ограничение на число организаций у одного владельца. В публичном
-- демо-режиме это единственный барьер против засорения базы: регистрация
-- открытая, капчи нет (ADR-002).
create or replace function public.owned_org_count(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from memberships
   where user_id = p_user and role = 'owner';
$$;

create or replace function public.create_organization(p_name text, p_slug text)
returns organizations
language plpgsql security definer set search_path = public as $$
declare
  v_org   organizations;
  v_user  uuid := auth.uid();
  v_limit constant integer := 5;
begin
  if v_user is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  -- Профиль создаётся триггером выше. Если его нет — регистрация прошла
  -- неполностью, и молча продолжать нельзя: memberships сошлётся в пустоту.
  if not exists (select 1 from profiles where id = v_user) then
    raise exception 'Профиль пользователя не найден' using errcode = 'P0002';
  end if;

  if public.owned_org_count(v_user) >= v_limit then
    raise exception 'Достигнут предел: не больше % организаций на пользователя', v_limit
      using errcode = 'check_violation';
  end if;

  begin
    insert into organizations (name, slug)
    values (trim(p_name), lower(trim(p_slug)))
    returning * into v_org;
  exception when unique_violation then
    raise exception 'Адрес «%» уже занят, выберите другой', lower(trim(p_slug))
      using errcode = 'unique_violation';
  end;

  insert into memberships (org_id, user_id, role)
  values (v_org.id, v_user, 'owner');

  insert into audit_log (org_id, actor_id, entity, entity_id, action, after)
  values (v_org.id, v_user, 'organization', v_org.id, 'create', to_jsonb(v_org));

  return v_org;
end;
$$;

-- Функция с SECURITY DEFINER выполняется с правами владельца, поэтому права
-- на её вызов раздаём вручную. По умолчанию execute есть у public — это
-- пустило бы к ней анонимов.
revoke execute on function public.create_organization(text, text) from public, anon;
grant  execute on function public.create_organization(text, text) to authenticated;

revoke execute on function public.owned_org_count(uuid) from public, anon;
grant  execute on function public.owned_org_count(uuid) to authenticated;

-- ============================================================================
-- 3. КОММЕНТАРИИ
-- ============================================================================

comment on function public.handle_new_user is
  'Создаёт profiles при регистрации в auth.users. SECURITY DEFINER: в момент срабатывания auth.uid() ещё не установлен';
comment on function public.create_organization is
  'Создаёт организацию, делает вызывающего владельцем и пишет в журнал одной транзакцией. Прямой insert в organizations запрещён политиками намеренно';
