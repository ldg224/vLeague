-- 0.6: weekly line-up deadlines (the user's decision, 1 October 2026).
-- The league office sets a deadline for each week. At the deadline every club's team sheet is copied into
-- week_sheets: that copy is what Simulate uses for the week, and it's public from then on (the reveal).
-- Managers can keep editing team_sheets at any time; after week N locks, their changes count for week N+1.
-- Exact to the second: every save is kept in team_sheet_versions, and a week takes each club's last save from
-- before its deadline, even if the lock job runs a little late. Times are timestamptz; the league is in
-- Australia/Melbourne, and the Editor enters deadlines in the office's own (Melbourne) time.

-- ---------------------------------------------------------------- deadlines

create table if not exists public.deadlines (
  week       int primary key check (week between 1 and 99),
  locks_at   timestamptz not null,
  locked_at  timestamptz,                         -- when the sheets were copied; null until then
  created_at timestamptz not null default now()
);

alter table public.deadlines enable row level security;
drop policy if exists deadlines_read on public.deadlines;
create policy deadlines_read on public.deadlines for select to anon, authenticated using (true);
drop policy if exists deadlines_office_write on public.deadlines;
create policy deadlines_office_write on public.deadlines for all to authenticated
  using (public.is_office()) with check (public.is_office());
grant select on public.deadlines to anon, authenticated;
grant insert, update, delete on public.deadlines to authenticated;

-- A locked week can't be moved, re-locked or deleted (its sheets are what the matches were played with).
create or replace function public.guard_deadline() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then raise exception 'Week % is already locked.', old.week; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.locked_at is not null and current_user <> 'postgres' then
    raise exception 'Week % is already locked.', old.week;
  end if;
  if tg_op = 'INSERT' then new.locked_at := null; end if;
  if tg_op = 'UPDATE' and current_user <> 'postgres' then new.locked_at := old.locked_at; end if;
  return new;
end $$;
drop trigger if exists deadlines_guard on public.deadlines;
create trigger deadlines_guard before insert or update or delete on public.deadlines
  for each row execute function public.guard_deadline();

-- ---------------------------------------------------------------- every save of a team sheet

create table if not exists public.team_sheet_versions (
  id       bigint generated always as identity primary key,
  club     text not null references public.clubs (code) on update cascade on delete cascade,
  sheet    jsonb not null,
  saved_at timestamptz not null default clock_timestamp()
);
create index if not exists team_sheet_versions_club on public.team_sheet_versions (club, saved_at desc);
alter table public.team_sheet_versions enable row level security;
drop policy if exists team_sheet_versions_office on public.team_sheet_versions;
create policy team_sheet_versions_office on public.team_sheet_versions for select to authenticated using (public.is_office());

create or replace function public.keep_team_sheet_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_sheet_versions (club, sheet)
  values (new.club, jsonb_build_object('formation', new.formation, 'tactics', new.tactics, 'lineup', new.lineup,
    'bench', new.bench, 'captain', new.captain, 'penalties', new.penalties, 'freekicks', new.freekicks, 'corners', new.corners));
  return new;
end $$;
drop trigger if exists team_sheets_version on public.team_sheets;
create trigger team_sheets_version after insert or update on public.team_sheets
  for each row execute function public.keep_team_sheet_version();

-- Sheets saved before this migration get a starting version, dated when they were last saved.
insert into public.team_sheet_versions (club, sheet, saved_at)
select s.club, jsonb_build_object('formation', s.formation, 'tactics', s.tactics, 'lineup', s.lineup, 'bench', s.bench,
  'captain', s.captain, 'penalties', s.penalties, 'freekicks', s.freekicks, 'corners', s.corners), s.updated_at
from public.team_sheets s
where not exists (select 1 from public.team_sheet_versions v where v.club = s.club);

-- ---------------------------------------------------------------- the locked sheets (public: the reveal)

create table if not exists public.week_sheets (
  week      int not null references public.deadlines (week) on delete restrict,
  club      text not null references public.clubs (code) on update cascade on delete cascade,
  formation text,
  tactics   jsonb not null default '{}'::jsonb,
  lineup    jsonb not null default '{}'::jsonb,
  bench     jsonb not null default '[]'::jsonb,
  captain   text,
  penalties text,
  freekicks text,
  corners   text,
  saved_at  timestamptz,                          -- when the manager last saved it before the deadline
  locked_at timestamptz not null default now(),
  primary key (week, club)
);
alter table public.week_sheets enable row level security;
drop policy if exists week_sheets_read on public.week_sheets;
create policy week_sheets_read on public.week_sheets for select to anon, authenticated using (true);
grant select on public.week_sheets to anon, authenticated;
-- Nobody writes week_sheets directly; only lock_due_weeks() (security definer) does.

-- Copy every club's last save before each passed, unlocked deadline. Clubs that never saved get no row
-- (the engine picks their team). Safe to run any time, as often as you like.
create or replace function public.lock_due_weeks() returns int
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, saved_at)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', v.saved_at
    from (select distinct on (club) club, sheet, saved_at from public.team_sheet_versions
          where saved_at <= d.locks_at order by club, saved_at desc) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lock_due_weeks() from public, anon, authenticated;

-- Run it every minute.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'vleague-lock-weeks';
select cron.schedule('vleague-lock-weeks', '* * * * *', 'select public.lock_due_weeks();');
