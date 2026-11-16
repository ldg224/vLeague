-- The Office: new squad rules and a move queue (16 Nov 2026, the league's poll and the office's call). Safe to re-run. Needs 0091 and 0092.
--
-- Squad rules (replace the draft's per-position limits):
--   at least office_settings.pos_min of each position (GK 1, DEF 4, MID 3, FWD 3), no maximum for any position, office_settings.squad_max players at most (16)
--   and squad_min at least (15: a club may still be one under 16 after a release). A move that does not make a club worse on a rule is allowed even if the
--   club already breaks it (only possible through office edits).
-- Queue: managers can make moves while the transfer window is not open. A release or signing made then, or a trade accepted then, waits in office_queue
--   and goes through the moment the window opens, in the order the moves were made, each checked again then (cap and over-cap limit, squad rules, the
--   players still where they were, the release limit). One that no longer works is marked 'failed' with the reason. Offers can be sent, countered and
--   accepted at any time (no longer only while the window is open); they no longer expire when the window closes, only when left unanswered 21 days.
--   The queue runs: when the office opens the window (office_save_settings), every minute (the vleague-office-queue job: a window opening at its set
--   time, or a round finishing), and whenever someone opens the Office (office_state). Nothing moves while a draft is running.
--
--   office_queue                    club, kind (release/sign/trade), player or offer, status (queued/done/failed/cancelled), note, move
--   office_queue_cancel(id)         a queued move's club (either club for a trade) takes it back
--   office_process_queue()          runs the queue if the window is open (anyone signed in may call it; it only does what the rules allow)

-- ---------------------------------------------------------------- settings and tables

alter table public.office_settings add column if not exists pos_min jsonb not null default '{"GK": 1, "DEF": 4, "MID": 3, "FWD": 3}'::jsonb;
alter table public.office_settings add column if not exists squad_max int not null default 16;
alter table public.office_settings add column if not exists squad_min int not null default 15;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_settings_squad_range') then
    alter table public.office_settings add constraint office_settings_squad_range check (squad_min between 11 and 40 and squad_max between squad_min and 40);
  end if;
end $$;

alter table public.office_offers drop constraint if exists office_offers_status_check;
alter table public.office_offers add constraint office_offers_status_check
  check (status in ('pending', 'queued', 'accepted', 'rejected', 'withdrawn', 'countered', 'expired', 'void'));

create table if not exists public.office_queue (
  id           bigserial primary key,
  club         text not null references public.clubs(code) on update cascade,   -- the club that made the move (a trade: the club that accepted)
  other_club   text references public.clubs(code) on update cascade,            -- a trade's other club
  kind         text not null check (kind in ('release', 'sign', 'trade')),
  player       text,                                                             -- release / sign
  offer_id     bigint references public.office_offers(id),                       -- trade
  status       text not null default 'queued' check (status in ('queued', 'done', 'failed', 'cancelled')),
  note         text,
  move_id      bigint,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists office_queue_waiting on public.office_queue (created_at, id) where status = 'queued';
alter table public.office_queue enable row level security;
drop policy if exists office_queue_read on public.office_queue;
create policy office_queue_read on public.office_queue for select to authenticated
  using (public.is_office() or club = public.my_club() or other_club = public.my_club());
revoke all on public.office_queue from anon, authenticated;
grant select on public.office_queue to authenticated;
revoke all on sequence public.office_queue_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- squad rules

create or replace function public.office_roster() returns table (pos text, mn int, mx int)
language sql stable security definer set search_path = public as $$
  select x.pos, coalesce((s.pos_min ->> x.pos)::int, 0), 99
  from public.office_settings s, (values ('GK'), ('DEF'), ('MID'), ('FWD')) x(pos) where s.id = 1
$$;
revoke all on function public.office_roster() from public, anon, authenticated;

create or replace function public.office_check(p_club text, p_out text[], p_in text[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b0 int; b1 int; t0 int; t1 int; few text;
begin
  b0 := public.office_bill(p_club);
  b1 := b0 - coalesce((select sum(value) from public.players where id = any (p_out)), 0)::int + coalesce((select sum(value) from public.players where id = any (p_in)), 0)::int;
  if b1 > c.cap + c.over_limit and b1 >= b0 then
    raise exception '% would have a wage bill of %, % over the cap of % (the most a club may go over is %; a club past that may only make moves that lower its bill).',
      p_club, to_char(b1, 'FM999,999,990'), to_char(b1 - c.cap, 'FM999,999,990'), to_char(c.cap, 'FM999,999,990'), to_char(c.over_limit, 'FM999,999,990');
  end if;
  select count(*) into t0 from public.players where club = p_club;
  select count(*) into t1 from public.players where (club = p_club and not (id = any (p_out))) or id = any (p_in);
  with now_ as (select position, count(*)::int n from public.players where club = p_club group by position),
       aft as (select position, count(*)::int n from public.players where (club = p_club and not (id = any (p_out))) or id = any (p_in) group by position)
  select string_agg(r.pos || ' (at least ' || r.mn || ')', ', ') into few
  from public.office_roster() r left join now_ a on a.position = r.pos left join aft b on b.position = r.pos
  where coalesce(b.n, 0) < r.mn and coalesce(b.n, 0) < coalesce(a.n, 0);
  if few is not null then raise exception '% would have too few players at %.', p_club, few; end if;
  if t1 > c.squad_max and t1 > t0 then raise exception '% would have % players (% at most).', p_club, t1, c.squad_max; end if;
  if t1 < c.squad_min and t1 < t0 then
    raise exception '% would have only % players (at least %: sign or trade for a player first).', p_club, t1, c.squad_min;
  end if;
end $$;
revoke all on function public.office_check(text, text[], text[]) from public, anon, authenticated;

create or replace function public.office_roster_json(p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'positions', jsonb_object_agg(r.pos, jsonb_build_object('min', r.mn, 'max', null, 'count', (select count(*) from public.players p where p.club = p_club and p.position = r.pos))),
    'short', sum(greatest(0, r.mn - (select count(*) from public.players p where p.club = p_club and p.position = r.pos))),
    'total', (select count(*) from public.players p where p.club = p_club),
    'squad_min', (select squad_min from public.office_settings where id = 1),
    'squad_max', (select squad_max from public.office_settings where id = 1))
  from public.office_roster() r
$$;
revoke all on function public.office_roster_json(text) from public, anon, authenticated;

-- The office's squad check: clubs short of a position's minimum, or outside the squad size.
create or replace function public.office_squad_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_office() then raise exception 'Only the league office can see the squad check.'; end if;
  select coalesce(jsonb_agg(x.j order by x.code), '[]'::jsonb) into res
  from (select c.code, jsonb_build_object('club', c.code, 'name', c.name, 'roster', public.office_roster_json(c.code)) j from public.clubs c where c.status = 'active') x
  where (x.j #>> '{roster,short}')::int > 0
     or (x.j #>> '{roster,total}')::int > (x.j #>> '{roster,squad_max}')::int
     or (x.j #>> '{roster,total}')::int < (x.j #>> '{roster,squad_min}')::int;
  return res;
end $$;
revoke all on function public.office_squad_report() from public, anon;
grant execute on function public.office_squad_report() to authenticated;

-- ---------------------------------------------------------------- the moves themselves (internal: the club and who made it are given)

create or replace function public.office_no_draft() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.drafts where status in ('live', 'paused')) then raise exception 'No moves while a draft is running.'; end if;
end $$;
revoke all on function public.office_no_draft() from public, anon, authenticated;

create or replace function public.office_do_release(p_club text, p_player text, p_by uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); pl public.players; used int; b0 int; mid bigint;
begin
  perform public.office_lock_clubs(array[p_club]);
  select * into pl from public.players where id = p_player for update;
  if not found or pl.club is distinct from p_club then raise exception 'That player is no longer in the squad.'; end if;
  select count(*) into used from public.office_moves
  where club = p_club and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  if used >= c.releases_per_window then raise exception 'All % releases for this window are used.', c.releases_per_window; end if;
  perform public.office_check(p_club, array[p_player], '{}');
  b0 := public.office_bill(p_club);
  update public.players set club = null where id = p_player;
  perform public.office_clean_sheets(p_club, array[p_player]);
  perform public.office_void_offers(array[p_player]);
  insert into public.office_moves (kind, club, players_out, bill_before, bill_after, made_by)
  values ('release', p_club, array[p_player], b0, public.office_bill(p_club), p_by) returning id into mid;
  return mid;
end $$;
revoke all on function public.office_do_release(text, text, uuid) from public, anon, authenticated;

create or replace function public.office_do_sign(p_club text, p_player text, p_by uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare pl public.players; b0 int; mid bigint;
begin
  perform public.office_lock_clubs(array[p_club]);
  select * into pl from public.players where id = p_player for update;
  if not found then raise exception 'No such player.'; end if;
  if pl.club is not null then raise exception 'He is no longer a free agent (he is at %).', pl.club; end if;
  perform public.office_check(p_club, '{}', array[p_player]);
  b0 := public.office_bill(p_club);
  update public.players set club = p_club where id = p_player;
  perform public.office_void_offers(array[p_player]);
  insert into public.office_moves (kind, club, players_in, bill_before, bill_after, made_by)
  values ('sign', p_club, array[p_player], b0, public.office_bill(p_club), p_by) returning id into mid;
  return mid;
end $$;
revoke all on function public.office_do_sign(text, text, uuid) from public, anon, authenticated;

create or replace function public.office_do_trade(p_offer bigint, p_by uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare o public.office_offers; a0 int; b0 int; mid bigint;
begin
  o := public.office_lock_offer(p_offer);
  if o.id is null then raise exception 'No such offer.'; end if;
  if o.status not in ('pending', 'queued') then raise exception 'That offer is no longer open (%).', o.status; end if;
  perform 1 from public.players where id = any (o.give || o.get) order by id for update;
  perform public.office_check_offer(o.from_club, o.to_club, o.give, o.get);
  a0 := public.office_bill(o.from_club); b0 := public.office_bill(o.to_club);
  update public.players set club = o.to_club where id = any (o.give);
  update public.players set club = o.from_club where id = any (o.get);
  perform public.office_clean_sheets(o.from_club, o.give);
  perform public.office_clean_sheets(o.to_club, o.get);
  insert into public.office_moves (kind, club, other_club, players_out, players_in, bill_before, bill_after, other_before, other_after, offer_id, made_by)
  values ('trade', o.from_club, o.to_club, o.give, o.get, a0, public.office_bill(o.from_club), b0, public.office_bill(o.to_club), o.id, p_by) returning id into mid;
  update public.office_offers set status = 'accepted', decided_by = coalesce(decided_by, p_by), decided_at = now(), move_id = mid where id = o.id;
  perform public.office_void_offers(o.give || o.get, o.id);
  return mid;
end $$;
revoke all on function public.office_do_trade(bigint, uuid) from public, anon, authenticated;

-- Offers: only pending ones are voided when a player moves; a queued (accepted) trade is checked again when the queue runs, and fails then.
-- Offers no longer expire with the window: only when left unanswered for 21 days.
create or replace function public.office_tidy() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.office_offers set status = 'expired', note = 'not answered for 21 days', decided_at = now()
  where status = 'pending' and created_at < now() - interval '21 days';
end $$;
revoke all on function public.office_tidy() from public, anon, authenticated;

-- ---------------------------------------------------------------- the queue

create or replace function public.office_process_queue() returns int
language plpgsql security definer set search_path = public as $$
declare q public.office_queue; mid bigint; n int := 0;
begin
  if public.office_window_status() <> 'open' or exists (select 1 from public.drafts where status in ('live', 'paused')) then return 0; end if;
  for q in select * from public.office_queue where status = 'queued' order by created_at, id for update skip locked loop
    begin
      if q.kind = 'release' then mid := public.office_do_release(q.club, q.player, q.created_by);
      elsif q.kind = 'sign' then mid := public.office_do_sign(q.club, q.player, q.created_by);
      else mid := public.office_do_trade(q.offer_id, q.created_by);
      end if;
      update public.office_queue set status = 'done', move_id = mid, processed_at = now() where id = q.id;
      n := n + 1;
    exception when others then
      update public.office_queue set status = 'failed', note = sqlerrm, processed_at = now() where id = q.id;
      if q.kind = 'trade' then
        update public.office_offers set status = 'void', note = sqlerrm, decided_at = now() where id = q.offer_id and status = 'queued';
      end if;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.office_process_queue() from public, anon;
grant execute on function public.office_process_queue() to authenticated;

create or replace function public.office_queue_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); q public.office_queue;
begin
  select * into q from public.office_queue where id = p_id for update;
  if not found or (q.club <> my and q.other_club is distinct from my) then raise exception 'No such move waiting for your club.'; end if;
  if q.status <> 'queued' then raise exception 'That move is no longer waiting (%).', q.status; end if;
  update public.office_queue set status = 'cancelled', note = 'taken back', processed_at = now() where id = q.id;
  if q.kind = 'trade' then
    update public.office_offers set status = 'withdrawn', note = 'taken back before the window opened', decided_by = me, decided_at = now()
    where id = q.offer_id and status = 'queued';
  end if;
end $$;
revoke all on function public.office_queue_cancel(bigint) from public, anon;
grant execute on function public.office_queue_cancel(bigint) to authenticated;

-- ---------------------------------------------------------------- what managers call (now or queued)

-- Returns the move id when it happened now, null when it is waiting for the window.
create or replace function public.office_release(p_player text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); c public.office_settings := public.office_cfg(); waiting int;
begin
  perform public.office_tidy();
  perform public.office_no_draft();
  if public.office_window_status() = 'open' then
    perform public.office_process_queue();   -- earlier moves first
    return public.office_do_release(my, p_player, me);
  end if;
  perform public.office_lock_clubs(array[my]);
  if not exists (select 1 from public.players where id = p_player and club = my) then raise exception 'That player is not in your squad.'; end if;
  if exists (select 1 from public.office_queue where status = 'queued' and kind = 'release' and player = p_player) then
    raise exception 'His release is already waiting for the window.';
  end if;
  select count(*) into waiting from public.office_queue where status = 'queued' and kind = 'release' and club = my;
  if waiting >= c.releases_per_window then raise exception 'You already have % releases waiting (the most for one window).', c.releases_per_window; end if;
  insert into public.office_queue (club, kind, player, created_by) values (my, 'release', p_player, me);
  return null;
end $$;
revoke all on function public.office_release(text) from public, anon;
grant execute on function public.office_release(text) to authenticated;

create or replace function public.office_sign(p_player text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club();
begin
  perform public.office_tidy();
  perform public.office_no_draft();
  if public.office_window_status() = 'open' then
    perform public.office_process_queue();
    return public.office_do_sign(my, p_player, me);
  end if;
  if not exists (select 1 from public.players where id = p_player and club is null) then raise exception 'That player is not a free agent.'; end if;
  if exists (select 1 from public.office_queue where status = 'queued' and kind = 'sign' and player = p_player and club = my) then
    raise exception 'You already have his signing waiting for the window.';
  end if;
  insert into public.office_queue (club, kind, player, created_by) values (my, 'sign', p_player, me);
  return null;
end $$;
revoke all on function public.office_sign(text) from public, anon;
grant execute on function public.office_sign(text) to authenticated;

create or replace function public.office_offer(p_to text, p_give text[], p_get text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); oid bigint;
begin
  perform public.office_tidy();
  perform public.office_no_draft();
  perform public.office_check_offer(my, upper(trim(p_to)), coalesce(p_give, '{}'), coalesce(p_get, '{}'));
  insert into public.office_offers (from_club, to_club, give, get, created_by)
  values (my, upper(trim(p_to)), coalesce(p_give, '{}'), coalesce(p_get, '{}'), me) returning id into oid;
  return oid;
end $$;
revoke all on function public.office_offer(text, text[], text[]) from public, anon;
grant execute on function public.office_offer(text, text[], text[]) to authenticated;

-- Accept (true) or reject (false). Accepted while the window is open: the trade happens now (returns the move id). Otherwise it waits for the window (null).
create or replace function public.office_respond(p_offer bigint, p_accept boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); o public.office_offers;
begin
  perform public.office_tidy();
  o := public.office_lock_offer(p_offer);
  if o.id is null or o.to_club <> my then raise exception 'No such offer to your club.'; end if;
  if o.status <> 'pending' then raise exception 'That offer is no longer open (%).', o.status; end if;
  if not coalesce(p_accept, false) then
    update public.office_offers set status = 'rejected', decided_by = me, decided_at = now() where id = o.id;
    return null;
  end if;
  perform public.office_no_draft();
  perform public.office_check_offer(o.from_club, o.to_club, o.give, o.get);   -- it must work as things stand when accepted
  if public.office_window_status() = 'open' then
    update public.office_offers set decided_by = me where id = o.id;
    return public.office_do_trade(o.id, me);
  end if;
  update public.office_offers set status = 'queued', decided_by = me, decided_at = now() where id = o.id;
  insert into public.office_queue (club, other_club, kind, offer_id, created_by) values (my, o.from_club, 'trade', o.id, me);
  return null;
end $$;
revoke all on function public.office_respond(bigint, boolean) from public, anon;
grant execute on function public.office_respond(bigint, boolean) to authenticated;

create or replace function public.office_counter(p_offer bigint, p_give text[], p_get text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); o public.office_offers; oid bigint;
begin
  perform public.office_tidy();
  o := public.office_lock_offer(p_offer);
  if o.id is null or o.to_club <> my then raise exception 'No such offer to your club.'; end if;
  if o.status <> 'pending' then raise exception 'That offer is no longer open (%).', o.status; end if;
  perform public.office_no_draft();
  perform public.office_check_offer(my, o.from_club, coalesce(p_give, '{}'), coalesce(p_get, '{}'));
  insert into public.office_offers (from_club, to_club, give, get, reply_to, created_by)
  values (my, o.from_club, coalesce(p_give, '{}'), coalesce(p_get, '{}'), o.id, me) returning id into oid;
  update public.office_offers set status = 'countered', decided_by = me, decided_at = now() where id = o.id;
  return oid;
end $$;
revoke all on function public.office_counter(bigint, text[], text[]) from public, anon;
grant execute on function public.office_counter(bigint, text[], text[]) to authenticated;

-- ---------------------------------------------------------------- settings and reads

create or replace function public.office_save_settings(p jsonb) returns public.office_settings
language plpgsql security definer set search_path = public as $$
declare c public.office_settings; k text; st0 text; st1 text;
  keys text[] := array['cap', 'over_limit', 'releases_per_window', 'window_open', 'opens_at', 'closes_at', 'pos_min', 'squad_min', 'squad_max'];
begin
  if not public.is_office() then raise exception 'Only the league office can change Office settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  if p ? 'pos_min' and (jsonb_typeof(p -> 'pos_min') <> 'object'
      or exists (select 1 from jsonb_each(p -> 'pos_min') e where e.key not in ('GK', 'DEF', 'MID', 'FWD') or jsonb_typeof(e.value) <> 'number' or (e.value)::text::int not between 0 and 11)) then
    raise exception 'those settings are out of range (each position''s minimum from 0 to 11)';
  end if;
  select * into c from public.office_settings where id = 1 for update;
  st0 := public.office_window_status();
  update public.office_settings set
    cap                 = coalesce((p ->> 'cap')::int, cap),
    over_limit          = coalesce((p ->> 'over_limit')::int, over_limit),
    releases_per_window = coalesce((p ->> 'releases_per_window')::int, releases_per_window),
    window_open         = coalesce((p ->> 'window_open')::boolean, window_open),
    opens_at            = case when p ? 'opens_at' then nullif(p ->> 'opens_at', '')::timestamptz else opens_at end,
    closes_at           = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    pos_min             = case when p ? 'pos_min' then pos_min || (p -> 'pos_min') else pos_min end,
    squad_min           = coalesce((p ->> 'squad_min')::int, squad_min),
    squad_max           = coalesce((p ->> 'squad_max')::int, squad_max),
    window_started_at   = case when coalesce((p ->> 'window_open')::boolean, window_open) and not window_open then now() else window_started_at end,
    updated_at          = now()
  where id = 1 returning * into c;
  st1 := public.office_window_status();
  if st0 in ('closed', 'not_yet') and st1 in ('open', 'round') then
    update public.office_settings set window_started_at = now() where id = 1 returning * into c;
  end if;
  perform public.office_tidy();
  perform public.office_process_queue();
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a cap from 0 to 10,000,000, an over-cap limit from 0 to 1,000,000, 0 to 50 releases, a squad of 11 to 40 with the most at least the fewest, a window that closes after it opens)';
end $$;
revoke all on function public.office_save_settings(jsonb) from public, anon;
grant execute on function public.office_save_settings(jsonb) to authenticated;

-- A club's queue for the pages: its own waiting and recent moves, and trades it is part of.
create or replace function public.office_queue_json(p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'club', q.club, 'other_club', q.other_club, 'status', q.status, 'note', q.note,
                                               'created_at', q.created_at, 'processed_at', q.processed_at,
                                               'player', case when q.player is not null then public.office_players_json(array[q.player]) -> 0 end,
                                               'give', case when q.offer_id is not null then public.office_players_json(o.give) end,
                                               'get', case when q.offer_id is not null then public.office_players_json(o.get) end,
                                               'from_club', o.from_club, 'to_club', o.to_club)
                            order by q.created_at desc, q.id desc), '[]'::jsonb)
  from public.office_queue q left join public.office_offers o on o.id = q.offer_id
  where (q.club = p_club or q.other_club = p_club)
    and (q.status = 'queued' or q.processed_at > now() - interval '14 days')
$$;
revoke all on function public.office_queue_json(text) from public, anon, authenticated;

create or replace function public.office_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare my text := public.office_my_club(); c public.office_settings; b int; used int; st text;
begin
  perform public.office_tidy();
  perform public.office_process_queue();
  c := public.office_cfg(); st := public.office_window_status();
  b := public.office_bill(my);
  select count(*) into used from public.office_moves
  where club = my and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  return jsonb_build_object(
    'club', my, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b, 'over_cap', b > c.cap,
    'window', jsonb_build_object('status', st, 'open', st = 'open', 'window_open', c.window_open, 'opens_at', c.opens_at, 'closes_at', c.closes_at,
                                 'round_week', public.office_round_live()),
    'releases', jsonb_build_object('limit', c.releases_per_window, 'used', used, 'left', greatest(0, c.releases_per_window - used),
                                   'queued', (select count(*) from public.office_queue where status = 'queued' and kind = 'release' and club = my)),
    'roster', public.office_roster_json(my),
    'squad', public.office_squad_json(my),
    'offers_in', public.office_offers_json('in', my),
    'offers_out', public.office_offers_json('out', my),
    'queue', public.office_queue_json(my),
    'penalties_applied', exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null)) || public.office_cap_json(b);
end $$;
revoke all on function public.office_state() from public, anon;
grant execute on function public.office_state() to authenticated;

-- ---------------------------------------------------------------- the queue runs every minute (a window opening at its time, a round finishing)

do $$ begin
  if exists (select 1 from cron.job where jobname = 'vleague-office-queue') then perform cron.unschedule('vleague-office-queue'); end if;
  perform cron.schedule('vleague-office-queue', '* * * * *', 'select public.office_process_queue();');
end $$;
