-- The Australia Day Round all on Australia Day (8 Nov 2026, the user: "all on australia day"). Safe to re-run.
-- 0087 (S-37) put week 24 on Tue 26 and Wed 27 Jan 2027. Like the New Year's Day Round (0088), a round named for its day is an exception to the two-day gap:
-- all five games on Tue 26 Jan, 12:00 to 4:00 pm Melbourne, one an hour, in the same order. Line-ups lock at 11:00. Round 19 ends Sun 24 Jan at about 3 pm,
-- so the gap before it is just under two days.

with ord as (
  select f.id, row_number() over (order by f.starts_at, f.id) as k
  from public.fixtures f
  where f.week = 24 and not coalesce(f.postponed, false) and not exists (select 1 from public.results r where r.fixture = f.id)
)
update public.fixtures f
set starts_at = (date '2027-01-26' + (array[time '12:00', time '13:00', time '14:00', time '15:00', time '16:00'])[o.k]) at time zone 'Australia/Melbourne'
from ord o
where f.id = o.id and o.k <= 5;

update public.deadlines d
set locks_at = x.first_ko - interval '60 minutes'
from (select min(starts_at) as first_ko from public.fixtures where week = 24) x
where d.week = 24 and d.locked_at is null;
