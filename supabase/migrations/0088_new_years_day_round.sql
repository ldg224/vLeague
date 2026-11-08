-- The New Year's Day Round back on New Year's Day (8 Nov 2026, the user). Safe to re-run.
-- 0087 (S-37, two days between rounds) moved week 16 to Wed 30 Dec to keep the gap before Round 13 (Sat 2 Jan). The round is named for the day, so it is an
-- exception to the gap: Fri 1 Jan 2027, 12:00 to 4:00 pm Melbourne, one game an hour, in the same order, as it was before 0087. Line-ups lock at 11:00.
-- Round 13 stays on Sat 2 and Sun 3 Jan, so there is less than a day between them.

with ord as (
  select f.id, row_number() over (order by f.starts_at, f.id) as k
  from public.fixtures f
  where f.week = 16 and not coalesce(f.postponed, false) and not exists (select 1 from public.results r where r.fixture = f.id)
)
update public.fixtures f
set starts_at = (date '2027-01-01' + (array[time '12:00', time '13:00', time '14:00', time '15:00', time '16:00'])[o.k]) at time zone 'Australia/Melbourne'
from ord o
where f.id = o.id and o.k <= 5;

update public.deadlines d
set locks_at = x.first_ko - interval '60 minutes'
from (select min(starts_at) as first_ko from public.fixtures where week = 16) x
where d.week = 16 and d.locked_at is null;
