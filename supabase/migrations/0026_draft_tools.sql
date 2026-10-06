-- 0.23: more draft tools. Needs 0023 and 0024.
--   roster rules: the most (roster_max) and fewest (roster_min) players a club may hold in each position, e.g. {"DEF": 5}
--   _draft_can_pick()      the one place the rules are checked; managers' picks and every automatic pick use it
--   office_delete_draft()  delete a draft at any stage, optionally returning its drafted players to free agency
--   office_draft_reset()   back to set-up: every pick taken back, the clock stopped

alter table public.drafts add column if not exists roster_max jsonb not null default '{}'::jsonb;
alter table public.drafts add column if not exists roster_min jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.drafts add constraint drafts_roster_rules check (jsonb_typeof(roster_max) = 'object' and jsonb_typeof(roster_min) = 'object');
exception when duplicate_object then null; end $$;

-- null = this club may take this player now; otherwise the reason in plain words. Looks at the pick on the clock.
-- A maximum stops a club taking more than that many of a position. A minimum has to stay reachable: after this pick the club
-- must still have enough picks left to fill every position up to its minimum.
create or replace function public._draft_can_pick(p_draft bigint, p_club text, p_player text) returns text
language plpgsql stable security definer set search_path = public as $$
declare d public.drafts; pos text; have int; mx int; remaining int; needed int := 0; k text; mn int; cnt int;
begin
  select * into d from public.drafts where id = p_draft;
  select p.position into pos from public.players p where p.id = p_player;
  if pos is null then return 'That player doesn''t exist.'; end if;
  select count(*) into have from public.players p where p.club = p_club and p.position = pos;
  mx := (d.roster_max ->> pos)::int;
  if mx is not null and have >= mx then return format('A club can have at most %s %s.', mx, pos); end if;
  select count(*) into remaining from public.draft_order o where o.draft = p_draft and o.club = p_club and o.pick_no > d.current_pick;
  for k, mn in select key, value::int from jsonb_each_text(d.roster_min) loop
    select count(*) into cnt from public.players p where p.club = p_club and p.position = k;
    if k = pos then cnt := cnt + 1; end if;
    needed := needed + greatest(mn - cnt, 0);
  end loop;
  if needed > remaining then return format('That would leave too few picks to reach the minimum for each position (%s still needed, %s picks left).', needed, remaining); end if;
  return null;
end $$;
revoke all on function public._draft_can_pick(bigint, text, text) from public, anon, authenticated;

-- Make one pick (as 0023), now checking the roster rules for a manager's own pick. The office's picks are overrides and skip them.
create or replace function public._draft_apply(p_draft bigint, p_player text, p_how text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; who text; total int; why text;
begin
  select * into d from public.drafts where id = p_draft for update;
  select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
  if who is null then raise exception 'There is no pick %.', d.current_pick; end if;
  if p_player is not null then
    if not exists (select 1 from public.players where id = p_player and club is null) then raise exception 'That player isn''t available.'; end if;
    if p_how = 'manual' then
      why := public._draft_can_pick(p_draft, who, p_player);
      if why is not null then raise exception '%', why; end if;
    end if;
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

-- The clock (as 0024), choosing only players the club is allowed to take.
create or replace function public.draft_tick() returns int
language plpgsql security definer set search_path = public as $$
declare dr public.drafts; cur public.drafts; who text; v_mode text; v_mins int; queued text; best text; started timestamptz;
        timed_out boolean; n int := 0; guard int;
begin
  for dr in select * from public.drafts where status = 'live'
      and (opens_at is null or now() >= opens_at) and (closes_at is null or now() <= closes_at) loop
    guard := 0;
    loop
      select * into cur from public.drafts where id = dr.id;
      exit when cur.status <> 'live' or guard >= 200;
      guard := guard + 1;
      select club into who from public.draft_order where draft = cur.id and pick_no = cur.current_pick;
      exit when who is null;
      select p.mode, p.minutes into v_mode, v_mins from public.draft_prefs p where p.draft = cur.id and p.club = who;
      v_mode := coalesce(v_mode, 'on_miss');
      timed_out := cur.pick_deadline is not null and now() >= cur.pick_deadline;
      started := cur.pick_deadline - make_interval(mins => cur.pick_minutes);

      queued := null;
      if v_mode <> 'never' then
        select q.player into queued from public.draft_queue q join public.players pl on pl.id = q.player and pl.club is null
          where q.draft = cur.id and q.club = who and public._draft_can_pick(cur.id, who, q.player) is null order by q.rank limit 1;
      end if;

      if queued is not null and (v_mode = 'always' or timed_out
          or (v_mode = 'after_minutes' and now() >= started + make_interval(mins => coalesce(v_mins, cur.pick_minutes)))) then
        perform public._draft_apply(cur.id, queued, 'queue');
        n := n + 1;
        continue;
      end if;

      exit when not timed_out;
      best := null;
      if cur.on_timeout = 'best_value' then
        select pl.id into best from public.players pl where pl.club is null and public._draft_can_pick(cur.id, who, pl.id) is null
          order by pl.value desc, pl.id limit 1;
      end if;
      perform public._draft_apply(cur.id, best, case when best is null then 'skip' else 'auto' end);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.draft_tick() from public, anon, authenticated;

-- Auto-assign (as 0024), best value first among the players each club is allowed to take.
create or replace function public.office_autofill(p_draft bigint, p_count int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d public.drafts; best text; who text; n int := 0;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  loop
    select * into d from public.drafts where id = p_draft for update;
    if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
    if d.status not in ('live', 'paused') then
      if n = 0 then raise exception 'The draft isn''t running.'; end if;
      exit;
    end if;
    exit when p_count is not null and n >= p_count;
    select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
    select pl.id into best from public.players pl where pl.club is null and public._draft_can_pick(p_draft, who, pl.id) is null
      order by pl.value desc, pl.id limit 1;
    perform public._draft_apply(p_draft, best, case when best is null then 'skip' else 'office' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.office_autofill(bigint, int) from public, anon;
grant execute on function public.office_autofill(bigint, int) to authenticated;

-- Delete a draft at any stage. p_release also returns every player it drafted to free agency (only while they're still at
-- the club that drafted them).
create or replace function public.office_delete_draft(p_draft bigint, p_release boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not exists (select 1 from public.drafts where id = p_draft) then raise exception 'That draft doesn''t exist.'; end if;
  if p_release then
    update public.players pl set club = null from public.draft_picks k
      where k.draft = p_draft and k.player = pl.id and pl.club = k.club;
    get diagnostics n = row_count;
  end if;
  delete from public.drafts where id = p_draft;
  return n;
end $$;
revoke all on function public.office_delete_draft(bigint, boolean) from public, anon;
grant execute on function public.office_delete_draft(bigint, boolean) to authenticated;

-- Back to set-up: every pick taken back (players return to free agency), the clock stopped. The order and settings stay.
create or replace function public.office_draft_reset(p_draft bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not exists (select 1 from public.drafts where id = p_draft) then raise exception 'That draft doesn''t exist.'; end if;
  update public.players pl set club = null from public.draft_picks k
    where k.draft = p_draft and k.player = pl.id and pl.club = k.club;
  delete from public.draft_picks where draft = p_draft;
  get diagnostics n = row_count;
  update public.drafts set status = 'setup', current_pick = 1, pick_deadline = null where id = p_draft;
  return n;
end $$;
revoke all on function public.office_draft_reset(bigint) from public, anon;
grant execute on function public.office_draft_reset(bigint) to authenticated;
