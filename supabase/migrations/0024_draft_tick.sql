-- 0.22: the draft clock and the office's bulk tools (see docs/DRAFT.md). Needs 0023_draft.sql.
--   draft_tick()          every minute: applies each club's auto-pick rule and the timeout rule to live drafts
--   office_autofill()     fill the rest of the draft (or the next N picks) with the best-value free players
--   office_draft_undo()   take back the last pick, or every pick from a given pick number on

-- Picks for any live draft that is inside its window, until nobody is due. Returns how many picks it made.
-- A club's rule (draft_prefs, default on_miss):
--   always         pick from my queue the moment it's my turn
--   after_minutes  pick from my queue N minutes into my turn
--   on_miss        pick from my queue when my time runs out
--   never          the queue is only a reference; a missed turn follows the draft's own on_timeout
-- When time runs out and there is nothing to pick from the queue, the draft's on_timeout decides: skip the pick, or take the
-- best-value free player.
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
          where q.draft = cur.id and q.club = who order by q.rank limit 1;
      end if;

      if queued is not null and (v_mode = 'always' or timed_out
          or (v_mode = 'after_minutes' and now() >= started + make_interval(mins => coalesce(v_mins, cur.pick_minutes)))) then
        perform public._draft_apply(cur.id, queued, 'queue');
        n := n + 1;
        continue;
      end if;

      exit when not timed_out;
      if cur.on_timeout = 'best_value' then
        select id into best from public.players where club is null order by value desc, id limit 1;
      else
        best := null;
      end if;
      perform public._draft_apply(cur.id, best, case when best is null then 'skip' else 'auto' end);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.draft_tick() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'vleague-draft-tick';
select cron.schedule('vleague-draft-tick', '* * * * *', 'select public.draft_tick();');

-- Fill the rest of the draft, best value first. p_count limits it to the next N picks. Skips a pick if no free player is left.
create or replace function public.office_autofill(p_draft bigint, p_count int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d public.drafts; best text; n int := 0;
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
    select id into best from public.players where club is null order by value desc, id limit 1;
    perform public._draft_apply(p_draft, best, case when best is null then 'skip' else 'office' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.office_autofill(bigint, int) from public, anon;
grant execute on function public.office_autofill(bigint, int) to authenticated;

-- Take back the last pick, or every pick from pick number p_from on. The players go back to being free agents. A finished
-- draft comes back paused.
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
    pick_deadline = case when status = 'live' then now() + make_interval(mins => pick_minutes) else null end
    where id = p_draft;
  return n;
end $$;
revoke all on function public.office_draft_undo(bigint, int) from public, anon;
grant execute on function public.office_draft_undo(bigint, int) to authenticated;
