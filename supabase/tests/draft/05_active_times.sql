create temp table t_sched(name text, q jsonb);   -- the clock stops counting after 400 separate active stretches, so the 2-minutes-a-day schedule is tested with short picks
insert into t_sched values
 ('draft28', (select quiet from public.drafts where id = 28)),
 ('overnight-only', '[{"days":[0,1,2,3,4,5,6],"from":"22:00","to":"07:00"}]'),
 ('one-weekly-window', '[{"days":[3],"from":"18:00","to":"18:20"}]'),
 ('overlapping', '[{"days":[1,2,3],"from":"09:00","to":"15:00"},{"days":[1,2,3],"from":"14:00","to":"20:00"},{"days":[1],"from":"19:00","to":"23:30"}]'),
 ('touching', '[{"days":[1,2,3,4,5],"from":"09:00","to":"12:00"},{"days":[1,2,3,4,5],"from":"12:00","to":"17:00"}]'),
 ('wrap-onto-unlisted-day', '[{"days":[6],"from":"20:00","to":"06:00"}]'),
 ('almost-24h', '[{"days":[0,1,2,3,4,5,6],"from":"00:00","to":"23:59"}]'),
 ('midnight-wrap-1min', '[{"days":[0,1,2,3,4,5,6],"from":"23:59","to":"00:01"}]'),
 ('everyday-full-overlap', '[{"days":[0,1,2,3,4,5,6],"from":"07:00","to":"22:00"},{"days":[0,1,2,3,4,5,6],"from":"22:00","to":"07:00"}]');

