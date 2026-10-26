-- Stakes: the game predictors are now Team A win, Draw or Team B win (26 Oct 2026), like FotMob's Predict, instead of an exact score. Safe to re-run. Needs 0061 to 0068.
--
--   stakes_lines.kind               'player' (over/under), 'result' (win, draw or win for a match) or 'score' (the old exact-score predictions, kept so none is lost)
--   stakes_picks.result             'home', 'draw' or 'away' for a result pick; the pick keeps the multiplier it was placed at (mult)
--   stakes_settings.result_win_mult   payout for calling a win right (default 2.2); result_draw_mult for calling a draw right (default 3.0)
--   stakes_settings.score_all         still the switch for the game predictors section
-- The score predictions already made are left alone; the matches that had one get a result stake instead, and a new result stake never needs a player.

alter table public.stakes_settings add column if not exists result_win_mult numeric(4, 2) not null default 2.20 check (result_win_mult between 1.01 and 20);
alter table public.stakes_settings add column if not exists result_draw_mult numeric(4, 2) not null default 3.00 check (result_draw_mult between 1.01 and 20);

alter table public.stakes_lines drop constraint if exists stakes_lines_kind_check;
alter table public.stakes_lines add constraint stakes_lines_kind_check check (kind in ('player', 'score', 'result'));
alter table public.stakes_lines drop constraint if exists stakes_lines_kind_shape;
alter table public.stakes_lines add constraint stakes_lines_kind_shape check (
  (kind = 'player' and player_id is not null and stat is not null and line is not null) or (kind in ('score', 'result') and player_id is null and stat is null and line is null));
drop index if exists public.stakes_lines_one_score;
create unique index if not exists stakes_lines_one_per_match on public.stakes_lines (fixture) where kind in ('score', 'result');

alter table public.stakes_picks add column if not exists result text check (result in ('home', 'draw', 'away'));
alter table public.stakes_picks drop constraint if exists stakes_picks_kind_shape;
alter table public.stakes_picks add constraint stakes_picks_kind_shape check (
  (side is not null and pred_home is null and pred_away is null and result is null)
  or (side is null and pred_home between 0 and 20 and pred_away between 0 and 20 and result is null)
  or (side is null and pred_home is null and pred_away is null and result is not null));

-- the matches that had a score line and nobody has predicted become result stakes
update public.stakes_lines l set kind = 'result' where kind = 'score' and not exists (select 1 from public.stakes_picks k where k.line_id = l.id);

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_week', 'lines_per_match', 'score_per_week', 'score_exact_mult', 'score_result_mult', 'result_win_mult', 'result_draw_mult', 'score_all', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
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
    result_win_mult   = coalesce((p ->> 'result_win_mult')::numeric, result_win_mult),
    result_draw_mult  = coalesce((p ->> 'result_draw_mult')::numeric, result_draw_mult),
    score_all         = coalesce((p ->> 'score_all')::boolean, score_all),
    stats             = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'stats') x), stats),
    line_adjust       = coalesce((p ->> 'line_adjust')::int, line_adjust),
    lock_minutes      = coalesce((p ->> 'lock_minutes')::int, lock_minutes),
    lines_days        = coalesce((p ->> 'lines_days')::int, lines_days),
    show_board        = coalesce((p ->> 'show_board')::boolean, show_board),
    updated_at        = now()
  where id = 1 returning * into c;
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01, a payout under 1.01...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

create or replace function public.stakes_make_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); have int; need int; n int := 0; added int := 0; r record; usual numeric; per_match int;
begin
  if not c.betting_open then return 0; end if;
  -- every open match of the round gets a result stake (win, draw or win) for the game predictors section; they never count towards the round's limit
  if c.score_all then
    insert into public.stakes_lines (fixture, kind, featured)
    select f.id, 'result', false from public.fixtures f
    where f.week = p_week and not f.postponed and f.starts_at is not null and f.starts_at - make_interval(mins => c.lock_minutes) > now()
      and not exists (select 1 from public.stakes_lines l where l.fixture = f.id and l.kind in ('score', 'result'))
    on conflict do nothing;
  end if;
  -- then the players: the most valuable starters across the round, within the round and per-match limits
  select count(*)::int into have from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week and l.kind = 'player';
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
      select count(*)::int into per_match from public.stakes_lines where fixture = r.fixture and kind = 'player';
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

