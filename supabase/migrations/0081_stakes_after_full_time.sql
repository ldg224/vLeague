-- Stakes keeps unplayed matches secret (4 Nov 2026). Safe to re-run. Needs 0061 to 0078.
--
-- A result is saved before its match is played, and the rule on the results table hides it until kick-off. The Stakes functions run as security definer, so that rule does
-- not bind them, and none of them looked at the clock. That let a saved result reach managers early in three ways:
--   1. The expected figure on a card (and the position average under it) added up every saved result, so it counted games not played yet.
--   2. Saving a result settled its picks at once: the real score or stat appeared in a manager's history, and Coins and the leaderboard moved.
--   3. A round left the page as soon as all its results were saved, played or not.
-- A match now counts only once it is over, for all three. "Over" is full time as the site shows it, not kick-off: a match plays live for 45 minutes
-- (live_minutes in js/dashboard-data.js: KEEP THE TWO IN STEP), and showing the final score at kick-off would spoil it.
-- A result saved in advance settles by the vleague-stakes-settle job, within a minute of full time. A result saved after full time settles when it is saved, as before.

create or replace function public.stakes_match_over(p_starts_at timestamptz, p_postponed boolean) returns boolean
language sql stable set search_path = public as $$
  select p_starts_at is not null and not coalesce(p_postponed, false) and p_starts_at + interval '45 minutes' <= now()
$$;
revoke all on function public.stakes_match_over(timestamptz, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- the expected figure: only matches that are over
create or replace function public.stakes_usual_info(p_player text, p_pos text, p_stat text) returns table (val numeric, n int, src text, pre int, mins int)
language plpgsql stable security definer set search_path = public as $$
declare own_stat numeric; own_min numeric; c int; pc int; pos_stat numeric; pos_min numeric; prior numeric; k constant numeric := 180;
  fallback numeric := case p_stat when 'sv' then 3.5 when 'sot' then 1.5 when 'tk' then 2.5 when 'g' then 0.5 when 'sh' then 3 else 32.5 end;
begin
  select coalesce(sum(coalesce((v.value ->> p_stat)::numeric, 0)), 0), coalesce(sum((v.value ->> 'min')::numeric), 0), count(*)::int,
         count(*) filter (where exists (select 1 from public.rounds rn where rn.week = f.week and rn.kind = 'preseason'))::int
    into own_stat, own_min, c, pc
  from public.results r join public.fixtures f on f.id = r.fixture, jsonb_each(r.summary -> 'players') v(key, value)
  where v.key = p_player and coalesce((v.value ->> 'min')::numeric, 0) > 0 and public.stakes_match_over(f.starts_at, f.postponed);
  select sum(coalesce((v.value ->> p_stat)::numeric, 0)), sum((v.value ->> 'min')::numeric) into pos_stat, pos_min
  from public.results r join public.fixtures f on f.id = r.fixture, jsonb_each(r.summary -> 'players') v(key, value)
  join public.players pl on pl.id = v.key
  where pl.position = p_pos and coalesce((v.value ->> 'min')::numeric, 0) > 0 and public.stakes_match_over(f.starts_at, f.postponed);
  if coalesce(pos_min, 0) >= 90 then prior := pos_stat / pos_min * 90; end if;
  if own_min > 0 then
    return query select (own_stat + coalesce(prior, fallback) / 90 * k) / (own_min + k) * 90, c, (case when own_min >= k then 'own' else 'blend' end)::text, pc, own_min::int;
  elsif prior is not null then return query select prior, 0, 'position'::text, 0, 0;
  else return query select fallback, 0, 'default'::text, 0, 0; end if;
end $$;
revoke all on function public.stakes_usual_info(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- a club's form (the fallback price): only matches that are over
create or replace function public.stakes_club_rating(p_club text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare mine numeric; lg numeric; gd numeric; n int;
begin
  with top as (select club, value, row_number() over (partition by club order by value desc) rn from public.players where club is not null),
       t as (select club, avg(value) v from top where rn <= 11 group by club)
  select (select v from t where club = p_club), avg(v) into mine, lg from t;
  select coalesce(sum(case when f.home = p_club then (r.summary ->> 'home')::int - (r.summary ->> 'away')::int else (r.summary ->> 'away')::int - (r.summary ->> 'home')::int end), 0), count(*)::int
    into gd, n
  from public.results r join public.fixtures f on f.id = r.fixture
  where (f.home = p_club or f.away = p_club) and r.summary ->> 'home' is not null and r.summary ->> 'away' is not null and public.stakes_match_over(f.starts_at, f.postponed);
  return 6 * (coalesce(mine, lg) / nullif(lg, 0) - 1) + 0.3 * gd / (n + 6);
end $$;
revoke all on function public.stakes_club_rating(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- settling: never before full time
create or replace function public.stakes_settle(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare res jsonb; sm jsonb; k record; won boolean; n int := 0; pay int; v_actual numeric; ah int; aa int; exact boolean; right_result boolean;
begin
  if not exists (select 1 from public.fixtures f where f.id = p_fixture and public.stakes_match_over(f.starts_at, f.postponed)) then return 0; end if;
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

-- Settles every match that has reached full time with a saved result and open picks. One match going wrong does not hold up the others.
create or replace function public.stakes_settle_due() returns int
language plpgsql security definer set search_path = public as $$
declare fx text; n int := 0;
begin
  for fx in
    select distinct f.id from public.stakes_picks k
    join public.stakes_lines l on l.id = k.line_id
    join public.fixtures f on f.id = l.fixture
    join public.results r on r.fixture = f.id
    where k.status = 'open' and public.stakes_match_over(f.starts_at, f.postponed)
  loop
    begin
      n := n + public.stakes_settle(fx);
    exception when others then
      raise warning 'stakes_settle_due: % failed: %', fx, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_settle_due() from public, anon, authenticated;

select cron.schedule('vleague-stakes-settle', '* * * * *', 'select public.stakes_settle_due();');

-- ---------------------------------------------------------------- the slate: a round stays on the page until every game is over and has its result
create or replace function public.stakes_slate() returns table (
  line_id bigint, kind text, featured boolean, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric, usual_n int, usual_src text, usual_pre int, usual_mins int,
  mult_home numeric, mult_draw numeric, mult_away numeric, p_home numeric, p_draw numeric, p_away numeric,
  my_side text, my_result text, my_home int, my_away int, my_stake int, my_status text, my_mult numeric, my_mult2 numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); w int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for w in select x.week from public.fixtures x where not x.postponed and x.starts_at is not null group by x.week
           having min(x.starts_at) > now() and min(x.starts_at) - make_interval(days => c.lines_days) <= now() order by 1 loop
    perform public.stakes_make_week(w);
    perform public.stakes_price_week(w);
  end loop;
  return query
    with live as (
      select x.week as wk, public.stakes_round_lock(x.week) as lk from public.fixtures x
      where not x.postponed and x.starts_at is not null and not exists (select 1 from public.rounds r where r.week = x.week and r.kind = 'preseason')
      group by x.week
      having min(x.starts_at) - make_interval(days => c.lines_days) <= now()
         and bool_or(not public.stakes_match_over(x.starts_at, x.postponed) or not exists (select 1 from public.results rs where rs.fixture = x.id))
    )
    select l.id, l.kind, l.featured, f.id, f.week, f.home, f.away, f.starts_at, lv.lk,
           l.player_id, p.name, p.club, p.position, l.stat, l.line,
           round(ui.val, 1), ui.n, ui.src, ui.pre, ui.mins,
           l.mult_home, l.mult_draw, l.mult_away, l.p_home, l.p_draw, l.p_away,
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
