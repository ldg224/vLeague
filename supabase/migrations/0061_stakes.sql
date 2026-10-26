-- MU-1 Stakes (26 Oct 2026): a fake-money over/under game on key players' match stats. Logged-in managers only, one currency (Coins),
-- single picks, a fixed 1.9x payout. Nothing here touches existing tables. Safe to re-run.
--
--   stakes_wallets  one per account: the Coins balance and the day of the last daily top-up.
--   stakes_lines    one over/under line per key starter per match, set near the player's average (always x.5, so no pushes).
--   stakes_picks    a manager's pick on a line: side, stake, status (open / won / lost / void).
--   stakes_ledger   every change to a balance, so a balance can always be explained.
-- Nobody writes these tables directly; the functions below (security definer) do, so balances only move on the server.

create table if not exists public.stakes_wallets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  coins      int  not null default 1000 check (coins >= 0),
  claimed_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.stakes_lines (
  id         bigint generated always as identity primary key,
  fixture    text not null references public.fixtures (id) on update cascade on delete cascade,
  player_id  text not null,
  stat       text not null check (stat in ('sv', 'pas', 'sot', 'tk')),
  line       numeric(5, 1) not null check (line > 0),
  created_at timestamptz not null default now(),
  unique (fixture, player_id, stat)
);

create table if not exists public.stakes_picks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  line_id    bigint not null references public.stakes_lines (id) on delete cascade,
  side       text not null check (side in ('over', 'under')),
  stake      int  not null check (stake >= 10),
  status     text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  actual     numeric(5, 1),
  payout     int not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, line_id)
);
create index if not exists stakes_picks_open on public.stakes_picks (line_id) where status = 'open';

create table if not exists public.stakes_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  delta         int  not null,
  reason        text not null,
  pick_id       bigint,
  balance_after int  not null,
  at            timestamptz not null default now()
);
create index if not exists stakes_ledger_user on public.stakes_ledger (user_id, at desc);

alter table public.stakes_wallets enable row level security;
alter table public.stakes_lines   enable row level security;
alter table public.stakes_picks   enable row level security;
alter table public.stakes_ledger  enable row level security;
drop policy if exists stakes_wallets_own on public.stakes_wallets;
create policy stakes_wallets_own on public.stakes_wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists stakes_lines_read on public.stakes_lines;
create policy stakes_lines_read on public.stakes_lines for select to authenticated using (true);
drop policy if exists stakes_picks_own on public.stakes_picks;
create policy stakes_picks_own on public.stakes_picks for select to authenticated using (user_id = auth.uid());
drop policy if exists stakes_ledger_own on public.stakes_ledger;
create policy stakes_ledger_own on public.stakes_ledger for select to authenticated using (user_id = auth.uid());
revoke all on public.stakes_wallets, public.stakes_lines, public.stakes_picks, public.stakes_ledger from anon, authenticated;
grant select on public.stakes_wallets, public.stakes_lines, public.stakes_picks, public.stakes_ledger to authenticated;

-- ---------------------------------------------------------------- the rules, in one place

create or replace function public.stakes_multiplier() returns numeric language sql immutable as $$ select 1.9::numeric $$;

-- Move a balance and write the ledger line, in one step. Returns the new balance.
create or replace function public.stakes_move(p_user uuid, p_delta int, p_reason text, p_pick bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  update public.stakes_wallets set coins = coins + p_delta where user_id = p_user returning coins into bal;
  if bal is null then raise exception 'no wallet'; end if;
  insert into public.stakes_ledger (user_id, delta, reason, pick_id, balance_after) values (p_user, p_delta, p_reason, p_pick, bal);
  return bal;
end $$;
revoke all on function public.stakes_move(uuid, int, text, bigint) from public, anon, authenticated;

-- Open the caller's wallet (1,000 Coins on first visit), then the daily top-up (+200, once per Melbourne day) and the
-- bail-out (a manager with under 100 Coins and nothing riding is topped back up to 100, so nobody is locked out).
create or replace function public.stakes_wallet() returns table (coins int, claimed_today boolean, bonus int)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); today date := (now() at time zone 'Australia/Melbourne')::date; w public.stakes_wallets; got int := 0; b int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  insert into public.stakes_wallets (user_id, claimed_on) values (me, today) on conflict (user_id) do nothing;
  if found then
    insert into public.stakes_ledger (user_id, delta, reason, balance_after) values (me, 1000, 'welcome', 1000);
  end if;
  select * into w from public.stakes_wallets where user_id = me for update;
  if w.claimed_on is distinct from today then
    perform public.stakes_move(me, 200, 'daily');
    update public.stakes_wallets set claimed_on = today where user_id = me;
    got := 200;
  end if;
  select sw.coins into b from public.stakes_wallets sw where sw.user_id = me;
  if b < 100 and not exists (select 1 from public.stakes_picks where user_id = me and status = 'open') then
    perform public.stakes_move(me, 100 - b, 'bailout');
    got := got + (100 - b);
    b := 100;
  end if;
  return query select sw.coins, got = 0, got from public.stakes_wallets sw where sw.user_id = me;
