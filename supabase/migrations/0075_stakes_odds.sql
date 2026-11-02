-- Game predictors priced by chance (2 Nov 2026): a win, draw or loss no longer pays the same 2.2x or 3x for every match. Each match gets a chance for home win, draw
-- and away win from the two clubs' strength, and pays about 1 / chance, less a small margin, so a heavy favourite pays little and a long shot pays a lot. Safe to re-run.
-- Needs 0061 to 0074.
--
--   A club's rating (in goals): its squad (the average value of its best 11 against the league's) plus its form (goal difference a game over every match played,
--   preseason too, steadied by four games of nothing). Home and away goals are then Poisson, with a home edge, and the chances come from the scores.
--   stakes_settings.result_margin    the league's cut, in percent (default 8): a fair 25% shot pays 3.68x, not 4x
--   stakes_settings.result_max_mult  the biggest payout, so a hopeless side is a long shot, not a lottery (default 15)
--   stakes_lines.p_*/mult_*          the chance and payout of home, draw and away; repriced each time the slate is read, until the round locks.
-- A pick keeps the payout it was placed at (stakes_picks.mult), as before. result_win_mult / result_draw_mult stay as the fallback only.

alter table public.stakes_settings add column if not exists result_margin int not null default 8 check (result_margin between 0 and 30);
alter table public.stakes_settings add column if not exists result_max_mult numeric(5, 1) not null default 15 check (result_max_mult between 2 and 100);
alter table public.stakes_lines add column if not exists p_home numeric(5, 4);
alter table public.stakes_lines add column if not exists p_draw numeric(5, 4);
alter table public.stakes_lines add column if not exists p_away numeric(5, 4);
alter table public.stakes_lines add column if not exists mult_home numeric(6, 2);
alter table public.stakes_lines add column if not exists mult_draw numeric(6, 2);
alter table public.stakes_lines add column if not exists mult_away numeric(6, 2);

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_week', 'lines_per_match', 'score_per_week', 'score_exact_mult', 'score_result_mult', 'result_win_mult', 'result_draw_mult', 'result_margin', 'result_max_mult', 'score_all', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
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
    result_margin     = coalesce((p ->> 'result_margin')::int, result_margin),
    result_max_mult   = coalesce((p ->> 'result_max_mult')::numeric, result_max_mult),
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
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01, a margin over 30%%...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

-- A club's rating, in goals: positive is better than a league-average side.
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
  where (f.home = p_club or f.away = p_club) and r.summary ->> 'home' is not null and r.summary ->> 'away' is not null;
  return 12 * (coalesce(mine, lg) / nullif(lg, 0) - 1) + 0.4 * gd / (n + 4);
end $$;
revoke all on function public.stakes_club_rating(text) from public, anon, authenticated;

-- The chances of a home win, a draw and an away win.
create or replace function public.stakes_result_odds(p_home text, p_away text) returns table (ph numeric, pd numeric, pa numeric)
language plpgsql stable security definer set search_path = public as $$
declare d numeric := public.stakes_club_rating(p_home) - public.stakes_club_rating(p_away); lh numeric := 1.45 * exp(d / 2.5); la numeric := 1.15 * exp(-d / 2.5);
  a numeric[]; b numeric[]; i int; j int; sh numeric := 0; sd numeric := 0; sa numeric := 0; tot numeric;
begin
  a[0] := exp(-lh); b[0] := exp(-la);
  for i in 1..12 loop a[i] := a[i - 1] * lh / i; b[i] := b[i - 1] * la / i; end loop;
  for i in 0..12 loop for j in 0..12 loop
    if i > j then sh := sh + a[i] * b[j]; elsif i = j then sd := sd + a[i] * b[j]; else sa := sa + a[i] * b[j]; end if;
  end loop; end loop;
  tot := sh + sd + sa;
  return query select sh / tot, sd / tot, sa / tot;
end $$;
revoke all on function public.stakes_result_odds(text, text) from public, anon, authenticated;

-- Price every result stake of a round that has not locked: the chances, and the payouts from them.
create or replace function public.stakes_price_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); r record; o record; n int := 0; keep numeric := 1 - c.result_margin / 100.0;
  lk timestamptz := public.stakes_round_lock(p_week);
begin
  if lk is null or lk <= now() then return 0; end if;
  for r in select l.id, f.home, f.away from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week and l.kind = 'result' loop
    select * into o from public.stakes_result_odds(r.home, r.away);
    update public.stakes_lines set p_home = round(o.ph, 4), p_draw = round(o.pd, 4), p_away = round(o.pa, 4),
      mult_home = least(c.result_max_mult, greatest(1.05, round(keep / greatest(o.ph, .0001), 2))),
      mult_draw = least(c.result_max_mult, greatest(1.05, round(keep / greatest(o.pd, .0001), 2))),
      mult_away = least(c.result_max_mult, greatest(1.05, round(keep / greatest(o.pa, .0001), 2)))
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_price_week(int) from public, anon, authenticated;

-- A result pick pays what the card showed, and keeps it.
create or replace function public.stakes_place_result(p_line bigint, p_result text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint; mult numeric; lk timestamptz; ln public.stakes_lines;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_result not in ('home', 'draw', 'away') then raise exception 'pick a home win, a draw or an away win'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if exists (select 1 from public.rounds where week = f.week and kind = 'preseason') then raise exception 'Stakes is only for the real season, not preseason'; end if;
  select * into ln from public.stakes_lines l where l.id = p_line;
  kd := ln.kind;
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
  if ln.mult_home is null then
    perform public.stakes_price_week(f.week);
    select * into ln from public.stakes_lines l where l.id = p_line;
  end if;
  mult := coalesce(case p_result when 'home' then ln.mult_home when 'away' then ln.mult_away else ln.mult_draw end,
                   case when p_result = 'draw' then c.result_draw_mult else c.result_win_mult end);
  insert into public.stakes_picks (user_id, line_id, result, stake, mult) values (me, p_line, p_result, p_stake, mult) returning id into pid;
  return public.stakes_move(me, -p_stake, 'stake', pid);
end $$;

-- The slate carries each match's chances and payouts.
drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
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
         and bool_or(not exists (select 1 from public.results rs where rs.fixture = x.id))
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
