-- Result prices from the match engine itself (2 Nov 2026). Safe to re-run. Needs 0061 to 0076.
--
-- 0075/0076 priced a match from squad value and results so far, which is a guess. The match engine (js/sim/hcl_sim) is what actually decides every score, so the prices
-- now come from a goals model fitted to hundreds of engine games (supabase/tools/stakes_model.py):
--     home goals ~ Poisson(model_mu * model_home * attack(home) / defence(away)),   away goals ~ Poisson(model_mu * attack(away) / defence(home))
-- stakes_model holds each club's attack and defence; the chances of a home win, a draw and an away win follow from the two Poisson counts. Re-fit the model (and
-- insert the new numbers) when squads change. A club that is missing from stakes_model falls back to the 0076 rating.
--
-- So that nobody can read results off the prices, each match's prices carry a small random error: every chance is nudged by a fixed random amount that belongs to that
-- match (the same all week, different for every match), then the chances are made to add up to 1 again.
--   stakes_settings.result_noise   the size of that error, as a percent of each chance (default 12); 0 = exact

create table if not exists public.stakes_model (
  club      text primary key references public.clubs (code) on update cascade on delete cascade,
  attack    numeric(7, 4) not null check (attack > 0),
  defence   numeric(7, 4) not null check (defence > 0),
  fitted_at timestamptz not null default now()
);
alter table public.stakes_model enable row level security;
revoke all on public.stakes_model from anon, authenticated;
alter table public.stakes_settings add column if not exists model_mu numeric(7, 4) not null default 1.2;
alter table public.stakes_settings add column if not exists model_home numeric(7, 4) not null default 1.2;
alter table public.stakes_settings add column if not exists result_noise int not null default 12 check (result_noise between 0 and 40);

create or replace function public.stakes_save_settings(p jsonb) returns public.stakes_settings
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings; k text; keys text[] := array['visible', 'betting_open', 'start_coins', 'daily_topup', 'bailout_below', 'bailout_to', 'multiplier', 'min_stake', 'max_stake',
  'lines_per_week', 'lines_per_match', 'score_per_week', 'score_exact_mult', 'score_result_mult', 'result_win_mult', 'result_draw_mult', 'result_margin', 'result_max_mult', 'result_noise',
  'score_all', 'stats', 'line_adjust', 'lock_minutes', 'lines_days', 'show_board'];
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
    result_noise      = coalesce((p ->> 'result_noise')::int, result_noise),
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
  raise exception 'those settings are out of range (a stake limit under the smallest stake, a payout under 1.01, a margin over 30%%, a price error over 40%%...)';
end $$;
revoke all on function public.stakes_save_settings(jsonb) from public, anon;
grant execute on function public.stakes_save_settings(jsonb) to authenticated;

-- The chances of a home win, a draw and an away win, with no error added.
create or replace function public.stakes_result_odds(p_home text, p_away text) returns table (ph numeric, pd numeric, pa numeric)
language plpgsql stable security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); mh public.stakes_model; ma public.stakes_model; lh numeric; la numeric; d numeric;
  a numeric[]; b numeric[]; i int; j int; sh numeric := 0; sd numeric := 0; sa numeric := 0; tot numeric;
begin
  select * into mh from public.stakes_model where club = p_home;
  select * into ma from public.stakes_model where club = p_away;
  if mh.club is not null and ma.club is not null then
    lh := c.model_mu * c.model_home * mh.attack / ma.defence;
    la := c.model_mu * ma.attack / mh.defence;
  else   -- no engine model for one of the clubs yet: the rating guess from 0076
    d := public.stakes_club_rating(p_home) - public.stakes_club_rating(p_away);
    lh := 1.45 * exp(d / 2.5); la := 1.15 * exp(-d / 2.5);
  end if;
  a[0] := exp(-lh); b[0] := exp(-la);
  for i in 1..12 loop a[i] := a[i - 1] * lh / i; b[i] := b[i - 1] * la / i; end loop;
  for i in 0..12 loop for j in 0..12 loop
    if i > j then sh := sh + a[i] * b[j]; elsif i = j then sd := sd + a[i] * b[j]; else sa := sa + a[i] * b[j]; end if;
  end loop; end loop;
  tot := sh + sd + sa;
  return query select sh / tot, sd / tot, sa / tot;
