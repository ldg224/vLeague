-- 0.11.1: nobody is a perfect 10. A player's offense and defense add up to at most 19 (so the best possible is 10/9 or
-- 9/10), and the price curve is steeper so the very best cost $10,000 or more (the user's decision, 5 October 2026).
--   overall = position-weighted mix (GK: 90% defense, 10% offense; DEF: 30/70; MID: 50/50; FWD: 70/30)
--   value   = 500 + 11500 * ((overall - 1) / 9) ^ 2, rounded to the nearest $50: $500 to about $11,250 (a 10/9 forward).
-- The players table was empty when this ran, so the column is simply rebuilt.

alter table public.players drop column if exists value;
alter table public.players drop constraint if exists players_rating_total;
alter table public.players add constraint players_rating_total check (offense + defense <= 19);
alter table public.players add column value int generated always as (
  (round((500 + 11500 * power(((case position
      when 'GK'  then 0.1 * offense + 0.9 * defense
      when 'DEF' then 0.3 * offense + 0.7 * defense
      when 'MID' then 0.5 * offense + 0.5 * defense
      else            0.7 * offense + 0.3 * defense end) - 1) / 9, 2)) / 50) * 50)::int
) stored;
