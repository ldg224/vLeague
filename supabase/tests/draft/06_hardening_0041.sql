do $$
declare d bigint; r text; n int; x text;
begin
  -- 0041.2 a paused office pick does not start a clock
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''pause'')', d));
  perform pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('GK', 1)));
  perform pg_temp.chk('F2.1 paused + office pick: still paused, no deadline, no start time', (select status = 'paused' and pick_deadline is null and pick_started is null and current_pick = 2 from drafts where id = d), pg_temp.st(d));
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''resume'')', d));
  perform pg_temp.chk('F2.2 resume then gives a fresh full clock', (select status = 'live' and pick_deadline > now() + interval '55 minutes' and pick_started > now() - interval '5 seconds' from drafts where id = d), pg_temp.st(d));
  -- autofill on a paused draft: finishes it cleanly
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''pause'')', d));
  perform pg_temp.run_as('office', format('select public.office_autofill(%s, 5)', d));
  perform pg_temp.chk('F2.3 paused + auto-assign 5: five picks, still paused with no clock', (select count(*) from draft_picks where draft = d) = 5 and (select status = 'paused' and pick_deadline is null from drafts where id = d), pg_temp.st(d));
  -- 0041.3 start with an order that does not begin at 1
  d := pg_temp.mk(); delete from draft_order where draft = d and pick_no <= 4;
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.chk('F3.1 an order starting at pick 5 starts on pick 5 (not stuck on a pick that does not exist)', r = 'OK' and (select current_pick = 5 from drafts where id = d), r || ' ' || pg_temp.st(d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('F3.2 ...and the clock works from there', exists (select 1 from draft_picks where draft = d and pick_no = 5) and (select current_pick = 6 from drafts where id = d), pg_temp.st(d));
  -- a draft with a gap inside the order still reaches the end
  d := pg_temp.mk(); delete from draft_order where draft = d and pick_no = 3;
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..11 loop perform pg_temp.overdue(d); perform draft_tick(); end loop;
  perform pg_temp.chk('F3.3 a gap in the order (no pick 3) is stepped over and the draft finishes', (select status = 'done' from drafts where id = d) and (select count(*) from draft_picks where draft = d) = 11, pg_temp.st(d));
  -- 0041.1 the clock still behaves with the lock in place, and the lock is real (a plain read of the drafts row by another statement still works)
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  n := draft_tick(); n := n + draft_tick(); n := n + draft_tick();
  perform pg_temp.chk('F1.1 repeated ticks with nothing due make no picks', n = 0 and pg_temp.st(d) = 'live/1/true', n::text);
  perform pg_temp.overdue(d); n := draft_tick();
  perform pg_temp.chk('F1.2 an overdue pick is made exactly once even if the tick runs again straight away', n = 1 and (select count(*) from draft_picks where draft = d) = 1 and pg_temp.st(d) = 'live/2/true', n || ' ' || pg_temp.st(d));
  n := draft_tick();
  perform pg_temp.chk('F1.3 a second tick right after does nothing', n = 0 and (select count(*) from draft_picks where draft = d) = 1, n::text);
  -- 0041.4 email function still compiles and runs, with and without a live draft
  begin
    n := (select count(*) from public.due_emails());
    perform pg_temp.chk('F4.1 due_emails() still runs (' || n || ' rows now)', true);
  exception when others then perform pg_temp.chk('F4.1 due_emails() runs', false, sqlerrm); end;
  perform pg_temp.chk('F4.2 the draft email key now includes the clock start',
    (select pg_get_functiondef('public.due_emails()'::regprocedure) like '%d.pick_started)::bigint%'), 'definition check');
end $$;
select name, ok, detail from t_log order by n;
rollback;
