-- 0.28.1: a missed pick is no longer lost. Where the draft used to SKIP a pick (time ran out with nothing in the queue, or the
-- office pressed "Skip this pick"), it now picks a random free player who fits one of the club's open spots: the position
-- maximums and minimums in _draft_can_pick (0026). Only if nobody left fits is the pick skipped. Needs 0029.
--   on_timeout 'skip'       was "skip the pick"          -> now "a random player who fits"
--   on_timeout 'queue'      was "queue, else skip"       -> now "queue, else a random player who fits"
--   on_timeout 'best_value' was "best-value free player" -> unchanged, and a random player who fits if none is allowed
-- (The stored values don't change, so existing drafts need no edit.)

-- A random free player this club may take now (null if nobody left fits). For the pick on the clock.
create or replace function public._draft_random_fit(p_draft bigint, p_club text) returns text
language sql stable security definer set search_path = public as $$
  select pl.id from public.players pl
  where pl.club is null and public._draft_can_pick(p_draft, p_club, pl.id) is null
  order by random() limit 1
$$;
revoke all on function public._draft_random_fit(bigint, text) from public, anon, authenticated;

-- The office makes the pick on the clock for whoever is on it. A null player now means "pick one for them at random who fits"
-- (it is skipped only if nobody fits).
create or replace function public.office_set_pick(p_draft bigint, p_player text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; who text; chosen text := p_player;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft and status in ('live', 'paused');
  if d.id is null then raise exception 'The draft isn''t running.'; end if;
  if chosen is null then
    select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
    chosen := public._draft_random_fit(p_draft, who);
  end if;
  perform public._draft_apply(p_draft, chosen, case when chosen is null then 'skip' when p_player is null then 'auto' else 'office' end);
end $$;
revoke all on function public.office_set_pick(bigint, text) from public, anon;
grant execute on function public.office_set_pick(bigint, text) to authenticated;

-- The clock (as 0029): a missed turn with nothing to take from the queue picks a random player who fits, instead of skipping.
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
      if best is null then best := public._draft_random_fit(cur.id, who); end if;   -- a missed pick is never just lost
      perform public._draft_apply(cur.id, best, case when best is null then 'skip' else 'auto' end);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.draft_tick() from public, anon, authenticated;
