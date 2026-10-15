-- S-05: Goal of the week. Additive and safe to re-run.
--   gotw_rounds  one row per round (week). The office picks the shortlist in Editor -> Goal of the week (the browser works it out from the match files),
--                chooses 5 finalists and opens voting. candidates = the shortlisted goals (a json array of { key, fixture, id, t, team, scorerName, wow, ... }),
--                finalists = the keys of the 5 on the ballot. status: 'picking' (office only is looking), 'voting' (managers vote until closes_at), 'closed'.
--   gotw_votes   one vote per manager per round. A manager reads only their own vote, so nobody can see a running tally.
--   gotw_vote()  casts or changes the vote: voting must be open, the manager has a club, the goal is a finalist and is not their own club's.
--   gotw_tally() the votes per finalist, only once voting has ended (closes_at passed or closed by the office), or for the office.
-- Needs 0001 (my_club, is_office).

create table if not exists public.gotw_rounds (
  week        int primary key,
  status      text not null default 'picking' check (status in ('picking', 'voting', 'closed')),
  candidates  jsonb not null default '[]' check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) <= 15),
  finalists   text[] not null default '{}' check (cardinality(finalists) <= 5),
  opens_at    timestamptz,
  closes_at   timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.gotw_rounds enable row level security;
drop policy if exists gotw_rounds_read on public.gotw_rounds;
create policy gotw_rounds_read on public.gotw_rounds for select to authenticated using (status <> 'picking' or public.is_office());
drop policy if exists gotw_rounds_office on public.gotw_rounds;
create policy gotw_rounds_office on public.gotw_rounds for all to authenticated using (public.is_office()) with check (public.is_office());
revoke all on public.gotw_rounds from anon, authenticated;
grant select on public.gotw_rounds to authenticated;
grant insert, update, delete on public.gotw_rounds to authenticated;

create table if not exists public.gotw_votes (
  week        int not null references public.gotw_rounds (week) on update cascade on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  club        text not null,
  pick        text not null,
  created_at  timestamptz not null default now(),
  primary key (week, user_id)
);
alter table public.gotw_votes enable row level security;
drop policy if exists gotw_votes_own on public.gotw_votes;
create policy gotw_votes_own on public.gotw_votes for select to authenticated using (user_id = auth.uid());
revoke all on public.gotw_votes from anon, authenticated;
grant select on public.gotw_votes to authenticated;

create or replace function public.gotw_vote(p_week int, p_pick text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_club(); r record; c jsonb;
begin
  if auth.uid() is null or me is null then raise exception 'Sign in as a club manager to vote.'; end if;
  select * into r from public.gotw_rounds where week = p_week;
  if not found or r.status <> 'voting' or (r.closes_at is not null and now() >= r.closes_at) then raise exception 'Voting isn’t open.'; end if;
  if not (p_pick = any (r.finalists)) then raise exception 'That goal isn’t on the ballot.'; end if;
  select x into c from jsonb_array_elements(r.candidates) x where x->>'key' = p_pick;
  if c is null or c->>'team' = me then raise exception 'You can’t vote for your own club’s goal.'; end if;
  insert into public.gotw_votes (week, user_id, club, pick) values (p_week, auth.uid(), me, p_pick)
  on conflict (week, user_id) do update set pick = excluded.pick, club = excluded.club, created_at = now();
end $$;
revoke all on function public.gotw_vote(int, text) from public, anon;
grant execute on function public.gotw_vote(int, text) to authenticated;

create or replace function public.gotw_tally(p_week int) returns table (pick text, votes bigint)
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.gotw_rounds where week = p_week;
  if not found then return; end if;
  if not (public.is_office() or r.status = 'closed' or (r.status = 'voting' and r.closes_at is not null and now() >= r.closes_at)) then return; end if;
  return query select v.pick, count(*) from public.gotw_votes v where v.week = p_week group by v.pick order by count(*) desc, v.pick;
end $$;
revoke all on function public.gotw_tally(int) from public, anon;
grant execute on function public.gotw_tally(int) to authenticated;
