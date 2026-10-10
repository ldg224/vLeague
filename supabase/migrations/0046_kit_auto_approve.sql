-- 0.60.1: kit logos and whole-kit designs no longer wait for the office (the user's call, 10 Oct 2026). Anything a club uploads
-- is approved straight away; the office can still reject one afterwards. Anything waiting now is approved.
-- Needs 0045.

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
    new.logo_status := 'approved';   -- a new upload is live at once
  else
    new.logo_status := old.logo_status;   -- only the office can change it (so a rejection sticks)
  end if;
  if new.art_path is null then
    new.art_status := 'none';
  elsif tg_op = 'INSERT' or new.art_path is distinct from old.art_path then
    new.art_status := 'approved';
  else
    new.art_status := old.art_status;
  end if;
  return new;
end $$;

-- (the guard would keep the old status on these updates, so it is switched off for them)
alter table public.club_kits disable trigger club_kits_guard;
update public.club_kits set logo_status = 'approved' where logo_status = 'pending';
update public.club_kits set art_status = 'approved' where art_status = 'pending';
alter table public.club_kits enable trigger club_kits_guard;
