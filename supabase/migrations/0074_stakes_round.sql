-- Stakes by the round, with more stats and an honest expected figure (2 Nov 2026). Safe to re-run. Needs 0061 to 0073.
--
--   1. More stats: forwards can be offered goals ('g'), shots on target ('sot') or shots ('sh'), so a round is not all one stat. Which one a forward gets is spread
--      across the round (by his id and the week), and only the stats ticked in Editor > Stakes are used.
--   2. A round's stakes appear lines_days (7) days before the round's FIRST kick-off, from the club's squad when no team sheet is in yet (a player who then does not
--      play is refunded, as before), and the whole round locks when its first game starts (minus the lock setting), not game by game.
--   3. The expected figure for a card (stakes_usual_info) is the player's rate per 90 minutes over EVERY game he has played, preseason included, blended with his
--      position's rate until he has two games' worth of minutes. The card shows how many games it rests on and how many were preseason.
--   4. Stakes made but not yet picked on for a coming round are dropped once, so they are made again under these rules.

-- ---------------------------------------------------------------- stats
alter table public.stakes_lines drop constraint if exists stakes_lines_stat_check;
alter table public.stakes_lines add constraint stakes_lines_stat_check check (stat in ('sv', 'pas', 'sot', 'tk', 'g', 'sh'));
alter table public.stakes_settings drop constraint if exists stakes_settings_stats_check;
alter table public.stakes_settings add constraint stakes_settings_stats_check check (stats <@ array['sv', 'pas', 'sot', 'tk', 'g', 'sh'] and cardinality(stats) >= 1);
alter table public.stakes_settings alter column stats set default array['sv', 'pas', 'sot', 'tk', 'g', 'sh'];
update public.stakes_settings set stats = (select array_agg(distinct x) from unnest(stats || array['g', 'sh']) x), lines_days = 7 where id = 1 and not (stats @> array['g', 'sh']);

-- ---------------------------------------------------------------- the round's lock
-- The moment a round's picks close: its first kick-off, less the lock setting. Null when no game of the round has a time.
create or replace function public.stakes_round_lock(p_week int) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(f.starts_at) - make_interval(mins => (select lock_minutes from public.stakes_settings where id = 1))
  from public.fixtures f where f.week = p_week and not f.postponed and f.starts_at is not null
