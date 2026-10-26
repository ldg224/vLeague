-- Stakes: guess the score (0065). Rolled back; safe on the live project.
create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare mgr uuid; off uuid; fa record; fb record; fc record; wk int; l1 bigint; l2 bigint; l3 bigint; bal int; cnt int; st text; pay int;
begin
  update public.stakes_settings set visible = default, betting_open = default, start_coins = default, daily_topup = default, bailout_below = default, bailout_to = default, multiplier = default, min_stake = default, max_stake = default, lines_per_week = default, lines_per_match = default, score_per_week = default, score_exact_mult = default, score_result_mult = default, stats = default, line_adjust = default, lock_minutes = default, lines_days = default, show_board = default;   -- a known starting point, whatever the office has set live
  select id into mgr from public.profiles where role = 'manager' limit 1;
  select id into off from public.profiles where role = 'office' limit 1;
  select week into wk from public.fixtures where starts_at > now() and not postponed and starts_at < now() + interval '60 days' order by starts_at limit 1;
  delete from public.stakes_wallets where user_id = mgr;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = wk);
  update public.stakes_settings set visible = true, lines_per_week = 8, lines_per_match = 2, score_per_week = 2, score_exact_mult = 8, score_result_mult = 2, min_stake = 10, max_stake = 0, start_coins = 1000, daily_topup = 0, betting_open = true, lock_minutes = 0, lines_days = 28;

  -- the round's stakes include score predictions, drawn from its matches, no more than score_per_week, and they count towards the round's total
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_wallet();
  perform public.stakes_slate();
  perform set_config('role', 'postgres', true);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'score';
  insert into t_log(name, ok, detail) values ('2 score predictions in the round', cnt = 2, cnt::text);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk;
  insert into t_log(name, ok, detail) values ('the round has at most 8 stakes in all', cnt <= 8, cnt::text);
  insert into t_log(name, ok, detail) select 'a score line has no player, stat or line', count(*) = 0, count(*)::text from public.stakes_lines where kind = 'score' and (player_id is not null or stat is not null or line is not null);
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_slate();
  perform set_config('role', 'postgres', true);
  select count(*) into cnt from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'score';
  insert into t_log(name, ok, detail) values ('asking again does not draw more', cnt = 2, cnt::text);

  -- three score lines to test settling (made by hand on three matches of the round)
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = wk) and kind = 'score';
  select * into fa from public.fixtures where week = wk order by starts_at, id limit 1 offset 0;
  select * into fb from public.fixtures where week = wk order by starts_at, id limit 1 offset 1;
  select * into fc from public.fixtures where week = wk order by starts_at, id limit 1 offset 2;
  insert into public.stakes_lines (fixture, kind) values (fa.id, 'score') returning id into l1;
  insert into public.stakes_lines (fixture, kind) values (fb.id, 'score') returning id into l2;
  if fc.id is not null then insert into public.stakes_lines (fixture, kind) values (fc.id, 'score') returning id into l3; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin perform public.stakes_place_score(l1, 25, 1, 50); insert into t_log values (default, 'a wild score is refused', false, ''); exception when others then insert into t_log values (default, 'a wild score is refused', sqlerrm like '%0 to 20%', sqlerrm); end;
  begin perform public.stakes_place(l1, 'over', 50); insert into t_log values (default, 'over/under on a score line refused', false, ''); exception when others then insert into t_log values (default, 'over/under on a score line refused', sqlerrm like '%score prediction%', sqlerrm); end;
  select public.stakes_place_score(l1, 2, 1, 50) into bal;
  insert into t_log(name, ok, detail) values ('score stake taken', bal = 950, bal::text);
  begin perform public.stakes_place_score(l1, 0, 0, 50); insert into t_log values (default, 'one prediction a match', false, ''); exception when others then insert into t_log values (default, 'one prediction a match', sqlerrm like '%already predicted%', sqlerrm); end;
  perform public.stakes_place_score(l2, 2, 1, 50);   -- will be the right result only
  if l3 is not null then perform public.stakes_place_score(l3, 0, 2, 50); end if;   -- will be wrong
  select count(*) into cnt from public.stakes_slate() s where s.kind = 'score' and s.my_home is not null;
  insert into t_log(name, ok, detail) values ('the slate shows my predictions', cnt >= 2, cnt::text);

  -- settle: l1 exactly right (2-1 v 2-1), l2 right result (2-1 v 3-1), l3 wrong (0-2 v 1-0)
  perform set_config('role', 'postgres', true);
  insert into public.results (fixture, summary) values (fa.id, jsonb_build_object('home', 2, 'away', 1, 'players', '{}'::jsonb));
  insert into public.results (fixture, summary) values (fb.id, jsonb_build_object('home', 3, 'away', 1, 'players', '{}'::jsonb));
  if l3 is not null then insert into public.results (fixture, summary) values (fc.id, jsonb_build_object('home', 1, 'away', 0, 'players', '{}'::jsonb)); end if;
  select payout into pay from public.stakes_picks where user_id = mgr and line_id = l1;
  insert into t_log(name, ok, detail) values ('exact score pays 8x (400)', pay = 400, pay::text);
  select payout into pay from public.stakes_picks where user_id = mgr and line_id = l2;
  insert into t_log(name, ok, detail) values ('right result only pays 2x (100)', pay = 100, pay::text);
  if l3 is not null then
    select status into st from public.stakes_picks where user_id = mgr and line_id = l3;
    insert into t_log(name, ok, detail) values ('a wrong result loses the stake', st = 'lost', st);
  end if;
  select coins into bal from public.stakes_wallets where user_id = mgr;
  insert into t_log(name, ok, detail) values ('wallet adds up', bal = 1000 - 50 - 50 - (case when l3 is not null then 50 else 0 end) + 400 + 100, bal::text);
  insert into t_log(name, ok, detail) select 'the real score is kept', act_home = 2 and act_away = 1, act_home || '-' || act_away from public.stakes_picks where user_id = mgr and line_id = l1;

  -- history shows score picks too
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from public.stakes_history() h where h.kind = 'score' and h.pred_home is not null;
  insert into t_log(name, ok, detail) values ('history lists score picks', cnt >= 2, cnt::text);

  -- the office's settings take the new numbers, and an exact payout under the result payout is refused
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', off, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_save_settings('{"score_per_week": 3, "score_exact_mult": 10, "score_result_mult": 2.5}');
  insert into t_log(name, ok, detail) select 'score settings saved', score_per_week = 3 and score_exact_mult = 10 and score_result_mult = 2.5, score_exact_mult::text from public.stakes_settings;
  begin perform public.stakes_save_settings('{"score_exact_mult": 2, "score_result_mult": 3}'); insert into t_log values (default, 'exact below result refused', false, ''); exception when others then insert into t_log values (default, 'exact below result refused', sqlerrm like '%out of range%', sqlerrm); end;
end $$;
select name, ok, detail from t_log order by n;
