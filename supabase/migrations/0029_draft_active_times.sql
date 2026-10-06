-- 0.28: active times for the draft. The office sets quiet times (for example 10 pm to 7 am every night) when the pick timer
-- doesn't run. Nothing is blocked: a manager can still pick, and the office can still do everything, in quiet time. Only the
-- clock stops, so a pick that starts at 3 am gets its full time counted from 7 am. Needs 0023 to 0027.
--
-- drafts.quiet is a list of windows: [{"days":[0,1,2,3,4,5,6], "from":"22:00", "to":"07:00"}]. "days" are the days the window
-- STARTS on (0 = Sunday); "to" at or before "from" means it ends the next morning. Times are Melbourne time, the league's zone.
-- drafts.pick_started is when the current pick's clock began (the deadline alone can't say, once quiet time is skipped).
alter table public.drafts add column if not exists quiet jsonb not null default '[]'::jsonb;
alter table public.drafts add column if not exists pick_started timestamptz;

create or replace function public._quiet_valid(q jsonb) returns boolean language plpgsql immutable as $$
declare w jsonb; x text;
begin
  if q is null or jsonb_typeof(q) <> 'array' or jsonb_array_length(q) > 14 then return false; end if;
  for w in select * from jsonb_array_elements(q) loop
    if jsonb_typeof(w) <> 'object' or jsonb_typeof(w->'days') is distinct from 'array' then return false; end if;
    if jsonb_array_length(w->'days') not between 1 and 7 then return false; end if;
    for x in select * from jsonb_array_elements_text(w->'days') loop
      if x !~ '^[0-6]$' then return false; end if;
    end loop;
    if coalesce(w->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(w->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (w->>'from') = (w->>'to') then return false; end if;
  end loop;
  return true;
end $$;
alter table public.drafts drop constraint if exists drafts_quiet_valid;
alter table public.drafts add constraint drafts_quiet_valid check (public._quiet_valid(quiet));

-- Every quiet stretch that could touch [p_from, p_to], as (start, end) instants.
create or replace function public._quiet_intervals(p_from timestamptz, p_to timestamptz, p_quiet jsonb)
returns table (s timestamptz, e timestamptz) language sql stable as $$
  select ((d::date + (w->>'from')::time) at time zone 'Australia/Melbourne'),
         ((d::date + (w->>'to')::time + case when (w->>'to')::time <= (w->>'from')::time then interval '1 day' else interval '0 seconds' end) at time zone 'Australia/Melbourne')
  from generate_series(((p_from at time zone 'Australia/Melbourne')::date - 1)::timestamp, ((p_to at time zone 'Australia/Melbourne')::date + 1)::timestamp, interval '1 day') d,
       jsonb_array_elements(p_quiet) w
  where exists (select 1 from jsonb_array_elements_text(w->'days') x where x::int = extract(dow from d)::int)
$$;

-- If p_t is inside quiet time, when the quiet time (and any that runs on from it) ends; otherwise null.
create or replace function public._quiet_end(p_t timestamptz, p_quiet jsonb) returns timestamptz language plpgsql stable as $$
declare t timestamptz := p_t; en timestamptz; hit boolean := false; i int := 0;
begin
  if p_quiet is null or jsonb_array_length(p_quiet) = 0 then return null; end if;
  loop
    i := i + 1; exit when i > 50;
    select max(e) into en from public._quiet_intervals(t, t, p_quiet) where s <= t and e > t;
    exit when en is null;
    hit := true; t := en;
  end loop;
  return case when hit then t end;
end $$;

create or replace function public._next_quiet_start(p_t timestamptz, p_horizon timestamptz, p_quiet jsonb) returns timestamptz language sql stable as $$
  select min(s) from public._quiet_intervals(p_t, p_horizon, p_quiet) where s > p_t
$$;

-- p_from plus p_minutes of ACTIVE time: quiet time doesn't count.
create or replace function public._draft_add_active(p_from timestamptz, p_minutes double precision, p_quiet jsonb) returns timestamptz
language plpgsql stable as $$
declare t timestamptz := p_from; rem double precision := p_minutes * 60; en timestamptz; nxt timestamptz; i int := 0;
begin
  if p_quiet is null or jsonb_array_length(p_quiet) = 0 then return p_from + make_interval(secs => rem); end if;
  loop
    i := i + 1; exit when i > 400;
    en := public._quiet_end(t, p_quiet);
    if en is not null then t := en; end if;
    nxt := public._next_quiet_start(t, t + make_interval(secs => rem) + interval '2 days', p_quiet);
    if nxt is null or t + make_interval(secs => rem) <= nxt then return t + make_interval(secs => rem); end if;
    rem := rem - extract(epoch from (nxt - t))::double precision;
    t := nxt;
  end loop;
  return t + make_interval(secs => rem);
end $$;

-- Seconds of active time between two instants.
create or replace function public._draft_active_seconds(p_from timestamptz, p_to timestamptz, p_quiet jsonb) returns double precision
language plpgsql stable as $$
declare t timestamptz := p_from; en timestamptz; nxt timestamptz; tot double precision := 0; i int := 0;
begin
  if p_to <= p_from then return 0; end if;
  if p_quiet is null or jsonb_array_length(p_quiet) = 0 then return extract(epoch from (p_to - p_from))::double precision; end if;
  loop
    i := i + 1; exit when i > 400 or t >= p_to;
    en := public._quiet_end(t, p_quiet);
    if en is not null then t := en; continue; end if;
    nxt := public._next_quiet_start(t, p_to, p_quiet);
    if nxt is null or nxt >= p_to then tot := tot + extract(epoch from (p_to - t))::double precision; exit; end if;
    tot := tot + extract(epoch from (nxt - t))::double precision;
    t := nxt;
  end loop;
  return tot;
end $$;
revoke all on function public._quiet_intervals(timestamptz, timestamptz, jsonb), public._quiet_end(timestamptz, jsonb),
  public._next_quiet_start(timestamptz, timestamptz, jsonb), public._draft_add_active(timestamptz, double precision, jsonb),
  public._draft_active_seconds(timestamptz, timestamptz, jsonb) from public, anon, authenticated;

-- What the Draft page needs to show the clock: are we in quiet time (until when), when does the next one start, and how much
-- ACTIVE time is left on the pick. Anyone can ask (the draft itself is public to signed-in managers).
create or replace function public.draft_quiet_state(p_draft bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.drafts;
begin
  select * into d from public.drafts where id = p_draft;
  if d.id is null then return null; end if;
  return jsonb_build_object(
    'quiet_until', public._quiet_end(now(), d.quiet),
    'next_quiet', public._next_quiet_start(now(), now() + interval '10 days', d.quiet),
    'active_left', case when d.pick_deadline is null then null else greatest(0, round(public._draft_active_seconds(now(), d.pick_deadline, d.quiet))) end);
end $$;
revoke all on function public.draft_quiet_state(bigint) from public;
grant execute on function public.draft_quiet_state(bigint) to anon, authenticated;

-- The office changes the quiet times. A pick already on the clock keeps the active time it had left.
create or replace function public.office_set_quiet(p_draft bigint, p_quiet jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; secs double precision;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not public._quiet_valid(p_quiet) then raise exception 'Those quiet times aren''t valid.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if d.status = 'live' and d.pick_deadline is not null then
    secs := public._draft_active_seconds(now(), d.pick_deadline, d.quiet);
    update public.drafts set quiet = p_quiet, pick_deadline = public._draft_add_active(now(), secs / 60.0, p_quiet) where id = p_draft;
  else
    update public.drafts set quiet = p_quiet where id = p_draft;
  end if;
end $$;
revoke all on function public.office_set_quiet(bigint, jsonb) from public, anon;
grant execute on function public.office_set_quiet(bigint, jsonb) to authenticated;

-- ---- The functions that start a clock now count active time only (each is its latest version plus that change).

-- Make one pick (as 0026).
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
    update public.drafts set status = 'done', current_pick = d.current_pick + 1, pick_deadline = null, pick_started = null where id = p_draft;
  else
    update public.drafts set current_pick = d.current_pick + 1, pick_started = now(),
      pick_deadline = public._draft_add_active(now(), d.pick_minutes, d.quiet) where id = p_draft;
  end if;
end $$;
revoke all on function public._draft_apply(bigint, text, text) from public, anon, authenticated;

-- Start, pause, resume or extend the clock (as 0023). Minutes are active minutes.
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
    update public.drafts set status = 'live', current_pick = 1, pick_started = now(),
      pick_deadline = public._draft_add_active(now(), d.pick_minutes, d.quiet) where id = p_draft;
  elsif p_action = 'pause' then
    if d.status <> 'live' then raise exception 'The draft isn''t live.'; end if;
    update public.drafts set status = 'paused', pick_deadline = null, pick_started = null where id = p_draft;
  elsif p_action = 'resume' then
    if d.status <> 'paused' then raise exception 'The draft isn''t paused.'; end if;
    update public.drafts set status = 'live', pick_started = now(),
      pick_deadline = public._draft_add_active(now(), d.pick_minutes, d.quiet) where id = p_draft;
  elsif p_action = 'extend' then
    if d.status <> 'live' then raise exception 'The draft isn''t live.'; end if;
    update public.drafts set pick_deadline = public._draft_add_active(coalesce(pick_deadline, now()), greatest(p_minutes, 1), d.quiet) where id = p_draft;
  else raise exception 'Unknown action.'; end if;
end $$;
revoke all on function public.office_draft_control(bigint, text, int) from public, anon;
grant execute on function public.office_draft_control(bigint, text, int) to authenticated;

-- Take back picks (as 0024).
create or replace function public.office_draft_undo(p_draft bigint, p_from int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d public.drafts; target int; n int;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if d.status = 'setup' then raise exception 'Nothing has been picked yet.'; end if;
  target := coalesce(p_from, d.current_pick - 1);
  if target < 1 or target >= d.current_pick then raise exception 'There is nothing to undo.'; end if;
  update public.players pl set club = null from public.draft_picks k
    where k.draft = p_draft and k.pick_no >= target and k.player = pl.id and pl.club = k.club;
  delete from public.draft_picks where draft = p_draft and pick_no >= target;
  get diagnostics n = row_count;
  update public.drafts set current_pick = target,
    status = case when status = 'done' then 'paused' else status end,
    pick_started = case when status = 'live' then now() else null end,
    pick_deadline = case when status = 'live' then public._draft_add_active(now(), pick_minutes, quiet) else null end
    where id = p_draft;
  return n;
end $$;
revoke all on function public.office_draft_undo(bigint, int) from public, anon;
grant execute on function public.office_draft_undo(bigint, int) to authenticated;

-- Back to set-up (as 0026).
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
  update public.drafts set status = 'setup', current_pick = 1, pick_deadline = null, pick_started = null where id = p_draft;
  return n;
end $$;
revoke all on function public.office_draft_reset(bigint) from public, anon;
grant execute on function public.office_draft_reset(bigint) to authenticated;

-- The clock (as 0027). "N minutes into my turn" now counts active minutes from when the pick's clock began; a timed-out
-- pick can't happen in quiet time because the deadline already skips it. "Always" still picks the moment it's the club's turn.
create or replace function public.draft_tick() returns int
language plpgsql security definer set search_path = public as $$
declare dr public.drafts; cur public.drafts; who text; v_mode text; v_mins int; v_how text; queued text; best text; started timestamptz;
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
      select p.mode, p.minutes, p.pick_how into v_mode, v_mins, v_how from public.draft_prefs p where p.draft = cur.id and p.club = who;
      v_mode := coalesce(v_mode, 'on_miss');
      v_how := coalesce(v_how, 'queue');
      timed_out := cur.pick_deadline is not null and now() >= cur.pick_deadline;
      started := coalesce(cur.pick_started, cur.pick_deadline - make_interval(mins => cur.pick_minutes));

      queued := null;
      if v_mode <> 'never' then
        if v_how = 'random' then
          select pl.id into queued from public.players pl where pl.club is null and public._draft_can_pick(cur.id, who, pl.id) is null
            order by random() limit 1;
        else
          select q.player into queued from public.draft_queue q join public.players pl on pl.id = q.player and pl.club is null
            where q.draft = cur.id and q.club = who and public._draft_can_pick(cur.id, who, q.player) is null order by q.rank limit 1;
        end if;
      end if;

      if queued is not null and (v_mode = 'always' or timed_out
          or (v_mode = 'after_minutes' and started is not null
              and now() >= public._draft_add_active(started, coalesce(v_mins, cur.pick_minutes), cur.quiet))) then
        perform public._draft_apply(cur.id, queued, case when v_how = 'random' then 'auto' else 'queue' end);
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
