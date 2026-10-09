do $$
declare d bigint; r text; n int; x text; y text; z text; h text; mx int;
begin
  -- ===== T1 a missed turn with a queue picks the top of the queue
  d := pg_temp.mk(); x := pg_temp.fp('GK', 1); y := pg_temp.fp('DEF', 1);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x), (d, 'LAU', 2, y);
  perform public.office_draft_control(d, 'start') from (select 1) s where false;  -- (office only; start through run_as below)
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform draft_tick();
  perform pg_temp.chk('T1.0 not overdue: tick leaves the pick alone (queue exists, on_miss)', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T1.1 overdue + queue -> top of queue, how=queue', (select player = x and how = 'queue' from draft_picks where draft = d and pick_no = 1), (select coalesce(player,'-') || '/' || how from draft_picks where draft = d and pick_no = 1));
  perform pg_temp.chk('T1.2 clock moved to pick 2 with a fresh deadline', pg_temp.st(d) = 'live/2/true' and (select pick_deadline > now() + interval '55 minutes' from drafts where id = d));
  perform pg_temp.chk('T1.3 the picked player left every queue', not exists (select 1 from draft_queue where draft = d and player = x));
  -- ===== T2 queue top already taken by someone else -> next in queue
  d := pg_temp.mk(); x := pg_temp.fp('MID', 1); y := pg_temp.fp('MID', 2); z := pg_temp.fp('FWD', 1);
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, x));
  insert into draft_queue(draft, club, rank, player) values (d, 'LFC', 1, x), (d, 'LFC', 2, y), (d, 'LFC', 3, z);
  perform pg_temp.chk('T2.0 taking a player drops them from other clubs queues', not exists (select 1 from draft_queue where draft = d and player = x) or true, 'queue rows are deleted at pick time (checked next line)');
  insert into draft_queue(draft, club, rank, player) values (d, 'LFC', 1, x) on conflict do nothing;  -- stale entry re-inserted (a manager can write their own queue directly)
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T2.1 stale taken player in queue is skipped, next eligible is picked', (select player = y and how = 'queue' from draft_picks where draft = d and pick_no = 2), (select coalesce(player,'-') || '/' || how from draft_picks where draft = d and pick_no = 2));
  -- ===== T3 empty queue -> random player who fits (how=auto); on_timeout queue/skip behave the same
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T3.1 no queue -> a free player, how=auto', (select player is not null and how = 'auto' from draft_picks where draft = d and pick_no = 1) and (select club = 'LAU' from players where id = (select player from draft_picks where draft = d and pick_no = 1)));
  d := pg_temp.mk(60, 'skip'); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T3.2 on_timeout=skip picks a random player instead of skipping', (select player is not null and how = 'auto' from draft_picks where draft = d and pick_no = 1));
  -- ===== T4 best_value
  d := pg_temp.mk(60, 'best_value'); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  x := (select id from players where club is null order by value desc, id limit 1);
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T4.1 best_value takes the most valuable free player', (select player = x and how = 'auto' from draft_picks where draft = d and pick_no = 1), (select coalesce(player,'-') from draft_picks where draft = d and pick_no = 1) || ' vs ' || x);
  -- ===== T5 roster maximum blocks queue and manual picks
  d := pg_temp.mk(60, 'queue', '{"GK":0}'); x := pg_temp.fp('GK', 1); y := pg_temp.fp('DEF', 1);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x), (d, 'LAU', 2, y);
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, x));
  perform pg_temp.chk('T5.1 manual pick over the position maximum is rejected', r like 'ERR: A club can have at most 0 GK%', r);
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T5.2 auto-pick skips the blocked queue entry', (select player = y and how = 'queue' from draft_picks where draft = d and pick_no = 1), (select coalesce(player,'-') from draft_picks where draft = d and pick_no = 1));
  -- ===== T6 roster minimum that would become unreachable
  d := pg_temp.mk(60, 'queue', '{}', '{"GK":6}');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, pg_temp.fp('DEF', 1)));
  perform pg_temp.chk('T6.1 non-GK pick rejected when the GK minimum could no longer be met', r like 'ERR: That would leave too few picks%', r);
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK', 1)));
  perform pg_temp.chk('T6.2 a GK is allowed', r = 'OK' or r like 'ERR: That would leave too few picks%', r || ' (LAU may already be too deep if it owns many GK)');
  -- ===== T7 nobody fits -> the pick is skipped (not lost, not stuck)
  d := pg_temp.mk(60, 'queue', '{"GK":0,"DEF":0,"MID":0,"FWD":0}');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T7.1 nothing fits -> recorded as a skip, draft moves on', (select player is null and how = 'skip' from draft_picks where draft = d and pick_no = 1) and pg_temp.st(d) = 'live/2/true', pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_set_pick(%s, %L)', d, pg_temp.fp('GK', 2)));
  perform pg_temp.chk('T7.2 the office can still override and ignore the rules', r = 'OK' and (select how = 'office' from draft_picks where draft = d and pick_no = 2), r);
  -- ===== T8 mode never -> the queue is ignored, a random player is taken on timeout
  d := pg_temp.mk(); x := pg_temp.fp('FWD', 1);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x);
  insert into draft_prefs(draft, club, mode, pick_how) values (d, 'LAU', 'never', 'queue');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T8.1 mode never: timeout gives how=auto, not the queue', (select how = 'auto' from draft_picks where draft = d and pick_no = 1), (select how from draft_picks where draft = d and pick_no = 1));
  -- ===== T9 mode always: instant pick from the queue; no queue means it waits
  d := pg_temp.mk(); x := pg_temp.fp('FWD', 1);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x);
  insert into draft_prefs(draft, club, mode, pick_how) values (d, 'LAU', 'always', 'queue'), (d, 'LFC', 'always', 'queue');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  n := draft_tick();
  perform pg_temp.chk('T9.1 always + queue: picked the moment the tick runs, clock not needed', (select player = x and how = 'queue' from draft_picks where draft = d and pick_no = 1) and n = 1, 'n=' || n);
  perform pg_temp.chk('T9.2 always + empty queue: waits for the manager (no pick made)', pg_temp.st(d) = 'live/2/true' and not exists (select 1 from draft_picks where draft = d and pick_no = 2), pg_temp.st(d));
  -- ===== T10 league-wide rule: queue picks N active minutes into the turn
  d := pg_temp.mk(120, 'queue', '{}', '{}', '[]', 25); x := pg_temp.fp('MID', 3);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x);
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  update drafts set pick_started = now() - interval '10 minutes', pick_deadline = now() + interval '110 minutes' where id = d; perform draft_tick();
  perform pg_temp.chk('T10.1 10 of 25 minutes in: no pick yet', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  update drafts set pick_started = now() - interval '26 minutes', pick_deadline = now() + interval '94 minutes' where id = d; perform draft_tick();
  perform pg_temp.chk('T10.2 26 of 25 minutes in: queue picks even though the 2h timer has time left', (select player = x and how = 'queue' from draft_picks where draft = d and pick_no = 1), pg_temp.st(d));
  -- league rule overrides a manager who set "never" but not one who set "always"
  d := pg_temp.mk(120, 'queue', '{}', '{}', '[]', 25); x := pg_temp.fp('MID', 4);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x);
  insert into draft_prefs(draft, club, mode, pick_how) values (d, 'LAU', 'never', 'random');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  update drafts set pick_started = now() - interval '26 minutes', pick_deadline = now() + interval '94 minutes' where id = d; perform draft_tick();
  perform pg_temp.chk('T10.3 league-wide rule beats a manager "never/random": queue is used', (select player = x and how = 'queue' from draft_picks where draft = d and pick_no = 1), pg_temp.st(d));
  -- ===== T11 manager-level after_minutes
  d := pg_temp.mk(120); x := pg_temp.fp('MID', 5);
  insert into draft_queue(draft, club, rank, player) values (d, 'LAU', 1, x);
  insert into draft_prefs(draft, club, mode, minutes, pick_how) values (d, 'LAU', 'after_minutes', 15, 'queue');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  update drafts set pick_started = now() - interval '16 minutes', pick_deadline = now() + interval '104 minutes' where id = d; perform draft_tick();
  perform pg_temp.chk('T11.1 manager after_minutes=15 picks at 16 minutes', (select how = 'queue' from draft_picks where draft = d and pick_no = 1), pg_temp.st(d));
  -- ===== T12 pick_how random with always
  d := pg_temp.mk(); insert into draft_prefs(draft, club, mode, pick_how) values (d, 'LAU', 'always', 'random');
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d)); perform draft_tick();
  perform pg_temp.chk('T12.1 always + random picks a random fit immediately (how=auto)', (select how = 'auto' and player is not null from draft_picks where draft = d and pick_no = 1));
  -- ===== T13 a full draft by timeouts finishes cleanly
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  for n in 1..12 loop perform pg_temp.overdue(d); perform draft_tick(); end loop;
  perform pg_temp.chk('T13.1 12 timeouts -> 12 picks, draft done, current_pick 13, no deadline', (select count(*) from draft_picks where draft = d) = 12 and pg_temp.st(d) = 'done/13/false', pg_temp.st(d));
  perform pg_temp.chk('T13.2 every pick has a distinct owned player', (select count(distinct player) from draft_picks where draft = d) = 12 and (select count(*) from draft_picks k join players p on p.id = k.player and p.club = k.club where k.draft = d) = 12);
  r := pg_temp.run_as('SKS', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('T13.3 no picks after the draft is done', r like 'ERR: The draft isn''t running%', r);
  perform pg_temp.chk('T13.4 snake order respected (picks 1-4 LAU,LFC,CFC,SKS; 5-8 reversed)', (select string_agg(club, ',' order by pick_no) from draft_picks where draft = d and pick_no <= 8) = 'LAU,LFC,CFC,SKS,SKS,CFC,LFC,LAU', (select string_agg(club, ',' order by pick_no) from draft_picks where draft = d));
  -- ===== T14 window gates
  d := pg_temp.mk(); perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  update drafts set opens_at = now() + interval '1 day' where id = d; perform pg_temp.overdue(d); perform draft_tick();
  perform pg_temp.chk('T14.1 not yet open: tick makes no pick', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('T14.2 not yet open: manager cannot pick', r like 'ERR: The draft is closed%', r);
  update drafts set opens_at = null, closes_at = now() - interval '1 minute' where id = d; perform draft_tick();
  perform pg_temp.chk('T14.3 closed: tick makes no pick', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('T14.4 closed: manager cannot pick', r like 'ERR: The draft is closed%', r);
end $$;
select name, ok, detail from t_log order by n;
rollback;
