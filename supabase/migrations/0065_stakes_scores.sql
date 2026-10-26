-- Stakes: guess the score (26 Oct 2026). Besides the over/under cards on players, some of a round's stakes are a match where you predict the final score.
-- Exact score pays the big multiplier, the right result (home win, draw or away win) with the wrong score pays the smaller one, anything else loses the stake.
-- Safe to re-run. Needs 0061, 0063 and 0064.
--
--   stakes_settings.score_per_week      how many of a round's stakes are score predictions (default 2; they count towards lines_per_week)
--   stakes_settings.score_exact_mult    payout for the exact score (default 8)
--   stakes_settings.score_result_mult   payout for the right result only (default 2)
--   stakes_lines.kind                   'player' (over/under) or 'score'; a score line has no player, stat or line
--   stakes_picks                        a score pick has pred_home and pred_away (and no side); it keeps both multipliers (mult, mult2) and the real score (act_home, act_away)
-- The matches that get a score stake are drawn at random when the round's stakes are made, and stay the same after that.

alter table public.stakes_settings add column if not exists score_per_week int not null default 2 check (score_per_week between 0 and 24);
alter table public.stakes_settings add column if not exists score_exact_mult numeric(5, 2) not null default 8.00 check (score_exact_mult between 1.01 and 100);
alter table public.stakes_settings add column if not exists score_result_mult numeric(4, 2) not null default 2.00 check (score_result_mult between 1.01 and 10);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stakes_settings_score_mult_order') then
    alter table public.stakes_settings add constraint stakes_settings_score_mult_order check (score_result_mult <= score_exact_mult);
  end if;
end $$;

alter table public.stakes_lines add column if not exists kind text not null default 'player' check (kind in ('player', 'score'));
alter table public.stakes_lines alter column player_id drop not null;
alter table public.stakes_lines alter column stat drop not null;
alter table public.stakes_lines alter column line drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stakes_lines_kind_shape') then
    alter table public.stakes_lines add constraint stakes_lines_kind_shape check (
      (kind = 'player' and player_id is not null and stat is not null and line is not null) or (kind = 'score' and player_id is null and stat is null and line is null));
  end if;
end $$;
create unique index if not exists stakes_lines_one_score on public.stakes_lines (fixture) where kind = 'score';

alter table public.stakes_picks alter column side drop not null;
alter table public.stakes_picks add column if not exists pred_home int;
alter table public.stakes_picks add column if not exists pred_away int;
alter table public.stakes_picks add column if not exists mult2 numeric(4, 2);
alter table public.stakes_picks add column if not exists act_home int;
alter table public.stakes_picks add column if not exists act_away int;
alter table public.stakes_picks drop constraint if exists stakes_picks_stake_check;
alter table public.stakes_picks add constraint stakes_picks_stake_check check (stake >= 1);   -- (the smallest stake is a setting, down to 1)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stakes_picks_kind_shape') then
    alter table public.stakes_picks add constraint stakes_picks_kind_shape check (
      (side is not null and pred_home is null and pred_away is null) or (side is null and pred_home between 0 and 20 and pred_away between 0 and 20));
  end if;
end $$;

-- ---------------------------------------------------------------- the office's controls

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_week', 'lines_per_match', 'score_per_week', 'score_exact_mult', 'score_result_mult', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
begin
  if not public.is_office() then raise exception 'only the league office can change Stakes settings'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  select * into c from public.stakes_settings where id = 1 for update;
  update public.stakes_settings set
    visible           = coalesce((p ->> 'visible')::boolean, visible),
    betting_open      = coalesce((p ->> 'betting_open')::boolean, betting_open),
    start_coins       = coalesce((p ->> 'start_coins')::int, start_coins),
    daily_topup       = coalesce((p ->> 'daily_topup')::int, daily_topup),
    bailout_below     = coalesce((p ->> 'bailout_below')::int, bailout_below),
    bailout_to        = coalesce((p ->> 'bailout_to')::int, bailout_to),
    multiplier        = coalesce((p ->> 'multiplier')::numeric, multiplier),
    min_stake         = coalesce((p ->> 'min_stake')::int, min_stake),
    max_stake         = coalesce((p ->> 'max_stake')::int, max_stake),
    lines_per_week    = coalesce((p ->> 'lines_per_week')::int, lines_per_week),
    lines_per_match   = coalesce((p ->> 'lines_per_match')::int, lines_per_match),
    score_per_week    = coalesce((p ->> 'score_per_week')::int, score_per_week),
    score_exact_mult  = coalesce((p ->> 'score_exact_mult')::numeric, score_exact_mult),
    score_result_mult = coalesce((p ->> 'score_result_mult')::numeric, score_result_mult),
    stats             = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'stats') x), stats),
    line_adjust       = coalesce((p ->> 'line_adjust')::int, line_adjust),
    lock_minutes      = coalesce((p ->> 'lock_minutes')::int, lock_minutes),
    lines_days        = coalesce((p ->> 'lines_days')::int, lines_days),
    show_board        = coalesce((p ->> 'show_board')::boolean, show_board),
    updated_at        = now()
  where id = 1 returning * into c;
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01, a right-result payout above the exact-score one...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------- making a round's stakes

