-- 0.54.0: the draft's times are now ACTIVE times. The windows the office enters (drafts.quiet, unchanged in the database so nothing
-- has to be re-entered) are when the pick timer RUNS; outside them the timer is paused. Before this, the same list meant the
-- opposite (when the timer was paused). Nothing is blocked either way: managers and the office can still pick at any time.
--
-- Only one function has to change. Everything that works with quiet time (_quiet_end, _next_quiet_start, _draft_add_active,
-- _draft_active_seconds, draft_quiet_state, the "never email in quiet time" rule of 0031) asks _quiet_intervals "which stretches
-- are paused?", so that now returns the gaps BETWEEN the active windows. An empty list still means the timer runs all the time.
-- Needs 0029. Safe to re-run, but run it ONCE: it changes what the saved times mean for every draft.

-- Every stretch of paused time that could touch [p_from, p_to], as (start, end) instants: the gaps between the active windows.
create or replace function public._quiet_intervals(p_from timestamptz, p_to timestamptz, p_quiet jsonb)
returns table (s timestamptz, e timestamptz) language sql stable as $$
  with lim as (
    select (((p_from at time zone 'Australia/Melbourne')::date - 1)::timestamp at time zone 'Australia/Melbourne') as lo,
           (((p_to at time zone 'Australia/Melbourne')::date + 2)::timestamp at time zone 'Australia/Melbourne') as hi
  ), act as (   -- the active windows (what 0029 treated as quiet stretches)
    select ((d::date + (w->>'from')::time) at time zone 'Australia/Melbourne') as s,
           ((d::date + (w->>'to')::time + case when (w->>'to')::time <= (w->>'from')::time then interval '1 day' else interval '0 seconds' end) at time zone 'Australia/Melbourne') as e
    from generate_series(((p_from at time zone 'Australia/Melbourne')::date - 1)::timestamp, ((p_to at time zone 'Australia/Melbourne')::date + 1)::timestamp, interval '1 day') d,
         jsonb_array_elements(p_quiet) w
    where exists (select 1 from jsonb_array_elements_text(w->'days') x where x::int = extract(dow from d)::int)
  ), ord as (
    select s, e, max(e) over (order by s, e rows between unbounded preceding and 1 preceding) as prev_end from act
  ), isl as (   -- overlapping or touching windows join into one stretch
    select s, e, sum(case when prev_end is null or s > prev_end then 1 else 0 end) over (order by s, e) as g from ord
  ), merged as (
    select min(s) as s, max(e) as e from isl group by g
  ), gaps as (
    select e as gs, lead(s) over (order by s) as ge from merged
  )
  select gs, ge from gaps where ge is not null and ge > gs
  union all select lim.lo, (select min(s) from merged) from lim where exists (select 1 from merged) and lim.lo < (select min(s) from merged)
  union all select (select max(e) from merged), lim.hi from lim where exists (select 1 from merged) and (select max(e) from merged) < lim.hi
  union all select lim.lo, lim.hi from lim where not exists (select 1 from merged)
$$;
revoke all on function public._quiet_intervals(timestamptz, timestamptz, jsonb) from public, anon, authenticated;

-- Wording only: the office saves active times now.
create or replace function public.office_set_quiet(p_draft bigint, p_quiet jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; secs double precision;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not public._quiet_valid(p_quiet) then raise exception 'Those active times aren''t valid.'; end if;
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

-- A pick on the clock right now was timed under the old meaning: work its deadline out again under the new one, from when it began.
update public.drafts set pick_deadline = public._draft_add_active(pick_started, pick_minutes, quiet)
  where status = 'live' and pick_started is not null and jsonb_array_length(quiet) > 0;