create or replace function public.stakes_place_result(p_line bigint, p_result text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint; mult numeric;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_result not in ('home', 'draw', 'away') then raise exception 'pick a home win, a draw or an away win'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  select l.kind into kd from public.stakes_lines l where l.id = p_line;
  if kd <> 'result' then raise exception 'this one is not a win, draw or win pick'; end if;
  if f.starts_at is null or f.starts_at - make_interval(mins => c.lock_minutes) <= now() or f.postponed then raise exception 'this match is closed'; end if;
  perform 1 from public.stakes_wallets where user_id = me for update;
  if not found then raise exception 'open your wallet first'; end if;
  select coins into bal from public.stakes_wallets where user_id = me;
  if p_stake is null or p_stake < c.min_stake then raise exception 'the smallest stake is % Coins', c.min_stake; end if;
  if c.max_stake > 0 and p_stake > c.max_stake then raise exception 'the biggest stake is % Coins', c.max_stake; end if;
  if p_stake > bal then raise exception 'not enough Coins'; end if;
  if exists (select 1 from public.stakes_picks where user_id = me and line_id = p_line) then raise exception 'you already picked this match'; end if;
  mult := case when p_result = 'draw' then c.result_draw_mult else c.result_win_mult end;
  insert into public.stakes_picks (user_id, line_id, result, stake, mult) values (me, p_line, p_result, p_stake, mult) returning id into pid;
  return public.stakes_move(me, -p_stake, 'stake', pid);
end $$;
revoke all on function public.stakes_place_result(bigint, text, int) from public, anon;
grant execute on function public.stakes_place_result(bigint, text, int) to authenticated;

-- the over/under and the old score placers refuse a result line (they already check their own kind)

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
  if kd <> 'player' then raise exception 'this one is a win, draw or win pick'; end if;
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
revoke all on function public.stakes_place(bigint, text, int) from public, anon;
grant execute on function public.stakes_place(bigint, text, int) to authenticated;

create or replace function public.stakes_settle(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare res jsonb; sm jsonb; k record; won boolean; n int := 0; pay int; v_actual numeric; ah int; aa int; exact boolean; right_result boolean;
begin
  select summary into sm from public.results where fixture = p_fixture;
  if sm is null then return 0; end if;
  res := sm -> 'players'; ah := (sm ->> 'home')::int; aa := (sm ->> 'away')::int;
  for k in
    select pk.id, pk.user_id, pk.side, pk.result, pk.stake, pk.mult, pk.mult2, pk.pred_home, pk.pred_away, l.kind, l.player_id, l.stat, l.line
    from public.stakes_picks pk join public.stakes_lines l on l.id = pk.line_id
    where l.fixture = p_fixture and pk.status = 'open' for update of pk
  loop
    if k.kind = 'result' then
      if ah is null or aa is null then
        update public.stakes_picks set status = 'void', payout = k.stake, settled_at = now() where id = k.id;
        perform public.stakes_move(k.user_id, k.stake, 'void', k.id);
      else
        won := k.result = case when ah > aa then 'home' when ah < aa then 'away' else 'draw' end;
        pay := case when won then floor(k.stake * k.mult)::int else 0 end;
        update public.stakes_picks set status = case when won then 'won' else 'lost' end, act_home = ah, act_away = aa, payout = pay, settled_at = now() where id = k.id;
        if won then perform public.stakes_move(k.user_id, pay, 'win', k.id); end if;
      end if;
    elsif k.kind = 'score' then
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

drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
  line_id bigint, kind text, featured boolean, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric, usual_n int, usual_src text,
  my_side text, my_result text, my_home int, my_away int, my_stake int, my_status text, my_mult numeric, my_mult2 numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); w int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for w in select distinct x.week from public.fixtures x where x.starts_at > now() and x.starts_at <= now() + make_interval(days => c.lines_days) and not x.postponed order by 1 loop
    perform public.stakes_make_week(w);
  end loop;
  return query
    select l.id, l.kind, l.featured, f.id, f.week, f.home, f.away, f.starts_at, f.starts_at - make_interval(mins => c.lock_minutes),
           l.player_id, p.name, p.club, p.position, l.stat, l.line,
           round(ui.val, 1), ui.n, ui.src,
           k.side, k.result, k.pred_home, k.pred_away, k.stake, k.status, k.mult, k.mult2
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    left join public.players p on p.id = l.player_id
    left join lateral public.stakes_usual_info(l.player_id, p.position, l.stat) ui on l.kind = 'player'
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + make_interval(days => c.lines_days) and not f.postponed and (l.kind = 'player' or c.score_all)
    order by f.week, f.starts_at, l.kind desc, p.value desc nulls last, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;

drop function if exists public.stakes_history(int);
create function public.stakes_history(p_limit int default 40) returns table (
  line_id bigint, kind text, fixture text, home text, away text, starts_at timestamptz, player_name text, team text, stat text, line numeric,
  side text, result text, pred_home int, pred_away int, act_home int, act_away int, stake int, status text, actual numeric, payout int, settled_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, f.id, f.home, f.away, f.starts_at, p.name, p.club, l.stat, l.line, k.side, k.result, k.pred_home, k.pred_away, k.act_home, k.act_away, k.stake, k.status, k.actual, k.payout, k.settled_at
  from public.stakes_picks k
  join public.stakes_lines l on l.id = k.line_id
  join public.fixtures f on f.id = l.fixture
  left join public.players p on p.id = l.player_id
  where k.user_id = auth.uid()
  order by k.created_at desc limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.stakes_history(int) from public, anon;
grant execute on function public.stakes_history(int) to authenticated;