$$;
revoke all on function public.stakes_round_lock(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- the expected figure
-- val: expected for a full 90 minutes. His own total for the stat over every game he played (preseason too), plus the position's rate worth 180 minutes, over
-- his minutes plus 180, times 90. n = games he played, pre = how many of those were preseason, mins = minutes played.
--   own       2 games' worth of minutes (180) or more: mostly his own
--   blend     some minutes, fewer than 180: his own, steadied by his position
--   position  no minutes yet: the position's rate per 90
--   default   nobody in his position has played: a fixed start
drop function if exists public.stakes_slate();
drop function if exists public.stakes_usual(text, text, text);
drop function if exists public.stakes_usual_info(text, text, text);
create function public.stakes_usual_info(p_player text, p_pos text, p_stat text) returns table (val numeric, n int, src text, pre int, mins int)
language plpgsql stable security definer set search_path = public as $$
declare own_stat numeric; own_min numeric; c int; pc int; pos_stat numeric; pos_min numeric; prior numeric; k constant numeric := 180;
  fallback numeric := case p_stat when 'sv' then 3.5 when 'sot' then 1.5 when 'tk' then 2.5 when 'g' then 0.5 when 'sh' then 3 else 32.5 end;
begin
  select coalesce(sum(coalesce((v.value ->> p_stat)::numeric, 0)), 0), coalesce(sum((v.value ->> 'min')::numeric), 0), count(*)::int,
         count(*) filter (where exists (select 1 from public.rounds rn where rn.week = f.week and rn.kind = 'preseason'))::int
    into own_stat, own_min, c, pc
  from public.results r join public.fixtures f on f.id = r.fixture, jsonb_each(r.summary -> 'players') v(key, value)
  where v.key = p_player and coalesce((v.value ->> 'min')::numeric, 0) > 0;
  select sum(coalesce((v.value ->> p_stat)::numeric, 0)), sum((v.value ->> 'min')::numeric) into pos_stat, pos_min
  from public.results r, jsonb_each(r.summary -> 'players') v(key, value)
  join public.players pl on pl.id = v.key
  where pl.position = p_pos and coalesce((v.value ->> 'min')::numeric, 0) > 0;
  if coalesce(pos_min, 0) >= 90 then prior := pos_stat / pos_min * 90; end if;
  if own_min > 0 then
    return query select (own_stat + coalesce(prior, fallback) / 90 * k) / (own_min + k) * 90, c, (case when own_min >= k then 'own' else 'blend' end)::text, pc, own_min::int;
  elsif prior is not null then return query select prior, 0, 'position'::text, 0, 0;
  else return query select fallback, 0, 'default'::text, 0, 0; end if;
end $$;
revoke all on function public.stakes_usual_info(text, text, text) from public, anon, authenticated;

create function public.stakes_usual(p_player text, p_pos text, p_stat text) returns numeric
language sql stable security definer set search_path = public as $$ select val from public.stakes_usual_info(p_player, p_pos, p_stat) $$;
revoke all on function public.stakes_usual(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- making a round's stakes
create or replace function public.stakes_make_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); lk timestamptz := public.stakes_round_lock(p_week); have int; need int; added int := 0; r record; usual numeric; per_match int;
begin
  if not c.betting_open or lk is null or lk <= now() then return 0; end if;
  if exists (select 1 from public.rounds where week = p_week and kind = 'preseason') then return 0; end if;   -- preseason rounds have no stakes
  if lk - make_interval(days => c.lines_days) > now() then return 0; end if;                                  -- not out yet: lines_days before the first game
  -- every open match gets a win / draw / win pick for the game predictors; they never count towards the round's limit
  if c.score_all then
    insert into public.stakes_lines (fixture, kind, featured)
    select f.id, 'result', false from public.fixtures f
    where f.week = p_week and not f.postponed and f.starts_at is not null
      and not exists (select 1 from public.stakes_lines l where l.fixture = f.id and l.kind in ('score', 'result'))
    on conflict do nothing;
  end if;
  select count(*)::int into have from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week and l.kind = 'player';
  need := c.lines_per_week - have;
  if need <= 0 then return 0; end if;
  for r in
    with open_fx as (
      select f.id, f.home, f.away from public.fixtures f where f.week = p_week and not f.postponed and f.starts_at is not null
    ), clubs as (
      select o.id as fixture, x.club from open_fx o cross join lateral (values (o.home), (o.away)) x(club)
    ), sheets as (
      select cl.fixture, cl.club,
             coalesce((select ws.lineup from public.week_sheets ws where ws.week = p_week and ws.club = cl.club and ws.lineup <> '{}'::jsonb),
                      (select s.sheet -> 'lineup' from public.submitted_sheets s where s.week = p_week and s.club = cl.club)) as lineup
      from clubs cl
    ), pool as (
      -- a submitted team sheet gives the starters; until it is in, the whole squad is the pool (a player who does not start is refunded)
      select sh.fixture, p.id as player_id, p.position, p.value
      from sheets sh, jsonb_each_text(sh.lineup) e join public.players p on p.id = e.value
      where sh.lineup is not null and sh.lineup <> '{}'::jsonb
      union all
      select sh.fixture, p.id, p.position, p.value
      from sheets sh join public.players p on p.club = sh.club
      where sh.lineup is null or sh.lineup = '{}'::jsonb
    ), picked as (
      select po.*, o.opts[1 + abs(hashtext(po.player_id || ':' || p_week)) % cardinality(o.opts)] as stat
      from pool po
      cross join lateral (select array(select s from unnest(case po.position when 'GK' then array['sv'] when 'DEF' then array['tk'] when 'MID' then array['pas'] else array['sot', 'g', 'sh'] end) s
                                       where s = any (c.stats)) as opts) o
      where cardinality(o.opts) > 0
    )
    select s.* from picked s
    where not exists (select 1 from public.stakes_lines l where l.fixture = s.fixture and l.player_id = s.player_id)
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
  return added;
end $$;
revoke all on function public.stakes_make_week(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- picks close when the round starts
create or replace function public.stakes_place(p_line bigint, p_side text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint; lk timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_side not in ('over', 'under') then raise exception 'pick over or under'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if exists (select 1 from public.rounds where week = f.week and kind = 'preseason') then raise exception 'Stakes is only for the real season, not preseason'; end if;
  select l.kind into kd from public.stakes_lines l where l.id = p_line;
  if kd <> 'player' then raise exception 'this one is a win, draw or win pick'; end if;
  lk := public.stakes_round_lock(f.week);
  if lk is null or lk <= now() or f.postponed then raise exception 'picks for this round have closed'; end if;
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

create or replace function public.stakes_place_result(p_line bigint, p_result text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint; mult numeric; lk timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_result not in ('home', 'draw', 'away') then raise exception 'pick a home win, a draw or an away win'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if exists (select 1 from public.rounds where week = f.week and kind = 'preseason') then raise exception 'Stakes is only for the real season, not preseason'; end if;
  select l.kind into kd from public.stakes_lines l where l.id = p_line;
  if kd <> 'result' then raise exception 'this one is not a win, draw or win pick'; end if;
  lk := public.stakes_round_lock(f.week);
  if lk is null or lk <= now() or f.postponed then raise exception 'picks for this round have closed'; end if;
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

create or replace function public.stakes_cancel(p_line bigint) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k public.stakes_picks; f public.fixtures; lk timestamptz;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into k from public.stakes_picks where user_id = me and line_id = p_line and status = 'open' for update;
  if not found then raise exception 'no open pick on this line'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  lk := public.stakes_round_lock(f.week);
  if lk is null or lk <= now() then raise exception 'picks for this round have closed'; end if;
  delete from public.stakes_picks where id = k.id;
  return public.stakes_move(me, k.stake, 'cancel', k.id);
end $$;

-- ---------------------------------------------------------------- the slate
-- A round is on the page from lines_days before its first game until all its games are played. Every card of it shows the same lock time.
create function public.stakes_slate() returns table (
  line_id bigint, kind text, featured boolean, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric, usual_n int, usual_src text, usual_pre int, usual_mins int,
  my_side text, my_result text, my_home int, my_away int, my_stake int, my_status text, my_mult numeric, my_mult2 numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); w int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for w in select x.week from public.fixtures x where not x.postponed and x.starts_at is not null group by x.week
           having min(x.starts_at) > now() and min(x.starts_at) - make_interval(days => c.lines_days) <= now() order by 1 loop
    perform public.stakes_make_week(w);
  end loop;
  return query
    with live as (
      select x.week as wk, public.stakes_round_lock(x.week) as lk from public.fixtures x
      where not x.postponed and x.starts_at is not null and not exists (select 1 from public.rounds r where r.week = x.week and r.kind = 'preseason')
      group by x.week
      having min(x.starts_at) - make_interval(days => c.lines_days) <= now()
         and bool_or(not exists (select 1 from public.results rs where rs.fixture = x.id))
    )
    select l.id, l.kind, l.featured, f.id, f.week, f.home, f.away, f.starts_at, lv.lk,
           l.player_id, p.name, p.club, p.position, l.stat, l.line,
           round(ui.val, 1), ui.n, ui.src, ui.pre, ui.mins,
           k.side, k.result, k.pred_home, k.pred_away, k.stake, k.status, k.mult, k.mult2
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    join live lv on lv.wk = f.week
    left join public.players p on p.id = l.player_id
    left join lateral public.stakes_usual_info(l.player_id, p.position, l.stat) ui on l.kind = 'player'
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where not f.postponed and (l.kind = 'player' or c.score_all)
    order by f.week, l.kind desc, p.value desc nulls last, f.starts_at, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;

-- ---------------------------------------------------------------- history carries the player's id so a name can open his popup
drop function if exists public.stakes_history(int);
create function public.stakes_history(p_limit int default 40) returns table (
  line_id bigint, kind text, fixture text, home text, away text, starts_at timestamptz, player_name text, team text, stat text, line numeric,
  side text, result text, pred_home int, pred_away int, act_home int, act_away int, stake int, status text, actual numeric, payout int, settled_at timestamptz, player_id text)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, f.id, f.home, f.away, f.starts_at, p.name, p.club, l.stat, l.line, k.side, k.result, k.pred_home, k.pred_away, k.act_home, k.act_away, k.stake, k.status, k.actual, k.payout, k.settled_at, l.player_id
  from public.stakes_picks k
  join public.stakes_lines l on l.id = k.line_id
  join public.fixtures f on f.id = l.fixture
  left join public.players p on p.id = l.player_id
  where k.user_id = auth.uid()
  order by k.created_at desc limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.stakes_history(int) from public, anon;
grant execute on function public.stakes_history(int) to authenticated;

-- ---------------------------------------------------------------- settling: a player who played but has no figure for the stat got 0
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
      v_actual := case when res is not null and coalesce((res -> k.player_id ->> 'min')::numeric, 0) > 0 then coalesce((res -> k.player_id ->> k.stat)::numeric, 0) end;   -- a stat the summary lacks counts as 0 for a player who played
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

-- ---------------------------------------------------------------- once: remake coming rounds' unpicked stakes under the new rules
delete from public.stakes_lines l using public.fixtures f
where l.fixture = f.id and l.kind = 'player' and public.stakes_round_lock(f.week) > now()
  and not exists (select 1 from public.stakes_picks k where k.line_id = l.id);
