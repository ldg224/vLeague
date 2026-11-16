-- Shared set-up for the Office tests (run.py puts it after the migration and before each test; everything is rolled back).
-- Fake accounts: managers of TUR, LAU and SKS, the office (no club), and an account with no club. Helpers switch who is acting and log results.
create temp table t_log(n serial, name text, ok boolean, detail text);
grant all on t_log to authenticated, anon; grant usage on sequence t_log_n_seq to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'office-test-tur@example.invalid'),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'office-test-lau@example.invalid'),
  ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'office-test-sks@example.invalid'),
  ('00000000-0000-4000-8000-0000000f0004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'office-test-office@example.invalid'),
  ('00000000-0000-4000-8000-0000000f0005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'office-test-noclub@example.invalid');
insert into public.profiles (id) select id from auth.users where id::text like '00000000-0000-4000-8000-0000000f000_' on conflict (id) do nothing;
update public.profiles set club = 'TUR' where id = '00000000-0000-4000-8000-0000000f0001';
update public.profiles set club = 'LAU' where id = '00000000-0000-4000-8000-0000000f0002';
update public.profiles set club = 'SKS' where id = '00000000-0000-4000-8000-0000000f0003';
update public.profiles set role = 'office', club = null where id = '00000000-0000-4000-8000-0000000f0004';

-- A known starting point: window open (started a minute ago), cap 125,000, 2 releases. No round being played (checked below).
update public.office_settings set cap = 125000, releases_per_window = 2, window_open = true, opens_at = null, closes_at = null, window_started_at = now() - interval '1 minute';

-- who: 'tur', 'lau', 'sks', 'office', 'noclub', 'anon', or 'su' (back to full rights)
create function pg_temp.act(who text) returns void language plpgsql as $$
declare u text := case who when 'tur' then '00000000-0000-4000-8000-0000000f0001' when 'lau' then '00000000-0000-4000-8000-0000000f0002'
  when 'sks' then '00000000-0000-4000-8000-0000000f0003' when 'office' then '00000000-0000-4000-8000-0000000f0004' when 'noclub' then '00000000-0000-4000-8000-0000000f0005' end;
begin
  perform set_config('role', 'postgres', true);
  if who = 'su' then return; end if;
  if who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;
create function pg_temp.ok(p_name text, p_ok boolean, p_detail text default '') returns void language sql as $$
  insert into t_log(name, ok, detail) values (p_name, coalesce(p_ok, false), coalesce(p_detail, 'null'))
$$;
-- Runs q and expects an error containing want.
create function pg_temp.err(p_name text, q text, want text) returns void language plpgsql as $$
begin
  execute q;
  insert into t_log(name, ok, detail) values (p_name, false, 'no error');
exception when others then
  insert into t_log(name, ok, detail) values (p_name, position(lower(want) in lower(sqlerrm)) > 0, sqlerrm);
end $$;
-- The n-th cheapest (asc) or dearest (desc) player of a club (null club = free agents) at a position.
create function pg_temp.pl(p_club text, p_pos text, p_n int default 1, p_desc boolean default false) returns text language sql as $$
  select id from public.players where club is not distinct from p_club and position = p_pos
  order by case when p_desc then -value else value end, id offset p_n - 1 limit 1
$$;
create function pg_temp.club_of(p text) returns text language sql as $$ select club from public.players where id = p $$;
create function pg_temp.wage(p text) returns int language sql as $$ select value from public.players where id = p $$;

select pg_temp.ok('setup: no round being played now', public.office_round_live() is null, coalesce(public.office_round_live()::text, ''));
select pg_temp.ok('setup: window open', public.office_window_status() = 'open', public.office_window_status());
