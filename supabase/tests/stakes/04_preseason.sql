create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated; grant usage on sequence t_log_n_seq to authenticated;
do $$
declare u uuid; fx record; n int; pk bigint;
begin
  update public.stakes_settings set visible = true, betting_open = true, lines_days = 28;
  select id into u from public.profiles where role='manager' limit 1;
  select * into fx from public.fixtures where starts_at > now() and not postponed and starts_at < now()+interval '28 days' order by starts_at limit 1;
  delete from public.stakes_lines where fixture in (select id from public.fixtures where week = fx.week);
  update public.rounds set kind = 'preseason', counts_for_ladder = false where week = fx.week;
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  perform public.stakes_wallet();
  select count(*) into n from public.stakes_slate() s where s.week = fx.week;
  insert into t_log(name,ok,detail) values ('preseason round shows no stakes', n=0, n::text);
  perform set_config('role','postgres',true);
  select count(*) into n from public.stakes_lines l join public.fixtures f on f.id=l.fixture where f.week = fx.week;
  insert into t_log(name,ok,detail) values ('preseason round makes no lines', n=0, n::text);
  update public.rounds set kind = 'regular', counts_for_ladder = true where week = fx.week;
  perform set_config('role','authenticated',true);
  select count(*) into n from public.stakes_slate() s where s.week = fx.week;
  insert into t_log(name,ok,detail) values ('same round as regular shows stakes', n>0, n::text);
end $$;
select * from t_log order by n;
