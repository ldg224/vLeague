-- The Summer Cup (S-51, the user, 26 Nov 2026): an in-season cup, NBA Cup style. Safe to re-run. Needs 0071, 0079 and 0098.
--   Groups (seeded from the table after Round 4): A SSF TUR DTP LFC · B VVS PRF CFC NGY · C LAU SKS CCF.
--   Group stage, Rounds 6 to 14: chosen league matches count for the league AND the cup group (fixtures.cup). A and B play once, C home and away.
--   Semi-finals and the Final are cup-only matches (fixtures.cup + stage SF / GF), so they never count for the league table.
--   Two league fixture swaps make room for Group C's home-and-away games: R7 SKS v LAU + CFC v DTP, R11 SKS v CCF + CFC v LFC.

-- ---------- cups and their groups ----------
create table if not exists public.cups (
  key text primary key check (key ~ '^[a-z0-9_]{2,24}$'),
  name text not null,
  settings jsonb not null default '{}'::jsonb,   -- { look, colours: { A, B, C }, qualify: { winners, best_runners_up } }
  created_at timestamptz not null default now()
);
create table if not exists public.cup_groups (
  cup text not null references public.cups(key) on update cascade on delete cascade,
  grp text not null check (grp ~ '^[A-H]$'),
  club text not null references public.clubs(code) on update cascade on delete cascade,
  seed int,
  primary key (cup, club)
);
alter table public.cups enable row level security;
alter table public.cup_groups enable row level security;
drop policy if exists cups_read on public.cups;
create policy cups_read on public.cups for select to anon, authenticated using (true);
drop policy if exists cups_office_write on public.cups;
create policy cups_office_write on public.cups for all to authenticated using (public.is_office()) with check (public.is_office());
drop policy if exists cup_groups_read on public.cup_groups;
create policy cup_groups_read on public.cup_groups for select to anon, authenticated using (true);
drop policy if exists cup_groups_office_write on public.cup_groups;
create policy cup_groups_office_write on public.cup_groups for all to authenticated using (public.is_office()) with check (public.is_office());

-- A fixture in a cup: a group match (a league match that also counts for its group) or, with a stage, a cup knockout match.
alter table public.fixtures add column if not exists cup text references public.cups(key) on update cascade on delete set null;

-- ---------- the look ----------
insert into public.looks (key, name, settings) values ('summer_cup', 'Summer Cup', '{"accent":"#ff6b4a","banner":"SUMMER CUP","theme":{"bg":["#0b2f3a","#061a21"],"edge":"#ffb627","ink":"#fff3df","score":["#ffffff","#ffe3b0"],"plate":["#ff6b4a","#ffb627"],"plateInk":"#061a21","glow":"#ffb627","clock":"#22b8b0","clockInk":"#061a21","fx":["shine"],"spill":"glints"}}'::jsonb)
on conflict (key) do nothing;

-- ---------- the cup ----------
insert into public.cups (key, name, settings) values ('summer_2026', 'Summer Cup',
  '{"look":"summer_cup","colours":{"A":"#ff6b4a","B":"#22b8b0","C":"#ffb627"},"qualify":{"winners":true,"best_runners_up":1}}'::jsonb)
on conflict (key) do nothing;
insert into public.cup_groups (cup, grp, club, seed) values
  ('summer_2026', 'A', 'SSF', 1), ('summer_2026', 'A', 'TUR', 2), ('summer_2026', 'A', 'DTP', 3), ('summer_2026', 'A', 'LFC', 4),
  ('summer_2026', 'B', 'VVS', 1), ('summer_2026', 'B', 'PRF', 2), ('summer_2026', 'B', 'CFC', 3), ('summer_2026', 'B', 'NGY', 4),
  ('summer_2026', 'C', 'LAU', 1), ('summer_2026', 'C', 'SKS', 2), ('summer_2026', 'C', 'CCF', 3)
on conflict (cup, club) do nothing;

-- ---------- the fixture swaps (only while the old pairings still stand and nothing is played) ----------
-- Round 7 (week 11): SKS v Cranbourne + Donald Trump v Lads  ->  SKS v Lads + Cranbourne v Donald Trump
-- Round 11 (week 15): Come Come v Cranbourne + SKS v Lucky   ->  SKS v Come Come + Cranbourne v Lucky
do $$
declare swaps text[][] := array[
  array['11', 'SKS', 'CFC', 'SKS', 'LAU'], array['11', 'DTP', 'LAU', 'CFC', 'DTP'],
  array['15', 'CCF', 'CFC', 'SKS', 'CCF'], array['15', 'SKS', 'LFC', 'CFC', 'LFC']];
  s text[]; moved text[] := '{}';
begin
  foreach s slice 1 in array swaps loop
    with f as (
      update public.fixtures x set home = s[4], away = s[5], home_kit = null, away_kit = null
      where x.week = s[1]::int and x.home = s[2] and x.away = s[3] and not exists (select 1 from public.results r where r.fixture = x.id)
      returning x.id)
    select moved || coalesce(array_agg(id), '{}') into moved from f;
  end loop;
  if cardinality(moved) > 0 then
    perform public.fixture_ids_by_round();   -- r7-sks-cfc -> r7-sks-lau, ...
    -- an old address of a swapped match must not open the new pairing: drop the aliases pointing at these four
    delete from public.fixture_aliases a using public.fixtures f
      where a.fixture = f.id and ((f.week = 11 and (f.home, f.away) in (('SKS', 'LAU'), ('CFC', 'DTP'))) or (f.week = 15 and (f.home, f.away) in (('SKS', 'CCF'), ('CFC', 'LFC'))));
  end if;
end $$;

-- ---------- the cup matches (by round week and pairing, so the ids don't matter) ----------
update public.fixtures f set cup = 'summer_2026', look = coalesce(f.look, 'summer_cup')
from (values
  -- Group A
  (11, 'TUR', 'LFC'), (14, 'TUR', 'SSF'), (14, 'LFC', 'DTP'), (15, 'DTP', 'TUR'), (17, 'DTP', 'SSF'), (18, 'SSF', 'LFC'),
  -- Group B
  (12, 'CFC', 'PRF'), (13, 'PRF', 'NGY'), (14, 'NGY', 'CFC'), (15, 'VVS', 'PRF'), (17, 'NGY', 'VVS'), (18, 'VVS', 'CFC'),
  -- Group C (home and away)
  (10, 'CCF', 'LAU'), (11, 'SKS', 'LAU'), (13, 'CCF', 'SKS'), (15, 'SKS', 'CCF'), (17, 'LAU', 'CCF'), (18, 'LAU', 'SKS')
) as c(week, home, away)
where f.week = c.week and f.home = c.home and f.away = c.away and f.cup is null;
