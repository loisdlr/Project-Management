-- ============================================================
-- DualFlow — Monthly accomplishment report upgrade
-- Run this ONCE in Supabase Dashboard -> SQL Editor.
-- Safe to run more than once.
-- ============================================================

-- When a card was completed, and what was accomplished.
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists accomplishment text not null default '';

-- Backfill cards that are already Done with their last edit time.
update public.tasks
set completed_at = updated_at
where status = 'Done' and completed_at is null;

-- Record the completion time automatically whenever a card moves to Done,
-- and clear it if the card is reopened.
create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Done' then
    if tg_op = 'INSERT' then
      new.completed_at = coalesce(new.completed_at, now());
    elsif old.status is distinct from 'Done' then
      new.completed_at = now();
    end if;
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at
before insert or update on public.tasks
for each row execute procedure public.set_task_completed_at();

create index if not exists tasks_assignee_completed_idx
  on public.tasks (team_id, assignee_id, completed_at);

-- Per-user report header: logos, program title, positions, "Noted by".
alter table public.profiles add column if not exists report_settings jsonb not null default '{}'::jsonb;
