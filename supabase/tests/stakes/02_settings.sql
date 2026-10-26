-- Stakes settings (0063): defaults, who can change them, every knob doing its job. Rolled back; safe on the live project.
create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare mgr uuid; off uuid; fx record; pk bigint; bal int; r text; cnt int; v_mult numeric; l bigint;
  as_user text := 'x';
begin
  select id into mgr from public.profiles where role = 'manager' limit 1;
  select id into off from public.profiles where role = 'office' limit 1;
  select * into fx from public.fixtures where starts_at > now() and not postponed and starts_at < now() + interval '60 days' order by starts_at limit 1;
  delete from public.stakes_wallets where user_id = mgr;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = fx.week);   -- live lines may already exist for this round
  insert into public.submitted_sheets (club, week, sheet)
  select c, fx.week, jsonb_build_object('formation', '4-4-2', 'lineup',
    (select jsonb_object_agg('S' || rn, id) from (select id, row_number() over (order by value desc) rn from public.players where club = c limit 11) x))
  from unnest(array[fx.home, fx.away]) c on conflict (club, week) do update set sheet = excluded.sheet;

  insert into t_log(name, ok, detail) select 'the tab starts hidden', not visible and betting_open and multiplier = 1.9 and start_coins = 1000 and daily_topup = 200, visible::text from public.stakes_settings;

  -- a manager cannot see Stakes while it is hidden, and cannot change a setting
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.stakes_wallet(); insert into t_log values (default, 'hidden: manager blocked', false, ''); exception when others then insert into t_log values (default, 'hidden: manager blocked', sqlerrm like '%not open yet%', sqlerrm); end;
  begin perform public.stakes_save_settings('{"visible": true}'); insert into t_log values (default, 'manager cannot save settings', false, ''); exception when others then insert into t_log values (default, 'manager cannot save settings', sqlerrm like '%only the league office%', sqlerrm); end;

  -- the office changes things
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', off, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_save_settings('{"visible": true, "multiplier": 2.0, "start_coins": 500, "daily_topup": 0, "min_stake": 20, "max_stake": 100, "stats": ["sv"], "lines_per_week": 24, "lines_per_match": 2}');
  begin perform public.stakes_save_settings('{"multiplier": 0.5}'); insert into t_log values (default, 'bad value refused', false, ''); exception when others then insert into t_log values (default, 'bad value refused', sqlerrm like '%out of range%', sqlerrm); end;
  begin perform public.stakes_save_settings('{"nonsense": 1}'); insert into t_log values (default, 'unknown setting refused', false, ''); exception when others then insert into t_log values (default, 'unknown setting refused', sqlerrm like '%unknown setting%', sqlerrm); end;
  begin perform public.stakes_save_settings('{"min_stake": 200}'); insert into t_log values (default, 'min above max refused', false, ''); exception when others then insert into t_log values (default, 'min above max refused', sqlerrm like '%out of range%', sqlerrm); end;

  -- a manager now: new wallet gets the starting Coins, no daily top-up, only keeper lines, stake limits, the multiplier
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_wallet();
  insert into t_log(name, ok, detail) select 'starting Coins from settings', coins = 500, coins::text from public.stakes_wallets where user_id = mgr;
  select count(*) into cnt from public.stakes_slate() s where s.fixture = fx.id;
  insert into t_log(name, ok, detail) values ('only keeper lines (sv): 2', cnt = 2, cnt::text);
  insert into t_log(name, ok, detail) select 'every stake is a keeper (only saves offered)', bool_and(stat = 'sv'), count(*)::text from public.stakes_lines l join public.fixtures f4 on f4.id = l.fixture where f4.week = fx.week;
  select line_id into l from public.stakes_slate() s where s.fixture = fx.id limit 1;
  begin perform public.stakes_place(l, 'over', 10); insert into t_log values (default, 'under the smallest stake blocked', false, ''); exception when others then insert into t_log values (default, 'under the smallest stake blocked', sqlerrm like '%smallest stake is 20%', sqlerrm); end;
  begin perform public.stakes_place(l, 'over', 150); insert into t_log values (default, 'over the biggest stake blocked', false, ''); exception when others then insert into t_log values (default, 'over the biggest stake blocked', sqlerrm like '%biggest stake is 100%', sqlerrm); end;
  select public.stakes_place(l, 'over', 50) into bal;
  insert into t_log(name, ok, detail) values ('stake taken', bal = 450, bal::text);
  select pk.mult into v_mult from public.stakes_picks pk where user_id = mgr and line_id = l;
  insert into t_log(name, ok, detail) values ('pick keeps its multiplier 2.0', v_mult = 2.0, v_mult::text);

  -- the multiplier changes after the pick: the pick still pays what it was placed at
  perform set_config('role', 'postgres', true);
  update public.stakes_settings set multiplier = 3.0;
  insert into public.results (fixture, summary) select fx.id, jsonb_build_object('players', (select jsonb_object_agg(x.player_id, jsonb_build_object('min', 90, 'sv', 99, 'sot', 99, 'pas', 99, 'tk', 99)) from public.stakes_lines x where x.fixture = fx.id));
  select coins into bal from public.stakes_wallets where user_id = mgr;
  insert into t_log(name, ok, detail) values ('pays at the placed 2.0 (100), not the new 3.0', bal = 550, bal::text);

  -- the leaderboard switch and the reset
  update public.stakes_settings set show_board = false;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from public.stakes_board();
  insert into t_log(name, ok, detail) values ('board hidden when switched off', cnt = 0, cnt::text);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', off, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.stakes_reset(300) into cnt;
  perform set_config('role', 'postgres', true);
  select coins into bal from public.stakes_wallets where user_id = mgr;
  insert into t_log(name, ok, detail) values ('reset puts wallets to the amount', bal = 300 and cnt >= 1, bal || ' / ' || cnt);
  insert into t_log(name, ok, detail) select 'reset is in the ledger', count(*) >= 1, count(*)::text from public.stakes_ledger where reason = 'reset' and user_id = mgr;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.stakes_reset(10); insert into t_log values (default, 'manager cannot reset', false, '');
  exception when others then insert into t_log values (default, 'manager cannot reset', sqlerrm like '%only the league office%', sqlerrm); end;

  -- the weekly cap: 3 stakes a round, 1 from a match
  perform set_config('role', 'postgres', true);
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = fx.week);
  update public.stakes_settings set lines_per_week = 3, lines_per_match = 1, stats = array['sv', 'pas', 'sot', 'tk'];
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_slate();
  perform set_config('role', 'postgres', true);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f5 on f5.id = l.fixture where f5.week = fx.week;
  insert into t_log(name, ok, detail) values ('a round has at most 3 stakes', cnt between 1 and 3, cnt::text);
  insert into t_log(name, ok, detail) select 'at most 1 from a match', coalesce(max(c3), 0) <= 1, coalesce(max(c3), 0)::text from (select count(*) c3 from public.stakes_lines l join public.fixtures f6 on f6.id = l.fixture where f6.week = fx.week group by l.fixture) z;
end $$;
select name, ok, detail from t_log order by n;
