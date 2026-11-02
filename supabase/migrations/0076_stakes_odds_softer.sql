-- Softer prices (2 Nov 2026): 0075 leaned too hard on squad value and on a few early results, so a side like SKS away at DTP priced near the cap (about 13x). A club's
-- rating now weighs squad value half as much and early results less (they are steadied by six games of nothing), so ratings spread out only as the season shows it.
-- Replaces the two rating functions; everything else from 0075 stays. Safe to re-run.

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
  return 6 * (coalesce(mine, lg) / nullif(lg, 0) - 1) + 0.3 * gd / (n + 6);
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

