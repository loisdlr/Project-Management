-- ============================================================
-- DualFlow: Supabase database setup
-- Run this ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User',
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  description text not null default '',
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'To Do'
    check (status in ('To Do','In Progress','Review','Done')),
  priority text not null default 'Medium'
    check (priority in ('Low','Medium','High','Urgent')),
  assignee_id uuid not null references public.profiles(id),
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  text text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Create profile automatically after Supabase Auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'User')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill any auth users created before this script.
insert into public.profiles (id, display_name)
select
  id,
  coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(email,'@',1), 'User')
from auth.users
on conflict (id) do nothing;

-- Helpers. SECURITY DEFINER avoids recursive RLS checks.
create or replace function public.is_team_member(check_team_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = check_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.shares_team_with(other_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other_user_id
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
before update on public.projects
for each row execute procedure public.touch_updated_at();

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
before update on public.tasks
for each row execute procedure public.touch_updated_at();

-- Create a workspace for the signed-in user.
create or replace function public.create_team(team_name text)
returns table(team_id uuid, invite_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  new_team_id uuid;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'This user already belongs to a workspace.';
  end if;

  if nullif(trim(team_name),'') is null then
    raise exception 'Workspace name is required.';
  end if;

  loop
    new_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
    exit when not exists (select 1 from public.teams where invite_code = new_code);
  end loop;

  insert into public.teams (name, invite_code, created_by)
  values (trim(team_name), new_code, auth.uid())
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, role)
  values (new_team_id, auth.uid(), 'owner');

  return query select new_team_id, new_code;
end;
$$;

-- Join by invite code. Hard limit: 2 users per workspace.
create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_team uuid;
  member_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'This user already belongs to a workspace.';
  end if;

  select id into target_team
  from public.teams
  where invite_code = upper(trim(code));

  if target_team is null then
    raise exception 'Invite code not found.';
  end if;

  select count(*) into member_count
  from public.team_members
  where team_id = target_team;

  if member_count >= 2 then
    raise exception 'This workspace already has two users.';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (target_team, auth.uid(), 'member');

  return target_team;
end;
$$;

grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_team_by_code(text) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.shares_team_with(uuid) to authenticated;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.checklist_items enable row level security;

drop policy if exists "profiles_select_shared_team" on public.profiles;
create policy "profiles_select_shared_team"
on public.profiles for select to authenticated
using (id = auth.uid() or public.shares_team_with(id));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "teams_select_members" on public.teams;
create policy "teams_select_members"
on public.teams for select to authenticated
using (public.is_team_member(id));

drop policy if exists "team_members_select_team" on public.team_members;
create policy "team_members_select_team"
on public.team_members for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "projects_select_team" on public.projects;
create policy "projects_select_team"
on public.projects for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "projects_insert_team" on public.projects;
create policy "projects_insert_team"
on public.projects for insert to authenticated
with check (public.is_team_member(team_id) and created_by = auth.uid());

drop policy if exists "projects_update_team" on public.projects;
create policy "projects_update_team"
on public.projects for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists "projects_delete_team" on public.projects;
create policy "projects_delete_team"
on public.projects for delete to authenticated
using (public.is_team_member(team_id));

drop policy if exists "tasks_select_team" on public.tasks;
create policy "tasks_select_team"
on public.tasks for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "tasks_insert_team" on public.tasks;
create policy "tasks_insert_team"
on public.tasks for insert to authenticated
with check (public.is_team_member(team_id) and created_by = auth.uid());

drop policy if exists "tasks_update_team" on public.tasks;
create policy "tasks_update_team"
on public.tasks for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists "tasks_delete_team" on public.tasks;
create policy "tasks_delete_team"
on public.tasks for delete to authenticated
using (public.is_team_member(team_id));

drop policy if exists "checklist_select_team" on public.checklist_items;
create policy "checklist_select_team"
on public.checklist_items for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "checklist_insert_team" on public.checklist_items;
create policy "checklist_insert_team"
on public.checklist_items for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists "checklist_update_team" on public.checklist_items;
create policy "checklist_update_team"
on public.checklist_items for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists "checklist_delete_team" on public.checklist_items;
create policy "checklist_delete_team"
on public.checklist_items for delete to authenticated
using (public.is_team_member(team_id));

-- Explicit grants used by Supabase Data API.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update, delete on public.projects, public.tasks, public.checklist_items to authenticated;

-- Realtime for the shared board.
-- If Supabase says a table is already in the publication, that line can be skipped.
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.checklist_items;
alter publication supabase_realtime add table public.team_members;
