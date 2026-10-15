-- Match page Predicted Lineup: show a club's XI as soon as it submits, not only once the round locks (the user, 15 Oct 2026).
-- submitted_sheets is private (office + own club), so this security-definer function hands out just the visible part of the
-- sheets for one round and two clubs: formation, line-up, captain, kit. Never tactics, bench or set pieces. Once a round locks
-- the page uses week_sheets (public) instead. Needs 0048 (submitted_sheets).
create or replace function public.submitted_lineups(p_week int, p_clubs text[]) returns table (club text, formation text, captain text, lineup jsonb, kit text)
language sql stable security definer set search_path = public as $$
  select s.club, s.sheet->>'formation', s.sheet->>'captain', coalesce(s.sheet->'lineup', '{}'), nullif(s.sheet->>'kit', '')
  from public.submitted_sheets s
  where s.week = p_week and s.club = any (p_clubs)
$$;
revoke all on function public.submitted_lineups(int, text[]) from public;
grant execute on function public.submitted_lineups(int, text[]) to anon, authenticated;
