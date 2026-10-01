-- 0.7: Settings and email reminders.
-- user_settings holds what follows a manager across devices (accent, spoiler-free results and the matches they've
-- revealed, clock, start page, email choices). How the app looks on one screen (text size, motion) stays in that
-- browser. Emails are only sent when they're useful: a deadline reminder only if the club hasn't saved its team
-- since the last week locked, at most once per reminder (email_log), never between 10 pm and 8 am Melbourne time,
-- and every email has a one-click unsubscribe. The Edge Function send-reminders sends what due_emails() returns;
-- pg_cron calls it every 5 minutes with a secret kept in Supabase Vault (name 'vleague_cron_secret'), not here.

-- ---------------------------------------------------------------- settings that follow the account

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_settings to authenticated;
drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- A manager's display name (profiles stays office-only to write).
create or replace function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := public.clean(p_name);
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if n is null or char_length(n) < 2 or char_length(n) > 40 then raise exception 'Use 2 to 40 characters for your name.'; end if;
  update public.profiles set display_name = n where id = auth.uid();
end $$;
revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- ---------------------------------------------------------------- what was sent (so nothing is sent twice)

create table if not exists public.email_log (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null,
  key     text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
alter table public.email_log enable row level security;
drop policy if exists email_log_office on public.email_log;
create policy email_log_office on public.email_log for select to authenticated using (public.is_office());

-- ---------------------------------------------------------------- which emails are due now

-- An email setting, with its default. Email kinds: deadline ('24h' | '3h' | 'both' | 'off'), sent_back,
-- lineups_out, weekly, office_digest (booleans).
create or replace function public.email_pref(p jsonb, k text) returns text
language sql immutable as $$
  select coalesce(p #>> array['email', k],
    case k when 'deadline' then '24h' when 'sent_back' then 'true' when 'office_digest' then 'true' else 'false' end)
$$;

-- When a reminder `lead` before `at` should go: that moment, or 9:30 pm the evening before if it falls in quiet
-- hours (10 pm to 8 am, Melbourne).
create or replace function public.send_at(at timestamptz, lead interval) returns timestamptz
language sql immutable as $$
  select case
    when extract(hour from l) >= 22 then (date_trunc('day', l) + interval '21 hours 30 minutes') at time zone 'Australia/Melbourne'
    when extract(hour from l) < 8 then (date_trunc('day', l) - interval '2 hours 30 minutes') at time zone 'Australia/Melbourne'
    else at - lead end
  from (select (at - lead) at time zone 'Australia/Melbourne' as l) x
$$;

-- Accounts that can get email: signed in at least once, with a confirmed address.
create or replace view public.mail_accounts with (security_invoker = true) as
  select u.id as user_id, u.email, p.role, p.club, coalesce(s.prefs, '{}'::jsonb) as prefs,
         coalesce(p.display_name, split_part(u.email, '@', 1)) as name
  from auth.users u
  join public.profiles p on p.id = u.id
  left join public.user_settings s on s.user_id = u.id
  where u.email is not null and u.email_confirmed_at is not null and u.last_sign_in_at is not null;
revoke all on public.mail_accounts from public, anon, authenticated;

-- One row per email to send now: (user_id, email, name, kind, key, data). Only the Edge Function calls this.
create or replace function public.due_emails() returns table (user_id uuid, email text, name text, kind text, key text, data jsonb)
language sql stable security definer set search_path = public as $$
  with
  -- the last time any week locked: a team saved after this counts as "picked" for the next deadline
  last_lock as (select coalesce(max(locked_at), '-infinity'::timestamptz) as at from public.deadlines where locked_at is not null),
  saved as (select club, max(saved_at) as at from public.team_sheet_versions group by club),
  open_deadlines as (select * from public.deadlines where locked_at is null and locks_at > now()),
  -- clubs that haven't saved a team since the last lock
  unpicked as (select c.code from public.clubs c left join saved s on s.club = c.code, last_lock
               where c.status <> 'withdrawn' and (s.at is null or s.at <= last_lock.at)),
  reminders as (
    select a.user_id, a.email, a.name, 'deadline'::text as kind, d.week || '-' || lead.label as key,
           jsonb_build_object('week', d.week, 'locks_at', d.locks_at, 'club', a.club) as data
    from public.mail_accounts a
    join unpicked u on u.code = a.club
    cross join open_deadlines d
    cross join (values ('24h', interval '24 hours'), ('3h', interval '3 hours')) as lead(label, gap)
    where public.email_pref(a.prefs, 'deadline') in (lead.label, 'both')
      and now() >= public.send_at(d.locks_at, lead.gap)
  ),
  sent_back as (
    select a.user_id, a.email, a.name, 'sent_back', r.id::text,
           jsonb_build_object('note', r.office_note, 'club', r.club)
    from public.club_requests r
    join public.mail_accounts a on a.club = r.club
    where r.status = 'returned' and r.reviewed_at > now() - interval '2 days'
      and public.email_pref(a.prefs, 'sent_back') = 'true'
  ),
  lineups as (
    select a.user_id, a.email, a.name, 'lineups_out', d.week::text,
           jsonb_build_object('week', d.week, 'club', a.club)
    from public.deadlines d
    join public.mail_accounts a on a.club is not null
    where d.locked_at > now() - interval '3 hours' and public.email_pref(a.prefs, 'lineups_out') = 'true'
      and extract(hour from now() at time zone 'Australia/Melbourne') between 8 and 21
  ),
  weekly as (
    select a.user_id, a.email, a.name, 'weekly', to_char(now() at time zone 'Australia/Melbourne', 'IYYY-IW'),
           jsonb_build_object('club', a.club)
    from public.mail_accounts a
    where public.email_pref(a.prefs, 'weekly') = 'true'
      and extract(isodow from now() at time zone 'Australia/Melbourne') = 1
      and extract(hour from now() at time zone 'Australia/Melbourne') >= 9
  ),
  office as (
    select a.user_id, a.email, a.name, 'office_digest', d.week::text,
           jsonb_build_object('week', d.week, 'locks_at', d.locks_at,
             'clubs', (select jsonb_agg(c.name order by c.name) from public.clubs c join unpicked u on u.code = c.code))
    from public.mail_accounts a
    cross join open_deadlines d
    where a.role = 'office' and public.email_pref(a.prefs, 'office_digest') = 'true'
      and now() >= public.send_at(d.locks_at, interval '24 hours')
      and exists (select 1 from unpicked)
  ),
  everything as (
    select * from reminders union all select * from sent_back union all select * from lineups
    union all select * from weekly union all select * from office
  )
  select e.* from everything e
  where not exists (select 1 from public.email_log l where l.user_id = e.user_id and l.kind = e.kind and l.key = e.key)
$$;
revoke all on function public.due_emails() from public, anon, authenticated;

-- ---------------------------------------------------------------- every 5 minutes

create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'vleague-send-reminders';
select cron.schedule('vleague-send-reminders', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://ywkhjpfzqtfssbxbvnbl.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'vleague_cron_secret')),
    body := '{"run":true}'::jsonb,
    timeout_milliseconds := 30000)
  where exists (select 1 from vault.decrypted_secrets where name = 'vleague_cron_secret');
$job$);
