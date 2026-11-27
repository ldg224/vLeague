-- B-53 (Fixtures): fair repeat meetings (27 Nov 2026). Data only. Safe to re-run: it does nothing once applied.
--
-- Reported by Sreehari (SKS): SKS played some clubs 3 times and others only once. With 11 clubs over 26 rounds some pairs must meet 3 times, but it
-- was uneven: 18 pairs met 3 times and 3 pairs only once (SKS v CFC, SKS v LFC, DTP v LAU), and SKS had five 3x opponents. Now every pair meets
-- 2 or 3 times, each club playing 23 games has exactly three 3x opponents (22 games: two), and every pair is split fairly between grounds.
-- Only 13 games in Rounds 12-26 change opponents or ground, keeping their round, date and kick-off. Played games, games with Stakes lines,
-- Summer Cup games and special looks (derbies) are not touched. SKS v LAU stays 3 times: one is played and two are Summer Cup group games.

do $$
declare n int;
begin
  update public.fixtures f set home = v.nh, away = v.na, home_kit = null, away_kit = null
  from (values
    ('r8-lfc-ccf', 'LFC', 'CCF', 'LFC', 'SKS'),
    ('r8-tur-sks', 'TUR', 'SKS', 'CCF', 'TUR'),
    ('r11-cfc-lfc', 'CFC', 'LFC', 'LFC', 'CFC'),
    ('r13-prf-sks', 'PRF', 'SKS', 'LFC', 'PRF'),
    ('r13-lfc-tur', 'LFC', 'TUR', 'TUR', 'SKS'),
    ('r15-cfc-lau', 'CFC', 'LAU', 'PRF', 'CFC'),
    ('r15-dtp-prf', 'DTP', 'PRF', 'DTP', 'LAU'),
    ('r16-lfc-sks', 'LFC', 'SKS', 'SKS', 'LFC'),
    ('r17-ccf-lfc', 'CCF', 'LFC', 'LFC', 'CCF'),
    ('r19-lfc-prf', 'LFC', 'PRF', 'DTP', 'PRF'),
    ('r19-cfc-dtp', 'CFC', 'DTP', 'CFC', 'LFC'),
    ('r22-lfc-cfc', 'LFC', 'CFC', 'LFC', 'TUR'),
    ('r22-sks-tur', 'SKS', 'TUR', 'SKS', 'CFC')
  ) as v(id, oh, oa, nh, na)
  where f.id = v.id and f.home = v.oh and f.away = v.oa
    and f.cup is null and f.look is null
    and not exists (select 1 from public.results r where r.fixture = f.id)
    and not exists (select 1 from public.stakes_lines s where s.fixture = f.id);
  get diagnostics n = row_count;
  raise notice 'B-53: % fixtures changed', n;
  if n not in (0, 13) then raise exception 'B-53: expected 13 rows, got %', n; end if;
  -- check: every pair meets 2 or 3 times in Rounds 1-26
  if exists (select 1 from (select least(home,away), greatest(home,away), count(*) c from public.fixtures where week between 1 and 26 group by 1,2) x where c not in (2,3))
     or (select count(*) from (select distinct least(home,away), greatest(home,away) from public.fixtures where week between 1 and 26) y) <> 55
  then raise exception 'B-53: a pair does not meet 2 or 3 times'; end if;
end $$;
