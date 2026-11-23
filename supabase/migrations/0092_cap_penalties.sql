-- Cap penalty points (Admin Explains Ep. 02 · Penalty points, 16 Nov 2026): a club may go over the wage cap, up to a hard limit, and gets penalty points
-- by how far over it is. Safe to re-run. Needs 0091 (the Office). Additive: 0091's tables keep their columns; the functions below replace 0091's.
--
-- The rule:
--   Over      over = greatest(0, wage bill - cap). The points (office_penalty_points):
--               $0 (on or under the cap) 0 · $1 to $5,000 1 · $5,001 to $10,000 3 · $10,001 to $15,000 6 · $15,001 to $20,000 10
--               $20,001 to $25,000 15 · $25,001 to $30,000 21.
--   Limit     office_settings.over_limit (30,000): a move is refused only if the club's bill ends above cap + over_limit AND is not lower than before.
--             So a club may go over the cap up to the limit; a club already past the limit (an office edit, a lower cap) may still lower its bill.
--             Past the limit the ladder stays at its top step (21) for the office's apply; the moves themselves cannot get a club there.
--   Pending   during the season the points are only shown (office_state, office_club, office_cap_report: from each club's bill now).
--   Applied   at the end of the regular season the office presses "Apply cap penalties" (office_apply_cap_penalties): one points_adjustments row per
--             club over the cap, points = -ladder(bill - cap), reason 'Cap penalty', from the bills at that moment. The league table counts adjustments.
--             Applying twice is refused while an application stands; office_undo_cap_penalties() undoes it (rows kept, undone_at set) so it can be applied again.
--
--   points_adjustments            club, points (negative for a penalty), reason, season, note, bill, over, created_at/by, undone_at/by. Everyone signed in reads it.
--   office_penalty_points(over)   the ladder (pure; callable by anyone signed in)
--   office_cap_report()           signed in: cap, over_limit, applied (bool) and every club's bill, over, pending points, applied points
--   office_apply_cap_penalties()  office only; returns the rows it recorded
--   office_undo_cap_penalties()   office only; returns how many rows it undid

-- Fix to 0091 (found while testing 0092): a test match (week 99, the site's test week) counted as "a round being played" and held the transfer window
-- shut while it ran. Test matches never hold the window now.
create or replace function public.office_round_live() returns int
language sql stable security definer set search_path = public as $$
  select min(d.week) from public.deadlines d
  where d.week <> 99
    and coalesce(d.locked_at, d.locks_at) <= now()
    and exists (select 1 from public.fixtures f where f.week = d.week and f.starts_at is not null and not f.postponed
                and (not public.stakes_match_over(f.starts_at, f.postponed)
                     or (f.starts_at <= now() and not exists (select 1 from public.results r where r.fixture = f.id))))
$$;
revoke all on function public.office_round_live() from public, anon, authenticated;

alter table public.office_settings add column if not exists over_limit int not null default 30000;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_settings_over_limit_range') then
    alter table public.office_settings add constraint office_settings_over_limit_range check (over_limit between 0 and 1000000);
  end if;
end $$;

create table if not exists public.points_adjustments (
  id          bigserial primary key,
  club        text not null references public.clubs(code) on update cascade,
  points      int not null,
  reason      text not null,
  season      text,
  note        text,
  bill        int,
  over        int,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  undone_at   timestamptz,
  undone_by   uuid
);
create index if not exists points_adjustments_live on public.points_adjustments (reason) where undone_at is null;
alter table public.points_adjustments enable row level security;
drop policy if exists points_adjustments_read on public.points_adjustments;
create policy points_adjustments_read on public.points_adjustments for select to authenticated using (true);
revoke all on public.points_adjustments from anon, authenticated;
grant select on public.points_adjustments to authenticated;
revoke all on sequence public.points_adjustments_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- the ladder

create or replace function public.office_penalty_points(p_over int) returns int
language sql immutable set search_path = public as $$
  select case
    when coalesce(p_over, 0) <= 0 then 0
    when p_over <= 5000 then 1
    when p_over <= 10000 then 3
    when p_over <= 15000 then 6
    when p_over <= 20000 then 10
    when p_over <= 25000 then 15
    else 21 end
$$;
revoke all on function public.office_penalty_points(int) from public, anon;
grant execute on function public.office_penalty_points(int) to authenticated;

-- ---------------------------------------------------------------- the check (replaces 0091's: over the cap is allowed up to the limit)

create or replace function public.office_check(p_club text, p_out text[], p_in text[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b0 int; b1 int; short0 int; short1 int; over0 int; over1 int; bad text;
begin
  b0 := public.office_bill(p_club);
  b1 := b0 - coalesce((select sum(value) from public.players where id = any (p_out)), 0)::int + coalesce((select sum(value) from public.players where id = any (p_in)), 0)::int;
  if b1 > c.cap + c.over_limit and b1 >= b0 then
    raise exception '% would have a wage bill of %, % over the cap of % (the most a club may go over is %; a club past that may only make moves that lower its bill).',
      p_club, to_char(b1, 'FM999,999,990'), to_char(b1 - c.cap, 'FM999,999,990'), to_char(c.cap, 'FM999,999,990'), to_char(c.over_limit, 'FM999,999,990');
  end if;
  with now_ as (select position, count(*)::int n from public.players where club = p_club group by position),
       aft as (select position, count(*)::int n from public.players
               where (club = p_club and not (id = any (p_out))) or id = any (p_in) group by position),
       t as (select r.pos, r.mn, r.mx, coalesce(a.n, 0) n0, coalesce(b.n, 0) n1
             from public.office_roster() r left join now_ a on a.position = r.pos left join aft b on b.position = r.pos)
  select sum(greatest(0, mn - n0)), sum(greatest(0, mn - n1)), sum(greatest(0, n0 - mx)), sum(greatest(0, n1 - mx)),
         string_agg(case when n1 > mx and n1 > n0 then pos || ' (most ' || mx || ')' end, ', ')
    into short0, short1, over0, over1, bad
  from t;
  if bad is not null then raise exception '% would have too many players at %.', p_club, bad; end if;
  if short1 > greatest(1, short0) then
    raise exception '% would be % players short of the squad rules (a club may be at most one short: sign or trade for one first).', p_club, short1;
  end if;
end $$;
revoke all on function public.office_check(text, text[], text[]) from public, anon, authenticated;

-- A club's cap figures for the pages: { cap, over_limit, limit, over, penalty_points }.
create or replace function public.office_cap_json(p_bill int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('over_limit', c.over_limit, 'limit', c.cap + c.over_limit, 'over', greatest(0, p_bill - c.cap),
                            'penalty_points', public.office_penalty_points(p_bill - c.cap))
  from public.office_settings c where c.id = 1
$$;
revoke all on function public.office_cap_json(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- settings (replaces 0091's: takes over_limit)

create or replace function public.office_save_settings(p jsonb) returns public.office_settings
language plpgsql security definer set search_path = public as $$
declare c public.office_settings; k text; keys text[] := array['cap', 'over_limit', 'releases_per_window', 'window_open', 'opens_at', 'closes_at']; st0 text; st1 text;
begin
  if not public.is_office() then raise exception 'Only the league office can change Office settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  select * into c from public.office_settings where id = 1 for update;
  st0 := public.office_window_status();
  perform public.office_tidy();
  update public.office_settings set
    cap                 = coalesce((p ->> 'cap')::int, cap),
    over_limit          = coalesce((p ->> 'over_limit')::int, over_limit),
    releases_per_window = coalesce((p ->> 'releases_per_window')::int, releases_per_window),
    window_open         = coalesce((p ->> 'window_open')::boolean, window_open),
    opens_at            = case when p ? 'opens_at' then nullif(p ->> 'opens_at', '')::timestamptz else opens_at end,
    closes_at           = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    window_started_at   = case when coalesce((p ->> 'window_open')::boolean, window_open) and not window_open then now() else window_started_at end,
    updated_at          = now()
  where id = 1 returning * into c;
  st1 := public.office_window_status();
  if st0 in ('closed', 'not_yet') and st1 in ('open', 'round') then
    update public.office_settings set window_started_at = now() where id = 1 returning * into c;
  end if;
  perform public.office_tidy();
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a cap from 0 to 10,000,000, an over-cap limit from 0 to 1,000,000, 0 to 50 releases, a window that closes after it opens)';
end $$;
revoke all on function public.office_save_settings(jsonb) from public, anon;
grant execute on function public.office_save_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------- reads (replace 0091's: with the over and the pending penalty)

create or replace function public.office_club(p_club text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b int; cl public.clubs;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into cl from public.clubs where code = p_club;
  if not found then raise exception 'No such club.'; end if;
  b := public.office_bill(p_club);
  return jsonb_build_object('club', cl.code, 'name', cl.name, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b,
                            'roster', public.office_roster_json(p_club), 'squad', public.office_squad_json(p_club)) || public.office_cap_json(b);
end $$;
revoke all on function public.office_club(text) from public, anon;
grant execute on function public.office_club(text) to authenticated;

create or replace function public.office_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare my text := public.office_my_club(); c public.office_settings; b int; used int; st text;
begin
  perform public.office_tidy();
  c := public.office_cfg(); st := public.office_window_status();
  b := public.office_bill(my);
  select count(*) into used from public.office_moves
  where club = my and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  return jsonb_build_object(
    'club', my, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b, 'over_cap', b > c.cap,
    'window', jsonb_build_object('status', st, 'open', st = 'open', 'window_open', c.window_open, 'opens_at', c.opens_at, 'closes_at', c.closes_at,
                                 'round_week', public.office_round_live()),
    'releases', jsonb_build_object('limit', c.releases_per_window, 'used', used, 'left', greatest(0, c.releases_per_window - used)),
    'roster', public.office_roster_json(my),
    'squad', public.office_squad_json(my),
    'offers_in', public.office_offers_json('in', my),
    'offers_out', public.office_offers_json('out', my),
    'penalties_applied', exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null)) || public.office_cap_json(b);
end $$;
revoke all on function public.office_state() from public, anon;
grant execute on function public.office_state() to authenticated;

-- Every club's bill and penalty: pending (from the bill now) and applied (the standing 'Cap penalty' adjustment, if any). Any signed-in user.
create or replace function public.office_cap_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg();
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object('cap', c.cap, 'over_limit', c.over_limit,
    'applied', exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('club', x.code, 'name', x.name, 'wage_bill', x.b, 'over', greatest(0, x.b - c.cap),
                                                            'points', public.office_penalty_points(x.b - c.cap), 'applied_points', x.applied)
                                         order by x.b desc, x.code), '[]'::jsonb)
              from (select cl.code, cl.name, public.office_bill(cl.code) b,
                           (select sum(a.points)::int from public.points_adjustments a where a.club = cl.code and a.reason = 'Cap penalty' and a.undone_at is null) applied
                    from public.clubs cl where cl.status is distinct from 'withdrawn' and cl.status is distinct from 'pending') x));
end $$;
revoke all on function public.office_cap_report() from public, anon;
grant execute on function public.office_cap_report() to authenticated;

-- ---------------------------------------------------------------- apply and undo (office only)

create or replace function public.office_apply_cap_penalties(p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.office_settings; res jsonb;
begin
  if not public.is_office() then raise exception 'Only the league office can apply cap penalties.'; end if;
  select * into c from public.office_settings where id = 1 for update;   -- one apply at a time
  if exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null) then
    raise exception 'Cap penalties have already been applied. Undo them first to apply them again.';
  end if;
  perform public.office_lock_clubs(array(select code from public.clubs));   -- no move changes a bill while the penalties are worked out
  with ins as (
    insert into public.points_adjustments (club, points, reason, note, bill, over, created_by)
    select x.code, -public.office_penalty_points(x.b - c.cap), 'Cap penalty', nullif(trim(p_note), ''), x.b, x.b - c.cap, auth.uid()
    from (select cl.code, public.office_bill(cl.code) b from public.clubs cl
          where cl.status is distinct from 'withdrawn' and cl.status is distinct from 'pending') x
    where public.office_penalty_points(x.b - c.cap) > 0
    returning club, points, bill, over)
  select coalesce(jsonb_agg(jsonb_build_object('club', club, 'points', points, 'wage_bill', bill, 'over', over) order by points, club), '[]'::jsonb) into res from ins;
  return res;
end $$;
revoke all on function public.office_apply_cap_penalties(text) from public, anon;
grant execute on function public.office_apply_cap_penalties(text) to authenticated;

create or replace function public.office_undo_cap_penalties() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_office() then raise exception 'Only the league office can undo cap penalties.'; end if;
  perform 1 from public.office_settings where id = 1 for update;
  update public.points_adjustments set undone_at = now(), undone_by = auth.uid() where reason = 'Cap penalty' and undone_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There are no cap penalties to undo.'; end if;
  return n;
end $$;
revoke all on function public.office_undo_cap_penalties() from public, anon;
grant execute on function public.office_undo_cap_penalties() to authenticated;
