-- 0.12: fixtures and results live here, not in the s3 test site's season.json.
-- Kick-off is one timestamptz (the Editor enters it in Melbourne time). A result can't be read before its match kicks
-- off, enforced by row-level security: only the league office reads it early. Results are filled in by Simulate (0.13).

create table if not exists public.fixtures (
  id        text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  week      int  not null check (week between 1 and 99),
  home      text not null references public.clubs (code) on update cascade on delete restrict,
  away      text not null references public.clubs (code) on update cascade on delete restrict,
  starts_at timestamptz,
  stage     text check (stage in ('SF', 'GF')),
  postponed boolean not null default false,
  created_at timestamptz not null default now(),
  check (home <> away)
);
create index if not exists fixtures_week on public.fixtures (week, starts_at);

create table if not exists public.results (
  fixture    text primary key references public.fixtures (id) on update cascade on delete cascade,
  summary    jsonb not null,                -- score, goals, cards, stats, ratings, man of the match
  file       text,                          -- the match file's name (published on this site, 0.13)
  created_at timestamptz not null default now()
);

alter table public.fixtures enable row level security;
alter table public.results  enable row level security;
drop policy if exists fixtures_read on public.fixtures;
create policy fixtures_read on public.fixtures for select to anon, authenticated using (true);
drop policy if exists fixtures_office_write on public.fixtures;
create policy fixtures_office_write on public.fixtures for all to authenticated using (public.is_office()) with check (public.is_office());
drop policy if exists results_read on public.results;
create policy results_read on public.results for select to anon, authenticated
  using (public.is_office() or exists (select 1 from public.fixtures f where f.id = fixture and f.starts_at is not null and f.starts_at <= now() and not f.postponed));
drop policy if exists results_office_write on public.results;
create policy results_office_write on public.results for all to authenticated using (public.is_office()) with check (public.is_office());

revoke all on public.fixtures, public.results from anon, authenticated;
grant select on public.fixtures, public.results to anon, authenticated;
grant insert, update, delete on public.fixtures, public.results to authenticated;
