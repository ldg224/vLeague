-- Stakes settings (26 Oct 2026): the numbers 0061 wrote into the functions now live in one row the Editor changes, and the Stakes tab has a visibility switch.
-- Safe to re-run. Needs 0061. The tab starts HIDDEN (visible = false) until the office switches it on.
--
--   stakes_settings        one row (id = 1): visible, betting_open, start_coins, daily_topup, bailout_below, bailout_to, multiplier, min_stake, max_stake (0 = no limit),
--                          lines_per_club, stats offered, line_adjust (% harder or easier), lock_minutes, lines_days, show_board
--   stakes_save_settings   the office saves any of them (checked, in one go)
--   stakes_reset           the office puts every wallet back to the starting Coins and takes back open picks
-- A pick keeps the multiplier it was placed at (stakes_picks.mult), so changing the payout never changes picks already made.

create table if not exists public.stakes_settings (
  id             int primary key default 1 check (id = 1),
  visible        boolean not null default false,
  betting_open   boolean not null default true,
  start_coins    int not null default 1000 check (start_coins between 0 and 1000000),
  daily_topup    int not null default 200 check (daily_topup between 0 and 100000),
  bailout_below  int not null default 100 check (bailout_below between 0 and 100000),
  bailout_to     int not null default 100 check (bailout_to between 0 and 100000),
  multiplier     numeric(4, 2) not null default 1.90 check (multiplier between 1.01 and 10),
  min_stake      int not null default 10 check (min_stake between 1 and 100000),
  max_stake      int not null default 0 check (max_stake between 0 and 1000000),
  lines_per_club int not null default 3 check (lines_per_club between 1 and 6),
  stats          text[] not null default array['sv', 'pas', 'sot', 'tk'] check (stats <@ array['sv', 'pas', 'sot', 'tk'] and cardinality(stats) >= 1),
  line_adjust    int not null default 0 check (line_adjust between -30 and 30),
  lock_minutes   int not null default 0 check (lock_minutes between 0 and 1440),
  lines_days     int not null default 7 check (lines_days between 1 and 28),
  show_board     boolean not null default true,
  updated_at     timestamptz not null default now(),
  check (max_stake = 0 or max_stake >= min_stake)
);
insert into public.stakes_settings (id) values (1) on conflict (id) do nothing;
alter table public.stakes_settings enable row level security;
drop policy if exists stakes_settings_read on public.stakes_settings;
create policy stakes_settings_read on public.stakes_settings for select to authenticated using (true);
revoke all on public.stakes_settings from anon, authenticated;
grant select on public.stakes_settings to authenticated;

alter table public.stakes_picks add column if not exists mult numeric(4, 2) not null default 1.90;

create or replace function public.stakes_cfg() returns public.stakes_settings
language sql stable security definer set search_path = public as $$ select * from public.stakes_settings where id = 1 $$;
revoke all on function public.stakes_cfg() from public, anon, authenticated;

create or replace function public.stakes_multiplier() returns numeric
language sql stable security definer set search_path = public as $$ select multiplier from public.stakes_settings where id = 1 $$;
revoke all on function public.stakes_multiplier() from public, anon, authenticated;

-- ---------------------------------------------------------------- the office's controls

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_club', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
begin
  if not public.is_office() then raise exception 'only the league office can change Stakes settings'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  select * into c from public.stakes_settings where id = 1 for update;
  update public.stakes_settings set
    visible        = coalesce((p ->> 'visible')::boolean, visible),
    betting_open   = coalesce((p ->> 'betting_open')::boolean, betting_open),
    start_coins    = coalesce((p ->> 'start_coins')::int, start_coins),
    daily_topup    = coalesce((p ->> 'daily_topup')::int, daily_topup),
    bailout_below  = coalesce((p ->> 'bailout_below')::int, bailout_below),
    bailout_to     = coalesce((p ->> 'bailout_to')::int, bailout_to),
    multiplier     = coalesce((p ->> 'multiplier')::numeric, multiplier),
    min_stake      = coalesce((p ->> 'min_stake')::int, min_stake),
    max_stake      = coalesce((p ->> 'max_stake')::int, max_stake),
    lines_per_club = coalesce((p ->> 'lines_per_club')::int, lines_per_club),
    stats          = coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'stats') x), stats),
    line_adjust    = coalesce((p ->> 'line_adjust')::int, line_adjust),
    lock_minutes   = coalesce((p ->> 'lock_minutes')::int, lock_minutes),
    lines_days     = coalesce((p ->> 'lines_days')::int, lines_days),
    show_board     = coalesce((p ->> 'show_board')::boolean, show_board),
    updated_at     = now()
  where id = 1 returning * into c;
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01 or over 10, a stat that is not offered...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

