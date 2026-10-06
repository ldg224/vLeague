-- 0.15: every registration submission keeps a full copy of what was sent: the form as typed, and the club's colours,
-- manager name, stadium and motto as they stood at that moment (the Editor's Clubs tab shows them). The ordinary columns
-- still hold only what the office approves; a change request still trims what didn't change. Older submissions have no
-- snapshot. Safe to re-run.

alter table public.club_requests add column if not exists snapshot jsonb;

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
    'colour', cur.colour, 'colour2', cur.colour2, 'accent', cur.accent, 'manager_name', cur.manager_name,
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
