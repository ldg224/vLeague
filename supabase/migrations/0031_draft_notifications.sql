-- 0.29: draft notifications and live updates. Needs 0029.
--   "You're on the clock" and "your time is nearly up" emails for the draft, through the same reminder system as everything
--   else (due_emails, logged so each is sent once, one-click unsubscribe). Setting email.draft: 'both' (default), 'turn', 'off'.
--   The draft board updates the moment a pick is made (Supabase realtime on drafts and draft_picks).

create or replace function public.email_pref(p jsonb, k text) returns text
language sql immutable as $$
  select coalesce(p #>> array['email', k],
    case k when 'deadline' then '24h' when 'sent_back' then 'true' when 'office_digest' then 'true' when 'draft' then 'both' else 'false' end)
$$;

-- One row per email to send now (as 0006, plus the draft emails): (user_id, email, name, kind, key, data). Only the Edge Function calls this.
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
  -- Draft emails (0.29): to the manager whose pick is on the clock. Never in the draft's quiet time, never 10 pm to 8 am Melbourne.
  live_drafts as (
    select d.*, o.club as on_club from public.drafts d
    join public.draft_order o on o.draft = d.id and o.pick_no = d.current_pick
    where d.status = 'live' and d.pick_deadline is not null
      and (d.opens_at is null or now() >= d.opens_at) and (d.closes_at is null or now() <= d.closes_at)
      and public._quiet_end(now(), d.quiet) is null
      and extract(hour from now() at time zone 'Australia/Melbourne') between 8 and 21
  ),
  draft_on as (
    select a.user_id, a.email, a.name, d.id || '-' || d.current_pick as key, a.prefs,
           jsonb_build_object('draft', d.name, 'pick', d.current_pick, 'of', (select count(*) from public.draft_order x where x.draft = d.id),
             'deadline', d.pick_deadline, 'minutes', d.pick_minutes, 'timeout', d.on_timeout,
             'left_min', round(public._draft_active_seconds(now(), d.pick_deadline, d.quiet) / 60.0),
             'queued', (select count(*) from public.draft_queue q join public.players pl on pl.id = q.player and pl.club is null where q.draft = d.id and q.club = a.club)) as data
    from live_drafts d join public.mail_accounts a on a.club = d.on_club
    -- a club on "the moment it's my turn" picks itself straight away, so there's nothing to tell it
    where coalesce((select p.mode from public.draft_prefs p where p.draft = d.id and p.club = a.club), 'on_miss') <> 'always'
  ),
  draft_turn as (
    select user_id, email, name, 'draft_turn'::text as kind, key, data from draft_on
    where public.email_pref(prefs, 'draft') in ('both', 'turn')
  ),
  draft_warn as (
    select o.user_id, o.email, o.name, 'draft_warn'::text as kind, o.key, o.data from draft_on o
    where public.email_pref(o.prefs, 'draft') = 'both' and (o.data->>'minutes')::int >= 180 and (o.data->>'left_min')::int <= 120
  ),
  everything as (
    select * from reminders union all select * from sent_back union all select * from lineups
    union all select * from weekly union all select * from office
    union all select * from draft_turn union all select * from draft_warn
  )
  select e.* from everything e
  where not exists (select 1 from public.email_log l where l.user_id = e.user_id and l.kind = e.kind and l.key = e.key)
$$;
revoke all on function public.due_emails() from public, anon, authenticated;

-- Live updates: let the page hear about picks as they happen. (Row security still decides who can read; both tables are readable.)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.draft_picks; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.drafts; exception when duplicate_object then null; end;
  end if;
end $$;
