-- EU-02: "[club] join vLeague" is posted only the first time a club's setup is approved. When the office presses
-- "Set up again" and approves a later setup, a new crest still gets the "reveal a new crest" news; otherwise nothing
-- is posted. Only review_club_request changes. Safe to re-run.

create or replace function public.review_club_request(p_id bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.club_requests; cl public.clubs; v_note text := public.clean(p_note); v_title text;
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

  -- "Join" only if this club has never been approved before this request; a new crest is announced either way.
  if r.kind = 'setup' and not exists (
       select 1 from public.club_requests
       where club in (r.club, cl.code) and status = 'approved' and id <> p_id and kind = 'setup') then
    v_title := cl.name || ' join vLeague';
  elsif r.crest_path is not null then
    v_title := cl.name || ' reveal a new crest';
  end if;

  if v_title is not null then
    insert into public.news (kind, club, title, data)
    values ('crest_reveal', cl.code, v_title,
            jsonb_build_object('crest_path', cl.crest_path, 'colour', cl.colour, 'colour2', cl.colour2,
                               'motto', cl.motto, 'name', cl.name, 'code', cl.code));
  end if;
end $$;