-- Every wallet back to the starting Coins (or the amount given); open picks are taken back (their lines stay). Returns how many wallets.
create or replace function public.stakes_reset(p_coins int default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); target int; w record; n int := 0;
begin
  if not public.is_office() then raise exception 'only the league office can reset wallets'; end if;
  target := coalesce(p_coins, c.start_coins);
  if target < 0 or target > 1000000 then raise exception 'pick an amount from 0 to 1,000,000'; end if;
  delete from public.stakes_picks where status = 'open';
  for w in select user_id, coins from public.stakes_wallets for update loop
    update public.stakes_wallets set coins = target, claimed_on = (now() at time zone 'Australia/Melbourne')::date where user_id = w.user_id;
    insert into public.stakes_ledger (user_id, delta, reason, balance_after) values (w.user_id, target - w.coins, 'reset', target);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_reset(int) from public, anon;
grant execute on function public.stakes_reset(int) to authenticated;

-- ---------------------------------------------------------------- the wallet

create or replace function public.stakes_wallet() returns table (coins int, claimed_today boolean, bonus int)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); today date := (now() at time zone 'Australia/Melbourne')::date; w public.stakes_wallets; got int := 0; b int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  insert into public.stakes_wallets (user_id, coins, claimed_on) values (me, c.start_coins, today) on conflict (user_id) do nothing;
  if found then
    insert into public.stakes_ledger (user_id, delta, reason, balance_after) values (me, c.start_coins, 'welcome', c.start_coins);
  end if;
  select * into w from public.stakes_wallets where user_id = me for update;
  if w.claimed_on is distinct from today then
    if c.daily_topup > 0 then perform public.stakes_move(me, c.daily_topup, 'daily'); got := c.daily_topup; end if;
    update public.stakes_wallets set claimed_on = today where user_id = me;
  end if;
  select sw.coins into b from public.stakes_wallets sw where sw.user_id = me;
  if c.bailout_to > 0 and b < c.bailout_below and b < c.bailout_to and not exists (select 1 from public.stakes_picks where user_id = me and status = 'open') then
    perform public.stakes_move(me, c.bailout_to - b, 'bailout');
    got := got + (c.bailout_to - b);
  end if;
  return query select sw.coins, got = 0, got from public.stakes_wallets sw where sw.user_id = me;
end $$;

-- ---------------------------------------------------------------- lines

create or replace function public.stakes_make_lines(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare f public.fixtures; c public.stakes_settings := public.stakes_cfg(); c_club text; lu jsonb; n int := 0; r record; st text; usual numeric; keepers int;
begin
  if not c.betting_open then return 0; end if;
  select * into f from public.fixtures where id = p_fixture;
  if not found or f.starts_at is null or f.starts_at - make_interval(mins => c.lock_minutes) <= now() or f.postponed then return 0; end if;
  keepers := case when 'sv' = any (c.stats) then 1 else 0 end;
  for c_club in select unnest(array[f.home, f.away]) loop
    -- A club's lines are made once, when its line-up is in; the other club's can come later (its manager may submit after the first).
    if exists (select 1 from public.stakes_lines l join public.players pl on pl.id = l.player_id where l.fixture = p_fixture and pl.club = c_club) then continue; end if;
    select ws.lineup into lu from public.week_sheets ws where ws.week = f.week and ws.club = c_club and ws.lineup <> '{}'::jsonb;
    if lu is null then
      select s.sheet -> 'lineup' into lu from public.submitted_sheets s where s.week = f.week and s.club = c_club;
    end if;
    if lu is null or lu = '{}'::jsonb then continue; end if;
    for r in
      with xi as (
        select p.id, p.position, p.value,
               case p.position when 'GK' then 'sv' when 'FWD' then 'sot' when 'DEF' then 'tk' else 'pas' end as stat
        from jsonb_each_text(lu) e join public.players p on p.id = e.value
      ), keeper as (
        select id, position, value, stat from xi where position = 'GK' and stat = any (c.stats) order by value desc limit keepers
      ), outfield as (
        select id, position, value, stat from xi where position <> 'GK' and stat = any (c.stats) order by value desc limit greatest(0, c.lines_per_club - keepers)
      )
      select * from keeper union all select * from outfield
    loop
      usual := public.stakes_usual(r.id, r.position, r.stat);
      insert into public.stakes_lines (fixture, player_id, stat, line)
      values (p_fixture, r.id, r.stat, greatest(0.5, floor(usual * (1 + c.line_adjust / 100.0)) + 0.5))
      on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
  line_id bigint, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric,
  my_side text, my_stake int, my_status text, my_mult numeric)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); fx text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.visible and not public.is_office() then raise exception 'Stakes is not open yet'; end if;
  for fx in select x.id from public.fixtures x where x.starts_at > now() and x.starts_at <= now() + make_interval(days => c.lines_days) and not x.postponed loop
    perform public.stakes_make_lines(fx);
  end loop;
  return query
    select l.id, f.id, f.week, f.home, f.away, f.starts_at, f.starts_at - make_interval(mins => c.lock_minutes), l.player_id, p.name, p.club, p.position, l.stat, l.line,
           k.side, k.stake, k.status, k.mult
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    join public.players p on p.id = l.player_id
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + make_interval(days => c.lines_days) and not f.postponed
    order by f.starts_at, f.id, p.club, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;

