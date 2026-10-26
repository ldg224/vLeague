-- Stakes: the score predictions live only in the "Game predictors" section now, not as big cards (26 Oct 2026). Safe to re-run. Needs 0061 to 0066.
--
-- The cards in the grid are player over/under stakes only, so the round's limit (lines_per_week) is all player stakes: no score prediction is featured any more.
-- stakes_settings.score_per_week stays in the table (it now defaults to 0); the Editor no longer shows it.
alter table public.stakes_settings alter column score_per_week set default 0;
update public.stakes_settings set score_per_week = 0;
update public.stakes_lines set featured = false where kind = 'score' and featured;
