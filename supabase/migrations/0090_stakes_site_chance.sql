-- B-41 (16 Nov 2026, PRF): Stakes win percentages didn't match the fixtures. Safe to re-run. Needs 0061 to 0089.
--
-- Stakes priced a match from its own model (each club's best XI by value, 0078) plus a random error of about 12% (0077), while the fixtures, matches, match and
-- game pages show the site's win chance (js/match-model.js winChance). So the same match showed two different chances. Now Stakes uses the site's win chance:
--   stakes_site_odds(fixture) is winChance rebuilt in SQL, step for step: squad quality from the line-ups (the locked sheet, else the submitted one while the
--   round is open, else each club's best 4-3-3), results so far, form over the last five, the home edge and head to head, all from matches that are over before
--   this one kicks off. KEEP IT IN STEP WITH js/match-model.js (same constants: SHRINK 3, START_HOME 1.08, START_GOALS 1.5, MAX_GOALS 10, the position weights).
-- The random error is gone: the fixtures page already shows the exact chance, so hiding it in Stakes protected nothing. stakes_settings.result_noise stays
-- as a column but is no longer used. The league's cut (result_margin) and the payout cap still apply.
-- Prices now follow the chance until each match kicks off, not only until the round's picks close, so a match later in a round moves with the results
-- before it, as on the fixtures page. A placed pick keeps the payout it was locked in at (stakes_picks.mult), so this never changes what a pick pays.

-- The eleven who count for a club and their attack and defence ratings (squadRatings in js/match-model.js).
create or replace function public.stakes_xi_ratings(p_club text, p_lineup jsonb) returns table (att float8, def float8, from_sheet boolean, size int)
language plpgsql stable security definer set search_path = public as $$
declare ids text[]; n int;
begin
  select array_agg(x.value order by x.ord) into ids
  from jsonb_each_text(coalesce(p_lineup, '{}'::jsonb)) with ordinality x(key, value, ord)
  join public.players p on p.id = x.value and p.club = p_club;
  n := coalesce(array_length(ids, 1), 0);
  return query
    with xi as (
      select p.position, p.offense::float8 o, p.defense::float8 d
      from unnest(ids[1:11]) u(id) join public.players p on p.id = u.id and p.club = p_club
      where n >= 11
      union all
      select b.position, b.offense::float8, b.defense::float8
      from (select p.position, p.offense, p.defense,
                   row_number() over (partition by p.position order by p.offense + p.defense desc, p.id) rn
            from public.players p where p.club = p_club) b
      where n < 11 and b.rn <= case b.position when 'GK' then 1 when 'DEF' then 4 when 'MID' then 3 when 'FWD' then 3 else 0 end
    ), w as (
      select o, d, case position when 'DEF' then 0.4 when 'MID' then 1 when 'FWD' then 1.6 else 0 end aw,
                   case position when 'GK' then 1.6 when 'DEF' then 1.4 when 'MID' then 0.8 when 'FWD' then 0.3 else 0 end dw
      from xi
    )
    select case when count(*) < 8 then null else coalesce(sum(o * aw) / nullif(sum(aw), 0), 0) end,
           case when count(*) < 8 then null else coalesce(sum(d * dw) / nullif(sum(dw), 0), 0) end,
           count(*) >= 8 and n >= 11, case when count(*) < 8 then 0 else count(*)::int end
    from w;
end $$;
revoke all on function public.stakes_xi_ratings(text, jsonb) from public, anon, authenticated;

-- A club's line-up for a round, as the site reads it (js/win-chance.js loadChanceSheets): the locked sheet, else the submitted one while the round is open.
create or replace function public.stakes_chance_lineup(p_week int, p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select w.lineup from public.week_sheets w where w.week = p_week and w.club = p_club and (w.submitted or w.random) limit 1),
    (select coalesce(s.sheet -> 'lineup', '{}'::jsonb) from public.submitted_sheets s join public.deadlines d on d.week = s.week
      where s.week = p_week and s.club = p_club and d.locked_at is null and d.locks_at > now() limit 1))
$$;
revoke all on function public.stakes_chance_lineup(int, text) from public, anon, authenticated;

-- The league games that are over before a match kicks off (leagueState's `past`): no finals, no pre-season or showcase rounds, not the match itself.
create or replace function public.stakes_chance_past(p_fixture text) returns table (home text, away text, hg int, ag int, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.home, f.away, (r.summary ->> 'home')::int, (r.summary ->> 'away')::int, f.starts_at
  from public.fixtures me, public.fixtures f
  join public.results r on r.fixture = f.id
  left join public.rounds rd on rd.week = f.week
  where me.id = p_fixture and f.id <> me.id and coalesce(f.stage, '') = ''
    and coalesce(rd.counts_for_ladder, true) and coalesce(rd.kind, '') <> 'preseason'
    and public.stakes_match_over(f.starts_at, f.postponed)
    and (me.starts_at is null or f.starts_at < me.starts_at)
    and r.summary ->> 'home' is not null and r.summary ->> 'away' is not null
$$;
revoke all on function public.stakes_chance_past(text) from public, anon, authenticated;

-- The site's win chance for a match before kick-off (winChance in js/match-model.js, without the in-play part).
create or replace function public.stakes_site_odds(p_fixture text) returns table (ph numeric, pd numeric, pa numeric)
language plpgsql stable security definer set search_path = public as $$
declare fx public.fixtures; rh record; ra record; lg_att float8; lg_def float8;
  games int; goals float8; hgs float8; ags float8; per_team float8; raw float8; home_adv float8;
  hp int; hgf float8; hga float8; hform float8; ap int; agf float8; aga float8; aform float8;
  w float8; rt float8; lnh float8; lna float8; h2h float8 := 0; d float8; hb float8; lh float8; la float8;
  a float8[]; b float8[]; i int; j int; sh float8 := 0; sd float8 := 0; sa float8 := 0; t float8;
begin
  select * into fx from public.fixtures where id = p_fixture;
  if not found then return; end if;
  select * into rh from public.stakes_xi_ratings(fx.home, public.stakes_chance_lineup(fx.week, fx.home));
  select * into ra from public.stakes_xi_ratings(fx.away, public.stakes_chance_lineup(fx.week, fx.away));
  select avg(x.att), avg(x.def) into lg_att, lg_def
  from public.clubs c, lateral public.stakes_xi_ratings(c.code, null) x
  where coalesce(c.status, '') not in ('withdrawn', 'pending') and x.att is not null;
  if coalesce(lg_att, 0) = 0 then lg_att := 5; end if;
  if coalesce(lg_def, 0) = 0 then lg_def := 5; end if;

  select count(*), coalesce(sum(p.hg + p.ag), 0), coalesce(sum(p.hg), 0), coalesce(sum(p.ag), 0) into games, goals, hgs, ags from public.stakes_chance_past(p_fixture) p;
  per_team := case when games > 0 then goals / (games * 2) else 1.5 end;
  if per_team <= 0 then per_team := 1.5; end if;
  raw := case when hgs <> 0 and ags <> 0 then hgs / ags else 1.08 end;
  home_adv := (raw * games + 1.08 * 8) / (games + 8);

  select count(*), coalesce(sum(case when p.home = fx.home then p.hg else p.ag end), 0), coalesce(sum(case when p.home = fx.home then p.ag else p.hg end), 0)
    into hp, hgf, hga from public.stakes_chance_past(p_fixture) p where p.home = fx.home or p.away = fx.home;
  select count(*), coalesce(sum(case when p.home = fx.away then p.hg else p.ag end), 0), coalesce(sum(case when p.home = fx.away then p.ag else p.hg end), 0)
    into ap, agf, aga from public.stakes_chance_past(p_fixture) p where p.home = fx.away or p.away = fx.away;
  select coalesce(avg(v) - 0.5, 0) into hform from (
    select case when (case when p.home = fx.home then p.hg - p.ag else p.ag - p.hg end) > 0 then 1.0
                when p.hg = p.ag then 0.5 else 0.0 end v
    from public.stakes_chance_past(p_fixture) p where p.home = fx.home or p.away = fx.home order by p.starts_at desc limit 5) x;
  select coalesce(avg(v) - 0.5, 0) into aform from (
    select case when (case when p.home = fx.away then p.hg - p.ag else p.ag - p.hg end) > 0 then 1.0
                when p.hg = p.ag then 0.5 else 0.0 end v
    from public.stakes_chance_past(p_fixture) p where p.home = fx.away or p.away = fx.away order by p.starts_at desc limit 5) x;

  -- results count for more as clubs play more games, squad quality for more at the start
  w := (hp::float8 / (hp + 4) + ap::float8 / (ap + 4)) / 2;
  rt := case when rh.att > 0 and ra.def > 0 then (rh.att / ra.def) / (lg_att / lg_def) else 1 end;
  lnh := (1 - w) * ln(rt) + w * ln(((hgf + 3 * per_team) / (hp + 3) / per_team) * ((aga + 3 * per_team) / (ap + 3) / per_team)) + 0.16 * hform - 0.08 * aform;
  rt := case when ra.att > 0 and rh.def > 0 then (ra.att / rh.def) / (lg_att / lg_def) else 1 end;
  lna := (1 - w) * ln(rt) + w * ln(((agf + 3 * per_team) / (ap + 3) / per_team) * ((hga + 3 * per_team) / (hp + 3) / per_team)) + 0.16 * aform - 0.08 * hform;

  select avg(case when p.home = fx.home then p.hg - p.ag else p.ag - p.hg end) into d
  from public.stakes_chance_past(p_fixture) p where (p.home = fx.home and p.away = fx.away) or (p.home = fx.away and p.away = fx.home);
  if d is not null then h2h := greatest(-0.06, least(0.06, d * 0.03)); end if;

  hb := sqrt(home_adv);
  lh := least(6, greatest(0.15, per_team * exp(lnh + h2h) * hb));
  la := least(6, greatest(0.15, per_team * exp(lna - h2h) / hb));
  a[0] := exp(-lh); b[0] := exp(-la);
  for i in 1..10 loop a[i] := a[i - 1] * lh / i; b[i] := b[i - 1] * la / i; end loop;
  for i in 0..10 loop for j in 0..10 loop
    if i > j then sh := sh + a[i] * b[j]; elsif i = j then sd := sd + a[i] * b[j]; else sa := sa + a[i] * b[j]; end if;
  end loop; end loop;
  t := sh + sd + sa;
  return query select (sh / t)::numeric, (sd / t)::numeric, (sa / t)::numeric;
end $$;
revoke all on function public.stakes_site_odds(text) from public, anon, authenticated;

-- Pricing: the site's chance, no random error, for every result line whose match has not kicked off.
create or replace function public.stakes_price_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); r record; o record; n int := 0; keep numeric := 1 - c.result_margin / 100.0;
begin
  for r in select l.id, f.id as fixture from public.stakes_lines l join public.fixtures f on f.id = l.fixture
           where f.week = p_week and l.kind = 'result' and f.starts_at > now() and not coalesce(f.postponed, false) loop
    select * into o from public.stakes_site_odds(r.fixture);
    if o.ph is null then continue; end if;
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

-- The slate (0081), now also re-pricing a round that has started but still has matches to come.
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
  end loop;
  for w in select x.week from public.fixtures x where not x.postponed and x.starts_at is not null group by x.week
           having max(x.starts_at) > now() and min(x.starts_at) - make_interval(days => c.lines_days) <= now() order by 1 loop
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
