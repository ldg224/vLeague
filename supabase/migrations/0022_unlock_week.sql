-- 0.20.1: unlock a week's line-ups. A deadline in the past locks within a minute and a locked week was stuck for good, even
-- after its matches were removed or its dates fixed. The office can now unlock a week that has no played matches: its saved
-- line-up copies (week_sheets) are dropped and the deadline is worked out again from the week's kick-offs (the sync from
-- 0.13). If that time is still in the past it will lock again within a minute, so move the kick-offs or the lock time first.
create or replace function public.office_unlock_week(p_week int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_office() then raise exception 'Only the league office can unlock a week.'; end if;
  if not exists (select 1 from public.deadlines where week = p_week and locked_at is not null) then
    raise exception 'Week % isn''t locked.', p_week;
  end if;
  if exists (select 1 from public.results r join public.fixtures f on f.id = r.fixture where f.week = p_week) then
    raise exception 'Matches have already been played in week %, so it can''t be unlocked.', p_week;
  end if;
  delete from public.week_sheets where week = p_week;
  update public.deadlines set locked_at = null where week = p_week;
  perform public.sync_week_deadline(p_week);
end $$;
revoke all on function public.office_unlock_week(int) from public, anon;
grant execute on function public.office_unlock_week(int) to authenticated;
