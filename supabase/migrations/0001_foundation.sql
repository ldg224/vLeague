-- vLeague 0.3.0: foundation. Clubs, profiles (who is a manager of which club, who is the league office),
-- team sheets (private to the club and the office), and the crests storage bucket.
-- Every table has row-level security: the database enforces who can read and change what, not the pages.
-- Run once, in order, on the vLeague Supabase project. Safe to re-run (idempotent where it matters).

-- ---------------------------------------------------------------- clubs (public identity)

create table if not exists public.clubs (
  code         text primary key check (code ~ '^[A-Z0-9]{2,4}$'),
  name         text not null check (char_length(name) between 2 and 40),
  short_name   text check (short_name is null or char_length(short_name) <= 12),
  colour       text check (colour  is null or colour  ~* '^#[0-9a-f]{6}$'),
  colour2      text check (colour2 is null or colour2 ~* '^#[0-9a-f]{6}$'),
  accent       text check (accent  is null or accent  ~* '^#[0-9a-f]{6}$'),  -- the site-safe club colour, worked out on save (0.4)
  crest_path   text,                                                        -- path in the crests bucket, e.g. 'tur/crest.png'
  manager_name text,
  stadium      text,
  motto        text check (motto is null or char_length(motto) <= 80),
  status       text not null default 'active' check (status in ('pending', 'active', 'withdrawn')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- profiles (one per account)

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'manager' check (role in ('manager', 'office')),
  club         text references public.clubs (code) on update cascade on delete set null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Every new account gets a profile (a manager with no club until the office links one).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers for the policies. security definer so they can read profiles without tripping its own policies.
create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'office');
$$;

create or replace function public.my_club() returns text
language sql stable security definer set search_path = public as $$
  select club from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------- team sheets (private)

-- A club's current team sheet (the s3 site's data/teams/<code>.json). Only that club's manager and the
-- league office can read or change it. The public T-10 reveal needs fixtures in the database (0.8).
create table if not exists public.team_sheets (
  club       text primary key references public.clubs (code) on update cascade on delete cascade,
  formation  text,
  tactics    jsonb not null default '{}'::jsonb,
  lineup     jsonb not null default '{}'::jsonb,   -- slot -> player id
  bench      jsonb not null default '[]'::jsonb,
  captain    text,
  penalties  text,
  freekicks  text,
  corners    text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists clubs_touch on public.clubs;
create trigger clubs_touch before update on public.clubs for each row execute function public.touch_updated_at();
drop trigger if exists team_sheets_touch on public.team_sheets;
create trigger team_sheets_touch before update on public.team_sheets for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- row-level security

alter table public.clubs       enable row level security;
alter table public.profiles    enable row level security;
alter table public.team_sheets enable row level security;

-- clubs: everyone (guests too) can read; only the office changes them for now (managers edit via the 0.4 wizard).
drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select to anon, authenticated using (true);
drop policy if exists clubs_office_write on public.clubs;
create policy clubs_office_write on public.clubs for all to authenticated using (public.is_office()) with check (public.is_office());

-- profiles: you can read your own; the office can read and change all (so nobody can promote themselves).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_office());
drop policy if exists profiles_office_write on public.profiles;
create policy profiles_office_write on public.profiles for all to authenticated using (public.is_office()) with check (public.is_office());

-- team sheets: your own club's, or any for the office. Guests: nothing.
drop policy if exists team_sheets_own on public.team_sheets;
create policy team_sheets_own on public.team_sheets for all to authenticated
  using (club = public.my_club() or public.is_office())
  with check (club = public.my_club() or public.is_office());

revoke all on public.profiles, public.team_sheets from anon;

-- ---------------------------------------------------------------- crests bucket

-- Public to read (crests appear everywhere). A manager may upload only into their own club's folder
-- ('<code lower case>/...'); the office anywhere. PNG or WebP, up to 500 KB. (No SVG: it can carry scripts.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crests', 'crests', true, 512000, array['image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists crests_write on storage.objects;
create policy crests_write on storage.objects for insert to authenticated
  with check (bucket_id = 'crests' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
drop policy if exists crests_update on storage.objects;
create policy crests_update on storage.objects for update to authenticated
  using (bucket_id = 'crests' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
drop policy if exists crests_delete on storage.objects;
create policy crests_delete on storage.objects for delete to authenticated
  using (bucket_id = 'crests' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
