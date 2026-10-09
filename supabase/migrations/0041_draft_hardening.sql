-- 0.56.0: draft hardening found by the full examination of the draft. Safe to re-run. Needs 0040.
--
-- 1. draft_tick() takes the draft's row lock before it decides anything. Before, it read the draft without a lock, so a manager's pick
--    (or a second tick, the cron job runs every 5 seconds) landing in the same few milliseconds could leave the clock acting on stale
--    information and giving the NEXT club a player chosen from the previous club's queue. Every pick path (manager, clock, office) now
--    takes the same lock first, so they queue up one behind another.
-- 2. _draft_apply(): a pick made by the office while the draft is paused no longer starts a pick clock (the draft stays paused with no
--    deadline; Resume starts the clock as before).
-- 3. Starting a draft goes to the first pick in the order, whatever its number (it assumed pick 1).
-- 4. The "you're on the clock" email is keyed by the pick AND when its clock began, so a pick that is taken back and re-picked, or a
--    clock restarted by Resume, emails the manager again. (Before it was keyed by the pick number alone, so a re-pick sent nothing.)

CREATE OR REPLACE FUNCTION public.draft_tick()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare dr public.drafts; cur public.drafts; who text; v_mode text; v_mins int; v_how text; queued text; best text; started timestamptz;
        timed_out boolean; n int := 0; guard int;
begin
  for dr in select * from public.drafts where status = 'live'
      and (opens_at is null or now() >= opens_at) and (closes_at is null or now() <= closes_at) loop
    guard := 0;
    loop
      select * into cur from public.drafts where id = dr.id for update;   -- same lock as make_pick and the office functions
      exit when cur.status <> 'live' or guard >= 200;
      guard := guard + 1;
      select club into who from public.draft_order where draft = cur.id and pick_no = cur.current_pick;
      exit when who is null;
      select p.mode, p.minutes, p.pick_how into v_mode, v_mins, v_how from public.draft_prefs p where p.draft = cur.id and p.club = who;
      v_mode := coalesce(v_mode, 'on_miss');
      v_how := coalesce(v_how, 'queue');
      -- The office's league-wide rule (drafts.auto_after_minutes): every club's queue picks that many active minutes into its turn.
      -- A manager's own setting can't loosen it; a manager who asked for an instant pick ('always') keeps that.
      if cur.auto_after_minutes is not null and v_mode <> 'always' then
        v_mode := 'after_minutes'; v_mins := cur.auto_after_minutes; v_how := 'queue';
      end if;
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
      if best is null then best := public._draft_random_fit(cur.id, who); end if;   -- a missed pick is never just lost
      perform public._draft_apply(cur.id, best, case when best is null then 'skip' else 'auto' end);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $function$;
