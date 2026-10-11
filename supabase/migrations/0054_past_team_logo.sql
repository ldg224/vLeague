-- A past team (a club that has left the league) can have a logo, shown beside its name on the Seasons tab and the History page.
-- The picture is a PNG in the public `trophies` bucket (the office uploads it in Editor -> History, as for trophy pictures); this holds its path.
-- Additive and safe to re-run.
alter table public.history_past_teams add column if not exists crest_path text;
