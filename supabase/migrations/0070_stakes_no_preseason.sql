-- Stakes is for the real season only: preseason rounds (rounds.kind = 'preseason') get no lines, hide any already made, and refuse picks.
-- Additive: only the four functions are replaced; existing picks on preseason lines still settle.

create or replace function public.stakes_make_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); have int; need int; n int := 0; added int := 0; r record; usual numeric; per_match int;
begin
  if not c.betting_open then return 0; end if;
  if exists (select 1 from public.rounds where week = p_week and kind = 'preseason') then return 0; end if;  -- preseason rounds have no stakes
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

create or replace function public.stakes_place_result(p_line bigint, p_result text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint; mult numeric;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_result not in ('home', 'draw', 'away') then raise exception 'pick a home win, a draw or an away win'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if exists (select 1 from public.rounds where week = f.week and kind = 'preseason') then raise exception 'Stakes is only for the real season, not preseason'; end if;
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

create or replace function public.stakes_place(p_line bigint, p_side text, p_stake int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.stakes_settings := public.stakes_cfg(); f public.fixtures; kd text; bal int; pid bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'sign in first'; end if;
  if not c.betting_open then raise exception 'Stakes is closed for now'; end if;
  if p_side not in ('over', 'under') then raise exception 'pick over or under'; end if;
  select fx.* into f from public.stakes_lines l join public.fixtures fx on fx.id = l.fixture where l.id = p_line;
  if not found then raise exception 'no such line'; end if;
  if exists (select 1 from public.rounds where week = f.week and kind = 'preseason') then raise exception 'Stakes is only for the real season, not preseason'; end if;
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
      and not exists (select 1 from public.rounds r where r.week = f.week and r.kind = 'preseason')
    order by f.week, f.starts_at, l.kind desc, p.value desc nulls last, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;
