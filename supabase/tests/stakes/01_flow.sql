create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare u uuid; fx record; w int; lines int; pk bigint; bal int; r record;
begin
  update public.stakes_settings set visible = true;
  select id into u from public.profiles where role='manager' limit 1;
  select * into fx from public.fixtures where starts_at > now() and not postponed and starts_at < now()+interval '60 days' order by starts_at limit 1;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = fx.week);   -- live lines may already exist for this round
  -- fake submitted sheets for both clubs: first 11 players of each club
  insert into public.submitted_sheets (club, week, sheet)
  select c, fx.week, jsonb_build_object('formation','4-4-2','lineup',
    (select jsonb_object_agg('S'||rn, id) from (select id, row_number() over (order by value desc) rn from public.players where club=c limit 11) x))
  from unnest(array[fx.home, fx.away]) c on conflict (club,week) do update set sheet=excluded.sheet;
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  perform public.stakes_wallet();
  insert into t_log(name,ok,detail) select 'wallet 1000', coins=1000, coins::text from public.stakes_wallets where user_id=u;
  select count(*) into lines from public.stakes_slate() s where s.fixture=fx.id;
  insert into t_log(name,ok,detail) values ('2 lines made for the match (the per-match limit)',lines=2,lines::text);
  select line_id into pk from public.stakes_slate() s where s.fixture=fx.id limit 1;
  select public.stakes_place(pk,'over',100) into bal;
  insert into t_log(name,ok,detail) values ('stake deducted',bal=900,bal::text);
  begin perform public.stakes_place(pk,'under',10); insert into t_log values (default,'dup blocked',false,''); exception when others then insert into t_log values (default,'dup blocked',true,sqlerrm); end;
  begin perform public.stakes_place(pk+0,'over',5000); insert into t_log values (default,'overspend blocked',false,''); exception when others then insert into t_log values (default,'overspend blocked',true,sqlerrm); end;
  perform set_config('role','postgres',true);
  -- settle: fake result giving the line player a huge stat so over wins
  insert into public.results (fixture, summary) select fx.id, jsonb_build_object('players', (select jsonb_object_agg(l.player_id, jsonb_build_object('min',90,'sv',99,'sot',99,'pas',99,'tk',99)) from public.stakes_lines l where l.fixture=fx.id));
  select coins into bal from public.stakes_wallets where user_id=u;
  insert into t_log(name,ok,detail) values ('over wins 190 back',bal=1090,bal::text);
  insert into t_log(name,ok,detail) select 'pick won', status='won' and payout=190, status||' '||payout from public.stakes_picks where id=(select max(id) from public.stakes_picks);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  insert into t_log(name,ok,detail) select 'board shows me', count(*)>=1, count(*)::text from public.stakes_board() where mine;
  begin perform 1 from public.stakes_wallets where user_id<>u; insert into t_log values (default,'rls own wallet only', not found, ''); end;
end $$;
select name, ok, detail from t_log order by n;
