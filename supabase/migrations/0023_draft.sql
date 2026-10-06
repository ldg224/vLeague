-- 0.21: the draft (see docs/DRAFT.md). A limited-time, slow draft: the office sets it up and the order, managers pick players
-- into their clubs on their turn (or leave a queue and an auto-pick rule). Every pick goes through make_pick() or the office
-- functions, so whose turn it is, a free player and the window are always checked by the database.

create table if not exists public.drafts (
  id            bigint generated always as identity primary key,
  name          text not null check (char_length(name) between 2 and 60),
  status        text not null default 'setup' check (status in ('setup', 'live', 'paused', 'done')),
  opens_at      timestamptz,
  closes_at     timestamptz,
  pick_minutes  int not null default 720 check (pick_minutes between 1 and 20160),   -- time a club has per pick
  on_timeout    text not null default 'queue' check (on_timeout in ('skip', 'queue', 'best_value')),
  rounds        int not null default 1 check (rounds between 1 and 50),
  current_pick  int not null default 1,
  pick_deadline timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.draft_order (
  draft   bigint not null references public.drafts (id) on delete cascade,
  pick_no int not null check (pick_no >= 1),
  club    text not null references public.clubs (code) on update cascade on delete cascade,
  primary key (draft, pick_no)
);

create table if not exists public.draft_picks (
  draft   bigint not null references public.drafts (id) on delete cascade,
  pick_no int not null,
  club    text not null references public.clubs (code) on update cascade,
  player  text references public.players (id) on delete set null,   -- null = the pick was skipped
  made_at timestamptz not null default now(),
  how     text not null check (how in ('manual', 'queue', 'auto', 'office', 'skip')),
  primary key (draft, pick_no)
);
create unique index if not exists draft_picks_player on public.draft_picks (draft, player) where player is not null;

create table if not exists public.draft_queue (
  draft  bigint not null references public.drafts (id) on delete cascade,
  club   text not null references public.clubs (code) on update cascade on delete cascade,
  player text not null references public.players (id) on delete cascade,
  rank   int not null check (rank >= 1),
  primary key (draft, club, player)
);

-- How a club wants its queue used: always (pick from it the moment it's my turn), on_miss (when my time runs out),
-- after_minutes (N minutes into my turn), never (the queue is only a reference).
create table if not exists public.draft_prefs (
  draft   bigint not null references public.drafts (id) on delete cascade,
  club    text not null references public.clubs (code) on update cascade on delete cascade,
  mode    text not null default 'on_miss' check (mode in ('always', 'on_miss', 'after_minutes', 'never')),
  minutes int check (minutes is null or minutes between 1 and 20160),
  primary key (draft, club)
);

alter table public.drafts enable row level security;
alter table public.draft_order enable row level security;
alter table public.draft_picks enable row level security;
alter table public.draft_queue enable row level security;
alter table public.draft_prefs enable row level security;
do $$ declare t text; begin
  foreach t in array array['drafts', 'draft_order', 'draft_picks'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
  foreach t in array array['drafts', 'draft_order'] loop
    execute format('drop policy if exists %I_office_write on public.%I', t, t);
    execute format('create policy %I_office_write on public.%I for all to authenticated using (public.is_office()) with check (public.is_office())', t, t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['draft_queue', 'draft_prefs'] loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format('create policy %I_own on public.%I for all to authenticated using (club = public.my_club() or public.is_office()) with check (club = public.my_club() or public.is_office())', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.drafts_id_seq to authenticated;

-- Each club's roster size and value: the "active team value" page.
create or replace view public.club_values with (security_invoker = true) as
  select c.code as club, count(p.id)::int as players, coalesce(sum(p.value), 0)::int as value
  from public.clubs c left join public.players p on p.club = c.code
  group by c.code;
grant select on public.club_values to anon, authenticated;

-- Make one pick, advance the clock and finish the draft after the last pick. Internal: callers check who may pick.
create or replace function public._draft_apply(p_draft bigint, p_player text, p_how text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; who text; total int;
begin
  select * into d from public.drafts where id = p_draft for update;
  select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
  if who is null then raise exception 'There is no pick %.', d.current_pick; end if;
  if p_player is not null then
    if not exists (select 1 from public.players where id = p_player and club is null) then raise exception 'That player isn''t available.'; end if;
    update public.players set club = who where id = p_player;
  end if;
  insert into public.draft_picks (draft, pick_no, club, player, how) values (p_draft, d.current_pick, who, p_player, p_how);
  delete from public.draft_queue where draft = p_draft and player = p_player;
  select count(*) into total from public.draft_order where draft = p_draft;
  if d.current_pick >= total then
    update public.drafts set status = 'done', current_pick = d.current_pick + 1, pick_deadline = null where id = p_draft;
  else
    update public.drafts set current_pick = d.current_pick + 1, pick_deadline = now() + make_interval(mins => d.pick_minutes) where id = p_draft;
  end if;
end $$;
revoke all on function public._draft_apply(bigint, text, text) from public, anon, authenticated;

-- A manager picks on their club's turn, while the draft is live and inside its window.
create or replace function public.make_pick(p_draft bigint, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; who text;
begin
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if d.status <> 'live' then raise exception 'The draft isn''t running right now.'; end if;
  if (d.opens_at is not null and now() < d.opens_at) or (d.closes_at is not null and now() > d.closes_at) then raise exception 'The draft is closed.'; end if;
  select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
  if who is distinct from public.my_club() then raise exception 'It isn''t your pick.'; end if;
  perform public._draft_apply(p_draft, p_player, 'manual');
end $$;
revoke all on function public.make_pick(bigint, text) from public, anon;
grant execute on function public.make_pick(bigint, text) to authenticated;

-- The office makes (or overrides) the pick that is on the clock for whoever is on it. A null player skips the pick.
create or replace function public.office_set_pick(p_draft bigint, p_player text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not exists (select 1 from public.drafts where id = p_draft and status in ('live', 'paused')) then raise exception 'The draft isn''t running.'; end if;
  perform public._draft_apply(p_draft, p_player, case when p_player is null then 'skip' else 'office' end);
end $$;
revoke all on function public.office_set_pick(bigint, text) from public, anon;
grant execute on function public.office_set_pick(bigint, text) to authenticated;

-- Start, pause, resume or extend the clock. action: start | pause | resume | extend (p_minutes added to the deadline).
create or replace function public.office_draft_control(p_draft bigint, p_action text, p_minutes int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if p_action = 'start' then
    if d.status <> 'setup' then raise exception 'The draft has already started.'; end if;
    if not exists (select 1 from public.draft_order where draft = p_draft) then raise exception 'Set the draft order first.'; end if;
    update public.drafts set status = 'live', current_pick = 1, pick_deadline = now() + make_interval(mins => d.pick_minutes) where id = p_draft;
  elsif p_action = 'pause' then
    if d.status <> 'live' then raise exception 'The draft isn''t live.'; end if;
    update public.drafts set status = 'paused', pick_deadline = null where id = p_draft;
  elsif p_action = 'resume' then
    if d.status <> 'paused' then raise exception 'The draft isn''t paused.'; end if;
    update public.drafts set status = 'live', pick_deadline = now() + make_interval(mins => d.pick_minutes) where id = p_draft;
  elsif p_action = 'extend' then
    if d.status <> 'live' then raise exception 'The draft isn''t live.'; end if;
    update public.drafts set pick_deadline = coalesce(pick_deadline, now()) + make_interval(mins => greatest(p_minutes, 1)) where id = p_draft;
  else raise exception 'Unknown action.'; end if;
end $$;
revoke all on function public.office_draft_control(bigint, text, int) from public, anon;
grant execute on function public.office_draft_control(bigint, text, int) to authenticated;
