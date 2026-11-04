-- Boosted captain (S-33): the boost now shows as soon as a club submits its team sheet, not only from the lock (the user, 4 Nov 2026), so the entrance and
-- the glow play on the Predicted lineup from then on. Replaces 0055's submitted_lineups(), with the boost added. Its return type changes, so it is dropped first.
-- all_submitted_lineups() (0056) only feeds the win chance and stays as it is. Needs 0055, 0082.
drop function if exists public.submitted_lineups(int, text[]);
create function public.submitted_lineups(p_week int, p_clubs text[]) returns table (club text, formation text, captain text, lineup jsonb, kit text, boost boolean)
language sql stable security definer set search_path = public as $$
  select s.club, s.sheet->>'formation', s.sheet->>'captain', coalesce(s.sheet->'lineup', '{}'), nullif(s.sheet->>'kit', ''), public.sheet_boosted(s.sheet)
  from public.submitted_sheets s
  where s.week = p_week and s.club = any (p_clubs)
$$;
revoke all on function public.submitted_lineups(int, text[]) from public;
grant execute on function public.submitted_lineups(int, text[]) to anon, authenticated;
