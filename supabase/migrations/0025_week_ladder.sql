-- 0.21.1: a week can be a showcase or pre-season week whose results don't count for the ladder.
alter table public.rounds add column if not exists counts_for_ladder boolean not null default true;