revoke all on function public.draft_tick() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._draft_apply(p_draft bigint, p_player text, p_how text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.drafts; who text; nxt int; why text;
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
  select min(o.pick_no) into nxt from public.draft_order o
    where o.draft = p_draft and not exists (select 1 from public.draft_picks k where k.draft = o.draft and k.pick_no = o.pick_no);
  if nxt is null then
    update public.drafts set status = 'done', current_pick = (select max(pick_no) + 1 from public.draft_order where draft = p_draft),
      pick_deadline = null, pick_started = null where id = p_draft;
  else
    update public.drafts set current_pick = nxt,
      pick_started = case when d.status = 'live' then now() end,
      pick_deadline = case when d.status = 'live' then public._draft_add_active(now(), d.pick_minutes, d.quiet) end where id = p_draft;
  end if;
end $function$;
revoke all on function public._draft_apply(bigint, text, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.office_draft_control(p_draft bigint, p_action text, p_minutes integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.drafts;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if p_action = 'start' then
    if d.status <> 'setup' then raise exception 'The draft has already started.'; end if;
    if not exists (select 1 from public.draft_order where draft = p_draft) then raise exception 'Set the draft order first.'; end if;
    update public.drafts set status = 'live', current_pick = (select min(pick_no) from public.draft_order where draft = p_draft), pick_started = now(),
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
end $function$;
revoke all on function public.office_draft_control(bigint, text, int) from public, anon;
grant execute on function public.office_draft_control(bigint, text, int) to authenticated;

CREATE OR REPLACE FUNCTION public.due_emails()
 RETURNS TABLE(user_id uuid, email text, name text, kind text, key text, data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  -- the last time any week locked: a team saved after this counts as "picked" for the next deadline
  last_lock as (select coalesce(max(locked_at), '-infinity'::timestamptz) as at from public.deadlines where locked_at is not null),
  saved as (select club, max(saved_at) as at from public.team_sheet_versions group by club),
  open_deadlines as (select * from public.deadlines where locked_at is null and locks_at > now()),
  -- clubs that haven't saved a team since the last lock
  unpicked as (select c.code from public.clubs c left join saved s on s.club = c.code, last_lock
               where c.status <> 'withdrawn' and (s.at is null or s.at <= last_lock.at)),
  reminders as (
    select a.user_id, a.email, a.name, 'deadline'::text as kind, d.week || '-' || lead.label as key,
           jsonb_build_object('week', d.week, 'locks_at', d.locks_at, 'club', a.club) as data
    from public.mail_accounts a
    join unpicked u on u.code = a.club
    cross join open_deadlines d
    cross join (values ('24h', interval '24 hours'), ('3h', interval '3 hours')) as lead(label, gap)
    where public.email_pref(a.prefs, 'deadline') in (lead.label, 'both')
      and now() >= public.send_at(d.locks_at, lead.gap)
  ),
  sent_back as (
    select a.user_id, a.email, a.name, 'sent_back', r.id::text,
           jsonb_build_object('note', r.office_note, 'club', r.club)
    from public.club_requests r
    join public.mail_accounts a on a.club = r.club
    where r.status = 'returned' and r.reviewed_at > now() - interval '2 days'
      and public.email_pref(a.prefs, 'sent_back') = 'true'
  ),
  lineups as (
    select a.user_id, a.email, a.name, 'lineups_out', d.week::text,
           jsonb_build_object('week', d.week, 'club', a.club)
    from public.deadlines d
    join public.mail_accounts a on a.club is not null
    where d.locked_at > now() - interval '3 hours' and public.email_pref(a.prefs, 'lineups_out') = 'true'
      and extract(hour from now() at time zone 'Australia/Melbourne') between 8 and 21
  ),
  weekly as (
    select a.user_id, a.email, a.name, 'weekly', to_char(now() at time zone 'Australia/Melbourne', 'IYYY-IW'),
           jsonb_build_object('club', a.club)
    from public.mail_accounts a
    where public.email_pref(a.prefs, 'weekly') = 'true'
      and extract(isodow from now() at time zone 'Australia/Melbourne') = 1
      and extract(hour from now() at time zone 'Australia/Melbourne') >= 9
  ),
  office as (
    select a.user_id, a.email, a.name, 'office_digest', d.week::text,
           jsonb_build_object('week', d.week, 'locks_at', d.locks_at,
             'clubs', (select jsonb_agg(c.name order by c.name) from public.clubs c join unpicked u on u.code = c.code))
    from public.mail_accounts a
    cross join open_deadlines d
    where a.role = 'office' and public.email_pref(a.prefs, 'office_digest') = 'true'
      and now() >= public.send_at(d.locks_at, interval '24 hours')
      and exists (select 1 from unpicked)
  ),
  -- Draft emails (0.29): to the manager whose pick is on the clock. Never in the draft's quiet time, never 10 pm to 8 am Melbourne.
  live_drafts as (
    select d.*, o.club as on_club from public.drafts d
    join public.draft_order o on o.draft = d.id and o.pick_no = d.current_pick
    where d.status = 'live' and d.pick_deadline is not null
      and (d.opens_at is null or now() >= d.opens_at) and (d.closes_at is null or now() <= d.closes_at)
      and public._quiet_end(now(), d.quiet) is null
      and extract(hour from now() at time zone 'Australia/Melbourne') between 8 and 21
  ),
  draft_on as (
    select a.user_id, a.email, a.name, d.id || '-' || d.current_pick || '-' || coalesce(extract(epoch from d.pick_started)::bigint, 0) as key, a.prefs,
           jsonb_build_object('draft', d.name, 'pick', d.current_pick, 'of', (select count(*) from public.draft_order x where x.draft = d.id),
             'deadline', d.pick_deadline, 'minutes', d.pick_minutes, 'timeout', d.on_timeout,
             'left_min', round(public._draft_active_seconds(now(), d.pick_deadline, d.quiet) / 60.0),
             'queued', (select count(*) from public.draft_queue q join public.players pl on pl.id = q.player and pl.club is null where q.draft = d.id and q.club = a.club)) as data
    from live_drafts d join public.mail_accounts a on a.club = d.on_club
    -- a club on "the moment it's my turn" picks itself straight away, so there's nothing to tell it
    where coalesce((select p.mode from public.draft_prefs p where p.draft = d.id and p.club = a.club), 'on_miss') <> 'always'
  ),
  draft_turn as (
    select user_id, email, name, 'draft_turn'::text as kind, key, data from draft_on
    where public.email_pref(prefs, 'draft') in ('both', 'turn')
  ),
  draft_warn as (
    select o.user_id, o.email, o.name, 'draft_warn'::text as kind, o.key, o.data from draft_on o
    where public.email_pref(o.prefs, 'draft') = 'both' and (o.data->>'minutes')::int >= 180 and (o.data->>'left_min')::int <= 120
  ),
  everything as (
    select * from reminders union all select * from sent_back union all select * from lineups
    union all select * from weekly union all select * from office
    union all select * from draft_turn union all select * from draft_warn
  )
  select e.* from everything e
  where not exists (select 1 from public.email_log l where l.user_id = e.user_id and l.kind = e.kind and l.key = e.key)
$function$;
revoke all on function public.due_emails() from public, anon, authenticated;
