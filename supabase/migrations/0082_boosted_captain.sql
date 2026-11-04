-- Boosted captain (S-33, the user's rules, 4 Nov 2026): a manager can switch on a boost when submitting a team sheet. 5 uses a season, finals
-- included, never in preseason. A use counts while its round is coming up or its match was played with the boost; a postponed match, or a
-- captain who couldn't play (the match file says no boost), gives it back. A random XI has no boost.
-- The switch lives in the submitted sheet (private until the lock; submitted_lineups and all_submitted_lineups never hand it out), then
-- in week_sheets.boost from the lock on. Each new season's fixtures start the count again, as uses are counted from the fixtures that exist.
-- Additive and safe to re-run. Needs 0048, 0080.

alter table public.week_sheets add column if not exists boost boolean not null default false;

-- Is the boost on in this sheet? Only with a captain who is in the XI.
create or replace function public.sheet_boosted(p_sheet jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_sheet->'boost' = 'true'::jsonb, false) and exists (
    select 1 from jsonb_each_text(coalesce(p_sheet->'lineup', '{}')) x where x.value = p_sheet->>'captain')
$$;

-- The rounds a club's boost uses are spent on (or held for, while the round hasn't locked).
create or replace function public.boost_weeks(p_club text) returns table (week int)
language sql stable security definer set search_path = public as $$
  select w.week from public.week_sheets w
  where w.club = p_club and w.boost and exists (
    select 1 from public.fixtures f left join public.results r on r.fixture = f.id
    where f.week = w.week and p_club in (f.home, f.away) and not coalesce(f.postponed, false)
      and (r.fixture is null or coalesce(r.summary->'boosted', '[]') ? p_club))
  union
  select s.week from public.submitted_sheets s join public.deadlines d on d.week = s.week
  where s.club = p_club and d.locked_at is null and public.sheet_boosted(s.sheet) and exists (
    select 1 from public.fixtures f where f.week = s.week and p_club in (f.home, f.away) and not coalesce(f.postponed, false))
$$;
revoke all on function public.boost_weeks(text) from public, anon, authenticated;

-- A manager's own count, for the switch on the team sheet.
create or replace function public.my_boost_weeks() returns table (week int)
language sql stable security definer set search_path = public as $$
  select b.week from public.boost_weeks(public.my_club()) b
$$;
revoke all on function public.my_boost_weeks() from public, anon;
grant execute on function public.my_boost_weeks() to authenticated;

-- As 0048, and a sheet with the boost on must be allowed it.
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
  if p_sheet->'boost' = 'true'::jsonb then
    if not public.sheet_boosted(p_sheet) then raise exception 'Boosted Captain needs a captain in your XI.'; end if;
    if exists (select 1 from public.rounds r where r.week = p_week and r.kind = 'preseason') then
      raise exception 'Boosted Captain can''t be used in preseason.';
    end if;
    if (select count(*) from public.boost_weeks(me) b where b.week <> p_week) >= 5 then
      raise exception 'You''ve used all 5 Boosted Captain uses this season.';
    end if;
  end if;
  insert into public.submitted_sheets (club, week, sheet, submitted_at, submitted_by) values (me, p_week, p_sheet, at, auth.uid())
  on conflict (club, week) do update set sheet = excluded.sheet, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by;
  return at;
end $$;
revoke all on function public.submit_team_sheet(int, jsonb) from public, anon;
grant execute on function public.submit_team_sheet(int, jsonb) to authenticated;

-- As 0080, and the boost is copied across from the submitted sheet. A random XI never has one.
create or replace function public.lock_due_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, kit, saved_at, submitted, random, boost)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', nullif(v.sheet->>'kit', ''), v.saved_at, v.submitted, not v.submitted, v.submitted and public.sheet_boosted(v.sheet)
    from (
      select s.club, s.sheet, s.submitted_at as saved_at, true as submitted
      from public.submitted_sheets s where s.week = d.week and s.submitted_at <= d.locks_at
      union all
      select c.code, public.random_week_sheet(c.code), d.locks_at, false
      from public.clubs c
      where exists (select 1 from public.fixtures f where f.week = d.week and c.code in (f.home, f.away) and not coalesce(f.postponed, false))
        and not exists (select 1 from public.submitted_sheets s where s.week = d.week and s.club = c.code and s.submitted_at <= d.locks_at)
        and exists (select 1 from public.players p where p.club = c.code)
    ) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lock_due_weeks() from public, anon, authenticated;
