-- Submit or it's random (the user's decision, 3 Nov 2026; replaces the 10 Oct 2026 rule that a round without a submitted sheet used the
-- club's latest saved draft). When a round locks, a club that plays in it and has not SUBMITTED a team sheet for it gets a random XI:
-- a fixed 4-4-2, each slot a random player of the right position from its squad (anyone left over if a position runs short), the rest of
-- the squad on the bench in random order, a random captain and random set-piece takers, middle tactics and the automatic kit.
-- The random sheet is stored in week_sheets with random = true, so the match, the line-up card and the win chance all use the same team.
-- Clubs with a bye get no row. Also: deadline reminders and the office digest now go to clubs that haven't submitted for that round
-- (before, saving any draft since the last lock counted as "picked"). Safe to re-run. Needs 0005, 0006, 0042, 0048.

alter table public.week_sheets add column if not exists random boolean not null default false;

-- A random team sheet for a club, in the same shape as a saved sheet (team_sheet_versions.sheet / submitted_sheets.sheet).
create or replace function public.random_week_sheet(p_club text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  slots text[] := array['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LST', 'RST'];
  wants text[] := array['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'];
  lineup jsonb := '{}'; used text[] := '{}'; outfield text[]; pid text; i int;
begin
  for i in 1 .. array_length(slots, 1) loop
    select p.id into pid from public.players p
     where p.club = p_club and p.position = wants[i] and not (p.id = any (used)) order by random() limit 1;
    if pid is null then   -- not enough of that position: anyone left (outfield first for an outfield slot)
      select p.id into pid from public.players p where p.club = p_club and not (p.id = any (used))
       order by (wants[i] <> 'GK' and p.position = 'GK'), random() limit 1;
    end if;
    exit when pid is null;   -- squad smaller than eleven: the slots left stay empty
    lineup := lineup || jsonb_build_object(slots[i], pid);
    used := used || pid;
  end loop;
  if used = '{}' then return null; end if;
  select array_agg(p.id order by random()) into outfield from public.players p where p.id = any (used) and p.position <> 'GK';
  if outfield is null then outfield := used; end if;
  return jsonb_build_object(
    'formation', '4-4-2',
    'lineup', lineup,
    'bench', coalesce((select jsonb_agg(p.id order by random()) from public.players p where p.club = p_club and not (p.id = any (used))), '[]'),
    'captain', used[1 + floor(random() * array_length(used, 1))::int],
    'penalties', outfield[1 + floor(random() * array_length(outfield, 1))::int],
    'freekicks', outfield[1 + floor(random() * array_length(outfield, 1))::int],
    'corners', outfield[1 + floor(random() * array_length(outfield, 1))::int],
    'tactics', jsonb_build_object('tempo', 0.5, 'width', 0.5, 'pressing', 0.5, 'directness', 0.5, 'line_height', 0.5));
end $$;
revoke all on function public.random_week_sheet(text) from public, anon, authenticated;

-- Locking a round: a club's submitted sheet for it wins; every other club that plays in it gets a random XI.
create or replace function public.lock_due_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select * from public.deadlines where locked_at is null and locks_at <= now() order by week for update loop
    insert into public.week_sheets (week, club, formation, tactics, lineup, bench, captain, penalties, freekicks, corners, kit, saved_at, submitted, random)
    select d.week, v.club, v.sheet->>'formation', coalesce(v.sheet->'tactics', '{}'), coalesce(v.sheet->'lineup', '{}'),
           coalesce(v.sheet->'bench', '[]'), v.sheet->>'captain', v.sheet->>'penalties', v.sheet->>'freekicks',
           v.sheet->>'corners', nullif(v.sheet->>'kit', ''), v.saved_at, v.submitted, not v.submitted
    from (
      select s.club, s.sheet, s.submitted_at as saved_at, true as submitted
      from public.submitted_sheets s where s.week = d.week and s.submitted_at <= d.locks_at
      union all
      select c.code, public.random_week_sheet(c.code), d.locks_at, false
      from public.clubs c
      where exists (select 1 from public.fixtures f where f.week = d.week and c.code in (f.home, f.away) and not coalesce(f.postponed, false))
        and not exists (select 1 from public.submitted_sheets s where s.week = d.week and s.club = c.code and s.submitted_at <= d.locks_at)
        and exists (select 1 from public.players p where p.club = c.code)
    ) v
    on conflict (week, club) do nothing;
    update public.deadlines set locked_at = now() where week = d.week;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Reminders: as 0042, except "unpicked" is now per round: a club that plays in the round and hasn't submitted a sheet for it.
CREATE OR REPLACE FUNCTION public.due_emails()
 RETURNS TABLE(user_id uuid, email text, name text, kind text, key text, data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  open_deadlines as (select * from public.deadlines where locked_at is null and locks_at > now()),
  -- clubs that play in an open round and haven't submitted a team sheet for it (they'll get a random XI)
  unpicked as (select c.code, d.week from public.clubs c cross join open_deadlines d
               where c.status <> 'withdrawn'
                 and exists (select 1 from public.fixtures f where f.week = d.week and c.code in (f.home, f.away) and not coalesce(f.postponed, false))
                 and not exists (select 1 from public.submitted_sheets s where s.club = c.code and s.week = d.week)),
  reminders as (
    select a.user_id, a.email, a.name, 'deadline'::text as kind, d.week || '-' || lead.label as key,
           jsonb_build_object('week', d.week, 'locks_at', d.locks_at, 'club', a.club) as data
    from public.mail_accounts a
    cross join open_deadlines d
    join unpicked u on u.code = a.club and u.week = d.week
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
             'clubs', (select jsonb_agg(c.name order by c.name) from public.clubs c join unpicked u on u.code = c.code and u.week = d.week))
    from public.mail_accounts a
    cross join open_deadlines d
    where a.role = 'office' and public.email_pref(a.prefs, 'office_digest') = 'true'
      and now() >= public.send_at(d.locks_at, interval '24 hours')
      and exists (select 1 from unpicked u where u.week = d.week)
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
    select a.user_id, a.email, a.name, d.id || '-' || d.current_pick || '-' || coalesce(extract(epoch from d.pick_started)::bigint, 0) as key, a.prefs,
           jsonb_build_object('draft', d.name, 'pick', d.current_pick, 'of', (select count(*) from public.draft_order x where x.draft = d.id),
             'deadline', d.pick_deadline, 'minutes', d.pick_minutes, 'timeout', d.on_timeout,
             'left_min', round(public._draft_active_seconds(now(), d.pick_deadline, d.quiet) / 60.0),
             'queued', (select count(*) from public.draft_queue q join public.players pl on pl.id = q.player and pl.club is null where q.draft = d.id and q.club = a.club),
             'auto_after', d.auto_after_minutes,
             'mode', coalesce((select p.mode from public.draft_prefs p where p.draft = d.id and p.club = a.club), 'on_miss'),
             'how', coalesce((select p.pick_how from public.draft_prefs p where p.draft = d.id and p.club = a.club), 'queue'),
             'mins', (select p.minutes from public.draft_prefs p where p.draft = d.id and p.club = a.club)) as data
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
$function$;
revoke all on function public.due_emails() from public, anon, authenticated;
