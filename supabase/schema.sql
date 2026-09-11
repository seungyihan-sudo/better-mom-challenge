create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique check (char_length(display_name) between 1 and 30),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.member_invites (
  member_id uuid primary key references public.members(id) on delete cascade,
  email_hash text not null unique,
  created_at timestamptz not null default now()
);

create table public.challenge_config (
  id boolean primary key default true check (id),
  start_date date not null,
  end_date date not null check (end_date = start_date + 27)
);

insert into public.challenge_config(id, start_date, end_date)
values (true, date '2026-08-08', date '2026-09-04');

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  activity text not null check (activity in ('exercise','reading')),
  attended_on date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (member_id, activity, attended_on)
);

create index attendance_member_date_idx on public.attendance (member_id, attended_on);
create index attendance_created_by_idx on public.attendance (created_by);
create index members_user_id_idx on public.members (user_id) where user_id is not null;
create unique index one_active_admin_idx on public.members ((role)) where role = 'admin' and active = true;

alter table public.members enable row level security;
alter table public.attendance enable row level security;
alter table public.challenge_config enable row level security;

create policy "attendance_is_visible_to_everyone" on public.attendance for select to anon, authenticated using (true);
create policy "active_members_are_visible_to_everyone" on public.members for select to anon, authenticated using (active = true);
create policy "challenge_config_is_visible_to_everyone" on public.challenge_config for select to anon, authenticated using (true);
create policy "first_user_can_claim_admin" on public.members for insert to authenticated
with check (
  role = 'admin'
  and user_id = (select auth.uid())
  and active = true
  and not exists (select 1 from public.members where role = 'admin' and active = true)
);
create policy "members_or_admins_can_add_attendance" on public.attendance for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and attended_on between (select start_date from public.challenge_config where id = true)
    and (select end_date from public.challenge_config where id = true)
  and attended_on <= timezone('Asia/Seoul', now())::date
  and exists (
    select 1 from public.members target where target.id = member_id and (
      target.user_id = (select auth.uid()) or exists (
        select 1 from public.members actor where actor.user_id = (select auth.uid()) and actor.role = 'admin' and actor.active = true
      )
    )
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.members, public.attendance, public.challenge_config to anon, authenticated;
grant insert on public.members to authenticated;
grant insert on public.attendance to authenticated;
revoke all on schema private from public, anon, authenticated;

create or replace function private.link_member_account() returns trigger language plpgsql security definer set search_path = '' as $$
declare matched_member uuid;
begin
  select member_id into matched_member from private.member_invites
  where email_hash = encode(extensions.digest(lower(new.email), 'sha256'), 'hex');
  if matched_member is not null then
    update public.members set user_id = new.id where id = matched_member and user_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.link_member_account() from public, anon, authenticated;
create trigger on_auth_user_created_link_member after insert on auth.users for each row execute function private.link_member_account();

create or replace function public.admin_add_members(entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  member_name text;
  member_email text;
  new_member_id uuid;
  existing_user_id uuid;
  added_count integer := 0;
begin
  if not exists (
    select 1 from public.members
    where user_id = auth.uid() and role = 'admin' and active = true
  ) then
    raise exception '관리자만 회원을 등록할 수 있습니다.';
  end if;

  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) = 0 or jsonb_array_length(entries) > 100 then
    raise exception '회원은 한 번에 1명부터 100명까지 등록할 수 있습니다.';
  end if;

  for entry in select value from jsonb_array_elements(entries)
  loop
    member_name := btrim(entry->>'name');
    member_email := lower(btrim(entry->>'email'));
    if member_name is null or char_length(member_name) not between 1 and 30
       or member_email is null or member_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception '이름 또는 이메일 형식을 확인해주세요.';
    end if;

    select id into existing_user_id
    from auth.users
    where encode(extensions.digest(lower(email), 'sha256'), 'hex') = encode(extensions.digest(member_email, 'sha256'), 'hex')
    limit 1;

    insert into public.members (display_name, user_id, role)
    values (member_name, existing_user_id, 'member')
    returning id into new_member_id;

    insert into private.member_invites (member_id, email_hash)
    values (new_member_id, encode(extensions.digest(member_email, 'sha256'), 'hex'));
    added_count := added_count + 1;
  end loop;
  return added_count;
end;
$$;
revoke all on function public.admin_add_members(jsonb) from public, anon;
grant execute on function public.admin_add_members(jsonb) to authenticated;
alter publication supabase_realtime add table public.attendance;

-- PIN authentication replaces email links for this private challenge.
create table if not exists private.member_pin_credentials (
  member_id uuid primary key references public.members(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  must_change_pin boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists private.member_pin_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists member_pin_sessions_member_idx on private.member_pin_sessions(member_id);
create index if not exists member_pin_sessions_expiry_idx on private.member_pin_sessions(expires_at);

alter table public.attendance alter column created_by drop not null;
alter table public.attendance add column if not exists created_by_member_id uuid references public.members(id) on delete set null;
create index if not exists attendance_created_by_member_idx on public.attendance(created_by_member_id);

create or replace function private.pin_actor(p_token text)
returns table(member_id uuid, display_name text, role text, must_change_pin boolean)
language sql
security definer
set search_path = ''
as $$
  select m.id, m.display_name, m.role, c.must_change_pin
  from private.member_pin_sessions s
  join public.members m on m.id = s.member_id and m.active = true
  join private.member_pin_credentials c on c.member_id = m.id
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.expires_at > now()
  limit 1
$$;
revoke all on function private.pin_actor(text) from public, anon, authenticated;

create or replace function public.pin_login(p_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.members%rowtype;
  credential private.member_pin_credentials%rowtype;
  plain_token text;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 30 or coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', '이름 또는 PIN을 확인해주세요.');
  end if;

  select * into target from public.members
  where display_name = btrim(p_name) and active = true limit 1;
  if target.id is null then
    perform pg_sleep(0.25);
    return jsonb_build_object('ok', false, 'error', '이름 또는 PIN을 확인해주세요.');
  end if;

  select * into credential from private.member_pin_credentials
  where member_id = target.id for update;
  if credential.member_id is null or (credential.locked_until is not null and credential.locked_until > now()) then
    return jsonb_build_object('ok', false, 'error', '잠시 후 다시 시도하거나 관리자에게 PIN 재설정을 요청해주세요.');
  end if;

  if extensions.crypt(p_pin, credential.pin_hash) <> credential.pin_hash then
    update private.member_pin_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
        updated_at = now()
    where member_id = target.id;
    return jsonb_build_object('ok', false, 'error', '이름 또는 PIN을 확인해주세요.');
  end if;

  update private.member_pin_credentials set failed_attempts = 0, locked_until = null, updated_at = now()
  where member_id = target.id;
  delete from private.member_pin_sessions where expires_at <= now();
  plain_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.member_pin_sessions(member_id, token_hash)
  values (target.id, encode(extensions.digest(plain_token, 'sha256'), 'hex'));
  return jsonb_build_object('ok', true, 'token', plain_token);
end;
$$;

create or replace function public.pin_session_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null then return jsonb_build_object('ok', false); end if;
  update private.member_pin_sessions set last_seen_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true, 'member', jsonb_build_object(
    'id', actor.member_id, 'display_name', actor.display_name, 'role', actor.role,
    'user_id', null, 'must_change_pin', actor.must_change_pin
  ));
end;
$$;

create or replace function public.pin_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.member_pin_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_add_attendance(p_token text, p_member_id uuid, p_activity text, p_attended_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record; challenge_start date; challenge_end date;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null then return jsonb_build_object('ok', false, 'error', '다시 로그인해주세요.'); end if;
  if actor.must_change_pin then return jsonb_build_object('ok', false, 'error', '먼저 임시 PIN을 변경해주세요.'); end if;
  if actor.role <> 'admin' and actor.member_id <> p_member_id then
    return jsonb_build_object('ok', false, 'error', '본인의 출석만 입력할 수 있어요.');
  end if;
  select start_date, end_date into challenge_start, challenge_end from public.challenge_config where id = true;
  if p_activity not in ('exercise', 'reading') or p_attended_on < challenge_start
     or p_attended_on > challenge_end or p_attended_on > timezone('Asia/Seoul', now())::date then
    return jsonb_build_object('ok', false, 'error', '인증 종류 또는 날짜를 확인해주세요.');
  end if;
  begin
    insert into public.attendance(member_id, activity, attended_on, created_by_member_id)
    values (p_member_id, p_activity, p_attended_on, actor.member_id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', '이미 같은 날짜에 인증했어요.');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_admin_upsert_members(p_token text, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record; entry jsonb; member_name text; member_pin text; target_id uuid; changed integer := 0;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', '관리자만 회원 PIN을 설정할 수 있어요.');
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'error', '회원은 한 번에 1명부터 100명까지 입력해주세요.');
  end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    member_name := btrim(entry->>'name'); member_pin := entry->>'pin';
    if char_length(coalesce(member_name, '')) not between 1 and 30 or coalesce(member_pin, '') !~ '^[0-9]{6}$' then
      return jsonb_build_object('ok', false, 'error', '이름과 숫자 6자리 PIN을 확인해주세요.');
    end if;
    select id into target_id from public.members where display_name = member_name limit 1;
    if target_id is null then
      insert into public.members(display_name, role) values (member_name, 'member') returning id into target_id;
    else
      update public.members set active = true where id = target_id;
    end if;
    insert into private.member_pin_credentials(member_id, pin_hash, must_change_pin, failed_attempts, locked_until, updated_at)
    values (target_id, extensions.crypt(member_pin, extensions.gen_salt('bf', 10)), true, 0, null, now())
    on conflict (member_id) do update set pin_hash = excluded.pin_hash, must_change_pin = true,
      failed_attempts = 0, locked_until = null, updated_at = now();
    delete from private.member_pin_sessions where member_id = target_id;
    changed := changed + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', changed);
end;
$$;

create or replace function public.pin_admin_reset_member_pin(p_token text, p_member_id uuid, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or actor.role <> 'admin' or coalesce(p_new_pin, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', '관리자 권한 또는 PIN을 확인해주세요.');
  end if;
  insert into private.member_pin_credentials(member_id, pin_hash, must_change_pin, failed_attempts, locked_until, updated_at)
  values (p_member_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)), true, 0, null, now())
  on conflict (member_id) do update set pin_hash = excluded.pin_hash, must_change_pin = true,
    failed_attempts = 0, locked_until = null, updated_at = now();
  delete from private.member_pin_sessions where member_id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_change_own_pin(p_token text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or coalesce(p_new_pin, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'PIN은 숫자 6자리로 입력해주세요.');
  end if;
  update private.member_pin_credentials set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
    must_change_pin = false, failed_attempts = 0, locked_until = null, updated_at = now()
  where member_id = actor.member_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_admin_rename_member(p_token text, p_member_id uuid, p_new_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; clean_name text := btrim(p_new_name); target_exists boolean;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', '관리자만 회원 이름을 수정할 수 있어요.');
  end if;
  if char_length(coalesce(clean_name, '')) not between 1 and 30 then
    return jsonb_build_object('ok', false, 'error', '이름은 1자부터 30자까지 입력해주세요.');
  end if;
  select exists(select 1 from public.members where id = p_member_id and active = true) into target_exists;
  if not target_exists then return jsonb_build_object('ok', false, 'error', '회원을 찾을 수 없어요.'); end if;
  begin
    update public.members set display_name = clean_name where id = p_member_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', '이미 사용 중인 회원 이름이에요.');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_admin_delete_member(p_token text, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; target_role text;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', '관리자만 회원을 삭제할 수 있어요.');
  end if;
  select role into target_role from public.members where id = p_member_id and active = true;
  if target_role is null then return jsonb_build_object('ok', false, 'error', '회원을 찾을 수 없어요.'); end if;
  if p_member_id = actor.member_id or target_role = 'admin' then
    return jsonb_build_object('ok', false, 'error', '관리자 본인 계정은 삭제할 수 없어요.');
  end if;
  delete from public.members where id = p_member_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pin_admin_reset_challenge(p_token text, p_start_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; new_end_date date;
begin
  select * into actor from private.pin_actor(p_token);
  if actor.member_id is null or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', '관리자만 챌린지를 초기화할 수 있어요.');
  end if;
  if p_start_date is null or p_start_date < date '2020-01-01' or p_start_date > date '2100-12-31' then
    return jsonb_build_object('ok', false, 'error', '새 챌린지 시작일을 확인해주세요.');
  end if;
  new_end_date := p_start_date + 27;
  delete from public.attendance;
  delete from public.members where role <> 'admin';
  insert into public.challenge_config(id, start_date, end_date)
  values (true, p_start_date, new_end_date)
  on conflict (id) do update set start_date = excluded.start_date, end_date = excluded.end_date;
  return jsonb_build_object('ok', true, 'start_date', p_start_date, 'end_date', new_end_date);
end;
$$;

revoke all on function public.pin_login(text, text) from public;
revoke all on function public.pin_session_profile(text) from public;
revoke all on function public.pin_logout(text) from public;
revoke all on function public.pin_add_attendance(text, uuid, text, date) from public;
revoke all on function public.pin_admin_upsert_members(text, jsonb) from public;
revoke all on function public.pin_admin_reset_member_pin(text, uuid, text) from public;
revoke all on function public.pin_change_own_pin(text, text) from public;
revoke all on function public.pin_admin_rename_member(text, uuid, text) from public;
revoke all on function public.pin_admin_delete_member(text, uuid) from public;
revoke all on function public.pin_admin_reset_challenge(text, date) from public;
grant execute on function public.pin_login(text, text), public.pin_session_profile(text), public.pin_logout(text),
  public.pin_add_attendance(text, uuid, text, date), public.pin_admin_upsert_members(text, jsonb),
  public.pin_admin_reset_member_pin(text, uuid, text), public.pin_change_own_pin(text, text),
  public.pin_admin_rename_member(text, uuid, text), public.pin_admin_delete_member(text, uuid),
  public.pin_admin_reset_challenge(text, date) to anon, authenticated;
