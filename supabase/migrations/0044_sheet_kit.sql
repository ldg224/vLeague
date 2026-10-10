-- 0.58: a team sheet picks the kit the team wears (S-23). null = automatic (the home kit; the away kit if the colours clash and
-- the club made one). The choice rides along with the line-up: it is saved with the sheet, kept in each sheet version, and copied
-- into week_sheets (public) when the week locks. Needs 0005 (team_sheet_versions, week_sheets, lock_due_weeks) and 0043 (kits).

alter table public.team_sheets add column if not exists kit text check (kit is null or kit in ('home', 'away', 'special'));
alter table public.week_sheets add column if not exists kit text check (kit is null or kit in ('home', 'away', 'special'));

create or replace function public.keep_team_sheet_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_sheet_versions (club, sheet)
  values (new.club, jsonb_build_object('formation', new.formation, 'tactics', new.tactics, 'lineup', new.lineup,
    'bench', new.bench, 'captain', new.captain, 'penalties', new.penalties, 'freekicks', new.freekicks, 'corners', new.corners,
    'kit', new.kit));
  return new;
end $$;

create or replace function public.lock_due_weeks() returns int
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, kit, saved_at)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', nullif(v.sheet->>'kit', ''), v.saved_at
    from (select distinct on (club) club, sheet, saved_at from public.team_sheet_versions
          where saved_at <= d.locks_at order by club, saved_at desc) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lock_due_weeks() from public, anon, authenticated;
