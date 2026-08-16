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

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  activity text not null check (activity in ('exercise','reading')),
  attended_on date not null check (attended_on between date '2026-08-08' and date '2026-09-04'),
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

create policy "attendance_is_visible_to_everyone" on public.attendance for select to anon, authenticated using (true);
create policy "active_members_are_visible_to_everyone" on public.members for select to anon, authenticated using (active = true);
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
  and attended_on between date '2026-08-08' and date '2026-09-04'
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
grant select on public.members, public.attendance to anon, authenticated;
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
