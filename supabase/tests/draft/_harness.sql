begin;
create temp table t_log(n serial, name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_cond boolean, p_detail text default '') returns void language sql as $$ insert into t_log(name, ok, detail) values (p_name, coalesce(p_cond,false), p_detail) $$;
create function pg_temp.run_as(who text, q text) returns text language plpgsql as $$
declare uid text;
begin
  begin
    if who = 'anon' then perform set_config('request.jwt.claims','{"role":"anon"}',true); execute 'set local role anon';
    elsif who = 'postgres' then null;
    else
      uid := case when who = 'office' then '8cf80979-e914-42b1-8aa9-84d9c1e685b9' else (select id::text from public.profiles where club = who and role = 'manager') end;
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute q;
    execute 'reset role';
    return 'OK';
  exception when others then
    execute 'reset role';
    return 'ERR: ' || sqlerrm;
  end;
end $$;
-- the nth free player of a position
create function pg_temp.fp(pos text, n int default 1) returns text language sql as $$
  select id from (select id, row_number() over (order by id) rn from public.players where club is null and position = pos) x where rn = n $$;
-- a scratch draft in the 4-club snake order (LAU, LFC, CFC, SKS), 3 rounds
create function pg_temp.mk(p_minutes int default 60, p_timeout text default 'queue', p_rmax jsonb default '{}', p_rmin jsonb default '{}', p_quiet jsonb default '[]', p_auto int default null) returns bigint language plpgsql as $$
declare did bigint; clubs text[] := array['LAU','LFC','CFC','SKS']; i int; r int;
begin
  insert into public.drafts(name, status, pick_minutes, rounds, on_timeout, roster_max, roster_min, quiet, auto_after_minutes, visible)
    values ('ZZ scratch', 'setup', p_minutes, 3, p_timeout, p_rmax, p_rmin, p_quiet, p_auto, false) returning id into did;
  for r in 0..2 loop for i in 1..4 loop
    insert into public.draft_order(draft, pick_no, club) values (did, r*4 + i, case when r % 2 = 0 then clubs[i] else clubs[5-i] end);
  end loop; end loop;
  return did;
end $$;
-- time travel: make the pick on the clock overdue
create function pg_temp.overdue(p_id bigint) returns void language sql as $$ update public.drafts set pick_deadline = now() - interval '1 second', pick_started = now() - (pick_minutes || ' minutes')::interval - interval '1 second' where id = p_id $$;
create function pg_temp.st(p_id bigint) returns text language sql as $$ select status || '/' || current_pick || '/' || (pick_deadline is not null) from public.drafts where id = p_id $$;
