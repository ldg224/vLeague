-- 0.14: full match files (about 2 MB each, gzipped) live in a private storage bucket, one per fixture, named
-- <fixture id>.json.gz. They follow the same rule as results: nobody but the league office can read a file before its
-- match kicks off, enforced here by the database. Only the office writes them (Simulate in the Editor).
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('matches', 'matches', false, 10485760, array['application/gzip', 'application/x-gzip', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 10485760;

create or replace function public.match_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_office() or exists (
    select 1 from public.fixtures f
    where f.id = regexp_replace(p_name, '\.json\.gz$', '')
      and f.starts_at is not null and f.starts_at <= now() and not f.postponed);
$$;
revoke all on function public.match_file_readable(text) from public;
grant execute on function public.match_file_readable(text) to anon, authenticated;

drop policy if exists matches_read on storage.objects;
create policy matches_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'matches' and public.match_file_readable(name));

drop policy if exists matches_insert on storage.objects;
create policy matches_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'matches' and public.is_office());

drop policy if exists matches_update on storage.objects;
create policy matches_update on storage.objects for update to authenticated
  using (bucket_id = 'matches' and public.is_office());

drop policy if exists matches_delete on storage.objects;
create policy matches_delete on storage.objects for delete to authenticated
  using (bucket_id = 'matches' and public.is_office());
