-- 0.66: league history. The office records past seasons in Editor -> History; history.html shows every season's winners
-- and runners-up, and each team page shows a trophy cabinet worked out from it.
--   history_competitions: the trophies a season can have (League, Grand Final, Christmas Cup...), each with a default picture
--                         for the winner and for the runner-up (PNG/WebP in the `trophies` bucket).
--   history_seasons:      Season 1, Season 2... in the order the office sets.
--   history_past_teams:   clubs that have left the league: name, code and manager, so they can still be credited.
--   history_awards:       one per season, competition and place (winner or runner-up), credited to a current club or a
--                         past team, with its own picture if that year's trophy looked different.
-- Everyone can read it (guests too); only the office writes. Replaces clubs.honours (0049), which was never filled in.
-- Safe to re-run.

create table if not exists public.history_competitions (
  id          bigint generated always as identity primary key,
  name        text not null unique check (char_length(name) between 2 and 40),
  sort        int not null default 0,
  winner_art  text,   -- path in the trophies bucket
  runner_art  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.history_seasons (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 40),
  sort        int not null default 0,   -- higher = more recent
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_at  timestamptz not null default now()
);

create table if not exists public.history_past_teams (
  id            bigint generated always as identity primary key,
  name          text not null check (char_length(name) between 2 and 40),
  code          text check (code is null or code ~ '^[A-Z0-9]{2,4}$'),
  manager_name  text check (manager_name is null or char_length(manager_name) <= 40),
  created_at    timestamptz not null default now()
);

create table if not exists public.history_awards (
  id           bigint generated always as identity primary key,
  season       bigint not null references public.history_seasons (id) on delete cascade,
  competition  bigint not null references public.history_competitions (id) on delete cascade,
  place        text not null check (place in ('winner', 'runner_up')),
  club         text references public.clubs (code) on update cascade on delete restrict,
  past_team    bigint references public.history_past_teams (id) on delete restrict,
  art_path     text,   -- this award's own picture; null = the competition's default for its place
  created_at   timestamptz not null default now(),
  unique (season, competition, place),
  check (num_nonnulls(club, past_team) = 1)
);

do $$
declare t text;
begin
  foreach t in array array['history_competitions', 'history_seasons', 'history_past_teams', 'history_awards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_office', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_office()) with check (public.is_office())', t || '_office', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Trophy pictures: public to read, only the office uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trophies', 'trophies', true, 1048576, array['image/png'])
on conflict (id) do nothing;
drop policy if exists trophies_write on storage.objects;
create policy trophies_write on storage.objects for insert to authenticated with check (bucket_id = 'trophies' and public.is_office());
drop policy if exists trophies_update on storage.objects;
create policy trophies_update on storage.objects for update to authenticated using (bucket_id = 'trophies' and public.is_office());
drop policy if exists trophies_delete on storage.objects;
create policy trophies_delete on storage.objects for delete to authenticated using (bucket_id = 'trophies' and public.is_office());

-- The cabinet comes from history_awards now.
alter table public.clubs drop column if exists honours;
