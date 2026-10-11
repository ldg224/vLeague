-- WR-24: the league's names over time. Seasons 1 and 2 ran under a different name; after the rebrand the count started again at Season 1 (so the
-- current season is the third overall). history_leagues lists the names the league has run under, oldest first (a higher sort = more recent);
-- history_seasons.league says which name a season ran under. A season with no league counts as the most recent name, so older code that adds a
-- season without one still works. Editor -> History edits it; the league page's Seasons tab groups previous seasons by it.
-- Everyone can read it; only the office writes. Additive and safe to re-run.

create table if not exists public.history_leagues (
  id          bigint generated always as identity primary key,
  name        text not null unique check (char_length(name) between 2 and 40),
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.history_seasons add column if not exists league bigint references public.history_leagues (id) on delete restrict;

-- The earlier name the existing seasons ran under (renamable in Editor -> History), and today's name.
insert into public.history_leagues (name, sort) values ('Heineken C League', 1), ('vLeague', 2) on conflict (name) do nothing;
update public.history_seasons set league = (select id from public.history_leagues where name = 'Heineken C League') where league is null;

alter table public.history_leagues enable row level security;
drop policy if exists history_leagues_read on public.history_leagues;
create policy history_leagues_read on public.history_leagues for select to anon, authenticated using (true);
drop policy if exists history_leagues_office on public.history_leagues;
create policy history_leagues_office on public.history_leagues for all to authenticated using (public.is_office()) with check (public.is_office());
grant select on public.history_leagues to anon, authenticated;
grant insert, update, delete on public.history_leagues to authenticated;