create or replace function public.stakes_make_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); have int; need int; sc_have int; sc_need int; n int := 0; added int := 0; r record; usual numeric; per_match int;
begin
  if not c.betting_open then return 0; end if;
  -- the score predictions first: matches of the round drawn at random (they stay once drawn)
  select count(*)::int into sc_have from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week and l.kind = 'score';
  sc_need := least(c.score_per_week, c.lines_per_week) - sc_have;
  if sc_need > 0 then
    for r in
      select f.id from public.fixtures f
      where f.week = p_week and not f.postponed and f.starts_at is not null and f.starts_at - make_interval(mins => c.lock_minutes) > now()
        and not exists (select 1 from public.stakes_lines l where l.fixture = f.id and l.kind = 'score')
      order by random() limit sc_need
    loop
      insert into public.stakes_lines (fixture, kind) values (r.id, 'score') on conflict do nothing;
      if found then n := n + 1; end if;
    end loop;
  end if;
  -- then the players: the most valuable starters across the round, within the round and per-match limits
  select count(*)::int into have from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week;
  need := c.lines_per_week - have;
  if need <= 0 then return n; end if;
  for r in
      with open_fx as (
        select f.id, f.home, f.away from public.fixtures f
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
      exit when added >= need;
      select count(*)::int into per_match from public.stakes_lines where fixture = r.fixture;
      if per_match >= c.lines_per_match then continue; end if;
      usual := public.stakes_usual(r.player_id, r.position, r.stat);
      insert into public.stakes_lines (fixture, kind, player_id, stat, line)
      values (r.fixture, 'player', r.player_id, r.stat, greatest(0.5, floor(usual * (1 + c.line_adjust / 100.0)) + 0.5))
      on conflict do nothing;
      if found then added := added + 1; end if;
  end loop;
  return n + added;
end $$;
revoke all on function public.stakes_make_week(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- what the page reads

drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
  line_id bigint, kind text, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric,
  my_side text, my_home int, my_away int, my_stake int, my_status text, my_mult numeric, my_mult2 numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); w int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for w in select distinct x.week from public.fixtures x where x.starts_at > now() and x.starts_at <= now() + make_interval(days => c.lines_days) and not x.postponed order by 1 loop
    perform public.stakes_make_week(w);
  end loop;
  return query
    select l.id, l.kind, f.id, f.week, f.home, f.away, f.starts_at, f.starts_at - make_interval(mins => c.lock_minutes),
           l.player_id, p.name, p.club, p.position, l.stat, l.line,
           case when l.kind = 'player' then round(public.stakes_usual(l.player_id, p.position, l.stat), 1) end,
           k.side, k.pred_home, k.pred_away, k.stake, k.status, k.mult, k.mult2
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    left join public.players p on p.id = l.player_id
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + make_interval(days => c.lines_days) and not f.postponed
    order by f.week, f.starts_at, l.kind desc, p.value desc nulls last, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;

-- ---------------------------------------------------------------- picks

create or replace function public.stakes_place(p_line bigint, p_side text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_side not in ('over', 'under') then raise exception 'pick over or under'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  select l.kind into kd from public.stakes_lines l where l.id = p_line;
  if kd <> 'player' then raise exception 'this one is a score prediction'; end if;
  if f.starts_at is null or f.starts_at - make_interval(mins => c.lock_minutes) <= now() or f.postponed then raise exception 'this match is closed'; end if;
  perform 1 from public.stakes_wallets where user_id = me for update;
  if not found then raise exception 'open your wallet first'; end if;
  select coins into bal from public.stakes_wallets where user_id = me;
  if p_stake is null or p_stake < c.min_stake then raise exception 'the smallest stake is % Coins', c.min_stake; end if;
  if c.max_stake > 0 and p_stake > c.max_stake then raise exception 'the biggest stake is % Coins', c.max_stake; end if;
  if p_stake > bal then raise exception 'not enough Coins'; end if;
  if exists (select 1 from public.stakes_picks where user_id = me and line_id = p_line) then raise exception 'you already picked this line'; end if;
  insert into public.stakes_picks (user_id, line_id, side, stake, mult) values (me, p_line, p_side, p_stake, c.multiplier) returning id into pid;
  return public.stakes_move(me, -p_stake, 'stake', pid);
end $$;

create or replace function public.stakes_place_score(p_line bigint, p_home int, p_away int, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_home is null or p_away is null or p_home not between 0 and 20 or p_away not between 0 and 20 then raise exception 'predict a score from 0 to 20 for each side'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  select l.kind into kd from public.stakes_lines l where l.id = p_line;
  if kd <> 'score' then raise exception 'this one is an over/under'; end if;
  if f.starts_at is null or f.starts_at - make_interval(mins => c.lock_minutes) <= now() or f.postponed then raise exception 'this match is closed'; end if;
  perform 1 from public.stakes_wallets where user_id = me for update;
  if not found then raise exception 'open your wallet first'; end if;
  select coins into bal from public.stakes_wallets where user_id = me;
  if p_stake is null or p_stake < c.min_stake then raise exception 'the smallest stake is % Coins', c.min_stake; end if;
  if c.max_stake > 0 and p_stake > c.max_stake then raise exception 'the biggest stake is % Coins', c.max_stake; end if;
  if p_stake > bal then raise exception 'not enough Coins'; end if;
  if exists (select 1 from public.stakes_picks where user_id = me and line_id = p_line) then raise exception 'you already predicted this match'; end if;
  insert into public.stakes_picks (user_id, line_id, pred_home, pred_away, stake, mult, mult2) values (me, p_line, p_home, p_away, p_stake, c.score_exact_mult, c.score_result_mult) returning id into pid;
  return public.stakes_move(me, -p_stake, 'stake', pid);
end $$;
revoke all on function public.stakes_place_score(bigint, int, int, int) from public, anon;
grant execute on function public.stakes_place_score(bigint, int, int, int) to authenticated;

-- ---------------------------------------------------------------- settling

create or replace function public.stakes_settle(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare res jsonb; sm jsonb; k record; won boolean; n int := 0; pay int; v_actual numeric; ah int; aa int; exact boolean; right_result boolean;
begin
  select summary into sm from public.results where fixture = p_fixture;
  if sm is null then return 0; end if;
  res := sm -> 'players'; ah := (sm ->> 'home')::int; aa := (sm ->> 'away')::int;
  for k in
    select pk.id, pk.user_id, pk.side, pk.stake, pk.mult, pk.mult2, pk.pred_home, pk.pred_away, l.kind, l.player_id, l.stat, l.line
    from public.stakes_picks pk join public.stakes_lines l on l.id = pk.line_id
    where l.fixture = p_fixture and pk.status = 'open' for update of pk
  loop
    if k.kind = 'score' then
      if ah is null or aa is null then
        update public.stakes_picks set status = 'void', payout = k.stake, settled_at = now() where id = k.id;
        perform public.stakes_move(k.user_id, k.stake, 'void', k.id);
      else
        exact := k.pred_home = ah and k.pred_away = aa;
        right_result := sign(k.pred_home - k.pred_away) = sign(ah - aa);
        pay := case when exact then floor(k.stake * k.mult)::int when right_result then floor(k.stake * k.mult2)::int else 0 end;
        update public.stakes_picks set status = case when pay > 0 then 'won' else 'lost' end, act_home = ah, act_away = aa, payout = pay, settled_at = now() where id = k.id;
        if pay > 0 then perform public.stakes_move(k.user_id, pay, case when exact then 'win' else 'win' end, k.id); end if;
      end if;
    else
      v_actual := case when res is not null and coalesce((res -> k.player_id ->> 'min')::numeric, 0) > 0 then (res -> k.player_id ->> k.stat)::numeric end;
      if v_actual is null then
        update public.stakes_picks set status = 'void', payout = k.stake, settled_at = now() where id = k.id;
        perform public.stakes_move(k.user_id, k.stake, 'void', k.id);
      else
        won := (k.side = 'over' and v_actual > k.line) or (k.side = 'under' and v_actual < k.line);
        pay := case when won then floor(k.stake * k.mult)::int else 0 end;
        update public.stakes_picks set status = case when won then 'won' else 'lost' end, actual = v_actual, payout = pay, settled_at = now() where id = k.id;
        if won then perform public.stakes_move(k.user_id, pay, 'win', k.id); end if;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_settle(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- history

drop function if exists public.stakes_history(int);
create function public.stakes_history(p_limit int default 40) returns table (
  line_id bigint, kind text, fixture text, home text, away text, starts_at timestamptz, player_name text, team text, stat text, line numeric,
  side text, pred_home int, pred_away int, act_home int, act_away int, stake int, status text, actual numeric, payout int, settled_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, f.id, f.home, f.away, f.starts_at, p.name, p.club, l.stat, l.line, k.side, k.pred_home, k.pred_away, k.act_home, k.act_away, k.stake, k.status, k.actual, k.payout, k.settled_at
  from public.stakes_picks k
  join public.stakes_lines l on l.id = k.line_id
  join public.fixtures f on f.id = l.fixture
  left join public.players p on p.id = l.player_id
  where k.user_id = auth.uid()
  order by k.created_at desc limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.stakes_history(int) from public, anon;
grant execute on function public.stakes_history(int) to authenticated;
