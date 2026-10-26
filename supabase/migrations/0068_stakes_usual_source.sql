-- Stakes: say what the "usual" number on a card really is (26 Oct 2026). Safe to re-run. Needs 0061 and 0066.
--
-- A card's line is set from the player's usual figure for the stat, and the card shows it as "Averages X a match". That is only true when he has played two or more full
-- matches; before that the figure was quietly his position's league average (or a fixed start), which a card should not call his average. stakes_usual_info() gives the
-- figure together with where it came from, and stakes_slate() passes both on so the page can say it honestly:
--   own       his own average over his full matches (2 or more)
--   position  the average of his position (he has played fewer than 2 full matches)
--   default   a fixed starting figure (nobody in his position has played yet)
-- stakes_usual() keeps working as before (it is the same figure), so lines are made exactly as they were.

create or replace function public.stakes_usual_info(p_player text, p_pos text, p_stat text) returns table (val numeric, n int, src text)
language plpgsql stable security definer set search_path = public as $$
declare own numeric; c int; lg numeric; fallback numeric := case p_stat when 'sv' then 3.5 when 'sot' then 1.5 when 'tk' then 2.5 else 32.5 end;
begin
  select avg((v.value ->> p_stat)::numeric), count(*)::int into own, c
  from public.results r, jsonb_each(r.summary -> 'players') v(key, value)
  where v.key = p_player and (v.value ->> 'min')::numeric >= 90;
  if c >= 2 then return query select own, c, 'own'::text; return; end if;
  select avg((v.value ->> p_stat)::numeric) into lg
  from public.results r, jsonb_each(r.summary -> 'players') v(key, value)
  join public.players pl on pl.id = v.key
  where pl.position = p_pos and (v.value ->> 'min')::numeric >= 90;
  if lg is not null then return query select lg, c, 'position'::text; else return query select fallback, c, 'default'::text; end if;
end $$;
revoke all on function public.stakes_usual_info(text, text, text) from public, anon, authenticated;

create or replace function public.stakes_usual(p_player text, p_pos text, p_stat text) returns numeric
language sql stable security definer set search_path = public as $$ select val from public.stakes_usual_info(p_player, p_pos, p_stat) $$;
revoke all on function public.stakes_usual(text, text, text) from public, anon, authenticated;

drop function if exists public.stakes_slate();
create function public.stakes_slate() returns table (
  line_id bigint, kind text, featured boolean, fixture text, week int, home text, away text, starts_at timestamptz, locks_at timestamptz,
  player_id text, player_name text, team text, pos text, stat text, line numeric, usual numeric, usual_n int, usual_src text,
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
    select l.id, l.kind, l.featured, f.id, f.week, f.home, f.away, f.starts_at, f.starts_at - make_interval(mins => c.lock_minutes),
           l.player_id, p.name, p.club, p.position, l.stat, l.line,
           round(ui.val, 1), ui.n, ui.src,
           k.side, k.pred_home, k.pred_away, k.stake, k.status, k.mult, k.mult2
    from public.stakes_lines l
    join public.fixtures f on f.id = l.fixture
    left join public.players p on p.id = l.player_id
    left join lateral public.stakes_usual_info(l.player_id, p.position, l.stat) ui on l.kind = 'player'
    left join public.stakes_picks k on k.line_id = l.id and k.user_id = me
    where f.starts_at > now() and f.starts_at <= now() + make_interval(days => c.lines_days) and not f.postponed and (l.featured or c.score_all)
    order by f.week, f.starts_at, l.kind desc, p.value desc nulls last, l.id;
end $$;
revoke all on function public.stakes_slate() from public, anon;
grant execute on function public.stakes_slate() to authenticated;
