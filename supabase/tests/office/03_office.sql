-- The office: undo, settings; reading clubs; row-level security and who may call what.
do $$
declare t1 text; t2 text; t3 text; l1 text; l2 text; l3 text; r1 bigint; r2 bigint; s1 bigint; tr bigint; tr2 bigint; o bigint; cl jsonb; st public.office_settings; ws timestamptz;
begin
  t1 := pg_temp.pl('TUR', 'DEF', 1); t2 := pg_temp.pl('TUR', 'DEF', 2); t3 := pg_temp.pl('TUR', 'DEF', 3);
  l1 := pg_temp.pl('LAU', 'DEF', 1); l2 := pg_temp.pl('LAU', 'DEF', 2); l3 := pg_temp.pl('LAU', 'DEF', 3);
  update public.office_settings set cap = 10000000;

  -- ---- undo a release
  perform pg_temp.act('tur');
  r1 := public.office_release(t1);
  perform pg_temp.err('undo: a manager cannot undo', format('select public.office_undo(%s)', r1), 'Only the league office');
  perform pg_temp.act('office');
  perform public.office_undo(r1);
  perform pg_temp.act('su');
  perform pg_temp.ok('undo release: the player is back', pg_temp.club_of(t1) = 'TUR' and (select undone_at is not null from public.office_moves where id = r1));
  perform pg_temp.act('tur');
  perform pg_temp.ok('undo release: it no longer counts against the limit', (public.office_state() #>> '{releases,used}')::int = 0);
  perform pg_temp.act('office');
  perform pg_temp.err('undo: not twice', format('select public.office_undo(%s)', r1), 'already been undone');

  -- ---- undo blocked while the player has moved on; undo the later move first
  perform pg_temp.act('tur');
  r1 := public.office_release(t1);
  perform pg_temp.act('lau');
  r2 := public.office_release(l1);
  s1 := public.office_sign(t1);
  perform pg_temp.act('su');
  insert into public.team_sheets (club, formation) values ('LAU', '4-4-2') on conflict (club) do nothing;
  update public.team_sheets set captain = t1 where club = 'LAU';
  perform pg_temp.act('office');
  perform pg_temp.err('undo release: refused once the player has been signed', format('select public.office_undo(%s)', r1), 'signed since');
  perform public.office_undo(s1);
  perform pg_temp.act('su');
  perform pg_temp.ok('undo signing: the player is a free agent again and out of the sheet', pg_temp.club_of(t1) is null and (select captain is null from public.team_sheets where club = 'LAU'));
  perform pg_temp.act('office');
  perform public.office_undo(r1);
  perform public.office_undo(r2);
  perform pg_temp.act('su');
  perform pg_temp.ok('undo: both releases undone, everyone home', pg_temp.club_of(t1) = 'TUR' and pg_temp.club_of(l1) = 'LAU');

  -- ---- undo a trade; blocked when a player in it has moved since
  perform pg_temp.act('tur');
  o := public.office_offer('LAU', array[t2], array[l2]);
  perform pg_temp.act('lau');
  tr := public.office_respond(o, true);
  perform pg_temp.act('office');
  perform public.office_undo(tr);
  perform pg_temp.act('su');
  perform pg_temp.ok('undo trade: the players go back', pg_temp.club_of(t2) = 'TUR' and pg_temp.club_of(l2) = 'LAU');
  perform pg_temp.act('tur');
  o := public.office_offer('LAU', array[t3], array[l3]);
  perform pg_temp.act('lau');
  tr2 := public.office_respond(o, true);
  perform public.office_release(t3);
  perform pg_temp.act('office');
  perform pg_temp.err('undo trade: refused when a player has moved since', format('select public.office_undo(%s)', tr2), 'moved since');

  -- ---- settings
  perform pg_temp.act('tur');
  perform pg_temp.err('settings: a manager cannot change them', 'select public.office_save_settings(''{"cap": 1}'')', 'Only the league office');
  perform pg_temp.act('office');
  perform pg_temp.err('settings: unknown keys are refused', 'select public.office_save_settings(''{"wages": 1}'')', 'unknown setting');
  perform pg_temp.err('settings: a negative cap is refused', 'select public.office_save_settings(''{"cap": -1}'')', 'out of range');
  perform pg_temp.err('settings: a window that closes before it opens is refused', 'select public.office_save_settings(''{"opens_at": "2027-01-10T00:00:00Z", "closes_at": "2027-01-01T00:00:00Z"}'')', 'out of range');
  st := public.office_save_settings('{"cap": 130000, "releases_per_window": 3, "window_open": false, "opens_at": "2027-01-01T00:00:00Z", "closes_at": "2027-01-10T00:00:00Z"}');
  perform pg_temp.ok('settings: saved', st.cap = 130000 and st.releases_per_window = 3 and not st.window_open and st.opens_at = '2027-01-01T00:00:00Z' and st.closes_at = '2027-01-10T00:00:00Z');
  ws := st.window_started_at;
  st := public.office_save_settings('{"window_open": true, "opens_at": "", "closes_at": null}');
  perform pg_temp.ok('settings: switching the window on starts a new one and dates clear', st.window_open and st.window_started_at = now() and st.window_started_at is distinct from ws and st.opens_at is null and st.closes_at is null);

  -- ---- reading any club
  perform pg_temp.act('tur');
  cl := public.office_club('SKS');
  perform pg_temp.ok('club: any club''s squad, bill and room', (cl ->> 'wage_bill')::int = (select sum(value) from public.players where club = 'SKS') and jsonb_array_length(cl -> 'squad') = 16
    and (cl ->> 'room')::int = 130000 - (cl ->> 'wage_bill')::int and (cl #>> '{squad,0,wage}') is not null and (cl #>> '{roster,positions,GK,max}')::int = 2, left(cl::text, 300));
  perform pg_temp.err('club: no such club', 'select public.office_club(''ZZZ'')', 'No such club');

  -- ---- row-level security and grants
  perform pg_temp.ok('RLS: managers read the moves log', (select count(*) from public.office_moves) >= 1);
  perform pg_temp.ok('RLS: managers read the settings', (select count(*) from public.office_settings) = 1);
  perform pg_temp.err('RLS: a manager cannot write moves', 'insert into public.office_moves (kind, club, bill_before, bill_after) values (''sign'', ''TUR'', 0, 0)', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot write offers', 'insert into public.office_offers (from_club, to_club) values (''TUR'', ''LAU'')', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot change offers', 'update public.office_offers set status = ''accepted''', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot change the settings', 'update public.office_settings set cap = 1', 'permission denied');
  perform pg_temp.err('RLS: a manager cannot undo a move by hand', 'update public.office_moves set undone_at = now()', 'permission denied');
  perform pg_temp.err('grants: the helpers are not callable', 'select public.office_check(''TUR'', ''{}'', ''{}'')', 'permission denied');
  perform pg_temp.err('grants: sheet cleaning is not callable', 'select public.office_clean_sheets(''LAU'', array[''0001''])', 'permission denied');
  perform pg_temp.act('office');
  perform pg_temp.err('the office with no club has no Office of its own', 'select public.office_state()', 'club manager');
  perform pg_temp.act('anon');
  perform pg_temp.err('a guest cannot read the moves', 'select count(*) from public.office_moves', 'permission denied');
  perform pg_temp.err('a guest cannot read a club''s wages', 'select public.office_club(''TUR'')', 'permission denied');
  perform pg_temp.err('a guest cannot read the state', 'select public.office_state()', 'permission denied');
  perform pg_temp.act('su');
end $$;
select name, ok, detail from t_log order by n;
