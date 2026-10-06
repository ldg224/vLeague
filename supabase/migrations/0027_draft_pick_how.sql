-- 0.24: auto-pick has two questions: WHAT to pick (pick_how: from my queue, or a random player) and WHEN (mode, as before:
-- always, after_minutes, on_miss, never). Needs 0026_draft_tools.sql.
alter table public.draft_prefs add column if not exists pick_how text not null default 'queue' check (pick_how in ('queue', 'random'));

-- The clock (as 0026). A club set to "random" gets a random free player it is allowed to take, at the time its rule says;
-- a club set to "queue" gets the first player in its queue who is still free and allowed. When there is nothing to pick,
-- a missed turn follows the draft's timeout rule as before.
create or replace function public.draft_tick() returns int
language plpgsql security definer set search_path = public as $$
declare dr public.drafts; cur public.drafts; who text; v_mode text; v_mins int; v_how text; queued text; best text; started timestamptz;
        timed_out boolean; n int := 0; guard int; how text;
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
      started := cur.pick_deadline - make_interval(mins => cur.pick_minutes);

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
          or (v_mode = 'after_minutes' and now() >= started + make_interval(mins => coalesce(v_mins, cur.pick_minutes)))) then
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
