-- 0.11.2: the weekly cap is $100,000 per team (the user's decision, 5 October 2026), so prices are scaled to fit, and
-- goalkeepers' offense counts (they play it out from the back).
--   overall = position-weighted mix (GK: 25% offense, 75% defense; DEF: 30/70; MID: 50/50; FWD: 70/30)
--   value   = 700 + 17300 * ((overall - 1) / 9) ^ 2, rounded to the nearest $100: $700 to about $16,900 (a 10/9 forward).
-- An average player is about $5,600, so a typical 16-man squad costs about $90,000.

alter table public.players drop column if exists value;
alter table public.players add column value int generated always as (
  (round((700 + 17300 * power(((case position
      when 'GK'  then 0.25 * offense + 0.75 * defense
      when 'DEF' then 0.3 * offense + 0.7 * defense
      when 'MID' then 0.5 * offense + 0.5 * defense
      else            0.7 * offense + 0.3 * defense end) - 1) / 9, 2)) / 100) * 100)::int
) stored;
