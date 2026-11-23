-- Release fees (24 Nov 2026, the user): a club may release more players than office_settings.releases_per_window allows, but each release past the
-- limit carries a release fee of 10% of that player's wage (his players.value, rounded to the dollar). The fee stays on the club's wage bill for the
-- rest of the season: it counts against the cap, the over-cap limit and the cap penalty points like any wage. A manager cannot get rid of it (signing
-- him back, trading, a new window: none of them clear it). Only the league office can: Editor > Office clears one fee or every fee (the end of the
-- season), and undoing the release itself also clears its fee (the release never happened).
-- Safe to re-run. Needs 0091, 0092, 0093. Additive: a new table; the functions below replace 0093's (and 0091's office_bill, office_undo, 0092's office_club).
--
--   office_release_fees                  club, player, wage, fee, move_id, created_at, cleared_at/by, note. Everyone signed in reads it (as office_moves).
--   office_release_fee(wage)             the fee for a wage (pure)
--   office_fees(club)                    the club's fees still standing, added up
--   office_bill(club)                    now the squad's wages PLUS office_fees(club)
--   office_clear_release_fees(ids)       office only: clears the fees with those ids (null: every fee still standing); returns how many

create table if not exists public.office_release_fees (
  id          bigserial primary key,
  club        text not null references public.clubs(code) on update cascade,
  player      text not null,
  wage        int not null,
  fee         int not null check (fee >= 0),
  move_id     bigint references public.office_moves(id),
  created_at  timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  uuid,
  note        text
);
create index if not exists office_release_fees_live on public.office_release_fees (club) where cleared_at is null;
alter table public.office_release_fees enable row level security;
drop policy if exists office_release_fees_read on public.office_release_fees;
create policy office_release_fees_read on public.office_release_fees for select to authenticated using (true);
revoke all on public.office_release_fees from anon, authenticated;
grant select on public.office_release_fees to authenticated;
revoke all on sequence public.office_release_fees_id_seq from anon, authenticated;

create or replace function public.office_release_fee(p_wage int) returns int
language sql immutable set search_path = public as $$ select greatest(0, round(coalesce(p_wage, 0) * 0.1))::int $$;
revoke all on function public.office_release_fee(int) from public, anon;
grant execute on function public.office_release_fee(int) to authenticated;

create or replace function public.office_fees(p_club text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(fee), 0)::int from public.office_release_fees where club = p_club and cleared_at is null
$$;
revoke all on function public.office_fees(text) from public, anon, authenticated;

-- The wage bill: the squad's wages and the release fees still standing.
create or replace function public.office_bill(p_club text) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(value) from public.players where club = p_club), 0) + public.office_fees(p_club))::int
$$;
revoke all on function public.office_bill(text) from public, anon, authenticated;

-- A release: free within the window's limit, with a fee past it (no longer refused).
create or replace function public.office_do_release(p_club text, p_player text, p_by uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); pl public.players; used int; b0 int; mid bigint; fid bigint;
begin
  perform public.office_lock_clubs(array[p_club]);
  select * into pl from public.players where id = p_player for update;
  if not found or pl.club is distinct from p_club then raise exception 'That player is no longer in the squad.'; end if;
  select count(*) into used from public.office_moves
  where club = p_club and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  perform public.office_check(p_club, array[p_player], '{}');   -- a release always lowers the bill (the fee is a tenth of the wage)
  b0 := public.office_bill(p_club);
  update public.players set club = null where id = p_player;
  perform public.office_clean_sheets(p_club, array[p_player]);
  perform public.office_void_offers(array[p_player]);
  if used >= c.releases_per_window then
    insert into public.office_release_fees (club, player, wage, fee)
    values (p_club, p_player, coalesce(pl.value, 0)::int, public.office_release_fee(coalesce(pl.value, 0)::int)) returning id into fid;
  end if;
  insert into public.office_moves (kind, club, players_out, bill_before, bill_after, made_by)
  values ('release', p_club, array[p_player], b0, public.office_bill(p_club), p_by) returning id into mid;
  if fid is not null then update public.office_release_fees set move_id = mid where id = fid; end if;
  return mid;
end $$;
revoke all on function public.office_do_release(text, text, uuid) from public, anon, authenticated;

