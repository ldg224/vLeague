-- 0.63: SUBMIT a team sheet for a round. The team sheet still saves as a draft as you edit (team_sheets, team_sheet_versions);
-- pressing SUBMIT and picking an upcoming round stores that sheet for that round. When the round locks, a submitted sheet is
-- used; without one, the latest draft from before the deadline is used, exactly as before (the user's decisions, 10 Oct 2026).
-- A club can submit ahead for any round it plays that hasn't locked, and change or withdraw a submission until it locks.
-- Needs 0006 (deadlines, week_sheets, lock_due_weeks), 0044 (kit).

create table if not exists public.submitted_sheets (
  club         text not null references public.clubs (code) on update cascade on delete cascade,
  week         int  not null check (week between 1 and 99),
  sheet        jsonb not null check (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) < 16000),
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  primary key (club, week)
);
alter table public.submitted_sheets enable row level security;
drop policy if exists submitted_sheets_read on public.submitted_sheets;
create policy submitted_sheets_read on public.submitted_sheets for select to authenticated
  using (public.is_office() or club = public.my_club());
revoke all on public.submitted_sheets from anon, authenticated;
grant select on public.submitted_sheets to authenticated;   -- writes only through the two functions below

alter table public.week_sheets add column if not exists submitted boolean not null default false;

-- Submit (or replace) your club's sheet for a round. The round must be one your club plays, with a deadline still to come.
create or replace function public.submit_team_sheet(p_week int, p_sheet jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare me text := public.my_club(); d public.deadlines; at timestamptz := now();
begin
  if me is null then raise exception 'Your account isn''t linked to a club.'; end if;
  if p_sheet is null or jsonb_typeof(p_sheet) <> 'object' or jsonb_typeof(coalesce(p_sheet->'lineup', '{}')) <> 'object' then
    raise exception 'That team sheet isn''t complete.';
  end if;
  select * into d from public.deadlines where week = p_week;
  if d.week is null then raise exception 'That round has no deadline yet, so it can''t take a team sheet.'; end if;
  if d.locked_at is not null or d.locks_at <= now() then raise exception 'That round has locked: its team sheets can''t change.'; end if;
  if not exists (select 1 from public.fixtures where week = p_week and me in (home, away) and not coalesce(postponed, false)) then
    raise exception 'Your club doesn''t play in that round.';
  end if;
  insert into public.submitted_sheets (club, week, sheet, submitted_at, submitted_by) values (me, p_week, p_sheet, at, auth.uid())
  on conflict (club, week) do update set sheet = excluded.sheet, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by;
  return at;
end $$;
revoke all on function public.submit_team_sheet(int, jsonb) from public, anon;
grant execute on function public.submit_team_sheet(int, jsonb) to authenticated;

-- Take a submission back (the round then uses the latest draft again), until the round locks.
create or replace function public.withdraw_team_sheet(p_week int) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_club(); d public.deadlines;
begin
  if me is null then raise exception 'Your account isn''t linked to a club.'; end if;
  select * into d from public.deadlines where week = p_week;
  if d.locked_at is not null or d.locks_at <= now() then raise exception 'That round has locked: its team sheets can''t change.'; end if;
  delete from public.submitted_sheets where club = me and week = p_week;
end $$;
revoke all on function public.withdraw_team_sheet(int) from public, anon;
grant execute on function public.withdraw_team_sheet(int) to authenticated;

-- Locking a round: a club's submitted sheet for it wins; otherwise its last draft saved before the deadline (as before 0.63).
create or replace function public.lock_due_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, kit, saved_at, submitted)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', nullif(v.sheet->>'kit', ''), v.saved_at, v.submitted
    from (
      select s.club, s.sheet, s.submitted_at as saved_at, true as submitted
      from public.submitted_sheets s where s.week = d.week and s.submitted_at <= d.locks_at
      union all
      select * from (select distinct on (tv.club) tv.club, tv.sheet, tv.saved_at, false
                     from public.team_sheet_versions tv where tv.saved_at <= d.locks_at order by tv.club, tv.saved_at desc) latest
      where not exists (select 1 from public.submitted_sheets s where s.week = d.week and s.club = latest.club and s.submitted_at <= d.locks_at)
    ) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;
