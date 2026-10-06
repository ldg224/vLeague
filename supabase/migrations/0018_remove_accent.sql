-- 0.17: a club's primary colour is the colour of its whole page, so the separate "accent" (the colour lifted until it read
-- on navy) is gone. Drops clubs.accent and stops the three functions that wrote or copied it. Colour, colour2, the motto, the
-- manager name and the stadium are unchanged. Older news and registration snapshots may still carry an "accent" key; nothing
-- reads it. Safe to re-run.

create or replace function public.update_club_style(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c text := public.require_my_club(); k text;
begin
  foreach k in array array['colour', 'colour2'] loop
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
    motto        = case when p ? 'motto'        then public.clean(p ->> 'motto')          else motto end,
    manager_name = case when p ? 'manager_name' then public.clean(p ->> 'manager_name')   else manager_name end,
    stadium      = case when p ? 'stadium'      then public.clean(p ->> 'stadium')        else stadium end
  where code = c;
end $$;

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
                               'motto', cl.motto, 'name', cl.name, 'code', cl.code));
  end if;
end $$;

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
  v_snap  jsonb;
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

  -- A full copy of what was submitted, kept for the office: the form as typed plus the club's colours and details as
  -- they stood when it was sent (the wizard saves those first). Unlike the columns below, nothing is trimmed.
  v_snap := jsonb_strip_nulls(jsonb_build_object(
    'name', v_name, 'short_name', v_short, 'code', v_code, 'crest_path', v_crest, 'notes', v_notes,
    'colour', cur.colour, 'colour2', cur.colour2, 'manager_name', cur.manager_name,
    'stadium', cur.stadium, 'motto', cur.motto, 'email', (select email from auth.users where id = auth.uid())));

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
  insert into public.club_requests (club, kind, name, short_name, code, crest_path, notes, submitted_by, snapshot)
  values (c, v_kind, v_name, v_short, v_code, v_crest, v_notes, auth.uid(), v_snap)
  returning id into v_id;

  if cur.setup_at is null then update public.clubs set setup_at = now() where code = c; end if;
  return v_id;
end $$;

alter table public.clubs drop column if exists accent;
