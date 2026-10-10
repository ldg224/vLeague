-- 0.58: kits (S-23 jersey editor, S-20 away kit). Each club has up to four kits: home, away, goalkeeper, special.
-- A kit is a design (pattern, colours, text) plus an optional uploaded logo. Designs show to everyone straight away; a logo
-- shows to everyone only once the office has approved it (until then only its club and the office see it).
-- Needs 0001 (clubs, is_office, my_club).

create table if not exists public.club_kits (
  club        text not null references public.clubs (code) on update cascade on delete cascade,
  slot        text not null check (slot in ('home', 'away', 'gk', 'special')),
  design      jsonb not null check (jsonb_typeof(design) = 'object' and pg_column_size(design) < 4000),
  logo_path   text check (logo_path is null or logo_path ~ '^[a-z0-9]{2,4}/[a-z0-9_-]{1,40}\.(png|webp)$'),
  logo_status text not null default 'none' check (logo_status in ('none', 'pending', 'approved', 'rejected')),
  updated_at  timestamptz not null default now(),
  primary key (club, slot)
);
alter table public.club_kits enable row level security;
drop policy if exists club_kits_read on public.club_kits;
create policy club_kits_read on public.club_kits for select to anon, authenticated using (true);
drop policy if exists club_kits_own on public.club_kits;
create policy club_kits_own on public.club_kits for all to authenticated
  using (public.is_office() or club = public.my_club()) with check (public.is_office() or club = public.my_club());
revoke all on public.club_kits from anon, authenticated;
grant select on public.club_kits to anon, authenticated;
grant insert, update, delete on public.club_kits to authenticated;

-- A manager can't approve their own logo. Changing the logo sends it back for approval; the office's own saves stay as they set them.
create or replace function public.club_kits_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_office() then
    if new.logo_path is null then new.logo_status := 'none'; end if;
    return new;
  end if;
  if new.logo_path is null then
    new.logo_status := 'none';
  elsif tg_op = 'INSERT' or new.logo_path is distinct from old.logo_path then
    new.logo_status := 'pending';
  else
    new.logo_status := old.logo_status;   -- only the office can change it
  end if;
  return new;
end $$;
drop trigger if exists club_kits_guard on public.club_kits;
create trigger club_kits_guard before insert or update on public.club_kits for each row execute function public.club_kits_guard();

-- Kit logos: public to read (they appear on kits everywhere once approved); a manager uploads only into their own club's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kits', 'kits', true, 256000, array['image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists kits_write on storage.objects;
create policy kits_write on storage.objects for insert to authenticated
  with check (bucket_id = 'kits' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
drop policy if exists kits_update on storage.objects;
create policy kits_update on storage.objects for update to authenticated
  using (bucket_id = 'kits' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
drop policy if exists kits_delete on storage.objects;
create policy kits_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kits' and (public.is_office() or (storage.foldername(name))[1] = lower(public.my_club())));
