-- 0.13: the season planner. A round (one per week) has a name, a look and a line-up lock rule; a match window is a block of
-- games inside a round with its own start and gap between games; the line-up deadline for a week is worked out from its
-- first kick-off (the user's decisions, 5 October 2026: one lock per week; finals later).

-- Looks: named scoreboard designs, stored as data so a new one is a new row. Unknown looks fall back to 'classic'.
create table if not exists public.looks (
  key      text primary key check (key ~ '^[a-z0-9_]{2,24}$'),
  name     text not null,
  settings jsonb not null default '{}'::jsonb      -- accent, banner text, ornament... read by the scoreboards
);
insert into public.looks (key, name, settings) values
  ('classic',     'Classic',     '{"accent": null, "banner": null}'),
  ('finals',      'Finals',      '{"accent": "#f5c542", "banner": "FINALS"}'),
  ('grand_final', 'Grand Final', '{"accent": "#ffd700", "banner": "GRAND FINAL"}'),
  ('christmas',   'Christmas',   '{"accent": "#e53935", "banner": "CHRISTMAS ROUND", "ornament": "🎄"}'),
  ('derby',       'Derby',       '{"accent": "#ff7043", "banner": "DERBY"}')
on conflict (key) do nothing;

create table if not exists public.rounds (
  week        int primary key check (week between 1 and 99),
  name        text check (name is null or char_length(name) <= 40),
  kind        text not null default 'regular' check (kind in ('regular', 'special', 'finals')),
  look        text not null default 'classic' references public.looks (key) on update cascade,
  lock_minutes_before int not null default 180 check (lock_minutes_before between 0 and 20160),  -- before the week's first kick-off
  lock_at_override timestamptz                       -- set to pick the lock time by hand
);

create table if not exists public.match_windows (
  id          bigint generated always as identity primary key,
  week        int  not null references public.rounds (week) on update cascade on delete cascade,
  label       text check (label is null or char_length(label) <= 40),
  starts_at   timestamptz not null,
  gap_minutes int  not null default 90 check (gap_minutes between 0 and 1440),
  look        text references public.looks (key) on update cascade   -- null = the round's look
);
alter table public.fixtures add column if not exists window_id bigint references public.match_windows (id) on delete set null;

alter table public.looks enable row level security;
alter table public.rounds enable row level security;
alter table public.match_windows enable row level security;
do $$ declare t text; begin
  foreach t in array array['looks', 'rounds', 'match_windows'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('drop policy if exists %I_office_write on public.%I', t, t);
    execute format('create policy %I_office_write on public.%I for all to authenticated using (public.is_office()) with check (public.is_office())', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.match_windows_id_seq to authenticated;

-- A week's line-up deadline = its first kick-off minus the round's lock rule (or the hand-picked time). Kept in the
-- existing `deadlines` table so the lock job from 0.6 needs no change. A week that has already locked is left alone.
create or replace function public.sync_week_deadline(p_week int) returns void
language plpgsql security definer set search_path = public as $$
declare first_ko timestamptz; r record; at timestamptz;
begin
  select min(starts_at) into first_ko from public.fixtures where week = p_week and starts_at is not null and not postponed;
  select * into r from public.rounds where week = p_week;
  if first_ko is null and r.lock_at_override is null then
    delete from public.deadlines where week = p_week and locked_at is null;
    return;
  end if;
  at := coalesce(r.lock_at_override, first_ko - make_interval(mins => coalesce(r.lock_minutes_before, 180)));
  insert into public.deadlines (week, locks_at) values (p_week, at)
  on conflict (week) do update set locks_at = excluded.locks_at where public.deadlines.locked_at is null;
end $$;
revoke all on function public.sync_week_deadline(int) from public, anon, authenticated;

create or replace function public.sync_deadline_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.sync_week_deadline(old.week); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.sync_week_deadline(new.week); end if;
  return null;
end $$;
revoke all on function public.sync_deadline_trigger() from public, anon, authenticated;
drop trigger if exists fixtures_sync_deadline on public.fixtures;
create trigger fixtures_sync_deadline after insert or update of week, starts_at, postponed or delete on public.fixtures
  for each row execute function public.sync_deadline_trigger();
drop trigger if exists rounds_sync_deadline on public.rounds;
create trigger rounds_sync_deadline after insert or update or delete on public.rounds
  for each row execute function public.sync_deadline_trigger();
