-- vLeague 0.3.0: the eight clubs from vLeague Season 1 (the s3 site's data/season.json), and the league office.
-- Reserved Team #1 and #2 are placeholders waiting for a manager, so they start as 'pending'.
insert into public.clubs (code, name, colour, manager_name, status, crest_path) values
  ('TUR', 'FC Turtle',            '#0cf6f3', 'Luke Grogan',                  'active',  'tur/crest.png'),
  ('SKS', 'SKS FC',               '#0027ff', 'Sreehari Kottarathil Sandeep', 'active',  'sks/crest.png'),
  ('CFC', 'Cranbourne United FC', '#ff409f', 'Luke Sheppard',                'active',  'cfc/crest.png'),
  ('LFC', 'Lucky FC',             '#ffb340', 'Lakshman Devendran',           'active',  'lfc/crest.png'),
  ('NGR', 'Tyrone FC',            '#2be02b', 'Aarav Ganesan',                'active',  'ngr/crest.png'),
  ('LAU', 'Lads United',          '#000d57', 'Oliver Jamieson',              'active',  'lau/crest.png'),
  ('RT1', 'Reserved Team #1',     '#ffffff', null,                           'pending', null),
  ('RT2', 'Reserved Team #2',     '#ffffff', null,                           'pending', null)
on conflict (code) do nothing;

-- The league office: only this account has Editor access.
insert into public.profiles (id, role, display_name)
select id, 'office', 'League office' from auth.users where email = 'lukedanielgrogan@gmail.com'
on conflict (id) do update set role = 'office';
