-- Fixture ids follow the round codes (2 Nov 2026). Safe to re-run. Needs 0013, 0014, 0021, 0057.
--
-- A fixture's id was made once, from its week number and clubs when it was created ("w3-ccf-cfc"), and never changed, so after rounds were moved or matches
-- edited it said the wrong week and sometimes the wrong clubs. Ids now follow the round codes the site shows (js/roster.js roundLabels):
--   p1-ccf-lau ... p3-...      preseason rounds, in order
--   r1-dtp-sks ... r22-...     the season's numbered rounds (or the number picked by hand)
--   sf-... / gf-...            the finals (a round named "Grand Final" is gf; "Semi..." or a finals round is sf)
--   w<week>-...                a round that is none of these (a special round without a number)
-- then the home and away codes as they are now, and -2, -3 ... for a second or third meeting in one round. Test matches (week 99) keep their ids.
--
-- fixture_ids_by_round() renames every fixture whose id is out of date, and everything that holds a fixture id with it:
--   results, press_answers, stakes_lines     follow by themselves (on update cascade)
--   user_settings.prefs -> 'revealed' (mail_accounts is a view of it)   the results each manager has opened (spoiler-free)
--   gotw_rounds.candidates / finalists, gotw_votes.pick           Goal of the Week keys ("<fixture>:<goal id>")
-- Match files keep their names: results.file says which file belongs to a match. The Editor calls it after every change to the fixtures (js/editor-fixtures.js).

-- Old ids keep working: every rename is remembered, so a link shared before it (match.html?id=w3-ccf-lau) still finds its match.
create table if not exists public.fixture_aliases (
  old        text primary key,
  fixture    text not null references public.fixtures (id) on update cascade on delete cascade,
  renamed_at timestamptz not null default now()
);
alter table public.fixture_aliases enable row level security;
drop policy if exists fixture_aliases_read on public.fixture_aliases;
create policy fixture_aliases_read on public.fixture_aliases for select to authenticated using (true);
revoke all on public.fixture_aliases from anon, authenticated;
grant select on public.fixture_aliases to authenticated;

create or replace function public.fixture_ids_by_round() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_office() then raise exception 'only the league office can renumber fixtures'; end if;

  create temp table if not exists _fx_map (old text primary key, new text not null) on commit drop;
  delete from _fx_map;
  insert into _fx_map (old, new)
  with wk as (
    select week from public.fixtures where week <> 99 union select week from public.rounds where week <> 99
  ), lab as (
    select w.week, r.kind, r.name, coalesce(r.numbered, true) as numbered, r.number_override,
           case when r.kind = 'preseason' then 'p'
                when (r.numbered = false or r.kind = 'finals') and (r.name ~* 'grand|semi' or r.kind = 'finals') then 'f'
                when coalesce(r.numbered, true) then 'r'
                else 'x' end as cat
    from wk w left join public.rounds r on r.week = w.week
  ), coded as (
    select week, case cat
      when 'p' then 'p' || row_number() over (partition by cat order by week)
      when 'r' then 'r' || coalesce(number_override, row_number() over (partition by cat order by week))
      when 'f' then case when name ~* 'grand' then 'gf' else 'sf' end
      else 'w' || week end as code
    from lab
  ), base as (
    select f.id, c.code || '-' || lower(f.home) || '-' || lower(f.away) as b,
           row_number() over (partition by c.code || '-' || lower(f.home) || '-' || lower(f.away) order by f.starts_at nulls last, f.id) as k
    from public.fixtures f join coded c on c.week = f.week
  )
  select id, b || case when k > 1 then '-' || k else '' end from base
  where id <> b || case when k > 1 then '-' || k else '' end;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;

  -- remember the old ids (an id that is now a current fixture's again is no alias any more)
  delete from public.fixture_aliases a using _fx_map m where a.old = m.new;
  -- two steps, so a new id can take an old one that is itself moving
  update public.fixtures f set id = 'tmp-' || substr(md5(m.old), 1, 24) from _fx_map m where f.id = m.old;
  update public.fixtures f set id = m.new from _fx_map m where f.id = 'tmp-' || substr(md5(m.old), 1, 24);

  insert into public.fixture_aliases (old, fixture) select m.old, m.new from _fx_map m where not exists (select 1 from public.fixtures f where f.id = m.old)
    on conflict (old) do update set fixture = excluded.fixture, renamed_at = now();
  update public.user_settings s set prefs = jsonb_set(s.prefs, '{revealed}',
      (select coalesce(jsonb_agg(coalesce(m.new, x)), '[]'::jsonb) from jsonb_array_elements_text(s.prefs -> 'revealed') x left join _fx_map m on m.old = x))
    where jsonb_typeof(s.prefs -> 'revealed') = 'array' and exists (select 1 from jsonb_array_elements_text(s.prefs -> 'revealed') x join _fx_map m on m.old = x);
  -- (mail_accounts is a view over user_settings, so it follows)

  -- Goal of the Week: a candidate carries its fixture and its key "<fixture>:<goal id>"; finalists and votes hold keys
  update public.gotw_rounds g set candidates = (
      select coalesce(jsonb_agg(case when m.new is null then e else e || jsonb_build_object('fixture', m.new, 'key', m.new || ':' || split_part(e ->> 'key', ':', 2)) end order by o), '[]'::jsonb)
      from jsonb_array_elements(g.candidates) with ordinality as t(e, o) left join _fx_map m on m.old = e ->> 'fixture')
    where exists (select 1 from jsonb_array_elements(g.candidates) e join _fx_map m on m.old = e ->> 'fixture');
  update public.gotw_rounds g set finalists = (
      select coalesce(array_agg(coalesce(m.new || ':' || split_part(x, ':', 2), x) order by o), '{}')
      from unnest(g.finalists) with ordinality as t(x, o) left join _fx_map m on m.old = split_part(x, ':', 1))
    where exists (select 1 from unnest(g.finalists) x join _fx_map m on m.old = split_part(x, ':', 1));
  update public.gotw_votes v set pick = m.new || ':' || split_part(v.pick, ':', 2) from _fx_map m where m.old = split_part(v.pick, ':', 1);

  return n;
end $$;
revoke all on function public.fixture_ids_by_round() from public, anon;
grant execute on function public.fixture_ids_by_round() to authenticated;

select public.fixture_ids_by_round();
