-- 0.27.0: a week can name the clubs that are on a bye. A club with neither a match nor a bye is "not placed yet",
-- which the Checks list still flags; a club on a bye is not. The list is by club code. Entries for a club that ends
-- up playing that week are simply ignored, so nothing needs tidying when a match is changed.
alter table public.rounds add column if not exists byes text[] not null default '{}';
