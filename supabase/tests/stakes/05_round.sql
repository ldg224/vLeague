create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare u uuid; wk int; far int; n int; m int; l1 bigint; l2 bigint; f1 text; f2 text; r record;
begin
  update public.stakes_settings set visible = default, betting_open = default, lines_per_week = default, lines_per_match = default, stats = default, line_adjust = default, lock_minutes = default, lines_days = default, show_board = default, score_all = false;
  update public.stakes_settings set visible = true, lines_per_week = 8, lines_per_match = 2;
  select id into u from public.profiles where role = 'manager' limit 1;
  delete from public.stakes_wallets where user_id = u;
  -- the first real round that starts in under 7 days, and one further off
  select x.week into wk from public.fixtures x where not x.postponed and x.starts_at is not null and x.week not in (select week from public.rounds where kind = 'preseason')
    group by x.week having min(x.starts_at) > now() and min(x.starts_at) <= now() + interval '7 days' order by min(x.starts_at) limit 1;
  select x.week into far from public.fixtures x where not x.postponed and x.starts_at is not null and x.week not in (select week from public.rounds where kind = 'preseason')
    group by x.week having min(x.starts_at) > now() + interval '8 days' order by min(x.starts_at) limit 1;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week in (wk, far));
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_wallet();

  select count(*) into n from public.stakes_slate() s where s.week = wk and s.kind = 'player';
  insert into t_log(name, ok, detail) values ('a round inside 7 days has its stakes (made from squads, no team sheets needed)', n = 8, n::text);
  select count(*) into n from public.stakes_slate() s where s.week = far;
  insert into t_log(name, ok, detail) values ('a round more than 7 days off has none yet', n = 0, n::text);
  select count(distinct locks_at) into n from public.stakes_slate() s where s.week = wk;
  insert into t_log(name, ok, detail) values ('every card in a round shares one lock time', n = 1, n::text);
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'player' and l.stat in ('g', 'sh', 'sot');
  select count(*) into m from public.stakes_lines l join public.fixtures f on f.id = l.fixture join public.players p on p.id = l.player_id where f.week = wk and l.kind = 'player' and p.position <> 'FWD' and l.stat in ('g', 'sh', 'sot');
  insert into t_log(name, ok, detail) values ('only forwards get goals, shots and shots on target', m = 0, n || ' forward stakes, ' || m || ' others');
  select count(distinct l.stat) into n from public.stakes_lines l join public.players p on p.id = l.player_id where p.position = 'FWD' and l.kind = 'player';
  insert into t_log(name, ok, detail) values ('forwards are not all the same stat', n >= 2, n::text);

  -- the expected figure counts preseason games
  select (ui).* into r from (select public.stakes_usual_info(g.key, 'FWD', 'sh') ui from (select v.key from public.results rs join public.fixtures f on f.id = rs.fixture, jsonb_each(rs.summary -> 'players') v(key, value)
    where f.week in (select week from public.rounds where kind = 'preseason') and (v.value ->> 'min')::numeric >= 90 limit 1) g) z;
  insert into t_log(name, ok, detail) values ('expected figure counts preseason games', r.pre >= 1 and r.n >= r.pre and r.src in ('own', 'blend'), r.n || ' games, ' || r.pre || ' preseason, ' || r.src);

  -- picks lock when the round's FIRST game starts, for every game of the round
  select l.id, l.fixture into l1, f1 from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'player' order by f.starts_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.stakes_place(l1, 'over', 50);
  insert into t_log(name, ok, detail) values ('a pick before the round starts is taken', true, '');
  perform set_config('role', 'postgres', true);
  update public.fixtures set starts_at = now() - interval '1 minute' where id = (select id from public.fixtures where week = wk and not postponed order by starts_at limit 1) and id <> f1;
  perform set_config('role', 'authenticated', true);
  select l.id into l2 from public.stakes_lines l join public.fixtures f on f.id = l.fixture where f.week = wk and l.kind = 'player' and l.id <> l1 limit 1;
  begin perform public.stakes_place(l2, 'over', 50); insert into t_log values (default, 'once the first game has started, no new picks (even for later games)', false, ''); exception when others then insert into t_log values (default, 'once the first game has started, no new picks (even for later games)', sqlerrm like '%closed%', sqlerrm); end;
  begin perform public.stakes_cancel(l1); insert into t_log values (default, 'and no taking back', false, ''); exception when others then insert into t_log values (default, 'and no taking back', sqlerrm like '%closed%', sqlerrm); end;
  select count(*) into n from public.stakes_slate() s where s.week = wk and s.kind = 'player';
  insert into t_log(name, ok, detail) values ('the locked round stays on the page', n = 8, n::text);
end $$;
select name, ok, detail from t_log order by n;
