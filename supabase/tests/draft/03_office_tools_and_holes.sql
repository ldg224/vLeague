do $$
declare d bigint; r text; n int; x text; y text; dl timestamptz; p text; fn text; fns text[];
begin
  -- helper: build a live draft with the first k picks made by the office (how=office) from fresh players
  -- ===== H1-H4 holes
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..6 loop perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('MID', 1))); end loop;
  perform pg_temp.chk('H0 six picks made, on pick 7', pg_temp.st(d) = 'live/7/true', pg_temp.st(d));
  x := (select player from draft_picks where draft = d and pick_no = 3);
  r := pg_temp.run_as('office', format('select public.office_remove_pick(%s, 3)', d));
  perform pg_temp.chk('H1.1 remove pick 3', r = 'OK', r);
  perform pg_temp.chk('H1.2 its player is a free agent again', (select club is null from players where id = x));
  perform pg_temp.chk('H1.3 clock goes to the hole (pick 3), other picks stay', pg_temp.st(d) = 'live/3/true' and (select count(*) from draft_picks where draft = d) = 5, pg_temp.st(d));
  perform pg_temp.chk('H1.4 fresh timer for the re-pick', (select pick_deadline > now() + interval '55 minutes' and pick_started > now() - interval '5 seconds' from drafts where id = d));
  r := pg_temp.run_as('CFC', format('select public.make_pick(%s, %L)', d, pg_temp.fp('FWD', 1)));
  perform pg_temp.chk('H2.1 the club that owns pick 3 (CFC) can pick again', r = 'OK', r);
  perform pg_temp.chk('H2.2 clock jumps to the lowest unmade pick (7), not 4', pg_temp.st(d) = 'live/7/true', pg_temp.st(d));
  -- two holes
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 5)', d));
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 2)', d));
  perform pg_temp.chk('H3.1 holes at 2 and 5: clock at 2', pg_temp.st(d) = 'live/2/true', pg_temp.st(d));
  perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('DEF', 1)));
  perform pg_temp.chk('H3.2 after pick 2 the clock goes to 5', pg_temp.st(d) = 'live/5/true', pg_temp.st(d));
  perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('DEF', 1)));
  perform pg_temp.chk('H3.3 after pick 5 the clock goes to 7 (where the draft had reached)', pg_temp.st(d) = 'live/7/true', pg_temp.st(d));
  -- removing a LATER pick while an earlier hole waits must not restart the clock
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 1)', d));
  select pick_deadline into dl from drafts where id = d;
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 6)', d));
  perform pg_temp.chk('H4.1 clock stays on pick 1 when pick 6 is also taken back', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  perform pg_temp.chk('H4.2 the waiting pick keeps its deadline (not restarted)', (select pick_deadline = dl from drafts where id = d), (select pick_deadline::text from drafts where id = d) || ' vs ' || dl::text);
  -- ===== H5 taking back from a finished draft
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.run_as('office', format('select public.office_autofill(%s)', d));
  perform pg_temp.chk('H5.0 auto-assign finished the whole draft', pg_temp.st(d) = 'done/13/false' and (select count(*) from draft_picks where draft = d) = 12, pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_remove_pick(%s, 4)', d));
  perform pg_temp.chk('H5.1 remove from a done draft pauses it at that pick', r = 'OK' and pg_temp.st(d) = 'paused/4/false', r || ' ' || pg_temp.st(d));
  r := pg_temp.run_as('SKS', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('H5.2 nobody can pick while it is paused', r like 'ERR: The draft isn''t running%', r);
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''resume'')', d));
  perform pg_temp.chk('H5.3 resume: live on pick 4, fresh timer', pg_temp.st(d) = 'live/4/true', pg_temp.st(d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('H5.4 the re-pick times out like any other and the draft finishes again', pg_temp.st(d) = 'done/13/false' and (select count(*) from draft_picks where draft = d) = 12, pg_temp.st(d));
  -- ===== H6 errors and skip rows
  r := pg_temp.run_as('office', format('select public.office_remove_pick(%s, 99)', d));
  perform pg_temp.chk('H6.1 removing a pick that was never made is an error', r like 'ERR: Pick 99 hasn''t been made%', r);
  r := pg_temp.run_as('LAU', format('select public.office_remove_pick(%s, 1)', d));
  perform pg_temp.chk('H6.2 managers cannot remove picks', r like 'ERR: Only the league office%', r);
  r := pg_temp.run_as('anon', format('select public.office_remove_pick(%s, 1)', d));
  perform pg_temp.chk('H6.3 signed-out cannot remove picks', r like 'ERR:%', r);
  d := pg_temp.mk(60, 'queue', '{"GK":0,"DEF":0,"MID":0,"FWD":0}'); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.overdue(d); perform draft_tick();
  r := pg_temp.run_as('office', format('select public.office_remove_pick(%s, 1)', d));
  perform pg_temp.chk('H6.4 a skipped pick (no player) can be taken back', r = 'OK' and pg_temp.st(d) = 'live/1/true', r || ' ' || pg_temp.st(d));
  -- ===== H7 undo
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..6 loop perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('FWD', 1))); end loop;
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 3)', d));
  r := pg_temp.run_as('office', format('select public.office_draft_undo(%s)', d));
  perform pg_temp.chk('H7.1 undo takes back the highest made pick (6), clock stays on the hole (3)', r = 'OK' and pg_temp.st(d) = 'live/3/true' and (select max(pick_no) from draft_picks where draft = d) = 5, r || ' ' || pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_draft_undo(%s, 5)', d));
  perform pg_temp.chk('H7.2 undo from 5 takes back 5 only; hole at 3 remains', (select max(pick_no) from draft_picks where draft = d) = 4 and pg_temp.st(d) = 'live/3/true', r || ' ' || pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_draft_undo(%s, 40)', d));
  perform pg_temp.chk('H7.3 undo from a pick that is not there is an error', r like 'ERR: There is nothing to undo%', r);
  d := pg_temp.mk(); r := pg_temp.run_as('office', format('select public.office_draft_undo(%s)', d));
  perform pg_temp.chk('H7.4 undo in set-up is an error', r like 'ERR: Nothing has been picked yet%', r);
  -- ===== H8 auto-assign with holes
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..8 loop perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('MID', 1))); end loop;
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 2)', d));
  perform pg_temp.run_as('office', format('select public.office_remove_pick(%s, 6)', d));
  perform pg_temp.run_as('office', format('select public.office_autofill(%s, 2)', d));
  perform pg_temp.chk('H8.1 auto-assign 2 fills the two holes (2 and 6), then the clock is back at 9', pg_temp.st(d) = 'live/9/true' and (select count(*) from draft_picks where draft = d) = 8, pg_temp.st(d));
  -- ===== H9 office_set_pick on a paused draft and with a taken/unknown player
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''pause'')', d));
  r := pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('H9.1 office can pick while paused', r = 'OK', r);
  perform pg_temp.chk('H9.2 draft is still paused after that pick', (select status = 'paused' from drafts where id = d), pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, (select player from draft_picks where draft = d and pick_no = 1)));
  perform pg_temp.chk('H9.3 office cannot give away a player who is already taken', r like 'ERR: That player isn''t available%', r);
  -- ===== H10 reset
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, pg_temp.fp('GK', 3));
  insert into draft_prefs(draft, club, mode) values (d, 'LAU', 'always');
  for n in 1..3 loop perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('GK', 5))); end loop;
  x := (select player from draft_picks where draft = d and pick_no = 1);
  r := pg_temp.run_as('office', format('select public.office_draft_reset(%s)', d));
  perform pg_temp.chk('H10.1 reset: back to set-up on pick 1, no picks', r = 'OK' and pg_temp.st(d) = 'setup/1/false' and not exists (select 1 from draft_picks where draft = d), r || ' ' || pg_temp.st(d));
  perform pg_temp.chk('H10.2 reset: drafted players are free again', (select club is null from players where id = x));
  perform pg_temp.chk('H10.3 reset keeps the order, queues and auto-pick settings', (select count(*) from draft_order where draft = d) = 12 and exists (select 1 from draft_queue where draft = d) and exists (select 1 from draft_prefs where draft = d));
  -- ===== H11 delete (release only players still at the club that drafted them)
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..3 loop perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('GK', 6))); end loop;
  x := (select player from draft_picks where draft = d and pick_no = 1); y := (select player from draft_picks where draft = d and pick_no = 2);
  update players set club = 'CCF' where id = y;   -- traded away since
  r := pg_temp.run_as('office', format('select public.office_delete_draft(%s, true)', d));
  perform pg_temp.chk('H11.1 delete with release frees players still at their draft club', r = 'OK' and (select club is null from players where id = x), r);
  perform pg_temp.chk('H11.2 ...but not one that has moved on', (select club = 'CCF' from players where id = y));
  perform pg_temp.chk('H11.3 the draft and its picks, order, queues are gone', not exists (select 1 from drafts where id = d) and not exists (select 1 from draft_order where draft = d) and not exists (select 1 from draft_picks where draft = d));
  r := pg_temp.run_as('LAU', format('select public.office_delete_draft(%s)', d));
  perform pg_temp.chk('H11.4 managers cannot delete drafts', r like 'ERR:%', r);
  -- ===== H12 office_set_quiet validation and live behaviour
  d := pg_temp.mk(60); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  r := pg_temp.run_as('office', format('select public.office_set_quiet(%s, %L::jsonb)', d, '[{"days":[1,2,3],"from":"09:00","to":"17:00"}]'));
  perform pg_temp.chk('H12.1 valid active times accepted', r = 'OK', r);
  foreach p in array array['[{"days":[],"from":"09:00","to":"17:00"}]', '[{"days":[7],"from":"09:00","to":"17:00"}]', '[{"days":[1],"from":"9:00","to":"17:00"}]', '[{"days":[1],"from":"09:00","to":"09:00"}]', '[{"days":[1],"from":"25:00","to":"17:00"}]', '{"days":[1]}', '"x"', '[{"from":"09:00","to":"10:00"}]', '[1]'] loop
    r := pg_temp.run_as('office', format('select public.office_set_quiet(%s, %L::jsonb)', d, p));
    perform pg_temp.chk('H12.2 rejected: ' || left(p, 50), r like 'ERR:%', r);
  end loop;
  r := pg_temp.run_as('office', format('select public.office_set_quiet(%s, %L::jsonb)', d, (select jsonb_agg(jsonb_build_object('days', jsonb_build_array(1), 'from', '09:00', 'to', '10:00')) from generate_series(1, 15))));
  perform pg_temp.chk('H12.3 more than 14 windows rejected', r like 'ERR:%', r);
  r := pg_temp.run_as('LAU', format('select public.office_set_quiet(%s, %L::jsonb)', d, '[]'));
  perform pg_temp.chk('H12.4 managers cannot set active times', r like 'ERR: Only the league office%', r);
  -- ===== H14 every office function refuses managers and signed-out visitors
  fns := array[
    format('select public.office_draft_control(%s, ''pause'')', d), format('select public.office_set_pick(%s, null)', d), format('select public.office_autofill(%s)', d),
    format('select public.office_draft_undo(%s)', d), format('select public.office_remove_pick(%s, 1)', d), format('select public.office_draft_reset(%s)', d),
    format('select public.office_delete_draft(%s)', d), format('select public.office_set_quiet(%s, ''[]'')', d)];
  foreach fn in array fns loop
    r := pg_temp.run_as('LFC', fn);
    perform pg_temp.chk('H14 manager refused: ' || left(fn, 60), r like 'ERR:%' and r ilike '%office%', r);
    r := pg_temp.run_as('anon', fn);
    perform pg_temp.chk('H14 signed-out refused: ' || left(fn, 60), r like 'ERR:%', r);
  end loop;
  perform pg_temp.chk('H14.9 the draft survived all of that untouched', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
end $$;
select name, ok, detail from t_log order by n;
rollback;
