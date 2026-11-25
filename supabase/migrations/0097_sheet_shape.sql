-- S-49 Formation overhaul, step 1 (25 Nov 2026): a manager can drag his players anywhere on the pitch (the club page's "Move players").
-- The sheet then has a `shape`: {slot: [x %, y %]} for each slot moved off its usual spot (null = the formation's usual spots). x runs
-- across the pitch from the left touchline, y up the pitch from the manager's own goal (pitch.js SHAPE_AREA, spotsOf). The formation name
-- still follows the spots (pitch.js nameShape), so formation stays the source of truth for lines and slot names and older pages keep working.
-- The shape rides along with the line-up like the kit (0044): saved with the sheet, kept in each sheet version, copied into week_sheets
-- (public) at the lock, and handed out with the submitted line-up before the lock (0055), so the match page can draw it.
-- A random XI (0080) has no shape. Additive and safe to re-run. Needs 0044, 0055, 0080, 0082.

alter table public.team_sheets add column if not exists shape jsonb check (shape is null or jsonb_typeof(shape) = 'object');
alter table public.week_sheets add column if not exists shape jsonb check (shape is null or jsonb_typeof(shape) = 'object');

-- A sheet's shape, or null when it has none (missing, JSON null, or not an object).
create or replace function public.sheet_shape(p_sheet jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_sheet->'shape') = 'object' then p_sheet->'shape' end
$$;

-- As 0044, and the shape is kept in each version.
create or replace function public.keep_team_sheet_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_sheet_versions (club, sheet)
  values (new.club, jsonb_build_object('formation', new.formation, 'tactics', new.tactics, 'lineup', new.lineup,
    'bench', new.bench, 'captain', new.captain, 'penalties', new.penalties, 'freekicks', new.freekicks, 'corners', new.corners,
    'kit', new.kit, 'shape', new.shape));
  return new;
end $$;

-- As 0082, and the shape is copied across from the submitted sheet. A random XI never has one.
create or replace function public.lock_due_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, kit, saved_at, submitted, random, boost, shape)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', nullif(v.sheet->>'kit', ''), v.saved_at, v.submitted, not v.submitted, v.submitted and public.sheet_boosted(v.sheet),
           case when v.submitted then public.sheet_shape(v.sheet) end
    from (
      select s.club, s.sheet, s.submitted_at as saved_at, true as submitted
      from public.submitted_sheets s where s.week = d.week and s.submitted_at <= d.locks_at
      union all
      select c.code, public.random_week_sheet(c.code), d.locks_at, false
      from public.clubs c
      where exists (select 1 from public.fixtures f where f.week = d.week and c.code in (f.home, f.away) and not coalesce(f.postponed, false))
        and not exists (select 1 from public.submitted_sheets s where s.week = d.week and s.club = c.code and s.submitted_at <= d.locks_at)
        and exists (select 1 from public.players p where p.club = c.code)
    ) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lock_due_weeks() from public, anon, authenticated;

-- As 0055, and the shape (the return type changes, so the function is dropped and made again with the same grants).
drop function if exists public.submitted_lineups(int, text[]);
create function public.submitted_lineups(p_week int, p_clubs text[])
returns table (club text, formation text, captain text, lineup jsonb, kit text, shape jsonb)
language sql stable security definer set search_path = public as $$
  select s.club, s.sheet->>'formation', s.sheet->>'captain', coalesce(s.sheet->'lineup', '{}'), nullif(s.sheet->>'kit', ''),
         public.sheet_shape(s.sheet)
  from public.submitted_sheets s
  where s.week = p_week and s.club = any (p_clubs)
$$;
revoke all on function public.submitted_lineups(int, text[]) from public;
grant execute on function public.submitted_lineups(int, text[]) to anon, authenticated;
