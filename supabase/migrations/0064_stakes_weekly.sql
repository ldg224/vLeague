-- Stakes by the week (26 Oct 2026): a round has at most a handful of stakes (8 by default), picked from the best starters across all its matches, each one an
-- individual card on the page. Replaces "lines per club per match". Safe to re-run. Needs 0061 and 0063.
--
--   stakes_settings.lines_per_week   how many stakes a round has (default 8)
--   stakes_settings.lines_per_match  the most from one match, so the card set is spread across the round (default 2)
--   stakes_make_week(week)           makes a round's stakes: the most valuable starters first (a keeper is as likely as a striker), one stat each, within the two limits.
--                                    Stakes already made stay as they are; if only some line-ups are in, the rest are added as the other clubs submit.
-- (lines_per_club stays in the table, unused.)

-- The first time only: lines made the old way (per club per match) that nobody has picked on are dropped, so the coming rounds are made again under the weekly rule.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stakes_settings' and column_name = 'lines_per_week') then
    delete from public.stakes_lines l using public.fixtures f where l.fixture = f.id and f.starts_at > now() and not exists (select 1 from public.stakes_picks k where k.line_id = l.id);
  end if;
end $$;

alter table public.stakes_settings add column if not exists lines_per_week int not null default 8 check (lines_per_week between 1 and 24);
alter table public.stakes_settings add column if not exists lines_per_match int not null default 2 check (lines_per_match between 1 and 6);

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_week', 'lines_per_match', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
begin
  if not public.is_office() then raise exception 'only the league office can change Stakes settings'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  select * into c from public.stakes_settings where id = 1 for update;
  update public.stakes_settings set
    visible         = coalesce((p ->> 'visible')::boolean, visible),
    betting_open    = coalesce((p ->> 'betting_open')::boolean, betting_open),
    start_coins     = coalesce((p ->> 'start_coins')::int, start_coins),
    daily_topup     = coalesce((p ->> 'daily_topup')::int, daily_topup),
    bailout_below   = coalesce((p ->> 'bailout_below')::int, bailout_below),
    bailout_to      = coalesce((p ->> 'bailout_to')::int, bailout_to),
    multiplier      = coalesce((p ->> 'multiplier')::numeric, multiplier),
    min_stake       = coalesce((p ->> 'min_stake')::int, min_stake),
    max_stake       = coalesce((p ->> 'max_stake')::int, max_stake),
    lines_per_week  = coalesce((p ->> 'lines_per_week')::int, lines_per_week),
    lines_per_match = coalesce((p ->> 'lines_per_match')::int, lines_per_match),
    stats           = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'stats') x), stats),
    line_adjust     = coalesce((p ->> 'line_adjust')::int, line_adjust),
    lock_minutes    = coalesce((p ->> 'lock_minutes')::int, lock_minutes),
    lines_days      = coalesce((p ->> 'lines_days')::int, lines_days),
    show_board      = coalesce((p ->> 'show_board')::boolean, show_board),
    updated_at      = now()
  where id = 1 returning * into c;
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01 or over 10, a stat that is not offered...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

drop function if exists public.stakes_make_lines(text);

create or replace function public.stakes_make_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); have int; need int; n int := 0; r record; usual numeric; per_match int;
begin
  if not c.betting_open then return 0; end if;
  select count(*)::int into have from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week;
  need := c.lines_per_week - have;
  if need <= 0 then return 0; end if;
  for r in
    with open_fx as (
      select f.id, f.home, f.away, f.week from public.fixtures f
      where f.week = p_week and not f.postponed and f.starts_at is not null and f.starts_at - make_interval(mins => c.lock_minutes) > now()
    ), clubs as (
      select o.id as fixture, x.club from open_fx o cross join lateral (values (o.home), (o.away)) x(club)
    ), sheets as (
      select cl.fixture, cl.club,
             coalesce((select ws.lineup from public.week_sheets ws where ws.week = p_week and ws.club = cl.club and ws.lineup <> '{}'::jsonb),
                      (select s.sheet -> 'lineup' from public.submitted_sheets s where s.week = p_week and s.club = cl.club)) as lineup
      from clubs cl
    ), starters as (
      select sh.fixture, p.id as player_id, p.position, p.value,
             case p.position when 'GK' then 'sv' when 'FWD' then 'sot' when 'DEF' then 'tk' else 'pas' end as stat
      from sheets sh, jsonb_each_text(sh.lineup) e join public.players p on p.id = e.value
      where sh.lineup is not null and sh.lineup <> '{}'::jsonb
    )
    select s.* from starters s
    where s.stat = any (c.stats) and not exists (select 1 from public.stakes_lines l where l.fixture = s.fixture and l.player_id = s.player_id)
    order by s.value desc, s.player_id
  loop
    exit when n >= need;
    select count(*)::int into per_match from public.stakes_lines where fixture = r.fixture;
    if per_match >= c.lines_per_match then continue; end if;
    usual := public.stakes_usual(r.player_id, r.position, r.stat);
    insert into public.stakes_lines (fixture, player_id, stat, line)
    values (r.fixture, r.player_id, r.stat, greatest(0.5, floor(usual * (1 + c.line_adjust / 100.0)) + 0.5))
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_make_week(int) from public, anon, authenticated;

drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
  line_id bigint, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric,
  my_side text, my_stake int, my_status text, my_mult numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); w int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for w in select distinct x.week from public.fixtures x where x.starts_at > now() and x.starts_at <= now() + make_interval(days => c.lines_days) and not x.postponed order by 1 loop
    perform public.stakes_make_week(w);
  end loop;
  return query
    select l.id, f.id, f.week, f.home, f.away, f.starts_at, f.starts_at - make_interval(mins => c.lock_minutes), l.player_id, p.name, p.club, p.position, l.stat, l.line,
           round(public.stakes_usual(l.player_id, p.position, l.stat), 1),
           k.side, k.stake, k.status, k.mult
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    join public.players p on p.id = l.player_id
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + make_interval(days => c.lines_days) and not f.postponed
    order by f.week, f.starts_at, p.value desc, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;
