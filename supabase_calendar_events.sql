-- ============================================================
-- DualFlow — Calendar schedules / events
-- Run this ONCE in Supabase Dashboard -> SQL Editor.
-- Safe to run more than once (if the last line says the table is
-- already in the publication, that's fine).
-- ============================================================

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  notes text not null default '',
  start_date date not null,
  end_date date not null,
  start_time time,
  color text not null default 'indigo'
    check (color in ('indigo','green','orange','pink','slate')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_dates_ok check (end_date >= start_date)
);

create index if not exists calendar_events_team_dates_idx
  on public.calendar_events (team_id, start_date, end_date);

drop trigger if exists calendar_events_touch_updated_at on public.calendar_events;
create trigger calendar_events_touch_updated_at
before update on public.calendar_events
for each row execute procedure public.touch_updated_at();

alter table public.calendar_events enable row level security;

drop policy if exists "calendar_events_select_team" on public.calendar_events;
create policy "calendar_events_select_team"
on public.calendar_events for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists "calendar_events_insert_team" on public.calendar_events;
create policy "calendar_events_insert_team"
on public.calendar_events for insert to authenticated
with check (public.is_team_member(team_id) and created_by = auth.uid());

drop policy if exists "calendar_events_update_team" on public.calendar_events;
create policy "calendar_events_update_team"
on public.calendar_events for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists "calendar_events_delete_team" on public.calendar_events;
create policy "calendar_events_delete_team"
on public.calendar_events for delete to authenticated
using (public.is_team_member(team_id));

-- Let signed-in users use the table through the app (RLS above still limits
-- them to their own workspace). Needed on projects that don't auto-expose
-- new tables to the Data API.
grant select, insert, update, delete on public.calendar_events to authenticated;

-- Make the API notice the new table right away.
notify pgrst, 'reload schema';

-- Live updates for both users.
alter publication supabase_realtime add table public.calendar_events;
