-- S-51 Summer Cup: SKS and FC Viper Athletic swap groups, and the league meets evenly (28 Nov 2026, the user). Data only. Safe to re-run: it does nothing once applied.
--
-- Why: SKS had already played Lads United (Round 2), so Group C home and away meant SKS v LAU three times (Sreehari, SKS). Viper have not met LAU or CCF
-- in the league yet, so they take SKS's Group C place and SKS take Viper's in Group B. At the same time the meetings table (league rounds, preseason not
-- counted) goes from 10 uneven pairs (5 meeting 3 times, 5 once, some left by 0099 and 0101) to every pair meeting exactly twice, one at each ground.
--   Group A  SSF TUR DTP LFC (unchanged)   Group B  SKS PRF CFC NGY   Group C  LAU VVS CCF (home and away)
-- 20 games in Rounds 7-20 change opponent or ground, keeping their round, date and kick-off. Nothing played, nothing with Stakes lines, no derby changes.
-- Round 7 SKS v LAU stays (their second and last meeting) but moves to Lads' ground and is league only. Home games: 10 each; no run longer than 4 (as before).
-- Cup matches now: B  R8 CFC-PRF, R9 NGY-SKS, R10 CFC-NGY, R11 PRF-SKS, R14 CFC-SKS, R14 PRF-NGY
--                  C  R6 CCF-LAU, R7 CCF-VVS, R10 VVS-LAU, R11 VVS-CCF, R13 LAU-CCF, R14 LAU-VVS
-- Fixture ids are left as they are (the Editor renames them to match on its next save; old ids keep working as aliases).

do $$
declare n int;
begin
  if exists (select 1 from public.cup_groups where cup = 'summer_2026' and club = 'SKS' and grp = 'B') then raise notice 'Summer Cup regroup: already applied'; return; end if;

  update public.fixtures f set home = v.nh, away = v.na, home_kit = null, away_kit = null
  from (values
    ('r7-sks-lau', 'SKS', 'LAU', 'LAU', 'SKS'),
    ('r8-lfc-ccf', 'LFC', 'SKS', 'SKS', 'TUR'),
    ('r8-tur-sks', 'CCF', 'TUR', 'CCF', 'LFC'),
    ('r9-ccf-sks', 'CCF', 'SKS', 'NGY', 'SKS'),
    ('r9-dtp-cfc', 'DTP', 'CFC', 'CCF', 'CFC'),
    ('r9-prf-ngy', 'PRF', 'NGY', 'DTP', 'PRF'),
    ('r11-sks-ccf', 'SKS', 'CCF', 'VVS', 'CCF'),
    ('r11-vvs-prf', 'VVS', 'PRF', 'PRF', 'SKS'),
    ('r14-lau-sks', 'LAU', 'SKS', 'LAU', 'VVS'),
    ('r14-ngy-prf', 'NGY', 'PRF', 'PRF', 'NGY'),
    ('r14-vvs-cfc', 'VVS', 'CFC', 'CFC', 'SKS'),
    ('r16-prf-vvs', 'PRF', 'VVS', 'VVS', 'PRF'),
    ('r18-ccf-dtp', 'CCF', 'DTP', 'CCF', 'SKS'),
    ('r18-cfc-sks', 'CFC', 'SKS', 'DTP', 'CFC'),
    ('r19-cfc-dtp', 'CFC', 'LFC', 'VVS', 'CFC'),
    ('r19-lfc-prf', 'DTP', 'PRF', 'NGY', 'PRF'),
    ('r19-ngy-sks', 'NGY', 'SKS', 'LFC', 'SKS'),
    ('r19-vvs-ccf', 'VVS', 'CCF', 'CCF', 'DTP'),
    ('r20-lau-vvs', 'LAU', 'VVS', 'CFC', 'LAU'),
    ('r20-prf-cfc', 'PRF', 'CFC', 'PRF', 'VVS')
  ) as v(id, oh, oa, nh, na)
  where f.id = v.id and f.home = v.oh and f.away = v.oa
    and not exists (select 1 from public.results r where r.fixture = f.id)
    and not exists (select 1 from public.stakes_lines s where s.fixture = f.id);
  get diagnostics n = row_count;
  if n <> 20 then raise exception 'Summer Cup regroup: expected 20 fixtures, got %', n; end if;

  update public.cup_groups set grp = 'B', seed = 1 where cup = 'summer_2026' and club = 'SKS';
  update public.cup_groups set grp = 'C', seed = 2 where cup = 'summer_2026' and club = 'VVS';

  -- cup flags follow the new groups: a group match is a Round 6-14 (weeks 10-18) league game between two clubs of one group
  update public.fixtures f set cup = null, look = case when f.look in ('summer_cup', 'summer_festive') then null else f.look end
  where f.cup = 'summer_2026' and f.stage is null and not exists (
    select 1 from public.cup_groups a join public.cup_groups b on a.cup = b.cup and a.grp = b.grp
    where a.cup = 'summer_2026' and a.club = f.home and b.club = f.away and f.week between 10 and 18);
  update public.fixtures f set cup = 'summer_2026', look = coalesce(f.look, case when f.week = 15 then 'summer_festive' else 'summer_cup' end)
  where f.cup is null and f.stage is null and f.week between 10 and 18 and exists (
    select 1 from public.cup_groups a join public.cup_groups b on a.cup = b.cup and a.grp = b.grp
    where a.cup = 'summer_2026' and a.club = f.home and b.club = f.away);

  -- checks: every pair meets exactly twice in the league rounds (weeks 5-26), one at each ground
  if exists (select 1 from (select least(home,away) a, greatest(home,away) b, count(*) c, count(distinct home) h from public.fixtures where week between 5 and 26 and stage is null group by 1,2) x where c <> 2 or h <> 2)
     or (select count(distinct (least(home,away), greatest(home,away))) from public.fixtures where week between 5 and 26) <> 55
  then raise exception 'Summer Cup regroup: a pair does not meet exactly twice, once at each ground'; end if;
  -- checks: A and B pairs once in the cup, C pairs twice (once at each ground)
  if exists (
    select 1 from public.cup_groups a join public.cup_groups b on a.cup = b.cup and a.grp = b.grp and a.club < b.club
    where a.cup = 'summer_2026' and (select count(*) from public.fixtures f where f.cup = 'summer_2026' and f.stage is null and least(f.home,f.away) = a.club and greatest(f.home,f.away) = b.club)
      <> case when a.grp = 'C' then 2 else 1 end)
  then raise exception 'Summer Cup regroup: cup group matches are wrong'; end if;
  raise notice 'Summer Cup regroup: done';
end $$;
