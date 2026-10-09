do $$
declare d bigint; r text; n int; x text;
begin
  d := pg_temp.mk();
  perform pg_temp.chk('B1.0 scratch draft built', (select count(*) from draft_order where draft = d) = 12, 'order rows');
  -- control permissions and lifecycle
  r := pg_temp.run_as('LAU', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.chk('B1.1 manager cannot start a draft', r like 'ERR: Only the league office%', r);
  r := pg_temp.run_as('anon', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.chk('B1.2 signed-out cannot start a draft', r like 'ERR:%', r);
  r := pg_temp.run_as('office', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('B1.3 cannot pick before start', r like 'ERR: The draft isn''t running%', r);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''resume'')', d));
  perform pg_temp.chk('B1.4 cannot resume a draft in setup', r like 'ERR: The draft isn''t paused%', r);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.chk('B1.5 office starts the draft', r = 'OK', r);
  perform pg_temp.chk('B1.6 live, pick 1, clock running', pg_temp.st(d) = 'live/1/true', pg_temp.st(d));
  perform pg_temp.chk('B1.7 deadline is about 60 min away', (select pick_deadline between now() + interval '59 minutes' and now() + interval '61 minutes' from drafts where id = d), (select pick_deadline::text from drafts where id = d));
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  perform pg_temp.chk('B1.8 cannot start twice', r like 'ERR: The draft has already started%', r);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''bogus'')', d));
  perform pg_temp.chk('B1.9 unknown action rejected', r like 'ERR: Unknown action%', r);
  -- make_pick rules
  r := pg_temp.run_as('LFC', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('B2.1 wrong club cannot pick', r like 'ERR: It isn''t your pick%', r);
  r := pg_temp.run_as('anon', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('B2.2 signed-out cannot pick', r like 'ERR:%', r);
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, 'no-such-player'));
  perform pg_temp.chk('B2.3 unknown player rejected', r like 'ERR:%', r);
  r := pg_temp.run_as('LAU', format('select public.make_pick(%s, %L)', d, pg_temp.fp('GK')));
  perform pg_temp.chk('B2.4 right club picks', r = 'OK', r);
  perform pg_temp.chk('B2.5 pick 1 recorded manual, player owned', (select how = 'manual' from draft_picks where draft = d and pick_no = 1) and (select club = 'LAU' from players where id = (select player from draft_picks where draft = d and pick_no = 1)));
  perform pg_temp.chk('B2.6 advanced to pick 2 with a fresh clock', pg_temp.st(d) = 'live/2/true' and (select pick_started > now() - interval '5 seconds' from drafts where id = d), pg_temp.st(d));
  x := (select player from draft_picks where draft = d and pick_no = 1);
  r := pg_temp.run_as('LFC', format('select public.make_pick(%s, %L)', d, x));
  perform pg_temp.chk('B2.7 taken player cannot be picked again', r like 'ERR: That player isn''t available%', r);
  -- pause, resume, extend
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''pause'')', d));
  perform pg_temp.chk('B3.1 pause', r = 'OK' and pg_temp.st(d) = 'paused/2/false', r || ' ' || pg_temp.st(d));
  r := pg_temp.run_as('LFC', format('select public.make_pick(%s, %L)', d, pg_temp.fp('DEF')));
  perform pg_temp.chk('B3.2 no picking while paused', r like 'ERR: The draft isn''t running%', r);
  perform draft_tick();
  perform pg_temp.chk('B3.3 tick does nothing while paused', pg_temp.st(d) = 'paused/2/false', pg_temp.st(d));
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''extend'', 10)', d));
  perform pg_temp.chk('B3.4 cannot extend while paused', r like 'ERR: The draft isn''t live%', r);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''resume'')', d));
  perform pg_temp.chk('B3.5 resume gives a fresh full timer', r = 'OK' and (select pick_deadline between now() + interval '59 minutes' and now() + interval '61 minutes' from drafts where id = d), r);
  n := extract(epoch from (select pick_deadline from drafts where id = d))::int;
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''extend'', 30)', d));
  perform pg_temp.chk('B3.6 extend adds 30 minutes', extract(epoch from (select pick_deadline from drafts where id = d))::int - n between 1795 and 1805, (extract(epoch from (select pick_deadline from drafts where id = d))::int - n)::text);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''extend'', 0)', d));
  perform pg_temp.chk('B3.7 extend 0 is treated as at least 1 minute', r = 'OK', r);
  r := pg_temp.run_as('office', format('select public.office_draft_control(%s, ''extend'', -50)', d));
  perform pg_temp.chk('B3.8 negative extend cannot shorten the clock', r = 'OK' and (select pick_deadline > now() + interval '85 minutes' from drafts where id = d), r || ' ' || (select pick_deadline::text from drafts where id = d));
  r := pg_temp.run_as('LAU', format('select public.office_draft_control(%s, ''pause'')', d));
  perform pg_temp.chk('B3.9 manager cannot pause', r like 'ERR: Only the league office%', r);
end $$;
select name, ok, detail from t_log order by n;
rollback;
