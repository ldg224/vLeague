-- 0.61: the office picks for the club on the clock by a rule, not only at random. "Pick for them" in Editor → Draft:
--   'rated'  the highest-rated free player who fits (OVR, the same sum as js/names.js overall())
--   'value'  the most valuable free player who fits
--   'queue'  the first player in that club's queue who is still free and fits
--   'random' a random free player who fits (what office_set_pick(.., null) does)
-- Every rule falls back to a random player who fits, and the pick is skipped only if nobody fits. Needs 0030, 0041.

create or replace function public._draft_overall(p public.players) returns numeric language sql immutable as $$
  select case p.position when 'GK' then 0.25 * p.offense + 0.75 * p.defense
                         when 'DEF' then 0.3 * p.offense + 0.7 * p.defense
                         when 'MID' then 0.5 * p.offense + 0.5 * p.defense
                         else 0.7 * p.offense + 0.3 * p.defense end
$$;

create or replace function public.office_auto_pick(p_draft bigint, p_how text) returns text
language plpgsql security definer set search_path = public as $$
declare d public.drafts; who text; chosen text;
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if p_how not in ('rated', 'value', 'queue', 'random') then raise exception 'Unknown way to pick: %', p_how; end if;
  select * into d from public.drafts where id = p_draft and status in ('live', 'paused');
  if d.id is null then raise exception 'The draft isn''t running.'; end if;
  select club into who from public.draft_order where draft = p_draft and pick_no = d.current_pick;
  if p_how = 'rated' then
    select pl.id into chosen from public.players pl
      where pl.club is null and public._draft_can_pick(p_draft, who, pl.id) is null
      order by public._draft_overall(pl) desc, pl.value desc, pl.id limit 1;
  elsif p_how = 'value' then
    select pl.id into chosen from public.players pl
      where pl.club is null and public._draft_can_pick(p_draft, who, pl.id) is null
      order by pl.value desc, pl.id limit 1;
  elsif p_how = 'queue' then
    select q.player into chosen from public.draft_queue q
      where q.draft = p_draft and q.club = who and public._draft_can_pick(p_draft, who, q.player) is null
      order by q.rank limit 1;
  end if;
  chosen := coalesce(chosen, public._draft_random_fit(p_draft, who));
  perform public._draft_apply(p_draft, chosen, case when chosen is null then 'skip' else 'auto' end);
  return chosen;
end $$;
revoke all on function public.office_auto_pick(bigint, text) from public, anon;
grant execute on function public.office_auto_pick(bigint, text) to authenticated;