-- What managers call: as 0093, without the cap on releases waiting (each one past the limit carries its fee when it goes through).
create or replace function public.office_release(p_player text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club();
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
  insert into public.office_queue (club, kind, player, created_by) values (my, 'release', p_player, me);
  return null;
end $$;
revoke all on function public.office_release(text) from public, anon;
grant execute on function public.office_release(text) to authenticated;

-- The office undoes a move (as 0091). Undoing a release also clears its fee.
create or replace function public.office_undo(p_move bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m public.office_moves;
begin
  if not public.is_office() then raise exception 'Only the league office can undo a move.'; end if;
  select * into m from public.office_moves where id = p_move for update;
  if not found then raise exception 'No such move.'; end if;
  if m.undone_at is not null then raise exception 'That move has already been undone.'; end if;
  perform public.office_lock_clubs(array[m.club, m.other_club]);
  perform 1 from public.players where id = any (m.players_out || m.players_in) order by id for update;
  if exists (select 1 from public.office_moves x where x.id > m.id and x.undone_at is null
             and (x.players_out || x.players_in) && (m.players_out || m.players_in)) then
    raise exception 'A later move involves the same players: undo that first.';
  end if;
  if m.kind = 'release' then
    if exists (select 1 from public.players where id = any (m.players_out) and club is not null) then raise exception 'The released player has been signed since: undo that first.'; end if;
    update public.players set club = m.club where id = any (m.players_out);
    update public.office_release_fees set cleared_at = now(), cleared_by = auth.uid(), note = 'release undone'
    where move_id = m.id and cleared_at is null;
  elsif m.kind = 'sign' then
    if exists (select 1 from public.players where id = any (m.players_in) and club is distinct from m.club) then raise exception 'The signed player has moved since: undo that first.'; end if;
    update public.players set club = null where id = any (m.players_in);
    perform public.office_clean_sheets(m.club, m.players_in);
  else
    if (select count(*) from public.players where id = any (m.players_out) and club = m.other_club) <> cardinality(m.players_out)
       or (select count(*) from public.players where id = any (m.players_in) and club = m.club) <> cardinality(m.players_in) then
      raise exception 'A player in that trade has moved since: undo that first.';
    end if;
    update public.players set club = m.club where id = any (m.players_out);
    update public.players set club = m.other_club where id = any (m.players_in);
    perform public.office_clean_sheets(m.other_club, m.players_out);
    perform public.office_clean_sheets(m.club, m.players_in);
  end if;
  perform public.office_void_offers(m.players_out || m.players_in);
  update public.office_moves set undone_at = now(), undone_by = auth.uid() where id = m.id;
end $$;
revoke all on function public.office_undo(bigint) from public, anon;
grant execute on function public.office_undo(bigint) to authenticated;

-- The office clears release fees: the ones with these ids, or (null) every fee still standing.
create or replace function public.office_clear_release_fees(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_office() then raise exception 'Only the league office can clear release fees.'; end if;
  perform public.office_lock_clubs(array(select distinct club from public.office_release_fees
                                         where cleared_at is null and (p_ids is null or id = any (p_ids))));
  update public.office_release_fees set cleared_at = now(), cleared_by = auth.uid(), note = 'cleared by the office'
  where cleared_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There are no release fees to clear.'; end if;
  return n;
end $$;
revoke all on function public.office_clear_release_fees(bigint[]) from public, anon;
grant execute on function public.office_clear_release_fees(bigint[]) to authenticated;

-- ---------------------------------------------------------------- reads (with the fees)

create or replace function public.office_fees_json(p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'player', f.player, 'name', p.name, 'wage', f.wage, 'fee', f.fee, 'created_at', f.created_at)
                            order by f.created_at, f.id), '[]'::jsonb)
  from public.office_release_fees f left join public.players p on p.id = f.player
  where f.club = p_club and f.cleared_at is null
$$;
revoke all on function public.office_fees_json(text) from public, anon, authenticated;

create or replace function public.office_club(p_club text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b int; cl public.clubs;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into cl from public.clubs where code = p_club;
  if not found then raise exception 'No such club.'; end if;
  b := public.office_bill(p_club);
  return jsonb_build_object('club', cl.code, 'name', cl.name, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b,
                            'fees', public.office_fees(p_club), 'release_fees', public.office_fees_json(p_club),
                            'roster', public.office_roster_json(p_club), 'squad', public.office_squad_json(p_club)) || public.office_cap_json(b);
end $$;
revoke all on function public.office_club(text) from public, anon;
grant execute on function public.office_club(text) to authenticated;

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
                                   'queued', (select count(*) from public.office_queue where status = 'queued' and kind = 'release' and club = my),
                                   'fee_pct', 10),
    'fees', public.office_fees(my),
    'release_fees', public.office_fees_json(my),
    'roster', public.office_roster_json(my),
    'squad', public.office_squad_json(my),
    'offers_in', public.office_offers_json('in', my),
    'offers_out', public.office_offers_json('out', my),
    'queue', public.office_queue_json(my),
    'penalties_applied', exists (select 1 from public.points_adjustments where reason = 'Cap penalty' and undone_at is null)) || public.office_cap_json(b);
end $$;
revoke all on function public.office_state() from public, anon;
grant execute on function public.office_state() to authenticated;
