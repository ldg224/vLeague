-- S-37 (8 Nov 2026, the user): at least 2 days between rounds, for Goal of the Week, line-ups and Stakes. Safe to re-run.
-- From Round 3 (week 7) the season played two rounds a week (a weekend round, then one game a day Mon-Fri at 5:30 pm) with under a day between them.
-- Now, Melbourne time:
--   weekend rounds: Sat 10:30, 2:00, 5:30 and Sun 10:30, 2:00 (a Sat 2 pm game added, Sun 5:30 dropped), so each is over by about 3 pm Sunday;
--   midweek rounds: Tue 5:30 and 7:00, Wed 4:00, 5:30 and 7:00;
--   the New Year's round (week 16, was Fri 1 Jan, the day before Round 13) on Wed 30 Dec at 12:00-4:00, one an hour as before;
--   week 15 (Sat 19 Dec, five games 12:00-4:00) stays as it is.
-- Each round keeps its games in the same order. Times are worked out from the Monday of the round's own week, so running this again changes nothing.
-- Line-ups lock an hour before each round's first game, as before.

with ord as (
  select f.id, f.week,
         row_number() over (partition by f.week order by f.starts_at, f.id) as k,
         date_trunc('week', min(f.starts_at at time zone 'Australia/Melbourne') over (partition by f.week))::date as mon
  from public.fixtures f
  where f.week between 7 and 26 and f.week <> 15 and not coalesce(f.postponed, false)
    and not exists (select 1 from public.results r where r.fixture = f.id)
), slot as (
  select id, week, k,
    case
      when week = 16 then date '2026-12-30' + (array[time '12:00', time '13:00', time '14:00', time '15:00', time '16:00'])[k]
      when week in (8, 10, 12, 14, 18, 20, 22, 24, 26) then
        (mon + (array[1, 1, 2, 2, 2])[k]) + (array[time '17:30', time '19:00', time '16:00', time '17:30', time '19:00'])[k]
      else
        (mon + (array[5, 5, 5, 6, 6])[k]) + (array[time '10:30', time '14:00', time '17:30', time '10:30', time '14:00'])[k]
    end as local_ko
  from ord where k <= 5
)
update public.fixtures f
set starts_at = s.local_ko at time zone 'Australia/Melbourne'
from slot s
where f.id = s.id and f.starts_at is distinct from (s.local_ko at time zone 'Australia/Melbourne');

update public.deadlines d
set locks_at = x.first_ko - interval '60 minutes'
from (select week, min(starts_at) as first_ko from public.fixtures where week between 7 and 26 group by week) x
where d.week = x.week and d.locked_at is null and d.locks_at is distinct from x.first_ko - interval '60 minutes';
