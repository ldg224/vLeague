-- 0.60: a kit drawn in Photoshop (S-23). A club downloads the kit template, paints the whole unrolled shirt and uploads it. The picture
-- (art) is the shirt; the crest, logo and print are still added on top. Like a logo, it shows to everyone only once the office has
-- approved it (until then only its club and the office see it; everyone else sees the design's colours).
-- Needs 0043 (club_kits, the kits bucket).

alter table public.club_kits add column if not exists art_path text
  check (art_path is null or art_path ~ '^[a-z0-9]{2,4}/[a-z0-9_-]{1,40}\.(png|webp|jpg)$');
alter table public.club_kits add column if not exists art_status text not null default 'none'
  check (art_status in ('none', 'pending', 'approved', 'rejected'));

-- The same rule as the logo, for the art: a manager can't approve their own; changing it sends it back for approval.
create or replace function public.club_kits_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_office() then
    if new.logo_path is null then new.logo_status := 'none'; end if;
    if new.art_path is null then new.art_status := 'none'; end if;
    return new;
  end if;
  if new.logo_path is null then
    new.logo_status := 'none';
  elsif tg_op = 'INSERT' or new.logo_path is distinct from old.logo_path then
    new.logo_status := 'pending';
  else
    new.logo_status := old.logo_status;   -- only the office can change it
  end if;
  if new.art_path is null then
    new.art_status := 'none';
  elsif tg_op = 'INSERT' or new.art_path is distinct from old.art_path then
    new.art_status := 'pending';
  else
    new.art_status := old.art_status;
  end if;
  return new;
end $$;

-- A whole shirt is a bigger picture than a logo: allow up to 1.5 MB, and JPEG (photos and painted textures squeeze far better).
update storage.buckets set file_size_limit = 1572864, allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg'] where id = 'kits';