do $$
declare s record; bad int; tot int; r text; t0 timestamptz; t1 timestamptz; secs double precision; ms int;
begin
  for s in select * from t_sched loop
    -- P1: active_seconds(start, add_active(start, m)) = m * 60, and the result is not inside paused time
    select count(*), count(*) filter (where abs(public._draft_active_seconds(st, en, s.q) - m * 60) > 1 or (public._quiet_end(en - interval '1 second', s.q) is not null)) into tot, bad
    from (select st, m, public._draft_add_active(st, m, s.q) en
          from (select ('2026-10-01 00:00+10'::timestamptz + (abs(hashtext('a' || i)) % 17280) * interval '10 minutes') st,
                       (1 + abs(hashtext('b' || i)) % (case when s.name = 'midnight-wrap-1min' then 30 else 1500 end))::double precision m from generate_series(1, 120) i) z) y;
    perform pg_temp.chk('P1 inverse holds: ' || s.name, bad = 0, bad || ' of ' || tot || ' samples off');
    -- P2: more minutes never ends earlier
    select count(*) into bad from (select st, public._draft_add_active(st, 30, s.q) a, public._draft_add_active(st, 90, s.q) b
          from (select ('2026-10-01 00:00+10'::timestamptz + (abs(hashtext('c' || i)) % 17280) * interval '10 minutes') st from generate_series(1, 80) i) z) y where b <= a;
    perform pg_temp.chk('P2 monotonic: ' || s.name, bad = 0, bad::text);
    -- P3: partition: paused XOR active at every 17-minute step over 3 weeks (crosses DST start on 2026-10-04)
    select count(*), count(*) filter (where (public._quiet_end(t, s.q) is null) = (public._quiet_end(t, s.q) is not null)) into tot, bad
      from generate_series('2026-09-28 00:00+10'::timestamptz, '2026-10-19 00:00+11'::timestamptz, interval '17 minutes') t;
    perform pg_temp.chk('P3 each moment is exactly one of paused/active: ' || s.name, bad = 0, bad::text);
    -- P4: the next pause starts after now and while active
    select count(*) into bad from (select t, public._next_quiet_start(t, t + interval '10 days', s.q) nx
          from generate_series('2026-10-01 00:00+10'::timestamptz, '2026-10-12 00:00+11'::timestamptz, interval '97 minutes') t) y
      where nx is not null and (nx <= t or public._quiet_end(nx, s.q) is null and public._quiet_end(nx - interval '1 second', s.q) is not null);
    perform pg_temp.chk('P4 next pause start is in the future and really starts a pause: ' || s.name, bad = 0, bad::text);
  end loop;

  -- DST end (Sun 2027-04-04 03:00 -> 02:00): the repeated hour is real time
  r := (public._draft_add_active('2027-04-03 22:00+11'::timestamptz, 600, '[{"days":[0,1,2,3,4,5,6],"from":"22:00","to":"07:00"}]'::jsonb) at time zone 'Australia/Melbourne')::text;
  perform pg_temp.chk('P5.1 DST ends: 600 active minutes from Sat 22:00 end at Sun 07:00 (10 real hours)', r = '2027-04-04 07:00:00', r);
  -- DST start (Sun 2026-10-04 02:00 -> 03:00): the missing hour is not counted
  r := (public._draft_add_active('2026-10-03 22:00+10'::timestamptz, 480, '[{"days":[0,1,2,3,4,5,6],"from":"22:00","to":"07:00"}]'::jsonb) at time zone 'Australia/Melbourne')::text;
  perform pg_temp.chk('P5.2 DST starts: 480 active minutes from Sat 22:00 end at Sun 07:00 (8 real hours)', r = '2026-10-04 07:00:00', r);
  -- a window that would start inside the missing hour
  begin
    r := (public._draft_add_active('2026-10-03 23:00+10'::timestamptz, 60, '[{"days":[6],"from":"02:30","to":"04:00"}]'::jsonb) at time zone 'Australia/Melbourne')::text;
    perform pg_temp.chk('P5.3 a window starting in the DST gap (02:30 on the night it does not exist) does not crash', true, r);
  exception when others then perform pg_temp.chk('P5.3 window in DST gap', false, sqlerrm); end;

  -- P6 limits and speed
  t0 := clock_timestamp();
  r := (public._draft_add_active('2026-10-12 12:00+11'::timestamptz, 20160, '[{"days":[3],"from":"18:00","to":"18:10"}]'::jsonb) at time zone 'Australia/Melbourne')::text;
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  perform pg_temp.chk('P6.1 14 days of active time on a 10-minute weekly window terminates and is fast (' || ms || ' ms): ' || r, ms < 3000 and r is not null, r);
  t0 := clock_timestamp();
  perform public.draft_quiet_state(28) from generate_series(1, 200);
  ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  perform pg_temp.chk('P6.2 200 clock-state reads for the real draft take ' || ms || ' ms', ms < 4000, ms::text);
  perform pg_temp.chk('P6.3 empty schedule = plain wall-clock', public._draft_add_active('2026-10-12 12:00+11'::timestamptz, 90, '[]'::jsonb) = '2026-10-12 12:00+11'::timestamptz + interval '90 minutes');
  perform pg_temp.chk('P6.4 null schedule = plain wall-clock', public._draft_add_active('2026-10-12 12:00+11'::timestamptz, 90, null) = '2026-10-12 12:00+11'::timestamptz + interval '90 minutes');
end $$;

-- P7 changing the schedule on a live pick keeps its remaining active time
do $$
declare d bigint; r text; before_secs double precision; after_secs double precision; q1 jsonb := '[{"days":[0,1,2,3,4,5,6],"from":"00:00","to":"23:59"}]'; q2 jsonb := '[{"days":[0,1,2,3,4,5,6],"from":"06:00","to":"23:00"},{"days":[0,1,2,3,4,5,6],"from":"23:30","to":"05:00"}]';
begin
  d := pg_temp.mk(300, 'queue', '{}', '{}', q1);
  perform pg_temp.run_as('office', format('select public.office_draft_control(%s, ''start'')', d));
  update drafts set pick_started = now() - interval '2 hours', pick_deadline = public._draft_add_active(now() - interval '2 hours', 300, q1) where id = d;
  select public._draft_active_seconds(now(), pick_deadline, quiet) into before_secs from drafts where id = d;
  r := pg_temp.run_as('office', format('select public.office_set_quiet(%s, %L::jsonb)', d, q2::text));
  select public._draft_active_seconds(now(), pick_deadline, quiet) into after_secs from drafts where id = d;
  perform pg_temp.chk('P7 changing active times keeps the pick''s remaining active time (' || round(before_secs) || 's -> ' || round(after_secs) || 's)', r = 'OK' and abs(before_secs - after_secs) < 5, r);
end $$;
select name, ok, detail from t_log order by n;
rollback;
