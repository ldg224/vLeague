-- Releases, signings, the cap, squad rules, the release limit, sheets cleaned, the window and a round being played.
do $$
declare d1 text; d2 text; d3 text; m1 text; fa_mid text; fa_cheap text; fa_dear text; fa2 text; b int; mid bigint; st jsonb;
  w_open int; w_locked int; s jsonb; sd1 text; sd2 text; fa_s text;
begin
  d1 := pg_temp.pl('TUR', 'DEF', 1); d2 := pg_temp.pl('TUR', 'DEF', 2); d3 := pg_temp.pl('TUR', 'DEF', 3); m1 := pg_temp.pl('TUR', 'MID', 1);
  fa_mid := pg_temp.pl(null, 'MID', 1); fa_cheap := pg_temp.pl(null, 'DEF', 1); fa2 := pg_temp.pl(null, 'DEF', 2); fa_dear := pg_temp.pl(null, 'DEF', 1, true);

  -- sheets holding d1: an unlocked round's submitted sheet, a locked round's submitted and week sheets, and the working team sheet
  select min(week) into w_open from public.deadlines where locked_at is null and locks_at > now() + interval '1 day';
  select max(week) into w_locked from public.deadlines where locked_at is not null and week < 90;
  insert into public.submitted_sheets (club, week, sheet) values
    ('TUR', w_open, jsonb_build_object('formation', '4-4-2', 'lineup', jsonb_build_object('GK', pg_temp.pl('TUR', 'GK', 1), 'LB', d1, 'RB', d2), 'bench', jsonb_build_array(d3, d1),
                                       'captain', d1, 'penalties', d1, 'corners', d2, 'boost', true)),
    ('TUR', w_locked, jsonb_build_object('lineup', jsonb_build_object('LB', d1), 'captain', d1))
  on conflict (club, week) do update set sheet = excluded.sheet;
  insert into public.week_sheets (week, club, lineup, captain) values (w_locked, 'TUR', jsonb_build_object('LB', d1), d1)
  on conflict (week, club) do update set lineup = excluded.lineup, captain = excluded.captain;
  insert into public.team_sheets (club, formation) values ('TUR', '4-4-2') on conflict (club) do nothing;
  update public.team_sheets set lineup = jsonb_build_object('LB', d1, 'RB', d2), bench = jsonb_build_array(d1), captain = d1, freekicks = d1, corners = d2 where club = 'TUR';

  -- ---- release
  b := public.office_bill('TUR');
  perform pg_temp.act('tur');
  mid := public.office_release(d1);
  perform pg_temp.ok('release: player becomes a free agent', pg_temp.club_of(d1) is null);
  perform pg_temp.ok('release: logged with the wage effect', exists (select 1 from public.office_moves where id = mid and kind = 'release' and club = 'TUR' and players_out = array[d1] and bill_before = b and bill_after = b - pg_temp.wage(d1)));
  st := public.office_state();
  perform pg_temp.ok('state: one release used, one left, one short', (st #>> '{releases,used}')::int = 1 and (st #>> '{releases,left}')::int = 1 and (st #>> '{roster,short}')::int = 1, st::text);
  perform pg_temp.ok('state: bill, room and squad one smaller', (st ->> 'wage_bill')::int = b - pg_temp.wage(d1) and (st ->> 'room')::int = 125000 - (st ->> 'wage_bill')::int
    and jsonb_array_length(st -> 'squad') = (select count(*) from public.players where club = 'TUR'), st::text);

  -- ---- sheets cleaned
  perform pg_temp.act('su');
  select sheet into s from public.submitted_sheets where club = 'TUR' and week = w_open;
  perform pg_temp.ok('sheets: out of the unlocked line-up and bench, others kept', not (s -> 'lineup' ? 'LB') and s #>> '{lineup,RB}' = d2 and s -> 'bench' = jsonb_build_array(d3), s::text);
  perform pg_temp.ok('sheets: captain and penalties cleared, corners kept, boost off', not (s ? 'captain') and not (s ? 'penalties') and s ->> 'corners' = d2 and s -> 'boost' = 'false'::jsonb, s::text);
  perform pg_temp.ok('sheets: locked submitted sheet untouched', (select sheet ->> 'captain' from public.submitted_sheets where club = 'TUR' and week = w_locked) = d1);
  perform pg_temp.ok('sheets: locked week sheet untouched', (select captain = d1 and lineup ->> 'LB' = d1 from public.week_sheets where club = 'TUR' and week = w_locked));
  perform pg_temp.ok('sheets: working team sheet cleaned', (select captain is null and freekicks is null and corners = d2 and not (lineup ? 'LB') and lineup ->> 'RB' = d2 and bench = '[]'::jsonb from public.team_sheets where club = 'TUR'));

  -- ---- squad rules
  perform pg_temp.act('tur');
  perform pg_temp.err('squad: a second release while one short is refused', format('select public.office_release(%L)', d2), 'at most one short');
  perform pg_temp.err('squad: releasing another position while short is refused', format('select public.office_release(%L)', m1), 'at most one short');
  perform pg_temp.err('squad: signing past a position''s maximum is refused', format('select public.office_sign(%L)', fa_mid), 'too many players at MID');

  -- ---- cap
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('TUR') + pg_temp.wage(fa_dear) - 1;
  perform pg_temp.act('tur');
  perform pg_temp.err('cap: a signing that takes the bill over the cap is refused', format('select public.office_sign(%L)', fa_dear), 'cap');
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('TUR') + pg_temp.wage(fa_cheap);
  perform pg_temp.act('tur');
  mid := public.office_sign(fa_cheap);
  perform pg_temp.ok('sign: a signing that lands exactly on the cap goes through', pg_temp.club_of(fa_cheap) = 'TUR' and exists (select 1 from public.office_moves where id = mid and kind = 'sign' and players_in = array[fa_cheap]));
  perform pg_temp.err('sign: a player who is not a free agent is refused', format('select public.office_sign(%L)', d2), 'not a free agent');
  perform pg_temp.err('release: another club''s player is refused', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'not in your squad');

  -- ---- release limit (2 per window; an undone release would not count)
  perform pg_temp.act('su');
  update public.office_settings set cap = 10000000;
  perform pg_temp.act('tur');
  perform public.office_release(d2);
  perform public.office_sign(fa2);
  perform pg_temp.err('release limit: a third release in the window is refused', format('select public.office_release(%L)', d3), 'all 2 releases');
  perform pg_temp.act('su');
  update public.office_settings set window_started_at = now() + interval '1 second';   -- a new window: (made_at is the transaction's start, so this puts the old releases before it)
  perform pg_temp.act('tur');
  perform pg_temp.ok('release limit: a new window starts the count again', (public.office_state() #>> '{releases,used}')::int = 0);
  perform pg_temp.act('su');
  update public.office_settings set window_started_at = now() - interval '1 minute';

  -- ---- over the cap: SKS (over 125,000 today, made sure of here) may release, but not sign while still over
  update public.office_settings set cap = public.office_bill('SKS') - 1000;
  sd1 := pg_temp.pl('SKS', 'DEF', 1, true); fa_s := pg_temp.pl(null, 'DEF', 1);
  perform pg_temp.act('sks');
  perform public.office_release(sd1);
  perform pg_temp.ok('cap: a club over the cap may release (it lowers the bill)', pg_temp.club_of(sd1) is null);
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('SKS') + pg_temp.wage(fa_s) - 1;
  perform pg_temp.act('sks');
  perform pg_temp.err('cap: a club still over after a signing cannot sign', format('select public.office_sign(%L)', fa_s), 'cap');
  perform pg_temp.act('su');
  update public.office_settings set cap = 125000;

  -- ---- the window
  update public.office_settings set window_open = false;
  perform pg_temp.act('lau');
  perform pg_temp.err('window: closed refuses a release', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'window is closed');
  perform pg_temp.act('su');
  update public.office_settings set window_open = true, opens_at = now() + interval '1 day';
  perform pg_temp.act('lau');
  perform pg_temp.err('window: one that opens later refuses a signing', format('select public.office_sign(%L)', pg_temp.pl(null, 'DEF', 1)), 'not open yet');
  perform pg_temp.act('su');
  update public.office_settings set opens_at = now() - interval '2 days', closes_at = now() - interval '1 day';
  perform pg_temp.act('lau');
  perform pg_temp.err('window: one past its closing time refuses a release', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'window is closed');
  perform pg_temp.act('su');
  update public.office_settings set opens_at = null, closes_at = now() + interval '1 day';

  -- ---- a round being played: from the line-up lock to 60 minutes after its last kick-off
  insert into public.rounds (week) values (97) on conflict (week) do nothing;
  insert into public.fixtures (id, week, home, away, starts_at) values ('zz-office-97', 97, 'TUR', 'LAU', now() - interval '10 minutes');
  insert into public.deadlines (week, locks_at) values (97, now() - interval '1 hour') on conflict (week) do update set locks_at = excluded.locks_at;
  perform pg_temp.ok('round: status says a round is being played', public.office_window_status() = 'round', public.office_window_status());
  perform pg_temp.act('lau');
  perform pg_temp.err('round: a release is refused mid-round', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'round is being played');
  perform pg_temp.ok('round: state shows the round', (public.office_state() #>> '{window,round_week}')::int = 97);
  perform pg_temp.act('su');
  update public.fixtures set postponed = true where id = 'zz-office-97';
  perform pg_temp.ok('round: a postponed game does not hold the window', public.office_window_status() = 'open', public.office_window_status());
  update public.fixtures set postponed = false, starts_at = now() - interval '61 minutes' where id = 'zz-office-97';
  perform pg_temp.ok('round: past the clock but not simulated still holds the window', public.office_window_status() = 'round', public.office_window_status());
  insert into public.results (fixture, summary) values ('zz-office-97', '{}'::jsonb);
  perform pg_temp.ok('round: open again once the last game is over and has its result', public.office_window_status() = 'open', public.office_window_status());

  -- ---- a draft running (live or paused) stops moves
  if not exists (select 1 from public.drafts) then insert into public.drafts (name) values ('Office test draft'); end if;
  update public.drafts set status = 'paused' where id = (select max(id) from public.drafts);
  perform pg_temp.act('lau');
  perform pg_temp.err('draft: a paused draft refuses a release', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'draft is running');
  perform pg_temp.act('su');
  update public.drafts set status = 'live' where id = (select max(id) from public.drafts);
  perform pg_temp.act('lau');
  perform pg_temp.err('draft: a live draft refuses a signing', format('select public.office_sign(%L)', pg_temp.pl(null, 'DEF', 1)), 'draft is running');
  perform pg_temp.act('su');
  update public.drafts set status = 'done' where status in ('live', 'paused');

  -- ---- over a maximum at one position: a move may not push another position over its maximum (even if the total over stays the same)
  declare mx int; k int; outs text[]; ins text[];
  begin
    select r.mx - (select count(*) from public.players where club = 'TUR' and position = 'MID') into mx from public.office_roster() r where r.pos = 'MID';
    k := greatest(mx, 0) + 1;
    -- TUR made k over at DEF by the office (free-agent defenders added), then swaps k defenders for k free midfielders
    update public.players set club = 'TUR' where id in (select id from public.players where club is null and position = 'DEF' order by id limit k);
    select array_agg(id) into outs from (select id from public.players where club = 'TUR' and position = 'DEF' order by id limit k) x;
    select array_agg(id) into ins from (select id from public.players where club is null and position = 'MID' order by id limit k) x;
    perform pg_temp.err('squad: a move that takes another position over its maximum is refused', format('select public.office_check(''TUR'', %L, %L)', outs, ins), 'too many players at MID');
  end;

  -- ---- who may call
  perform pg_temp.act('noclub');
  perform pg_temp.err('an account with no club cannot release', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'club manager');
  perform pg_temp.act('anon');
  perform pg_temp.err('a guest cannot call the Office', format('select public.office_sign(%L)', pg_temp.pl(null, 'DEF', 1)), 'permission denied');
  perform pg_temp.act('su');
end $$;
select name, ok, detail from t_log order by n;
