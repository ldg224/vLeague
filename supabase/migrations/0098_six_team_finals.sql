-- Six clubs in the finals (the user, 26 Nov 2026): the league keeps its full 26 rounds, and the top six play the finals. Safe to re-run. Needs 0079 and 0084.
--   Week 27  Elimination finals: 3rd v 6th, 4th v 5th (1st and 2nd have the week off)
--   Week 28  Semi-finals: 1st v the lowest-placed winner, 2nd v the other winner
--   Week 29  Grand Final
-- The Third Place Final goes. Its stage (TP) and look stay, for any season that used them.

-- An elimination final as a stage. Like the other stages, it doesn't count for the table.
alter table public.fixtures drop constraint if exists fixtures_stage_check;
alter table public.fixtures add constraint fixtures_stage_check check (stage in ('EF', 'SF', 'GF', 'TP'));

-- The finals rounds (no finals fixtures exist yet: the office adds them in the Editor once the table is final).
update public.rounds set name = 'Elimination Finals' where week = 27 and kind = 'finals' and name = 'Semi Finals';
update public.rounds set name = 'Semi Finals', look = 'finals' where week = 28 and kind = 'finals' and name = 'Third Place Final';

-- Fixture ids: an elimination final is ef-..., a third place final tp-... (both were sf-... before).
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
      when 'f' then case when name ~* 'grand' then 'gf' when name ~* 'elimination' then 'ef' when name ~* 'third' then 'tp' else 'sf' end
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
