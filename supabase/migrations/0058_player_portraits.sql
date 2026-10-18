-- Player portraits. Additive and safe to re-run.
--   look  the background the player's portrait is drawn from (the face, skin tones, hair and beard that suit his name). The Editor sets it
--         (suggested from the name); null falls back to 'euro' in the drawing.
--   face  a number the Editor bumps to re-roll a portrait. The portrait is drawn in the browser from the player's id, face, look and club
--         colours (js/portrait.js), so nothing is stored but these two columns.
-- Needs 0008. The existing players policies already cover the new columns.

alter table public.players add column if not exists look text check (look in ('euro', 'latin', 'mena', 'southasian', 'eastasian', 'black', 'pacific'));
alter table public.players add column if not exists face int not null default 0 check (face between 0 and 9999);
