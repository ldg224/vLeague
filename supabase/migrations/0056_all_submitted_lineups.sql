-- Win chance everywhere (15 Oct 2026): every page works it out from the same line-ups, so the fixtures page, the matches page and the
-- match page agree. Submitted-but-not-locked sheets for all upcoming rounds in one call; same visible fields as submitted_lineups()
-- (0055): formation, line-up, captain, kit. Rounds that have locked are read from week_sheets instead. Needs 0048, 0055.
create or replace function public.all_submitted_lineups() returns table (week int, club text, formation text, captain text, lineup jsonb, kit text)
language sql stable security definer set search_path = public as $$
  select s.week, s.club, s.sheet->>'formation', s.sheet->>'captain', coalesce(s.sheet->'lineup', '{}'), nullif(s.sheet->>'kit', '')
  from public.submitted_sheets s
  join public.deadlines d on d.week = s.week
  where d.locked_at is null and d.locks_at > now()
$$;
revoke all on function public.all_submitted_lineups() from public;
grant execute on function public.all_submitted_lineups() to anon, authenticated;
