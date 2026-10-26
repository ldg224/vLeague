-- S-35: a club can make up to three special kits (slots special, special2, special3). Only widens the allowed values, so every existing row stays valid.
alter table public.club_kits drop constraint if exists club_kits_slot_check;
alter table public.club_kits add constraint club_kits_slot_check check (slot in ('home', 'away', 'gk', 'special', 'special2', 'special3'));

alter table public.team_sheets drop constraint if exists team_sheets_kit_check;
alter table public.team_sheets add constraint team_sheets_kit_check check (kit is null or kit in ('home', 'away', 'special', 'special2', 'special3'));
alter table public.week_sheets drop constraint if exists week_sheets_kit_check;
alter table public.week_sheets add constraint week_sheets_kit_check check (kit is null or kit in ('home', 'away', 'special', 'special2', 'special3'));

alter table public.fixtures drop constraint if exists fixtures_home_kit_check;
alter table public.fixtures add constraint fixtures_home_kit_check check (home_kit is null or home_kit in ('home', 'away', 'special', 'special2', 'special3'));
alter table public.fixtures drop constraint if exists fixtures_away_kit_check;
alter table public.fixtures add constraint fixtures_away_kit_check check (away_kit is null or away_kit in ('home', 'away', 'special', 'special2', 'special3'));