end $$;
revoke all on function public.stakes_wallet() from public, anon;
grant execute on function public.stakes_wallet() to authenticated;

-- ---------------------------------------------------------------- lines

-- A player's usual number for a stat: his own average over matches played in full, else the league average for his position, else a fixed start.
create or replace function public.stakes_usual(p_player text, p_pos text, p_stat text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare own numeric; n int; lg numeric; fallback numeric := case p_stat when 'sv' then 3.5 when 'sot' then 1.5 when 'tk' then 2.5 else 32.5 end;
begin
  select avg((v.value ->> p_stat)::numeric), count(*) into own, n
  from public.results r, jsonb_each(r.summary -> 'players') v(key, value)
  where v.key = p_player and (v.value ->> 'min')::numeric >= 90;
  if n >= 2 then return own; end if;
  select avg((v.value ->> p_stat)::numeric) into lg
  from public.results r, jsonb_each(r.summary -> 'players') v(key, value)
  join public.players pl on pl.id = v.key
  where pl.position = p_pos and (v.value ->> 'min')::numeric >= 90;
  return coalesce(lg, fallback);
end $$;
revoke all on function public.stakes_usual(text, text, text) from public, anon, authenticated;

-- Make the lines for one match if it has none yet: per club, the goalkeeper (saves) plus the two most valuable outfield starters
-- (forward: shots on target, midfielder: passes, defender: tackles won). Only from a submitted or locked line-up, and only before kick-off.
create or replace function public.stakes_make_lines(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare f public.fixtures; c_club text; lu jsonb; n int := 0; r record;
begin
  select * into f from public.fixtures where id = p_fixture;
  if not found or f.starts_at is null or f.starts_at <= now() or f.postponed then return 0; end if;
  if exists (select 1 from public.stakes_lines where fixture = p_fixture) then return 0; end if;
  for c_club in select unnest(array[f.home, f.away]) loop
    select ws.lineup into lu from public.week_sheets ws where ws.week = f.week and ws.club = c_club and ws.lineup <> '{}'::jsonb;
    if lu is null then
      select s.sheet -> 'lineup' into lu from public.submitted_sheets s where s.week = f.week and s.club = c_club;
    end if;
    if lu is null or lu = '{}'::jsonb then continue; end if;
    for r in
      with xi as (
        select p.id, p.position, p.value from jsonb_each_text(lu) e join public.players p on p.id = e.value
      ), keeper as (
        select id, position, value, 1 as ord from xi where position = 'GK' order by value desc limit 1
      ), outfield as (
        select id, position, value, 2 as ord from xi where position <> 'GK' order by value desc limit 2
      )
      select * from keeper union all select * from outfield
    loop
      insert into public.stakes_lines (fixture, player_id, stat, line)
      values (p_fixture, r.id,
        case r.position when 'GK' then 'sv' when 'FWD' then 'sot' when 'DEF' then 'tk' else 'pas' end,
        greatest(0.5, floor(public.stakes_usual(r.id, r.position,
          case r.position when 'GK' then 'sv' when 'FWD' then 'sot' when 'DEF' then 'tk' else 'pas' end)) + 0.5))
      on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_make_lines(text) from public, anon, authenticated;

-- Everything the Stakes tab shows: the open lines for matches starting in the next 7 days (made on demand), each with the caller's pick.
drop function if exists public.stakes_slate();   -- (0062 gives it another column, so a re-run of this file has to start clean)
create function public.stakes_slate() returns table (
  line_id bigint, fixture text, week int, home text, away text, starts_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric,
  my_side text, my_stake int, my_status text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fx text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  for fx in select x.id from public.fixtures x where x.starts_at > now() and x.starts_at <= now() + interval '7 days' and not x.postponed loop
    perform public.stakes_make_lines(fx);
  end loop;
  return query
    select l.id, f.id, f.week, f.home, f.away, f.starts_at, l.player_id, p.name, p.club, p.position, l.stat, l.line,
           k.side, k.stake, k.status
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    join public.players p on p.id = l.player_id
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + interval '7 days' and not f.postponed
    order by f.starts_at, f.id, p.club, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;

-- ---------------------------------------------------------------- picks

create or replace function public.stakes_place(p_line bigint, p_side text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); f public.fixtures; bal int; pid bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if p_side not in ('over', 'under') then raise exception 'pick over or under'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if f.starts_at is null or f.starts_at <= now() or f.postponed then raise exception 'this match is closed'; end if;
  perform 1 from public.stakes_wallets where user_id = me for update;
  if not found then raise exception 'open your wallet first'; end if;
  select coins into bal from public.stakes_wallets where user_id = me;
  if p_stake is null or p_stake < 10 then raise exception 'the smallest stake is 10 Coins'; end if;
  if p_stake > bal then raise exception 'not enough Coins'; end if;
  if exists (select 1 from public.stakes_picks where user_id = me and line_id = p_line) then raise exception 'you already picked this line'; end if;
  insert into public.stakes_picks (user_id, line_id, side, stake) values (me, p_line, p_side, p_stake) returning id into pid;
  return public.stakes_move(me, -p_stake, 'stake', pid);
end $$;
revoke all on function public.stakes_place(bigint, text, int) from public, anon;
grant execute on function public.stakes_place(bigint, text, int) to authenticated;

-- Take a pick back before kick-off: the stake returns.
create or replace function public.stakes_cancel(p_line bigint) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k public.stakes_picks; f public.fixtures;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into k from public.stakes_picks where user_id = me and line_id = p_line and status = 'open' for update;
  if not found then raise exception 'no open pick on this line'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if f.starts_at is null or f.starts_at <= now() then raise exception 'this match is closed'; end if;
  delete from public.stakes_picks where id = k.id;
  return public.stakes_move(me, k.stake, 'cancel', k.id);
end $$;
revoke all on function public.stakes_cancel(bigint) from public, anon;
grant execute on function public.stakes_cancel(bigint) to authenticated;

-- ---------------------------------------------------------------- settling

-- Called whenever a result is saved. A player missing from the result (or on 0 minutes) voids his lines and returns the stakes.
create or replace function public.stakes_settle(p_fixture text) returns int
language plpgsql security definer set search_path = public as $$
declare res jsonb; k record; won boolean; n int := 0; pay int; v_actual numeric;
begin
  select summary -> 'players' into res from public.results where fixture = p_fixture;
  if res is null then return 0; end if;
  for k in
    select pk.id, pk.user_id, pk.side, pk.stake, l.player_id, l.stat, l.line
    from public.stakes_picks pk join public.stakes_lines l on l.id = pk.line_id
    where l.fixture = p_fixture and pk.status = 'open' for update of pk
  loop
    v_actual := case when coalesce((res -> k.player_id ->> 'min')::numeric, 0) > 0 then (res -> k.player_id ->> k.stat)::numeric end;
    if v_actual is null then
      update public.stakes_picks set status = 'void', payout = k.stake, settled_at = now() where id = k.id;
      perform public.stakes_move(k.user_id, k.stake, 'void', k.id);
    else
      won := (k.side = 'over' and v_actual > k.line) or (k.side = 'under' and v_actual < k.line);
      pay := case when won then floor(k.stake * public.stakes_multiplier())::int else 0 end;
      update public.stakes_picks set status = case when won then 'won' else 'lost' end, actual = v_actual, payout = pay, settled_at = now() where id = k.id;
      if won then perform public.stakes_move(k.user_id, pay, 'win', k.id); end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_settle(text) from public, anon, authenticated;

create or replace function public.stakes_on_result() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.stakes_settle(new.fixture);
  return new;
end $$;
drop trigger if exists results_stakes on public.results;
create trigger results_stakes after insert or update of summary on public.results
  for each row execute function public.stakes_on_result();

-- ---------------------------------------------------------------- history and the board

create or replace function public.stakes_history(p_limit int default 40) returns table (
  line_id bigint, fixture text, home text, away text, starts_at timestamptz, player_name text, team text, stat text, line numeric,
  side text, stake int, status text, actual numeric, payout int, settled_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, f.id, f.home, f.away, f.starts_at, p.name, p.club, l.stat, l.line, k.side, k.stake, k.status, k.actual, k.payout, k.settled_at
  from public.stakes_picks k
  join public.stakes_lines l on l.id = k.line_id
  join public.fixtures f on f.id = l.fixture
  join public.players p on p.id = l.player_id
  where k.user_id = auth.uid()
  order by k.created_at desc limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.stakes_history(int) from public, anon;
grant execute on function public.stakes_history(int) to authenticated;

-- The board: every manager with a wallet, richest first. Shows club and name only; never anyone's picks.
create or replace function public.stakes_board() returns table (rank bigint, club text, name text, coins int, won int, settled int, mine boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by w.coins desc), pr.club, coalesce(pr.display_name, 'Manager'), w.coins,
         (select count(*)::int from public.stakes_picks k where k.user_id = w.user_id and k.status = 'won'),
         (select count(*)::int from public.stakes_picks k where k.user_id = w.user_id and k.status in ('won', 'lost')),
         w.user_id = auth.uid()
  from public.stakes_wallets w join public.profiles pr on pr.id = w.user_id
  where auth.uid() is not null and pr.role = 'manager'
  order by 1, 3
$$;
revoke all on function public.stakes_board() from public, anon;
grant execute on function public.stakes_board() to authenticated;