end $$;
revoke all on function public.stakes_result_odds(text, text) from public, anon, authenticated;

-- A fixed, repeatable "random" number for a match and a result, roughly bell-shaped with spread 1 (the same every time it is asked, so prices do not flicker).
create or replace function public.stakes_match_noise(p_fixture text, p_which text) returns numeric
language sql immutable as $$
  select ((hashtextextended(p_fixture || ':a:' || p_which, 7) & 1048575)::numeric / 1048576
        + (hashtextextended(p_fixture || ':b:' || p_which, 11) & 1048575)::numeric / 1048576
        + (hashtextextended(p_fixture || ':c:' || p_which, 13) & 1048575)::numeric / 1048576 - 1.5) * 2
$$;
revoke all on function public.stakes_match_noise(text, text) from public, anon, authenticated;

-- Price every result stake of a round that has not locked: the engine's chances, a fixed random error for each match, then the payouts.
create or replace function public.stakes_price_week(p_week int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); r record; o record; n int := 0; keep numeric := 1 - c.result_margin / 100.0; s numeric := c.result_noise / 100.0;
  lk timestamptz := public.stakes_round_lock(p_week); h numeric; d numeric; a numeric; t numeric;
begin
  if lk is null or lk <= now() then return 0; end if;
  for r in select l.id, f.id as fixture, f.home, f.away from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = p_week and l.kind = 'result' loop
    select * into o from public.stakes_result_odds(r.home, r.away);
    h := o.ph * exp(s * public.stakes_match_noise(r.fixture, 'home'));
    d := o.pd * exp(s * public.stakes_match_noise(r.fixture, 'draw'));
    a := o.pa * exp(s * public.stakes_match_noise(r.fixture, 'away'));
    t := h + d + a; h := h / t; d := d / t; a := a / t;
    update public.stakes_lines set p_home = round(h, 4), p_draw = round(d, 4), p_away = round(a, 4),
      mult_home = least(c.result_max_mult, greatest(1.05, round(keep / greatest(h, .0001), 2))),
      mult_draw = least(c.result_max_mult, greatest(1.05, round(keep / greatest(d, .0001), 2))),
      mult_away = least(c.result_max_mult, greatest(1.05, round(keep / greatest(a, .0001), 2)))
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_price_week(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- the fit (python supabase/tools/stakes_model.py fit), 785 engine games, 2 Nov 2026
-- fit: 785 engine games, home goals 1.98, away goals 1.91
-- fit: mean log score: model -1.049, flat guess -1.099
-- fit: chance 10-20%: said 19.3%, happened 24.6%  (191)
-- fit: chance 20-30%: said 22.7%, happened 21.8%  (777)
-- fit: chance 30-40%: said 35.4%, happened 35.5%  (667)
-- fit: chance 40-50%: said 44.8%, happened 44.9%  (559)
-- fit: chance 50-60%: said 52.8%, happened 50.3%  (161)

update public.stakes_settings set model_mu = 1.8922, model_home = 1.0381 where id = 1;
insert into public.stakes_model (club, attack, defence) values
  ('CCF', 0.9574, 1.0667),
  ('CFC', 0.8942, 0.9779),
  ('DTP', 1.0725, 1.1282),
  ('LAU', 1.1840, 0.9891),
  ('LFC', 0.8288, 1.0591),
  ('NGY', 1.0660, 1.0053),
  ('PRF', 0.9546, 0.9176),
  ('SKS', 0.9417, 0.9642),
  ('SSF', 1.0986, 1.1227),
  ('TUR', 1.0218, 0.8262),
  ('VVS', 1.0316, 0.9833)
on conflict (club) do update set attack = excluded.attack, defence = excluded.defence, fitted_at = now();
