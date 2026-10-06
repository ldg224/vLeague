-- 0.19.0: news posts can carry a picture, an accent colour and a button (all in news.data), and can be emailed to managers.
-- Pictures live in a public `news` storage bucket that only the office can write to. Safe to re-run.

insert into storage.buckets (id, name, public) values ('news', 'news', true) on conflict (id) do nothing;

drop policy if exists news_files_insert on storage.objects;
create policy news_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'news' and public.is_office());
drop policy if exists news_files_update on storage.objects;
create policy news_files_update on storage.objects for update to authenticated
  using (bucket_id = 'news' and public.is_office());
drop policy if exists news_files_delete on storage.objects;
create policy news_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'news' and public.is_office());

-- When a post was emailed, and to how many managers. A post is emailed once; the send-news function checks.
alter table public.news add column if not exists emailed_at    timestamptz;
alter table public.news add column if not exists emailed_count integer;

-- "League news" is an email setting like the others: on unless the manager turns it off (Settings, or the link in the email).
create or replace function public.email_pref(p jsonb, k text) returns text
language sql immutable as $$
  select coalesce(p #>> array['email', k],
    case k when 'deadline' then '24h' when 'sent_back' then 'true' when 'office_digest' then 'true' when 'news' then 'true' else 'false' end)
$$;

-- Who a post is emailed to: managers (accounts with a club) in its audience who haven't turned news emails off.
-- Only the send-news function (service role) can call this; nobody else gets to list email addresses.
create or replace function public.news_recipients(p_id bigint)
returns table (user_id uuid, email text, name text, club text)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.email, a.name, a.club
  from public.news n
  join public.mail_accounts a on a.club is not null
  where n.id = p_id and n.kind = 'post'
    and (n.audience is null or a.club = any (n.audience))
    and public.email_pref(a.prefs, 'news') = 'true'
$$;
revoke all on function public.news_recipients(bigint) from public, anon, authenticated;
grant execute on function public.news_recipients(bigint) to service_role;
