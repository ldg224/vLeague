-- S-49 (0097): the sheet's shape is saved, versioned, copied at the lock and handed out before it. Runs inside the harness transaction
-- (draft/_harness.sql: begin, t_log, chk, run_as), which is always rolled back.

-- Columns
select pg_temp.chk('team_sheets.shape exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_sheets' and column_name = 'shape'));
select pg_temp.chk('week_sheets.shape exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'week_sheets' and column_name = 'shape'));

-- sheet_shape
select pg_temp.chk('sheet_shape: object kept', public.sheet_shape('{"shape": {"LB": [12, 22]}}') = '{"LB": [12, 22]}'::jsonb);
select pg_temp.chk('sheet_shape: missing is null', public.sheet_shape('{}') is null);
select pg_temp.chk('sheet_shape: JSON null is null', public.sheet_shape('{"shape": null}') is null);
select pg_temp.chk('sheet_shape: array is null', public.sheet_shape('{"shape": [1, 2]}') is null);

-- A manager saves a shape on his own sheet; a version keeps it
create temp table t_club as select club from public.profiles where role = 'manager' and club is not null order by club limit 1;
insert into public.team_sheets (club) select club from t_club on conflict (club) do nothing;
select pg_temp.chk('manager can save a shape',
  pg_temp.run_as((select club from t_club), format('update public.team_sheets set shape = %L where club = %L', '{"LB": [12, 22]}', (select club from t_club))) = 'OK');
select pg_temp.chk('the shape is saved', (select shape from public.team_sheets where club = (select club from t_club)) = '{"LB": [12, 22]}'::jsonb);
select pg_temp.chk('the latest version keeps the shape',
  (select sheet->'shape' from public.team_sheet_versions where club = (select club from t_club) order by saved_at desc, id desc limit 1) = '{"LB": [12, 22]}'::jsonb);
select pg_temp.chk('a shape that is not an object is refused',
  pg_temp.run_as('postgres', format('update public.team_sheets set shape = %L where club = %L', '[1, 2]', (select club from t_club))) like 'ERR:%');
select pg_temp.chk('clearing the shape works',
  pg_temp.run_as((select club from t_club), format('update public.team_sheets set shape = null where club = %L', (select club from t_club))) = 'OK');

-- The lock copies a submitted sheet's shape; a random XI has none. A scratch round 97 between two clubs, already due.
alter table public.fixtures disable trigger fixtures_sync_deadline;
alter table public.deadlines disable trigger deadlines_guard;
create temp table t_two as select code, row_number() over (order by code) n from public.clubs c where exists (select 1 from public.players p where p.club = c.code) order by code limit 2;
insert into public.fixtures (id, week, home, away, starts_at) values ('zz-97', 97, (select code from t_two where n = 1), (select code from t_two where n = 2), now() - interval '1 hour');
insert into public.deadlines (week, locks_at) values (97, now() + interval '1 hour');
insert into public.submitted_sheets (club, week, sheet, submitted_at)
values ((select code from t_two where n = 1), 97, '{"formation": "4-3-3", "lineup": {}, "shape": {"ST": [50, 92]}}', now() - interval '1 minute');

-- Before the lock: submitted_lineups hands out the shape, to anyone
select pg_temp.chk('submitted_lineups returns the shape',
  (select shape from public.submitted_lineups(97, array[(select code from t_two where n = 1)])) = '{"ST": [50, 92]}'::jsonb);
select pg_temp.chk('anon can still call submitted_lineups',
  pg_temp.run_as('anon', 'select * from public.submitted_lineups(97, array[''LAU''])') = 'OK');

update public.deadlines set locks_at = now() - interval '1 second' where week = 97;
select pg_temp.chk('lock_due_weeks locks the scratch round', public.lock_due_weeks() >= 1);
select pg_temp.chk('submitted sheet: shape copied',
  (select shape from public.week_sheets where week = 97 and club = (select code from t_two where n = 1)) = '{"ST": [50, 92]}'::jsonb);
select pg_temp.chk('random XI: no shape',
  (select random and shape is null from public.week_sheets where week = 97 and club = (select code from t_two where n = 2)));

select name, ok, detail from t_log order by n;
rollback;
