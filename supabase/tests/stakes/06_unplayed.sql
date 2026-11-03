-- Stakes keeps unplayed matches secret (0081): a saved result stays hidden until full time. Rolled back; safe on the live project.
create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare u uuid; wk int; fx text; fx2 text; lp bigint; lr bigint; lr2 bigint; pid text; bal0 int; bal int; st text; pst text; n int; usual0 numeric; n0 int; mins0 int; usual1 numeric; n1 int; mins1 int; other0 numeric; other1 numeric; other_l bigint; ah int; act numeric;
begin
  update public.stakes_settings set visible = true, betting_open = true, lines_days = 28, daily_topup = 0, score_all = true, lock_minutes = 0, min_stake = 10, max_stake = 0, stats = default, lines_per_week = 8, lines_per_match = 2, line_adjust = 0;
  select id into u from public.profiles where role = 'manager' limit 1;
  delete from public.stakes_wallets where user_id = u;
  -- a round that has not started and has no results
  select x.week into wk from public.fixtures x where not x.postponed and x.starts_at is not null and x.week not in (select week from public.rounds where kind = 'preseason')
    and not exists (select 1 from public.results r join public.fixtures y on y.id = r.fixture where y.week = x.week)
    group by x.week having min(x.starts_at) > now() order by min(x.starts_at) limit 1;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = wk);

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_wallet();
  select s.line_id, s.fixture, s.player_id, s.usual, s.usual_n, s.usual_mins into lp, fx, pid, usual0, n0, mins0 from public.stakes_slate() s where s.week = wk and s.kind = 'player' order by s.line_id limit 1;
  select s.line_id, s.usual into other_l, other0 from public.stakes_slate() s where s.week = wk and s.kind = 'player' and s.fixture <> fx order by s.line_id limit 1;
  select s.line_id into lr from public.stakes_slate() s where s.fixture = fx and s.kind = 'result' limit 1;
  select s.fixture into fx2 from public.stakes_slate() s where s.line_id = other_l;
  select s.line_id into lr2 from public.stakes_slate() s where s.fixture = fx2 and s.kind = 'result' limit 1;
  perform public.stakes_place(lp, 'over', 100);
  perform public.stakes_place_result(lr2, 'away', 50);
  select public.stakes_place_result(lr, 'home', 100) into bal0;
  perform set_config('role', 'postgres', true);

  -- every game of the round gets a result saved before it is played; the picked match has a loud one
  insert into public.results (fixture, summary)
  select f.id, jsonb_build_object('home', 2, 'away', 1, 'players', (select jsonb_object_agg(pl.id, jsonb_build_object('min', 90, 'sv', 99, 'sot', 99, 'pas', 99, 'tk', 99, 'g', 99, 'sh', 99)) from public.players pl where pl.club in (f.home, f.away)))
  from public.fixtures f where f.week = wk and not f.postponed;

  select status into st from public.stakes_picks where user_id = u and line_id = lp;
  select status into pst from public.stakes_picks where user_id = u and line_id = lr;
  insert into t_log(name, ok, detail) values ('a result saved before kick-off settles nothing', st = 'open' and pst = 'open', st || ' / ' || pst);
  select coins into bal from public.stakes_wallets where user_id = u;
  insert into t_log(name, ok, detail) values ('and moves no Coins', bal = bal0, bal || ' against ' || bal0);
  perform public.stakes_settle_due();
  select status into st from public.stakes_picks where user_id = u and line_id = lp;
  insert into t_log(name, ok, detail) values ('the settling job leaves it alone too', st = 'open', st);

  perform set_config('role', 'authenticated', true);
  select s.usual, s.usual_n, s.usual_mins into usual1, n1, mins1 from public.stakes_slate() s where s.line_id = lp;
  insert into t_log(name, ok, detail) values ('the card''s expected figure, game count and minutes do not move', usual1 = usual0 and n1 = n0 and mins1 = mins0, usual0 || '/' || n0 || '/' || mins0 || ' then ' || usual1 || '/' || n1 || '/' || mins1);
  select s.usual into other1 from public.stakes_slate() s where s.line_id = other_l;
  insert into t_log(name, ok, detail) values ('nor does the position average under another card', other1 = other0, other0 || ' then ' || other1);
  select count(*) into n from public.stakes_slate() s where s.week = wk;
  insert into t_log(name, ok, detail) values ('the round stays on the page with all its results saved', n > 0, n::text);
  select h.actual, h.act_home into act, ah from public.stakes_history() h where h.line_id = lp;
  insert into t_log(name, ok, detail) values ('history shows no stat', act is null, coalesce(act::text, 'none'));
  select h.act_home into ah from public.stakes_history() h where h.line_id = lr;
  insert into t_log(name, ok, detail) values ('history shows no score', ah is null, coalesce(ah::text, 'none'));
  perform set_config('role', 'postgres', true);

  -- kicked off and playing live: the score must still be hidden
  update public.fixtures set starts_at = now() - interval '10 minutes' where id = fx;
  perform public.stakes_settle_due();
  select status into st from public.stakes_picks where user_id = u and line_id = lp;
  insert into t_log(name, ok, detail) values ('ten minutes in, still open', st = 'open', st);
  perform set_config('role', 'authenticated', true);
  select s.usual_n into n1 from public.stakes_slate() s where s.line_id = lp;
  insert into t_log(name, ok, detail) values ('ten minutes in, the game count has not moved', n1 = n0, n0 || ' then ' || n1);
  perform set_config('role', 'postgres', true);

  -- a postponed match never settles, whatever the clock says
  update public.fixtures set starts_at = now() - interval '3 hours', postponed = true where id = fx;
  perform public.stakes_settle_due();
  select status into st from public.stakes_picks where user_id = u and line_id = lp;
  insert into t_log(name, ok, detail) values ('postponed: still open', st = 'open', st);

  -- full time: the job settles it
  update public.fixtures set starts_at = now() - interval '46 minutes', postponed = false where id = fx;
  select public.stakes_settle_due() into n;
  insert into t_log(name, ok, detail) values ('at full time the job settles the match''s picks', n = 2, n::text);
  select status, actual into st, act from public.stakes_picks where user_id = u and line_id = lp;
  insert into t_log(name, ok, detail) values ('the over pick won on the real stat', st = 'won' and act = 99, st || ' ' || act);
  select status, act_home into pst, ah from public.stakes_picks where user_id = u and line_id = lr;
  insert into t_log(name, ok, detail) values ('the home pick won on the real score', pst = 'won' and ah = 2, pst || ' ' || ah);
  select coins into bal from public.stakes_wallets where user_id = u;
  insert into t_log(name, ok, detail) values ('the Coins arrive', bal > bal0, bal0 || ' then ' || bal);
  select public.stakes_settle_due() into n;
  insert into t_log(name, ok, detail) values ('running the job again pays nothing twice', n = 0, n::text);
  perform set_config('role', 'authenticated', true);
  select s.usual_n into n1 from public.stakes_slate() s where s.line_id = lp;
  insert into t_log(name, ok, detail) values ('after full time the game counts on the card', n1 = n0 + 1, n0 || ' then ' || n1);
  perform set_config('role', 'postgres', true);
  select count(*) into n from cron.job where jobname = 'vleague-stakes-settle' and active;
  insert into t_log(name, ok, detail) values ('the settling job is scheduled', n = 1, n::text);

  -- the job and the check are not for managers
  perform set_config('role', 'authenticated', true);
  begin perform public.stakes_settle_due(); insert into t_log values (default, 'a manager cannot run the job', false, ''); exception when others then insert into t_log values (default, 'a manager cannot run the job', sqlerrm like '%permission denied%', sqlerrm); end;
  perform set_config('role', 'postgres', true);

  -- a result saved after full time settles as soon as it is saved
  select status into st from public.stakes_picks where user_id = u and line_id = lr2;
  insert into t_log(name, ok, detail) values ('another match of the round, not over yet, is still open', st = 'open', st);
  delete from public.results where fixture = fx2;
  update public.fixtures set starts_at = now() - interval '2 hours' where id = fx2;
  insert into public.results (fixture, summary) values (fx2, jsonb_build_object('home', 0, 'away', 3, 'players', '{}'::jsonb));
  select status, act_away into st, ah from public.stakes_picks where user_id = u and line_id = lr2;
  insert into t_log(name, ok, detail) values ('a result saved after full time settles when it is saved', st = 'won' and ah = 3, st || ' ' || ah);
end $$;
select name, ok, detail from t_log order by n;
