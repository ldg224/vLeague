-- Preseason is a round Type (like Regular, Special, Finals) instead of a separate switch: one setting, and "counts for the table" follows from it.
-- Replaces the 0059 column (never used by a released version). Additive for the live site, which only ever sees kind values it knows or ignores.
alter table public.rounds drop constraint if exists rounds_kind_check;
alter table public.rounds add constraint rounds_kind_check check (kind in ('regular', 'special', 'finals', 'preseason'));
update public.rounds set kind = 'preseason', counts_for_ladder = false where preseason;
alter table public.rounds drop column if exists preseason;