-- ---------------------------------------------------------------- picks

create or replace function public.stakes_place(p_line bigint, p_side text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; bal int; pid bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_side not in ('over', 'under') then raise exception 'pick over or under'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
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

create or replace function public.stakes_cancel(p_line bigint) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); k public.stakes_picks; f public.fixtures;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into k from public.stakes_picks where user_id = me and line_id = p_line and status = 'open' for update;
  if not found then raise exception 'no open pick on this line'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if f.starts_at is null or f.starts_at - make_interval(mins => c.lock_minutes) <= now() then raise exception 'this match is closed'; end if;
  delete from public.stakes_picks where id = k.id;
  return public.stakes_move(me, k.stake, 'cancel', k.id);
end $$;

-- ---------------------------------------------------------------- settling and the board

create or replace function public.stakes_settle(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare res jsonb; k record; won boolean; n int := 0; pay int; v_actual numeric;
begin
  select summary -> 'players' into res from public.results where fixture = p_fixture;
  if res is null then return 0; end if;
  for k in
    select pk.id, pk.user_id, pk.side, pk.stake, pk.mult, l.player_id, l.stat, l.line
    from public.stakes_picks pk join public.stakes_lines l on l.id = pk.line_id
    where l.fixture = p_fixture and pk.status = 'open' for update of pk
  loop
    v_actual := case when coalesce((res -> k.player_id ->> 'min')::numeric, 0) > 0 then (res -> k.player_id ->> k.stat)::numeric end;
    if v_actual is null then
      update public.stakes_picks set status = 'void', payout = k.stake, settled_at = now() where id = k.id;
      perform public.stakes_move(k.user_id, k.stake, 'void', k.id);
    else
      won := (k.side = 'over' and v_actual > k.line) or (k.side = 'under' and v_actual < k.line);
      pay := case when won then floor(k.stake * k.mult)::int else 0 end;
      update public.stakes_picks set status = case when won then 'won' else 'lost' end, actual = v_actual, payout = pay, settled_at = now() where id = k.id;
      if won then perform public.stakes_move(k.user_id, pay, 'win', k.id); end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.stakes_board() returns table (rank bigint, club text, name text, coins int, won int, settled int, mine boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by w.coins desc), pr.club, coalesce(pr.display_name, 'Manager'), w.coins,
         (select count(*)::int from public.stakes_picks k where k.user_id = w.user_id and k.status = 'won'),
         (select count(*)::int from public.stakes_picks k where k.user_id = w.user_id and k.status in ('won', 'lost')),
         w.user_id = auth.uid()
  from public.stakes_wallets w join public.profiles pr on pr.id = w.user_id
  where auth.uid() is not null and pr.role = 'manager' and (select show_board from public.stakes_settings where id = 1)
  order by 1, 3
$$;
revoke all on function public.stakes_board() from public, anon;
grant execute on function public.stakes_board() to authenticated;

-- A few numbers for the Editor's Stakes page (office only).
create or replace function public.stakes_summary() returns table (wallets int, coins bigint, open_picks int, settled_picks int, lines int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office() then raise exception 'only the league office can read this'; end if;
  return query select (select count(*)::int from public.stakes_wallets), (select coalesce(sum(w.coins), 0)::bigint from public.stakes_wallets w),
    (select count(*)::int from public.stakes_picks where status = 'open'), (select count(*)::int from public.stakes_picks where status <> 'open'), (select count(*)::int from public.stakes_lines);
end $$;
revoke all on function public.stakes_summary() from public, anon;
grant execute on function public.stakes_summary() to authenticated;

-- The settings a manager's Stakes page needs (stakes_settings can be read directly too; this keeps the page to rpc calls).
create or replace function public.stakes_config() returns public.stakes_settings
language sql stable security definer set search_path = public as $$ select * from public.stakes_settings where id = 1 $$;
revoke all on function public.stakes_config() from public, anon;
grant execute on function public.stakes_config() to authenticated;
