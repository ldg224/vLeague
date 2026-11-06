-- One-hour match slots (S-34, 6 Nov 2026). A match now plays live for 60 minutes (45 of football, 15 of matchday show), so Stakes settles at the new full time.
-- KEEP IN STEP with live_minutes in js/dashboard-data.js. Safe to re-run.
create or replace function public.stakes_match_over(p_starts_at timestamptz, p_postponed boolean) returns boolean
language sql stable set search_path = public as $$
  select p_starts_at is not null and not coalesce(p_postponed, false) and p_starts_at + interval '60 minutes' <= now()
$$;
revoke all on function public.stakes_match_over(timestamptz, boolean) from public, anon, authenticated;
