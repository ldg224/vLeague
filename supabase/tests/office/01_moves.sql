-- Releases, signings, the cap, squad rules, the release limit, sheets cleaned, the window and a round being played.
do $$
declare d1 text; d2 text; d3 text; m1 text; fa_mid text; fa_cheap text; fa_dear text; fa2 text; b int; mid bigint; st jsonb;
  w_open int; w_locked int; qrel text; qsign text; qf text; qc bigint; qr bigint; s jsonb; sd1 text; sd2 text; fa_s text;
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
  perform pg_temp.ok('state: one release used, one left, one short', (st #>> '{releases,used}')::int = 1 and (st #>> '{releases,left}')::int = 1 and (st #>> '{roster,total}')::int = (select count(*) from public.players where club = 'TUR'), st::text);
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
  perform pg_temp.err('squad: a second release while at 15 is refused (15 players at least, 4 defenders at least)', format('select public.office_release(%L)', d2), 'at least');
  perform pg_temp.err('squad: releasing another position while at 15 is refused', format('select public.office_release(%L)', m1), 'at least 15');
  perform pg_temp.ok('squad: no maximum for any position (0093)', (public.office_state() #> '{roster,positions,MID,max}') = 'null'::jsonb and (public.office_state() #>> '{roster,squad_max}')::int = 16);

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
  perform pg_temp.err('sign: a player who is not a free agent is refused', format('select public.office_sign(%L)', d2), 'free agent');
  perform pg_temp.err('release: another club''s player is refused', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'squad');

  -- ---- release limit (2 per window; an undone release would not count)
  perform pg_temp.act('su');
  update public.office_settings set cap = 10000000;
  perform pg_temp.act('tur');
  perform public.office_release(d2);
  perform public.office_sign(fa2);
  -- 0096: a third release goes through with a release fee (10% of his wage); undone here so the rest of the file starts as before
  perform pg_temp.act('su');
  b := public.office_bill('TUR');
  perform pg_temp.act('tur');
  mid := public.office_release(d3);
  perform pg_temp.act('su');
  perform pg_temp.ok('release limit: a third release goes through, with a fee of 10% of his wage on the bill', pg_temp.club_of(d3) is null
    and (select bill_after from public.office_moves where id = mid) = b - pg_temp.wage(d3) + round(pg_temp.wage(d3) * 0.1)::int);
  perform pg_temp.act('office');
  perform public.office_undo(mid);
  perform pg_temp.act('tur');
  perform pg_temp.act('su');
  update public.office_settings set window_started_at = now() + interval '1 second';   -- a new window: (made_at is the transaction's start, so this puts the old releases before it)
  perform pg_temp.act('tur');
  perform pg_temp.ok('release limit: a new window starts the count again', (public.office_state() #>> '{releases,used}')::int = 0);
  perform pg_temp.act('su');
  update public.office_settings set window_started_at = now() - interval '1 minute';

  perform pg_temp.act('su');
  update public.office_settings set squad_min = 11;   -- 0093: live SKS may already be at 15; this part is about the cap
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

  -- ---- the window not open: moves wait in the queue and go through when it opens (0093)
  update public.office_settings set window_open = false;
  perform pg_temp.act('lau');
  qrel := pg_temp.pl('LAU', 'MID', 1);
  perform pg_temp.ok('queue: a release while the window is closed waits', public.office_release(qrel) is null);
  perform pg_temp.ok('queue: nothing moves yet, the release is queued', pg_temp.club_of(qrel) = 'LAU' and exists (select 1 from public.office_queue where player = qrel and kind = 'release' and status = 'queued'));
  perform pg_temp.err('queue: the same release twice is refused', format('select public.office_release(%L)', qrel), 'already waiting');
  perform pg_temp.act('su');
  update public.office_settings set window_open = true, opens_at = now() + interval '1 day';
  perform pg_temp.act('lau');
  qsign := pg_temp.pl(null, 'DEF', 1);
  perform pg_temp.ok('queue: a signing before the window opens waits', public.office_sign(qsign) is null and pg_temp.club_of(qsign) is null);
  perform pg_temp.act('su');
  update public.office_settings set opens_at = null;
  perform public.office_process_queue();
  perform pg_temp.ok('queue: when the window opens they go through, in order', pg_temp.club_of(qrel) is null and pg_temp.club_of(qsign) = 'LAU'
    and (select bool_and(status = 'done' and move_id is not null) from public.office_queue where player in (qrel, qsign)));
  update public.office_settings set window_open = false;
  perform pg_temp.act('lau');
  qf := pg_temp.pl(null, 'DEF', 1);
  perform public.office_sign(qf);
  perform pg_temp.act('su');
  update public.players set club = 'SKS' where id = qf;   -- another club got him first
  update public.office_settings set window_open = true;
  perform public.office_process_queue();
  perform pg_temp.ok('queue: a queued move that no longer works fails with the reason', (select status = 'failed' and note like '%free agent%' from public.office_queue where player = qf and kind = 'sign' order by id desc limit 1));
  update public.office_settings set window_open = false;
  perform pg_temp.act('lau');
  perform public.office_release(pg_temp.pl('LAU', 'FWD', 1));
  select id into qc from public.office_queue where club = 'LAU' and status = 'queued' order by id desc limit 1;
  perform public.office_queue_cancel(qc);
  perform pg_temp.ok('queue: a waiting move can be taken back', (select status from public.office_queue where id = qc) = 'cancelled');
  perform pg_temp.act('tur');
  perform pg_temp.err('queue: another club cannot take it back', format('select public.office_queue_cancel(%s)', qc), 'No such move');
  perform pg_temp.act('su');
  update public.office_settings set window_open = true, opens_at = null, closes_at = now() + interval '1 day';
  -- ---- a round being played: from the line-up lock to 60 minutes after its last kick-off
  insert into public.rounds (week) values (97) on conflict (week) do nothing;
  insert into public.fixtures (id, week, home, away, starts_at) values ('zz-office-97', 97, 'TUR', 'LAU', now() - interval '10 minutes');
  insert into public.deadlines (week, locks_at) values (97, now() - interval '1 hour') on conflict (week) do update set locks_at = excluded.locks_at;
  perform pg_temp.ok('round: status says a round is being played', public.office_window_status() = 'round', public.office_window_status());
  perform pg_temp.act('lau');
  perform pg_temp.ok('round: a release mid-round waits for the round to end', public.office_release(pg_temp.pl('LAU', 'DEF', 1)) is null);
  select id into qr from public.office_queue where club = 'LAU' and status = 'queued' order by id desc limit 1;
  perform public.office_queue_cancel(qr);
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

  -- ---- 16 at most, and no maximum for any position (0093)
  update public.players set club = 'TUR' where id in (select id from public.players where club is null and position = 'FWD' order by id limit greatest(0, 16 - (select count(*) from public.players where club = 'TUR')));
  perform pg_temp.err('squad: a 17th player is refused', format('select public.office_check(''TUR'', %L, %L)', array[]::text[], array[pg_temp.pl(null, 'MID', 1)]), '16 at most');

  -- ---- who may call
  perform pg_temp.act('noclub');
  perform pg_temp.err('an account with no club cannot release', format('select public.office_release(%L)', pg_temp.pl('LAU', 'DEF', 1)), 'club manager');
  perform pg_temp.act('anon');
  perform pg_temp.err('a guest cannot call the Office', format('select public.office_sign(%L)', pg_temp.pl(null, 'DEF', 1)), 'permission denied');
  perform pg_temp.act('su');
end $$;
select name, ok, detail from t_log order by n;
