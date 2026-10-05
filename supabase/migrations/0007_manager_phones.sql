-- 0.10: managers' phone numbers. Every club's manager is asked for one in their Inbox (a pinned post with a small
-- form). A number is private: only that club's manager and the league office can read it, and nobody can write
-- the table directly; managers save through save_my_phone(), which checks the number first.

create table if not exists public.manager_phones (
  club       text primary key references public.clubs (code) on update cascade on delete cascade,
  phone      text not null check (phone ~ '^\+?[0-9 ()-]{8,20}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.manager_phones enable row level security;
revoke all on public.manager_phones from anon, authenticated;
drop policy if exists phones_read on public.manager_phones;
create policy phones_read on public.manager_phones for select to authenticated
  using (club = public.my_club() or public.is_office());
drop policy if exists phones_office_delete on public.manager_phones;
create policy phones_office_delete on public.manager_phones for delete to authenticated using (public.is_office());
grant select, delete on public.manager_phones to authenticated;

create or replace function public.save_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.require_my_club(); n text := btrim(regexp_replace(coalesce(p_phone, ''), '\s+', ' ', 'g'));
begin
  if n !~ '^\+?[0-9 ()-]{8,20}$' or length(regexp_replace(n, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Enter a phone number with 8 to 15 digits, like 0412 345 678.';
  end if;
  insert into public.manager_phones (club, phone, updated_by) values (c, n, auth.uid())
  on conflict (club) do update set phone = excluded.phone, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.save_my_phone(text) from public, anon;
grant execute on function public.save_my_phone(text) to authenticated;

-- The Inbox post every club sees. Its form is drawn by js/inbox.js (data.form = 'phone').
insert into public.news (kind, title, body, data)
select 'post', 'Add your phone number',
  'The league office is collecting each manager’s phone number so we can reach you when it matters, like a late line-up or a fixture change.' || E'\n\n' ||
  'Only you and the league office can see it. You can change it here any time.',
  '{"form": "phone", "pinned": true}'::jsonb
where not exists (select 1 from public.news where data->>'form' = 'phone');
