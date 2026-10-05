-- 0.11: the league's players live here, not in the s3 test site.
-- Every player starts as a free agent (club is null); the office deals them to clubs later (a draft).
-- Everyone can read the table; only the league office changes it. Offense and defense are 1 to 10.
-- `value` is the player's price in dollars, always worked out from the two ratings (never typed in):
--   overall = position-weighted mix (GK: defense; DEF: 30% offense, 70% defense; MID: even; FWD: 70% offense, 30% defense)
--   value   = 500 + 7500 * ((overall - 1) / 9) ^ 1.8, rounded to the nearest $50 ($500 to $8,000).

create sequence if not exists public.player_id_seq minvalue 1 start 1;

create table if not exists public.players (
  id       text primary key default lpad(nextval('public.player_id_seq')::text, 4, '0'),
  name     text not null check (name = btrim(name) and char_length(name) between 2 and 40),
  position text not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  offense  int  not null check (offense between 1 and 10),
  defense  int  not null check (defense between 1 and 10),
  club     text references public.clubs (code) on update cascade on delete set null,
  value    int generated always as (
    (round((500 + 7500 * power(((case position
        when 'GK'  then defense::float8
        when 'DEF' then 0.3 * offense + 0.7 * defense
        when 'MID' then 0.5 * offense + 0.5 * defense
        else            0.7 * offense + 0.3 * defense end) - 1) / 9, 1.8)) / 50) * 50)::int
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists players_name_unique on public.players (lower(name));
create index if not exists players_club on public.players (club);

drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players for each row execute function public.touch_updated_at();

alter table public.players enable row level security;
drop policy if exists players_read on public.players;
create policy players_read on public.players for select to anon, authenticated using (true);
drop policy if exists players_office_write on public.players;
create policy players_office_write on public.players for all to authenticated
  using (public.is_office()) with check (public.is_office());
revoke all on public.players from anon, authenticated;
grant select on public.players to anon, authenticated;
grant insert, update, delete on public.players to authenticated;
grant usage on sequence public.player_id_seq to authenticated;

-- Reset for the new player pool (the user's decision, 5 October 2026): the old s3 players are gone, so every club's
-- saved team sheet (which points at their ids) and its save history are cleared. The locked test week 1 is left as it was
-- (a locked week can't be deleted; that is the office's call).
update public.team_sheets set formation = null, tactics = '{}', lineup = '{}', bench = '[]',
  captain = null, penalties = null, freekicks = null, corners = null;
delete from public.team_sheet_versions;
