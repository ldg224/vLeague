-- 0.67.1 (B-17): whole-kit designs and logos uploaded by an office account stayed at 'none' and never showed (the kit fell
-- back to its average colours). 0046's guard returned early for the office without approving a new upload. Now an upload is
-- live at once whoever makes it; the office can still set a status on purpose (for example to reject one), which is kept.
-- Also repairs the kits already saved that way. Needs 0046. Safe to re-run.

create or replace function public.club_kits_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_logo boolean := case when tg_op = 'INSERT' then true else new.logo_path is distinct from old.logo_path end;
  new_art  boolean := case when tg_op = 'INSERT' then true else new.art_path is distinct from old.art_path end;
begin
  new.updated_at := now();
  if new.logo_path is null then
    new.logo_status := 'none';
  elsif public.is_office() then
    -- the office's own choice stands; an upload that came without one (still 'none') goes live
    if new.logo_status = 'none' then new.logo_status := 'approved'; end if;
  elsif new_logo then
    new.logo_status := 'approved';   -- a new upload is live at once
  else
    new.logo_status := old.logo_status;   -- only the office can change it (so a rejection sticks)
  end if;
  if new.art_path is null then
    new.art_status := 'none';
  elsif public.is_office() then
    if new.art_status = 'none' then new.art_status := 'approved'; end if;
  elsif new_art then
    new.art_status := 'approved';
  else
    new.art_status := old.art_status;
  end if;
  return new;
end $$;

-- Kits saved by the office with a picture but no status: live now.
alter table public.club_kits disable trigger club_kits_guard;
update public.club_kits set art_status = 'approved' where art_path is not null and art_status = 'none';
update public.club_kits set logo_status = 'approved' where logo_path is not null and logo_status = 'none';
alter table public.club_kits enable trigger club_kits_guard;
