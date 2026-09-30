-- vLeague 0.4.0: "Set up your club". A manager's first sign-in goes through a wizard (setup.html). Colours, accent,
-- motto, manager name and stadium save straight away; name, short name, code and crest go to the league office as a
-- request, which the office approves (applied to clubs, crest reveal posted to news) or sends back with a note.
-- Managers never write clubs or club_requests directly: only through the security definer functions below, which
-- check everything. Safe to re-run.

-- ---------------------------------------------------------------- clubs: has the manager done the wizard?

-- Every manager (the office's own club too) sees the wizard once: while setup_at is null. Submitting it sets
-- setup_at, and it isn't shown again until the office switches it back on (reopen_club_setup), which starts the
-- process again from a fresh setup request.
alter table public.clubs add column if not exists setup_at timestamptz;        -- null = the wizard is due
alter table public.clubs add column if not exists setup_reset_at timestamptz;  -- when the office last switched it back on

-- ---------------------------------------------------------------- requests to the league office

create table if not exists public.club_requests (
  id           bigint generated always as identity primary key,
  club         text not null references public.clubs (code) on update cascade on delete cascade,
  kind         text not null check (kind in ('setup', 'change')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  name         text,            -- null = no change asked for
  short_name   text,
  code         text,
  crest_path   text,
  notes        text check (notes is null or char_length(notes) <= 500),        -- from the manager to the office
  office_note  text check (office_note is null or char_length(office_note) <= 500),
  submitted_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users (id) on delete set null
);
create index if not exists club_requests_club on public.club_requests (club, created_at desc);
-- At most one pending request per club.
create unique index if not exists club_requests_one_pending on public.club_requests (club) where status = 'pending';

alter table public.club_requests enable row level security;
drop policy if exists club_requests_read on public.club_requests;
create policy club_requests_read on public.club_requests for select to authenticated
  using (club = public.my_club() or public.is_office());
revoke all on public.club_requests from anon;

-- ---------------------------------------------------------------- news (public)

-- League news. For now only the crest reveal written when the office approves a club; the full news system
-- (audiences, the composer, reactions) arrives in 0.7.
create table if not exists public.news (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('crest_reveal', 'post')),
  club       text references public.clubs (code) on update cascade on delete set null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists news_created on public.news (created_at desc);

alter table public.news enable row level security;
drop policy if exists news_read on public.news;
create policy news_read on public.news for select to anon, authenticated using (true);
drop policy if exists news_office_write on public.news;
create policy news_office_write on public.news for all to authenticated using (public.is_office()) with check (public.is_office());

-- ---------------------------------------------------------------- helpers

-- The caller's club, or a readable error.
create or replace function public.require_my_club() returns text
language plpgsql stable security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  c := public.my_club();
  if c is null then raise exception 'Your account isn’t linked to a club yet.'; end if;
  return c;
end $$;

-- Is a 3-letter code free for the caller's club? (Its own current code counts as free, and so does a code
-- another club has only asked for, until the office approves it.)
create or replace function public.code_available(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select upper(coalesce(p_code, '')) ~ '^[A-Z]{3}$'
     and not exists (select 1 from public.clubs where code = upper(p_code) and code is distinct from public.my_club())
     and not exists (select 1 from public.club_requests where status = 'pending' and code = upper(p_code)
                                                          and club is distinct from public.my_club());
$$;

-- '' -> null, and trimmed.
create or replace function public.clean(v text) returns text language sql immutable as $$
  select nullif(btrim(coalesce(v, '')), '');
$$;

-- ---------------------------------------------------------------- manager: instant changes

-- Colours, accent, motto, manager name and stadium. Only the keys present in p change.
create or replace function public.update_club_style(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.require_my_club(); k text;
begin
  foreach k in array array['colour', 'colour2', 'accent'] loop
    if p ? k and public.clean(p ->> k) is not null and public.clean(p ->> k) !~* '^#[0-9a-f]{6}$' then
      raise exception 'Colours must look like #1e88e5.';
    end if;
  end loop;
  if char_length(public.clean(p ->> 'motto')) > 80 then raise exception 'The motto can be up to 80 characters.'; end if;
  if char_length(public.clean(p ->> 'manager_name')) > 40 then raise exception 'The manager name can be up to 40 characters.'; end if;
  if char_length(public.clean(p ->> 'stadium')) > 40 then raise exception 'The stadium name can be up to 40 characters.'; end if;

  update public.clubs set
    colour       = case when p ? 'colour'       then lower(public.clean(p ->> 'colour'))  else colour end,
    colour2      = case when p ? 'colour2'      then lower(public.clean(p ->> 'colour2')) else colour2 end,
    accent       = case when p ? 'accent'       then lower(public.clean(p ->> 'accent'))  else accent end,
    motto        = case when p ? 'motto'        then public.clean(p ->> 'motto')          else motto end,
    manager_name = case when p ? 'manager_name' then public.clean(p ->> 'manager_name')   else manager_name end,
    stadium      = case when p ? 'stadium'      then public.clean(p ->> 'stadium')        else stadium end
  where code = c;
end $$;

-- ---------------------------------------------------------------- manager: changes the office approves

-- Name, short name, code and crest (and notes for the office). Replaces the club's pending request. The first one
-- is the 'setup' request and marks the wizard done; later ones are 'change' requests holding only what differs.
-- Returns the request id, or null when nothing differs from the club as it is.
create or replace function public.submit_club_request(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c    text := public.require_my_club();
  cur  public.clubs;
  v_name  text := public.clean(p ->> 'name');
  v_short text := public.clean(p ->> 'short_name');
  v_code  text := upper(public.clean(p ->> 'code'));
  v_crest text := public.clean(p ->> 'crest_path');
  v_notes text := public.clean(p ->> 'notes');
  v_kind  text;
  v_id    bigint;
begin
  select * into cur from public.clubs where code = c;
  -- 'setup' until the office has approved one in this round (so a sent-back setup that's fixed and resent is still
  -- a setup); a round starts again when the office switches the wizard back on.
  v_kind := case when exists (select 1 from public.club_requests where club = c and kind = 'setup' and status = 'approved'
                                and created_at > coalesce(cur.setup_reset_at, '-infinity'))
                 then 'change' else 'setup' end;

  if v_name is not null and char_length(v_name) not between 2 and 25 then
    raise exception 'The club name needs 2 to 25 characters.';
  end if;
  if v_short is not null and char_length(v_short) > 12 then raise exception 'The short name can be up to 12 characters.'; end if;
  if v_code is not null and v_code !~ '^[A-Z]{3}$' then raise exception 'The code is 3 letters, like TUR.'; end if;
  if v_code is not null and not public.code_available(v_code) then raise exception 'That code is taken.'; end if;
  if v_crest is not null and (v_crest not like lower(c) || '/%' or v_crest ~ '\.\.') then
    raise exception 'That crest isn’t in your club’s folder.';
  end if;
  if char_length(v_notes) > 500 then raise exception 'Notes can be up to 500 characters.'; end if;
  if v_kind = 'setup' and coalesce(v_name, cur.name) is null then raise exception 'Give your club a name.'; end if;

  -- A change request keeps only what differs from the club as it is.
  if v_kind = 'change' then
    if v_name  = cur.name       then v_name  := null; end if;
    if v_short is not distinct from cur.short_name then v_short := null; end if;
    if v_code  = cur.code       then v_code  := null; end if;
    if v_crest is not distinct from cur.crest_path then v_crest := null; end if;
    if v_name is null and v_short is null and v_code is null and v_crest is null then
      delete from public.club_requests where club = c and status = 'pending';
      return null;
    end if;
  end if;

  delete from public.club_requests where club = c and status = 'pending';
  insert into public.club_requests (club, kind, name, short_name, code, crest_path, notes, submitted_by)
  values (c, v_kind, v_name, v_short, v_code, v_crest, v_notes, auth.uid())
  returning id into v_id;

  if cur.setup_at is null then update public.clubs set setup_at = now() where code = c; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- office: approve or send back

create or replace function public.review_club_request(p_id bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.club_requests; cl public.clubs; v_note text := public.clean(p_note);
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  select * into r from public.club_requests where id = p_id for update;
  if r.id is null then raise exception 'That request no longer exists.'; end if;
  if r.status <> 'pending' then raise exception 'That request has already been dealt with.'; end if;

  if not p_approve then
    if v_note is null then raise exception 'Say what needs changing, so the manager knows.'; end if;
    update public.club_requests set status = 'returned', office_note = v_note, reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_id;
    return;
  end if;

  if r.code is not null and exists (select 1 from public.clubs where code = r.code and code <> r.club) then
    raise exception 'Another club has the code % now. Send it back so the manager picks another.', r.code;
  end if;

  update public.clubs set
    name       = coalesce(r.name, name),
    short_name = coalesce(r.short_name, short_name),
    crest_path = coalesce(r.crest_path, crest_path),
    status     = case when status = 'pending' then 'active' else status end,
    code       = coalesce(r.code, code)          -- cascades to profiles, team sheets, requests, news
  where code = r.club
  returning * into cl;

  update public.club_requests set status = 'approved', office_note = v_note, reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_id;

  if r.crest_path is not null or r.kind = 'setup' then
    insert into public.news (kind, club, title, data)
    values ('crest_reveal', cl.code,
            case when r.kind = 'setup' then cl.name || ' join vLeague' else cl.name || ' reveal a new crest' end,
            jsonb_build_object('crest_path', cl.crest_path, 'colour', cl.colour, 'colour2', cl.colour2,
                               'accent', cl.accent, 'motto', cl.motto, 'name', cl.name, 'code', cl.code));
  end if;
end $$;

-- Switch "Set up your club" back on for a club: its manager sees the wizard at their next sign-in, and the process
-- starts again (a pending request is dropped).
create or replace function public.reopen_club_setup(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  update public.clubs set setup_at = null, setup_reset_at = now() where code = p_code;
  if not found then raise exception 'That club no longer exists.'; end if;
  delete from public.club_requests where club = p_code and status = 'pending';
end $$;

-- ---------------------------------------------------------------- office: accounts

-- Every account with its email and sign-in state, for the Editor's Managers list. Office only.
create or replace function public.office_accounts()
returns table (id uuid, email text, role text, club text, display_name text,
               invited_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office() then raise exception 'Only the league office can do that.'; end if;
  return query
    select u.id, u.email::text, p.role, p.club, p.display_name, u.invited_at, u.confirmed_at, u.last_sign_in_at
    from auth.users u join public.profiles p on p.id = u.id
    order by p.club nulls last, u.email;
end $$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function public.update_club_style(jsonb), public.submit_club_request(jsonb),
  public.review_club_request(bigint, boolean, text), public.office_accounts(), public.code_available(text),
  public.reopen_club_setup(text), public.require_my_club() from public, anon;
grant execute on function public.update_club_style(jsonb), public.submit_club_request(jsonb),
  public.review_club_request(bigint, boolean, text), public.office_accounts(), public.code_available(text),
  public.reopen_club_setup(text) to authenticated;
