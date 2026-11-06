-- B-35 (Fixtures): every pair of clubs meets once at each ground (7 Nov 2026). Data only. Needs 0079. Safe to re-run: it does nothing once applied.
--
-- Reported by Sreehari (SKS): SKS played four clubs twice at the same ground. 27 of the season's 55 pairs had this, though each club still had 10 home
-- and 10 away. One game of each pair changes ground, keeping its round, date and kick-off. Rounds 1 and 2 are not touched (Round 1 is played, Round 2 has
-- Stakes lines); among the rest, the games were picked to keep runs of home or away games short.

do $$
declare n int; bad int; renamed int;
begin
  -- swap the venue; a game with a result is never touched
  update public.fixtures f set home = v.away, away = v.home, home_kit = f.away_kit, away_kit = f.home_kit
  from (values
    ('r5-dtp-vvs', 'DTP', 'VVS'),
    ('r7-lau-dtp', 'LAU', 'DTP'),
    ('r7-vvs-ccf', 'VVS', 'CCF'),
    ('r10-ccf-prf', 'CCF', 'PRF'),
    ('r11-cfc-ccf', 'CFC', 'CCF'),
    ('r11-prf-vvs', 'PRF', 'VVS'),
    ('r12-lfc-ngy', 'LFC', 'NGY'),
    ('r12-tur-cfc', 'TUR', 'CFC'),
    ('r12-vvs-sks', 'VVS', 'SKS'),
    ('r13-ccf-lau', 'CCF', 'LAU'),
    ('r14-cfc-vvs', 'CFC', 'VVS'),
    ('r14-sks-lau', 'SKS', 'LAU'),
    ('r15-lau-cfc', 'LAU', 'CFC'),
    ('r15-prf-dtp', 'PRF', 'DTP'),
    ('r15-vvs-tur', 'VVS', 'TUR'),
    ('r16-ssf-lau', 'SSF', 'LAU'),
    ('r17-cfc-ssf', 'CFC', 'SSF'),
    ('r17-dtp-sks', 'DTP', 'SKS'),
    ('r17-tur-prf', 'TUR', 'PRF'),
    ('r18-lau-tur', 'LAU', 'TUR'),
    ('r18-sks-cfc', 'SKS', 'CFC'),
    ('r19-prf-lfc', 'PRF', 'LFC'),
    ('r19-tur-ssf', 'TUR', 'SSF'),
    ('r20-ngy-tur', 'NGY', 'TUR'),
    ('r20-vvs-lau', 'VVS', 'LAU'),
    ('r21-ssf-vvs', 'SSF', 'VVS'),
    ('r22-lau-prf', 'LAU', 'PRF')
  ) as v(id, home, away)
  where f.id = v.id and f.home = v.home and f.away = v.away
    and not exists (select 1 from public.results r where r.fixture = f.id);
  get diagnostics n = row_count;
  if n not in (0, 27) then raise exception 'expected 27 swaps, made %', n; end if;

  renamed := public.fixture_ids_by_round();   -- ids hold the home and away codes; this keeps them right and remembers the old ones
  if renamed <> n then raise exception 'expected % renames, made %', n, renamed; end if;

  -- every pair of clubs now meets once at each ground in the numbered season
  select count(*) into bad from (
    select least(home, away), greatest(home, away) from public.fixtures f join public.rounds r on r.week = f.week
    where r.kind = 'regular' and f.week <> 99
    group by 1, 2 having count(*) <> 2 or count(*) filter (where home < away) <> 1) x;
  if bad > 0 then raise exception '% pairs are still not home and away', bad; end if;
  -- all good
end $$;
