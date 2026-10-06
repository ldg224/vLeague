-- 0.16: the league office can set or clear any club's phone number from the Editor (pen icon in the club's panel). Same
-- rules as a manager saving their own (save_my_phone). An empty number removes it. Safe to re-run.

create or replace function public.office_set_phone(p_club text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_phone, ''), '\s+', ' ', 'g'));
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  if not exists (select 1 from public.clubs where code = p_club) then raise exception 'That club doesn’t exist.'; end if;
  if n = '' then
    delete from public.manager_phones where club = p_club;
    return;
  end if;
  if n !~ '^\+?[0-9 ()-]{8,20}$' or length(regexp_replace(n, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Enter a phone number with 8 to 15 digits, like 0412 345 678.';
  end if;
  insert into public.manager_phones (club, phone, updated_by) values (p_club, n, auth.uid())
  on conflict (club) do update set phone = excluded.phone, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.office_set_phone(text, text) from public, anon;
grant execute on function public.office_set_phone(text, text) to authenticated;
