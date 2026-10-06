-- 0.20: roster tools. Weeks can be renumbered, reordered and swapped in one safe step; a week can go without a round
-- number ("Christmas Cup", a break week) or show a number you choose; a week can carry a private note.

-- numbered = counts as a numbered round (Round 1, Round 2...). Off = shows only its name. number_override = the number
-- to show instead of the automatic count. Neither changes the week's place in the order (that is `week`).
alter table public.rounds add column if not exists numbered boolean not null default true;
alter table public.rounds add column if not exists number_override int check (number_override is null or number_override between 0 and 999);
alter table public.rounds add column if not exists note text check (note is null or char_length(note) <= 300);

-- Older rounds stored "Round 5" as their name. The number is worked out now, so it follows the week when weeks move.
update public.rounds set name = null where name ~ '^Round [0-9]+$';

-- Move weeks to new numbers in one step: {"3": 5, "5": 3} swaps weeks 3 and 5. Every week keeps its matches, round
-- (name, look, lock rule) and match blocks. Results and match files stay with their matches. A week whose line-ups have
-- locked can't move, and nothing can move onto it. Line-up deadlines follow on their own (the sync triggers from 0.13).
create or replace function public.office_move_weeks(p_map jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; src int[] := '{}'; dst int[] := '{}'; touched int[] := '{}'; i int; idx int; f int; w int; moved int := 0;
begin
  if not public.is_office() then raise exception 'Only the league office can move weeks.'; end if;
  if p_map is null or jsonb_typeof(p_map) <> 'object' then raise exception 'Say which weeks move where.'; end if;
  for r in select k::int as s, v::int as d from jsonb_each_text(p_map) as e(k, v) loop
    if r.s < 1 or r.s > 99 or r.d < 1 or r.d > 99 then raise exception 'Weeks go from 1 to 99.'; end if;
    if r.s <> r.d then src := src || r.s; dst := dst || r.d; end if;
  end loop;
  if coalesce(array_length(src, 1), 0) = 0 then return 0; end if;
  if (select count(distinct d) from unnest(dst) as d) <> array_length(dst, 1) then
    raise exception 'Two weeks can''t move to the same number.';
  end if;
  if exists (select 1 from public.deadlines where locked_at is not null and (week = any(src) or week = any(dst))) then
    raise exception 'A week with locked line-ups can''t be moved, and nothing can move onto it.';
  end if;
  for i in 1 .. array_length(dst, 1) loop
    if not (dst[i] = any(src)) and (
         exists (select 1 from public.fixtures where week = dst[i]) or exists (select 1 from public.rounds where week = dst[i])
         or exists (select 1 from public.deadlines where week = dst[i])) then
      raise exception 'Week % is already in use.', dst[i];
    end if;
  end loop;

  -- Move a week whose target is free; when only closed loops are left (a swap), park one week on a spare number first.
  while coalesce(array_length(src, 1), 0) > 0 loop
    idx := null;
    for i in 1 .. array_length(src, 1) loop
      if not (dst[i] = any(src)) then idx := i; exit; end if;
    end loop;
    if idx is null then
      select g into f from generate_series(1, 99) g
       where not exists (select 1 from public.fixtures where week = g) and not exists (select 1 from public.rounds where week = g)
         and not exists (select 1 from public.deadlines where week = g) and g <> all(src) and g <> all(dst) limit 1;
      if f is null then raise exception 'There is no spare week number to move through. Delete an empty week first.'; end if;
      update public.rounds set week = f where week = src[1];
      update public.fixtures set week = f where week = src[1];
      touched := touched || src[1] || f;
      src[1] := f;
    else
      update public.rounds set week = dst[idx] where week = src[idx];
      update public.fixtures set week = dst[idx] where week = src[idx];
      touched := touched || src[idx] || dst[idx];
      src := src[1 : idx - 1] || src[idx + 1 :];
      dst := dst[1 : idx - 1] || dst[idx + 1 :];
      moved := moved + 1;
    end if;
  end loop;
  foreach w in array touched loop perform public.sync_week_deadline(w); end loop;
  return moved;
end $$;
revoke all on function public.office_move_weeks(jsonb) from public, anon;
grant execute on function public.office_move_weeks(jsonb) to authenticated;
