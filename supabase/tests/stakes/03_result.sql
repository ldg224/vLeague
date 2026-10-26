-- Stakes: game predictors, win / draw / win (0069). Rolled back; safe on the live project.
create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare mgr uuid; off uuid; fa record; fb record; fc record; wk int; l1 bigint; l2 bigint; l3 bigint; pl bigint; bal int; cnt int; st text; pay int; m numeric; nfx int;
begin
  update public.stakes_settings set visible = default, betting_open = default, start_coins = default, daily_topup = default, bailout_below = default, bailout_to = default, multiplier = default, min_stake = default, max_stake = default, lines_per_week = default, lines_per_match = default, score_per_week = default, score_exact_mult = default, score_result_mult = default, result_win_mult = default, result_draw_mult = default, stats = default, line_adjust = default, lock_minutes = default, lines_days = default, show_board = default, score_all = default;   -- a known starting point, whatever the office has set live
  select id into mgr from public.profiles where role = 'manager' limit 1;
  select id into off from public.profiles where role = 'office' limit 1;
  select week into wk from public.fixtures where starts_at > now() and not postponed and starts_at < now() + interval '60 days' order by starts_at limit 1;
  delete from public.stakes_wallets where user_id = mgr;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = wk);
  update public.stakes_settings set visible = true, lines_days = 28, daily_topup = 0;

  insert into t_log(name, ok, detail) select 'default payouts: win 2.2, draw 3.0', result_win_mult = 2.2 and result_draw_mult = 3.0, result_win_mult || '/' || result_draw_mult from public.stakes_settings;

  -- every open game of the round gets a result stake; they do not use up the round's stakes
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_wallet();
  perform public.stakes_slate();
  perform set_config('role', 'postgres', true);
  select count(*) into nfx from public.fixtures f where f.week = wk and not f.postponed and f.starts_at > now();
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'result';
  insert into t_log(name, ok, detail) values ('a result stake for every open game', cnt = nfx, cnt || ' of ' || nfx);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'player';
  insert into t_log(name, ok, detail) values ('the round keeps its own limit of player stakes (8)', cnt <= 8, cnt::text);
  insert into t_log(name, ok, detail) select 'a result line has no player, stat or line', count(*) = 0, count(*)::text from public.stakes_lines where kind = 'result' and (player_id is not null or stat is not null or line is not null);
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_slate();
  perform set_config('role', 'postgres', true);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'result';
  insert into t_log(name, ok, detail) values ('asking again does not make more', cnt = nfx, cnt::text);

  -- three games to settle: a home pick that wins, a draw pick that wins, an away pick that loses
  select * into fa from public.fixtures where week = wk order by starts_at, id limit 1 offset 0;
  select * into fb from public.fixtures where week = wk order by starts_at, id limit 1 offset 1;
  select * into fc from public.fixtures where week = wk order by starts_at, id limit 1 offset 2;
  select id into l1 from public.stakes_lines where fixture = fa.id and kind = 'result';
  select id into l2 from public.stakes_lines where fixture = fb.id and kind = 'result';
  select id into l3 from public.stakes_lines where fixture = fc.id and kind = 'result';

  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.stakes_place_result(l1, 'banana', 50); insert into t_log values (default, 'a made-up result is refused', false, ''); exception when others then insert into t_log values (default, 'a made-up result is refused', sqlerrm like '%home win, a draw or an away win%', sqlerrm); end;
  begin perform public.stakes_place(l1, 'over', 50); insert into t_log values (default, 'over/under on a result stake refused', false, ''); exception when others then insert into t_log values (default, 'over/under on a result stake refused', sqlerrm like '%win, draw or win pick%', sqlerrm); end;
  select public.stakes_place_result(l1, 'home', 50) into bal;
  insert into t_log(name, ok, detail) values ('result stake taken', bal = 950, bal::text);
  begin perform public.stakes_place_result(l1, 'draw', 50); insert into t_log values (default, 'one pick a game', false, ''); exception when others then insert into t_log values (default, 'one pick a game', sqlerrm like '%already picked%', sqlerrm); end;
  perform public.stakes_place_result(l2, 'draw', 50);
  if l3 is not null then perform public.stakes_place_result(l3, 'away', 50); end if;
  perform set_config('role', 'postgres', true);
  select mult into m from public.stakes_picks where user_id = mgr and line_id = l1;
  insert into t_log(name, ok, detail) values ('a win pick keeps the win payout (2.2)', m = 2.2, m::text);
  select mult into m from public.stakes_picks where user_id = mgr and line_id = l2;
  insert into t_log(name, ok, detail) values ('a draw pick keeps the draw payout (3.0)', m = 3.0, m::text);
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from public.stakes_slate() s where s.kind = 'result' and s.my_result is not null;
  insert into t_log(name, ok, detail) values ('the slate shows my picks', cnt >= 2, cnt::text);

  -- the payouts change after the picks: the picks keep what they were placed at
  perform set_config('role', 'postgres', true);
  update public.stakes_settings set result_win_mult = 5, result_draw_mult = 9;

  -- settle: fa 2-1 (home pick wins), fb 1-1 (draw pick wins), fc 1-0 (away pick loses)
  insert into public.results (fixture, summary) values (fa.id, jsonb_build_object('home', 2, 'away', 1, 'players', '{}'::jsonb));
  insert into public.results (fixture, summary) values (fb.id, jsonb_build_object('home', 1, 'away', 1, 'players', '{}'::jsonb));
  if l3 is not null then insert into public.results (fixture, summary) values (fc.id, jsonb_build_object('home', 1, 'away', 0, 'players', '{}'::jsonb)); end if;
  select payout into pay from public.stakes_picks where user_id = mgr and line_id = l1;
  insert into t_log(name, ok, detail) values ('a right home pick pays 2.2x (110)', pay = 110, pay::text);
  select payout into pay from public.stakes_picks where user_id = mgr and line_id = l2;
  insert into t_log(name, ok, detail) values ('a right draw pick pays 3.0x (150)', pay = 150, pay::text);
  if l3 is not null then
    select status into st from public.stakes_picks where user_id = mgr and line_id = l3;
    insert into t_log(name, ok, detail) values ('a wrong pick loses the stake', st = 'lost', st);
  end if;
  select coins into bal from public.stakes_wallets where user_id = mgr;
  insert into t_log(name, ok, detail) values ('the wallet adds up', bal = 1000 - 50 - 50 - (case when l3 is not null then 50 else 0 end) + 110 + 150, bal::text);
  insert into t_log(name, ok, detail) select 'the real score is kept', act_home = 2 and act_away = 1, act_home || '-' || act_away from public.stakes_picks where user_id = mgr and line_id = l1;

  -- history lists result picks
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from public.stakes_history() h where h.kind = 'result' and h.result is not null;
  insert into t_log(name, ok, detail) values ('history lists result picks', cnt >= 2, cnt::text);

  -- the switch hides the section; the office saves the payouts and bad values are refused
  perform set_config('role', 'postgres', true);
  update public.stakes_settings set score_all = false;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from public.stakes_slate() s where s.kind <> 'player';
  insert into t_log(name, ok, detail) values ('the switch off hides the game predictors', cnt = 0, cnt::text);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', off, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_save_settings('{"result_win_mult": 2.5, "result_draw_mult": 3.5, "score_all": true}');
  insert into t_log(name, ok, detail) select 'payouts saved', result_win_mult = 2.5 and result_draw_mult = 3.5 and score_all, result_win_mult::text from public.stakes_settings;
  begin perform public.stakes_save_settings('{"result_win_mult": 0.5}'); insert into t_log values (default, 'a payout under 1.01 refused', false, ''); exception when others then insert into t_log values (default, 'a payout under 1.01 refused', sqlerrm like '%out of range%', sqlerrm); end;
end $$;
select name, ok, detail from t_log order by n;
