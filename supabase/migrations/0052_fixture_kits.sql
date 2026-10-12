-- 0.69: the Editor can choose the kit each side wears in a match. null = no Editor choice (the team's sheet pick, else automatic).
-- Needs 0013 (fixtures) and 0043 (kits). Office-only writes come from the existing fixtures_office_write policy. Safe to re-run.

alter table public.fixtures add column if not exists home_kit text check (home_kit is null or home_kit in ('home', 'away', 'special'));
alter table public.fixtures add column if not exists away_kit text check (away_kit is null or away_kit in ('home', 'away', 'special'));
