-- 0.52.0: two draft fixes. Safe to re-run. Needs 0038.
--
-- 1. save_draft_queue(): a club's queue is saved in one step. Before, the page deleted the queue and then inserted the new one as two
--    separate calls, so a refresh (or a failed insert) in between left the queue empty on the server, and the clock then had nothing
--    to pick from and chose a random player (B-13, and the Cranbourne United picks).
-- 2. Taking a pick back (office_remove_pick) so a club can pick again. The draft no longer assumes picks are made in order: the pick on
--    the clock is always the lowest-numbered pick that hasn't been made. Remove pick 5 and pick 23 from a draft that has reached 31 and
--    the clock goes to 5, then 23, then carries on at 31.

-- ---- 1. The queue, saved in one step. p_players is in order, first choice first. Anyone may save their own club's queue; the office may save any.
create or replace function public.save_draft_queue(p_draft bigint, p_club text, p_players text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_club is distinct from public.my_club() and not public.is_office() then raise exception 'That isn''t your club.'; end if;
  if not exists (select 1 from public.drafts where id = p_draft) then raise exception 'That draft doesn''t exist.'; end if;
  delete from public.draft_queue where draft = p_draft and club = p_club;
  insert into public.draft_queue (draft, club, rank, player)
    select p_draft, p_club, (row_number() over (order by min(t.ord)))::int, t.player
    from unnest(coalesce(p_players, '{}')) with ordinality as t(player, ord)
    where exists (select 1 from public.players pl where pl.id = t.player)
    group by t.player;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.save_draft_queue(bigint, text, text[]) from public, anon;
grant execute on function public.save_draft_queue(bigint, text, text[]) to authenticated;

-- ---- 2. The pick on the clock is the lowest pick that hasn't been made.

-- Roster minimums: the picks a club "still has left" are its unmade picks other than the one on the clock (as 0026, but not assuming order).
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
  select count(*) into remaining from public.draft_order o
    where o.draft = p_draft and o.club = p_club and o.pick_no <> d.current_pick
      and not exists (select 1 from public.draft_picks k2 where k2.draft = o.draft and k2.pick_no = o.pick_no);
  for k, mn in select key, value::int from jsonb_each_text(d.roster_min) loop
    select count(*) into cnt from public.players p where p.club = p_club and p.position = k;
    if k = pos then cnt := cnt + 1; end if;
    needed := needed + greatest(mn - cnt, 0);
  end loop;
  if needed > remaining then return format('That would leave too few picks to reach the minimum for each position (%s still needed, %s picks left).', needed, remaining); end if;
  return null;
end $$;
revoke all on function public._draft_can_pick(bigint, text, text) from public, anon, authenticated;

-- Make one pick (as 0029), then move the clock to the lowest unmade pick; the draft is done when there isn't one.
create or replace function public._draft_apply(p_draft bigint, p_player text, p_how text) returns void
language plpgsql security definer set search_path = public as $$
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
    update public.drafts set current_pick = nxt, pick_started = now(),
      pick_deadline = public._draft_add_active(now(), d.pick_minutes, d.quiet) where id = p_draft;
  end if;
end $$;
revoke all on function public._draft_apply(bigint, text, text) from public, anon, authenticated;

-- Take one made pick back so that club picks again. The player returns to free agents. If the draft was finished it is paused (press
-- Resume); if it is live, the clock goes to the lowest unmade pick and that club gets a fresh timer. Taking back a later pick while an
-- earlier one is still waiting leaves the clock where it is.
create or replace function public.office_remove_pick(p_draft bigint, p_pick_no int) returns void
language plpgsql security definer set search_path = public as $$
declare d public.drafts; k public.draft_picks; nxt int;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  select * into k from public.draft_picks where draft = p_draft and pick_no = p_pick_no;
  if k.draft is null then raise exception 'Pick % hasn''t been made.', p_pick_no; end if;
  if k.player is not null then
    update public.players set club = null where id = k.player and club = k.club;
  end if;
  delete from public.draft_picks where draft = p_draft and pick_no = p_pick_no;
  select min(o.pick_no) into nxt from public.draft_order o
    where o.draft = p_draft and not exists (select 1 from public.draft_picks k2 where k2.draft = o.draft and k2.pick_no = o.pick_no);
  if d.status = 'done' then
    update public.drafts set status = 'paused', current_pick = nxt, pick_started = null, pick_deadline = null where id = p_draft;
  elsif nxt is distinct from d.current_pick then
    update public.drafts set current_pick = nxt,
      pick_started = case when status = 'live' then now() else null end,
      pick_deadline = case when status = 'live' then public._draft_add_active(now(), pick_minutes, quiet) else null end
      where id = p_draft;
  end if;
end $$;
revoke all on function public.office_remove_pick(bigint, int) from public, anon;
grant execute on function public.office_remove_pick(bigint, int) to authenticated;

-- Take back picks (as 0029): from p_from (default the last pick made) to the end. Picks are no longer assumed to be in order.
create or replace function public.office_draft_undo(p_draft bigint, p_from int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d public.drafts; target int; n int; nxt int;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into d from public.drafts where id = p_draft for update;
  if d.id is null then raise exception 'That draft doesn''t exist.'; end if;
  if d.status = 'setup' then raise exception 'Nothing has been picked yet.'; end if;
  target := coalesce(p_from, (select max(pick_no) from public.draft_picks where draft = p_draft));
  if target is null or not exists (select 1 from public.draft_picks where draft = p_draft and pick_no >= target) then raise exception 'There is nothing to undo.'; end if;
  update public.players pl set club = null from public.draft_picks k
    where k.draft = p_draft and k.pick_no >= target and k.player = pl.id and pl.club = k.club;
  delete from public.draft_picks where draft = p_draft and pick_no >= target;
  get diagnostics n = row_count;
  select min(o.pick_no) into nxt from public.draft_order o
    where o.draft = p_draft and not exists (select 1 from public.draft_picks k2 where k2.draft = o.draft and k2.pick_no = o.pick_no);
  update public.drafts set current_pick = nxt,
    status = case when status = 'done' then 'paused' else status end,
    pick_started = case when status = 'live' then now() else null end,
    pick_deadline = case when status = 'live' then public._draft_add_active(now(), pick_minutes, quiet) else null end
    where id = p_draft;
  return n;
end $$;
revoke all on function public.office_draft_undo(bigint, int) from public, anon;
grant execute on function public.office_draft_undo(bigint, int) to authenticated;
