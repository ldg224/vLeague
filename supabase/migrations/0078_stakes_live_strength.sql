-- Result prices follow the players' current ratings (2 Nov 2026). Safe to re-run. Needs 0061 to 0077.
--
-- 0077 priced a match from each club's attack and defence as they were when the engine games were played, so a rating change during the season would not have moved
-- the prices. Now a club's strength is read from the players table every time a match is priced:
--   its best goalkeeper, 4 defenders, 3 midfielders and 3 forwards by value (the engine's 4-3-3), and six averages of them (stakes_team_features):
--     forwards' offence, midfielders' offence, defenders' offence, goalkeeper's defence, defenders' defence, midfielders' defence.
--   Goals expected by a side = exp( intercept + home edge + sum(own_k * own feature k) + sum(opp_k * the opponent's feature k) ), each feature taken as its rating minus 6.
--   The numbers (stakes_coef) were fitted to the match engine's own games with deliberately varied squads (supabase/tools/stakes_model.py, simvar then fitfeat),
--   so they say how much each rating is worth in goals. They only need fitting again if the match engine itself changes; squads and ratings do not need it.
-- The chances then follow from the two goal counts, and the random error and payouts are as in 0077. Clubs whose players are missing fall back to 0077 / 0076.

create table if not exists public.stakes_coef (
  name  text primary key,
  value numeric(9, 5) not null
);
alter table public.stakes_coef enable row level security;
revoke all on public.stakes_coef from anon, authenticated;

-- The six averages for a club, from its players now.
create or replace function public.stakes_team_features(p_club text) returns numeric[]
language sql stable security definer set search_path = public as $$
  with r as (select position, offense, defense, row_number() over (partition by position order by value desc, id) rn from public.players where club = p_club)
  select array[
    coalesce(avg(offense) filter (where position = 'FWD' and rn <= 3), 5),
    coalesce(avg(offense) filter (where position = 'MID' and rn <= 3), 5),
    coalesce(avg(offense) filter (where position = 'DEF' and rn <= 4), 5),
    coalesce(avg(defense) filter (where position = 'GK' and rn <= 1), 5),
    coalesce(avg(defense) filter (where position = 'DEF' and rn <= 4), 5),
    coalesce(avg(defense) filter (where position = 'MID' and rn <= 3), 5)]
  from r
$$;
revoke all on function public.stakes_team_features(text) from public, anon, authenticated;

-- The chances of a home win, a draw and an away win, with no error added.
create or replace function public.stakes_result_odds(p_home text, p_away text) returns table (ph numeric, pd numeric, pa numeric)
language plpgsql stable security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); mh public.stakes_model; ma public.stakes_model; lh numeric; la numeric; d numeric;
  fh numeric[] := public.stakes_team_features(p_home); fa numeric[] := public.stakes_team_features(p_away); k text[] := array['off_fwd', 'off_mid', 'off_def', 'def_gk', 'def_def', 'def_mid'];
  co jsonb; i int; eh numeric; ea numeric;
  a numeric[]; b numeric[]; j int; sh numeric := 0; sd numeric := 0; sa numeric := 0; tot numeric;
begin
  select jsonb_object_agg(name, value) into co from public.stakes_coef;
  if co is not null and co ? 'intercept' and co ? 'home' then
    eh := (co ->> 'intercept')::numeric + (co ->> 'home')::numeric; ea := (co ->> 'intercept')::numeric;
    for i in 1..6 loop
      eh := eh + (co ->> ('own_' || k[i]))::numeric * (fh[i] - 6) + (co ->> ('opp_' || k[i]))::numeric * (fa[i] - 6);
      ea := ea + (co ->> ('own_' || k[i]))::numeric * (fa[i] - 6) + (co ->> ('opp_' || k[i]))::numeric * (fh[i] - 6);
    end loop;
    lh := exp(eh); la := exp(ea);
  else
    select * into mh from public.stakes_model where club = p_home;
    select * into ma from public.stakes_model where club = p_away;
    if mh.club is not null and ma.club is not null then
      lh := c.model_mu * c.model_home * mh.attack / ma.defence; la := c.model_mu * ma.attack / mh.defence;
    else
      d := public.stakes_club_rating(p_home) - public.stakes_club_rating(p_away);
      lh := 1.45 * exp(d / 2.5); la := 1.15 * exp(-d / 2.5);
    end if;
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

-- ---------------------------------------------------------------- the fit (python supabase/tools/stakes_model.py fitfeat), 2 Nov 2026
-- fit: 1115 engine games (330 with varied squads); mean log score -1.031 against -1.099 for a flat guess
-- fit: chance 0-10%: said 8.3%, happened 0.0%  (9)
-- fit: chance 10-20%: said 16.9%, happened 18.1%  (293)
-- fit: chance 20-30%: said 21.7%, happened 21.6%  (1055)
-- fit: chance 30-40%: said 35.6%, happened 36.6%  (913)
-- fit: chance 40-50%: said 44.1%, happened 43.2%  (850)
-- fit: chance 50-60%: said 54.1%, happened 53.8%  (117)
-- fit: chance 60-70%: said 65.2%, happened 59.5%  (74)
-- fit: chance 70-80%: said 74.2%, happened 80.0%  (30)
-- fit: chance 80-90%: said 82.8%, happened 50.0%  (4)
insert into public.stakes_coef (name, value) values
  ('intercept', 0.29524),
  ('home', 0.01103),
  ('own_off_fwd', 0.13841),
  ('own_off_mid', 0.06100),
  ('own_off_def', 0.03943),
  ('own_def_gk', 0.03352),
  ('own_def_def', 0.00126),
  ('own_def_mid', 0.01182),
  ('opp_off_fwd', 0.04207),
  ('opp_off_mid', -0.01278),
  ('opp_off_def', -0.09400),
  ('opp_def_gk', -0.04585),
  ('opp_def_def', -0.01830),
  ('opp_def_mid', -0.04010)
on conflict (name) do update set value = excluded.value;
