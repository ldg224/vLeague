-- Cap penalty points (0092): the ladder, moves over the cap up to the limit, a club past the limit, the pending penalty in the reads,
-- applying the penalties (office only, once), undo, the over_limit setting and row-level security.
do $$
declare t1 text; fa text; fa2 text; s1 text; fa_s text; st jsonb; cl jsonb; rep jsonb; res jsonb; n int; b int; capv int; s public.office_settings;
begin
  -- ---- the ladder
  perform pg_temp.ok('ladder: ' || x.o || ' over -> ' || x.p, public.office_penalty_points(x.o) = x.p, coalesce(public.office_penalty_points(x.o)::text, 'null'))
  from (values (-500, 0), (0, 0), (1, 1), (5000, 1), (5001, 3), (10000, 3), (10001, 6), (15000, 6), (15001, 10), (20000, 10), (20001, 15),
               (25000, 15), (25001, 21), (30000, 21), (30001, 21)) x(o, p);
  perform pg_temp.ok('ladder: no bill over -> 0', public.office_penalty_points(null) = 0);
  perform pg_temp.ok('settings: over_limit defaults to 30,000', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'office_settings' and column_name = 'over_limit') = '30000');

  -- ---- moves over the cap, up to the limit
  update public.office_settings set cap = 10000000, over_limit = 30000;
  t1 := pg_temp.pl('TUR', 'DEF', 1);
  fa := pg_temp.pl(null, 'DEF', 1, true); fa2 := pg_temp.pl(null, 'DEF', 2, true);
  perform pg_temp.act('tur');
  perform public.office_release(t1);
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('TUR') + pg_temp.wage(fa) - 6200;   -- the signing lands $6,200 over
  perform pg_temp.act('tur');
  perform public.office_sign(fa);
  perform pg_temp.ok('over the cap: a signing that lands $6,200 over goes through', pg_temp.club_of(fa) = 'TUR');
  st := public.office_state();
  perform pg_temp.ok('state: over, penalty points, limit', (st ->> 'over')::int = 6200 and (st ->> 'penalty_points')::int = 3 and (st ->> 'over_limit')::int = 30000
    and (st ->> 'limit')::int = (st ->> 'cap')::int + 30000 and (st ->> 'over_cap')::boolean and not (st ->> 'penalties_applied')::boolean, left(st::text, 400));
  cl := public.office_club('TUR');
  perform pg_temp.ok('club: over and penalty points', (cl ->> 'over')::int = 6200 and (cl ->> 'penalty_points')::int = 3, left(cl::text, 200));

  -- one more release (a new window, so the limit is not in the way), then a signing one dollar past the limit is refused and one exactly at it is not
  perform pg_temp.act('su');
  update public.office_settings set cap = 10000000, window_started_at = now() + interval '1 second';
  perform pg_temp.act('tur');
  perform public.office_release(fa);
  perform pg_temp.act('su');
  update public.office_settings set window_started_at = now() - interval '1 minute';
  capv := public.office_bill('TUR') + pg_temp.wage(fa2) - 30001;
  update public.office_settings set cap = capv;
  perform pg_temp.act('tur');
  perform pg_temp.err('limit: a signing that lands $30,001 over is refused', format('select public.office_sign(%L)', fa2), 'the most a club may go over is 30,000');
  perform pg_temp.act('su');
  update public.office_settings set cap = capv + 1;
  perform pg_temp.act('tur');
  perform public.office_sign(fa2);
  perform pg_temp.ok('limit: a signing that lands exactly $30,000 over goes through', pg_temp.club_of(fa2) = 'TUR' and (public.office_state() ->> 'penalty_points')::int = 21);

  -- ---- a club past the limit (the cap lowered by the office) may still lower its bill, never raise it
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('SKS') - 60000;   -- $60,000 over, past the $30,000 limit
  s1 := pg_temp.pl('SKS', 'DEF', 1, true); fa_s := pg_temp.pl(null, 'DEF', 1);
  perform pg_temp.act('sks');
  perform public.office_release(s1);
  perform pg_temp.ok('past the limit: a release (bill down) goes through', pg_temp.club_of(s1) is null);
  perform pg_temp.err('past the limit: a signing (bill up) is refused', format('select public.office_sign(%L)', fa_s), 'SKS would have a wage bill');
  perform pg_temp.ok('past the limit: the ladder stays at its top step', (public.office_state() ->> 'penalty_points')::int = 21);

  -- ---- the cap report (everyone signed in)
  perform pg_temp.act('su');
  update public.office_settings set cap = 125000;
  perform pg_temp.act('lau');
  rep := public.office_cap_report();
  perform pg_temp.ok('report: every club with its bill and pending points', (rep ->> 'cap')::int = 125000 and not (rep ->> 'applied')::boolean
    and jsonb_array_length(rep -> 'clubs') = (select count(*) from public.clubs where status is distinct from 'withdrawn' and status is distinct from 'pending')
    and not exists (select 1 from jsonb_array_elements(rep -> 'clubs') e where (e ->> 'points')::int <> public.office_penalty_points((e ->> 'wage_bill')::int - 125000)), left(rep::text, 400));

  -- ---- apply (office only, once)
  perform pg_temp.act('tur');
  perform pg_temp.err('apply: a manager cannot apply penalties', 'select public.office_apply_cap_penalties()', 'Only the league office');
  perform pg_temp.act('su');
  update public.office_settings set cap = least(public.office_bill('TUR'), public.office_bill('SKS')) - 7000;   -- TUR and SKS at least $7,000 over
  b := public.office_bill('TUR'); capv := (select cap from public.office_settings);
  perform pg_temp.act('office');
  res := public.office_apply_cap_penalties('End of the regular season');
  perform pg_temp.act('su');
  perform pg_temp.ok('apply: one row per club over the cap', jsonb_array_length(res) = (select count(*) from public.clubs c where c.status is distinct from 'withdrawn' and c.status is distinct from 'pending' and public.office_bill(c.code) > capv)
    and (select count(*) from public.points_adjustments where reason = 'Cap penalty' and undone_at is null) = jsonb_array_length(res), left(res::text, 400));
  perform pg_temp.ok('apply: TUR gets minus the ladder of its over', (select points = -public.office_penalty_points(b - capv) and bill = b and over = b - capv and note = 'End of the regular season' and created_by = '00000000-0000-4000-8000-0000000f0004'
    from public.points_adjustments where club = 'TUR' and reason = 'Cap penalty' and undone_at is null));
  perform pg_temp.ok('apply: no row for a club on or under the cap', not exists (select 1 from public.points_adjustments a where a.reason = 'Cap penalty' and a.undone_at is null and (a.points >= 0 or public.office_bill(a.club) <= capv)));
  perform pg_temp.act('office');
  perform pg_temp.err('apply: not twice', 'select public.office_apply_cap_penalties()', 'already been applied');
  perform pg_temp.act('tur');
  perform pg_temp.ok('apply: the state says it is applied', (public.office_state() ->> 'penalties_applied')::boolean);
  perform pg_temp.ok('apply: the report shows the applied points', (select (e ->> 'applied_points')::int from jsonb_array_elements(public.office_cap_report() -> 'clubs') e where e ->> 'club' = 'TUR') = -public.office_penalty_points(b - capv));

  -- ---- row-level security
  perform pg_temp.ok('RLS: managers read the adjustments', (select count(*) from public.points_adjustments where reason = 'Cap penalty') >= 2);
  perform pg_temp.err('RLS: a manager cannot add an adjustment', 'insert into public.points_adjustments (club, points, reason) values (''TUR'', 5, ''x'')', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot change an adjustment', 'update public.points_adjustments set points = 0', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot delete an adjustment', 'delete from public.points_adjustments', 'permission denied');
  perform pg_temp.act('office');
  perform pg_temp.err('RLS: the office cannot write adjustments by hand either', 'update public.points_adjustments set points = 0', 'permission denied');
  perform pg_temp.act('anon');
  perform pg_temp.err('RLS: a guest cannot read the adjustments', 'select count(*) from public.points_adjustments', 'permission denied');
  perform pg_temp.err('grants: a guest cannot read the cap report', 'select public.office_cap_report()', 'permission denied');
  perform pg_temp.err('grants: a guest cannot apply', 'select public.office_apply_cap_penalties()', 'permission denied');

  -- ---- undo
  perform pg_temp.act('tur');
  perform pg_temp.err('undo: a manager cannot undo penalties', 'select public.office_undo_cap_penalties()', 'Only the league office');
  perform pg_temp.act('office');
  n := public.office_undo_cap_penalties();
  perform pg_temp.ok('undo: every applied row is undone', n = jsonb_array_length(res) and not exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null)
    and (select count(*) from public.points_adjustments where reason = 'Cap penalty' and undone_by = '00000000-0000-4000-8000-0000000f0004') = n, n::text);
  perform pg_temp.err('undo: nothing left to undo', 'select public.office_undo_cap_penalties()', 'no cap penalties to undo');
  res := public.office_apply_cap_penalties();
  perform pg_temp.ok('undo: penalties can be applied again after an undo', jsonb_array_length(res) = n and (select count(*) from public.points_adjustments where reason = 'Cap penalty') = 2 * n);

  -- ---- the over_limit setting
  s := public.office_save_settings('{"over_limit": 20000}');
  perform pg_temp.ok('settings: over_limit saved', s.over_limit = 20000);
  perform pg_temp.err('settings: a negative over_limit is refused', 'select public.office_save_settings(''{"over_limit": -1}'')', 'out of range');
  perform pg_temp.act('tur');
  perform pg_temp.err('settings: a manager cannot change over_limit', 'select public.office_save_settings(''{"over_limit": 1}'')', 'Only the league office');
  perform pg_temp.act('su');

  -- ---- a test match (week 99) being played never holds the window (fix to 0091)
  update public.fixtures set postponed = true where week <> 99 and starts_at <= now() and starts_at > now() - interval '3 hours';
  insert into public.deadlines (week, locks_at, locked_at) values (99, now() - interval '30 minutes', now() - interval '30 minutes')
    on conflict (week) do update set locks_at = excluded.locks_at, locked_at = excluded.locked_at;
  insert into public.fixtures (id, week, home, away, starts_at, postponed) values ('t99-office-check', 99, 'TUR', 'LAU', now() - interval '10 minutes', false);
  perform pg_temp.ok('window: a test match being played (week 99) does not count as a round', public.office_round_live() is distinct from 99,
    coalesce(public.office_round_live()::text, 'none'));
end $$;
select name, ok, detail from t_log order by n;
