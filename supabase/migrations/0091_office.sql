-- The Office (S-35 GM Update, 16 Nov 2026): wages, the cap, transfer windows, releases, free-agent signings and trades between managers.
-- Safe to re-run. Needs 0001 (profiles, is_office, my_club), 0026 (draft roster rules), 0085 (stakes_match_over). Database only: the pages come later.
--
-- The rules (all checked here, so the browser cannot break them):
--   Wage    a player's wage is his players.value; a club's wage bill is the sum of its squad's values. One league cap (office_settings.cap, 125,000).
--   Cap     a move is allowed for a club if, after it, the club's bill is within the cap, OR the move lowers that club's bill (a club over the cap may still
--           make moves that bring the bill down). Each club in a trade is checked on its own.
--   Squad   the roster rules of the latest draft (roster_min / roster_max per position; today GK 2, DEF 5, MID 5, FWD 4 = 16; GK 2 / DEF 5 / MID 5 / FWD 4 if no draft has any).
--           After any move a club may be AT MOST ONE PLAYER SHORT in total (the sum over positions of how far each is under its minimum), and never over
--           any position's maximum. So a club can release one player, then must sign or trade for a player in that position before it can release another.
--           A club already further out (only possible through office edits) may still make moves that do not make it worse.
--           When a window closes nothing happens automatically: the office sees who is short in the Editor.
--   Release free; at most office_settings.releases_per_window per club per window (undone releases do not count). The player becomes a free agent.
--   Sign    a free agent, first come first served (the player row is locked, so two clubs cannot both get him).
--   Trade   players only. Club A offers {give: A's players, get: B's players} to B (at least one player in the deal); B accepts or rejects, or counters (a new offer the
--           other way that closes the old one); A can withdraw. On accept everything is checked again (each player still where he was, cap, squads, window)
--           and the players swap in one go. Pending offers expire when the window closes (or a new one opens), and are voided when one of their players moves.
--   Window  moves (and offers) only while the office has a window open (window_open, inside opens_at / closes_at when set) AND no round is being played:
--           from a round's line-up lock (deadlines.locked_at, or locks_at once passed) until its last game is over (stakes_match_over, 60 minutes after kick-off;
--           postponed games do not count).
--   Sheets  a player who leaves a club is taken out of that club's working team sheet and its unlocked submitted sheets (line-up, bench, captain, set-piece
--           takers; a boost goes with its captain). Locked week_sheets are never touched.
--   Log     every completed move is in office_moves (kind, clubs, players, wage bills before and after, who, when, undone_at). Everyone signed in reads it.
--           Offers are read only by the two clubs involved and the office.
--   Undo    the office can undo any completed move if its players are still where the move put them (no window, cap or squad check: the office's call).
--
--   office_settings        one row: cap, releases_per_window, window_open, opens_at, closes_at (window_started_at is set when window_open is switched on)
--   office_offers          trade offers
--   office_moves           the log of completed moves
--   office_state()         the signed-in manager's Office: cap, bill, room, window, releases, squad with wages, roster counts, offers in and out
--   office_club(club)      any club's squad with wages, bill and room (signed in)
--   office_release(player) / office_sign(player)
--   office_offer(to, give, get) / office_counter(offer, give, get) / office_respond(offer, accept) / office_withdraw(offer)
--   office_undo(move)      office only
--   office_save_settings(jsonb)  office only

-- ---------------------------------------------------------------- tables

create table if not exists public.office_settings (
  id                  int primary key default 1 check (id = 1),
  cap                 int not null default 125000 check (cap between 0 and 10000000),
  releases_per_window int not null default 2 check (releases_per_window between 0 and 50),
  window_open         boolean not null default false,
  opens_at            timestamptz,
  closes_at           timestamptz,
  window_started_at   timestamptz,
  updated_at          timestamptz not null default now(),
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);
insert into public.office_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.office_offers (
  id          bigserial primary key,
  from_club   text not null references public.clubs(code) on update cascade,
  to_club     text not null references public.clubs(code) on update cascade,
  give        text[] not null default '{}',   -- from_club's players
  get         text[] not null default '{}',   -- to_club's players
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'countered', 'expired', 'void')),
  reply_to    bigint references public.office_offers(id),   -- the offer this one counters
  move_id     bigint,
  note        text,   -- why it closed, when not plain (void, expired)
  created_by  uuid,
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz,
  check (from_club <> to_club)
);
create index if not exists office_offers_pending on public.office_offers (status) where status = 'pending';

create table if not exists public.office_moves (
  id            bigserial primary key,
  kind          text not null check (kind in ('release', 'sign', 'trade')),
  club          text not null references public.clubs(code) on update cascade,   -- the club that made the move (a trade: the club that offered)
  other_club    text references public.clubs(code) on update cascade,            -- a trade's other club
  players_out   text[] not null default '{}',   -- left club (to other_club, or to free agency)
  players_in    text[] not null default '{}',   -- joined club (from other_club, or from free agency)
  bill_before   int not null,
  bill_after    int not null,
  other_before  int,
  other_after   int,
  offer_id      bigint references public.office_offers(id),
  made_by       uuid,
  made_at       timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid
);
create index if not exists office_moves_club on public.office_moves (club, kind, made_at);

alter table public.office_settings enable row level security;
alter table public.office_offers enable row level security;
alter table public.office_moves enable row level security;
drop policy if exists office_settings_read on public.office_settings;
create policy office_settings_read on public.office_settings for select to authenticated using (true);
drop policy if exists office_moves_read on public.office_moves;
create policy office_moves_read on public.office_moves for select to authenticated using (true);
drop policy if exists office_offers_read on public.office_offers;
create policy office_offers_read on public.office_offers for select to authenticated
  using (public.is_office() or from_club = public.my_club() or to_club = public.my_club());
revoke all on public.office_settings, public.office_offers, public.office_moves from anon, authenticated;
grant select on public.office_settings, public.office_offers, public.office_moves to authenticated;
revoke all on sequence public.office_offers_id_seq, public.office_moves_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- internal helpers (not callable from the browser)

create or replace function public.office_cfg() returns public.office_settings
language sql stable security definer set search_path = public as $$ select * from public.office_settings where id = 1 $$;
revoke all on function public.office_cfg() from public, anon, authenticated;

-- When the current window started (releases are counted, and offers kept, from here).
create or replace function public.office_window_start() returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(coalesce(opens_at, '-infinity'), coalesce(window_started_at, '-infinity')) from public.office_settings where id = 1
$$;
revoke all on function public.office_window_start() from public, anon, authenticated;

-- The round being played now (locked and a game not over yet), or null.
create or replace function public.office_round_live() returns int
language sql stable security definer set search_path = public as $$
  select min(d.week) from public.deadlines d
  where coalesce(d.locked_at, d.locks_at) <= now()
    and exists (select 1 from public.fixtures f where f.week = d.week and f.starts_at is not null and not f.postponed
                and not public.stakes_match_over(f.starts_at, f.postponed))
$$;
revoke all on function public.office_round_live() from public, anon, authenticated;

-- 'open', 'closed' (no window), 'not_yet' (opens later), 'round' (window open but a round is being played).
create or replace function public.office_window_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when not s.window_open or (s.closes_at is not null and s.closes_at <= now()) then 'closed'
    when s.opens_at is not null and s.opens_at > now() then 'not_yet'
    when public.office_round_live() is not null then 'round'
    else 'open' end
  from public.office_settings s where s.id = 1
$$;
revoke all on function public.office_window_status() from public, anon, authenticated;

create or replace function public.office_need_window() returns void
language plpgsql stable security definer set search_path = public as $$
declare st text := public.office_window_status();
begin
  if st = 'closed' then raise exception 'The transfer window is closed.'; end if;
  if st = 'not_yet' then raise exception 'The transfer window is not open yet.'; end if;
  if st = 'round' then raise exception 'No moves while a round is being played (from the line-up lock to the last game).'; end if;
end $$;
revoke all on function public.office_need_window() from public, anon, authenticated;

-- Offers left from a closed window are expired (called at the start of every Office function).
create or replace function public.office_tidy() returns void
language plpgsql security definer set search_path = public as $$
declare st text := public.office_window_status(); ws timestamptz := public.office_window_start();
begin
  update public.office_offers set status = 'expired', note = 'the window closed', decided_at = now()
  where status = 'pending' and (st in ('closed', 'not_yet') or created_at < ws);
end $$;
revoke all on function public.office_tidy() from public, anon, authenticated;

-- The roster rules: the latest draft that has any, else the usual 2/5/5/4.
create or replace function public.office_roster() returns table (pos text, mn int, mx int)
language sql stable security definer set search_path = public as $$
  with d as (select roster_min, roster_max from public.drafts where roster_min <> '{}'::jsonb or roster_max <> '{}'::jsonb order by id desc limit 1),
       def(pos, n) as (values ('GK', 2), ('DEF', 5), ('MID', 5), ('FWD', 4))
  select def.pos,
         coalesce((select (d.roster_min ->> def.pos)::int from d), case when exists (select 1 from d) then 0 else def.n end),
         coalesce((select (d.roster_max ->> def.pos)::int from d), case when exists (select 1 from d) then 99 else def.n end)
  from def
$$;
revoke all on function public.office_roster() from public, anon, authenticated;

create or replace function public.office_bill(p_club text) returns int
language sql stable security definer set search_path = public as $$ select coalesce(sum(value), 0)::int from public.players where club = p_club $$;
revoke all on function public.office_bill(text) from public, anon, authenticated;

-- Check one club against the cap and the squad rules if p_out leave it and p_in join it. Raises a plain message when the move is not allowed.
create or replace function public.office_check(p_club text, p_out text[], p_in text[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b0 int; b1 int; short0 int; short1 int; over0 int; over1 int; bad text;
begin
  b0 := public.office_bill(p_club);
  b1 := b0 - coalesce((select sum(value) from public.players where id = any (p_out)), 0)::int + coalesce((select sum(value) from public.players where id = any (p_in)), 0)::int;
  if b1 > c.cap and b1 >= b0 then
    raise exception '% would have a wage bill of % against the cap of % (a club over the cap may only make moves that lower its bill).',
      p_club, to_char(b1, 'FM999,999,990'), to_char(c.cap, 'FM999,999,990');
  end if;
  with now_ as (select position, count(*)::int n from public.players where club = p_club group by position),
       aft as (select position, count(*)::int n from public.players
               where (club = p_club and not (id = any (p_out))) or id = any (p_in) group by position),
       t as (select r.pos, r.mn, r.mx, coalesce(a.n, 0) n0, coalesce(b.n, 0) n1
             from public.office_roster() r left join now_ a on a.position = r.pos left join aft b on b.position = r.pos)
  select sum(greatest(0, mn - n0)), sum(greatest(0, mn - n1)), sum(greatest(0, n0 - mx)), sum(greatest(0, n1 - mx)),
         string_agg(case when n1 > mx and n1 > n0 then pos || ' (most ' || mx || ')' end, ', ')
    into short0, short1, over0, over1, bad
  from t;
  if over1 > over0 then raise exception '% would have too many players at %.', p_club, bad; end if;
  if short1 > greatest(1, short0) then
    raise exception '% would be % players short of the squad rules (a club may be at most one short: sign or trade for one first).', p_club, short1;
  end if;
end $$;
revoke all on function public.office_check(text, text[], text[]) from public, anon, authenticated;

-- A sheet (submitted_sheets.sheet, or a team sheet as jsonb) without the given players: out of the line-up and bench; captain and set-piece
-- takers cleared; a boost goes with its captain.
create or replace function public.office_sheet_without(p_sheet jsonb, p_gone text[]) returns jsonb
language sql immutable set search_path = public as $$
  select case when p_sheet is null or jsonb_typeof(p_sheet) <> 'object' then p_sheet else
    (p_sheet
     || case when jsonb_typeof(p_sheet -> 'lineup') = 'object' then jsonb_build_object('lineup',
          coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p_sheet -> 'lineup') e where not coalesce(e.value #>> '{}' = any (p_gone), false)), '{}'::jsonb))
        else '{}'::jsonb end
     || case when jsonb_typeof(p_sheet -> 'bench') = 'array' then jsonb_build_object('bench',
          coalesce((select jsonb_agg(e.value order by e.o) from jsonb_array_elements(p_sheet -> 'bench') with ordinality e(value, o) where not coalesce(e.value #>> '{}' = any (p_gone), false)), '[]'::jsonb))
        else '{}'::jsonb end
     || case when p_sheet ->> 'captain' = any (p_gone) and p_sheet ? 'boost' then jsonb_build_object('boost', false) else '{}'::jsonb end)
    - coalesce((select array_agg(k) from unnest(array['captain', 'penalties', 'freekicks', 'corners']) k where p_sheet ->> k = any (p_gone)), '{}'::text[])
  end
$$;
revoke all on function public.office_sheet_without(jsonb, text[]) from public, anon, authenticated;

-- Take players who left p_club out of its working team sheet and its submitted sheets for weeks not locked yet (locked week_sheets are never touched).
create or replace function public.office_clean_sheets(p_club text, p_gone text[]) returns void
language plpgsql security definer set search_path = public as $$
declare t record; x jsonb;
begin
  if p_club is null or coalesce(cardinality(p_gone), 0) = 0 then return; end if;
  update public.submitted_sheets s set sheet = public.office_sheet_without(s.sheet, p_gone)
  where s.club = p_club
    and not exists (select 1 from public.deadlines d where d.week = s.week and d.locked_at is not null)
    and public.office_sheet_without(s.sheet, p_gone) is distinct from s.sheet;
  for t in select * from public.team_sheets where club = p_club for update loop
    x := public.office_sheet_without(jsonb_build_object('lineup', t.lineup, 'bench', t.bench, 'captain', t.captain,
                                                        'penalties', t.penalties, 'freekicks', t.freekicks, 'corners', t.corners), p_gone);
    if x is distinct from jsonb_build_object('lineup', t.lineup, 'bench', t.bench, 'captain', t.captain, 'penalties', t.penalties, 'freekicks', t.freekicks, 'corners', t.corners) then
      update public.team_sheets set lineup = coalesce(x -> 'lineup', '{}'), bench = coalesce(x -> 'bench', '[]'), captain = x ->> 'captain',
        penalties = x ->> 'penalties', freekicks = x ->> 'freekicks', corners = x ->> 'corners'
      where club = p_club;
    end if;
  end loop;
end $$;
revoke all on function public.office_clean_sheets(text, text[]) from public, anon, authenticated;

-- Pending offers that hold any of these players can no longer go through as offered.
create or replace function public.office_void_offers(p_players text[], p_except bigint default null) returns void
language sql security definer set search_path = public as $$
  update public.office_offers set status = 'void', note = 'a player in it has moved', decided_at = now()
  where status = 'pending' and id is distinct from p_except and (give && p_players or get && p_players)
$$;
revoke all on function public.office_void_offers(text[], bigint) from public, anon, authenticated;

-- The signed-in manager's club, or an error.
create or replace function public.office_my_club() returns text
language plpgsql stable security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select club into c from public.profiles where id = auth.uid();
  if c is null then raise exception 'Only a club manager can make moves.'; end if;
  return c;
end $$;
revoke all on function public.office_my_club() from public, anon, authenticated;

-- Lock clubs in a fixed order so two moves on the same clubs wait for each other (no double signings, no release limit races).
create or replace function public.office_lock_clubs(p_clubs text[]) returns void
language sql security definer set search_path = public as $$
  select 1 from public.clubs where code = any (p_clubs) order by code for update
$$;
revoke all on function public.office_lock_clubs(text[]) from public, anon, authenticated;

-- A player list as jsonb for the pages.
create or replace function public.office_players_json(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'position', p.position, 'club', p.club, 'wage', coalesce(p.value, 0),
                                               'offense', p.offense, 'defense', p.defense, 'number', p.number)
                            order by array_position(p_ids, p.id)), '[]'::jsonb)
  from public.players p where p.id = any (p_ids)
$$;
revoke all on function public.office_players_json(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- moves

create or replace function public.office_release(p_player text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); c public.office_settings := public.office_cfg(); pl public.players; used int; b0 int; mid bigint;
begin
  perform public.office_tidy();
  perform public.office_need_window();
  perform public.office_lock_clubs(array[my]);
  select * into pl from public.players where id = p_player for update;
  if not found or pl.club is distinct from my then raise exception 'That player is not in your squad.'; end if;
  select count(*) into used from public.office_moves
  where club = my and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  if used >= c.releases_per_window then raise exception 'You have used all % releases for this window.', c.releases_per_window; end if;
  perform public.office_check(my, array[p_player], '{}');
  b0 := public.office_bill(my);
  update public.players set club = null where id = p_player;
  perform public.office_clean_sheets(my, array[p_player]);
  perform public.office_void_offers(array[p_player]);
  insert into public.office_moves (kind, club, players_out, bill_before, bill_after, made_by)
  values ('release', my, array[p_player], b0, public.office_bill(my), me) returning id into mid;
  return mid;
end $$;
revoke all on function public.office_release(text) from public, anon;
grant execute on function public.office_release(text) to authenticated;

create or replace function public.office_sign(p_player text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); pl public.players; b0 int; mid bigint;
begin
  perform public.office_tidy();
  perform public.office_need_window();
  perform public.office_lock_clubs(array[my]);
  select * into pl from public.players where id = p_player for update;
  if not found then raise exception 'No such player.'; end if;
  if pl.club is not null then raise exception 'That player is not a free agent (he is at %).', pl.club; end if;
  perform public.office_check(my, '{}', array[p_player]);
  b0 := public.office_bill(my);
  update public.players set club = my where id = p_player;
  insert into public.office_moves (kind, club, players_in, bill_before, bill_after, made_by)
  values ('sign', my, array[p_player], b0, public.office_bill(my), me) returning id into mid;
  return mid;
end $$;
revoke all on function public.office_sign(text) from public, anon;
grant execute on function public.office_sign(text) to authenticated;

-- Checks an offer's players and both clubs (used when sending and again when accepting).
create or replace function public.office_check_offer(p_from text, p_to text, p_give text[], p_get text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_to is null or not exists (select 1 from public.clubs where code = p_to) then raise exception 'No such club.'; end if;
  if p_to = p_from then raise exception 'Pick another club to trade with.'; end if;
  if coalesce(cardinality(p_give), 0) + coalesce(cardinality(p_get), 0) = 0 then raise exception 'Put at least one player in the deal.'; end if;
  if (select count(distinct x) from unnest(coalesce(p_give, '{}') || coalesce(p_get, '{}')) x) <> coalesce(cardinality(p_give), 0) + coalesce(cardinality(p_get), 0) then
    raise exception 'A player is in the deal twice.';
  end if;
  if (select count(*) from public.players where id = any (p_give) and club = p_from) <> coalesce(cardinality(p_give), 0) then
    raise exception 'A player offered is no longer at %.', p_from;
  end if;
  if (select count(*) from public.players where id = any (p_get) and club = p_to) <> coalesce(cardinality(p_get), 0) then
    raise exception 'A player asked for is no longer at %.', p_to;
  end if;
  perform public.office_check(p_from, coalesce(p_give, '{}'), coalesce(p_get, '{}'));
  perform public.office_check(p_to, coalesce(p_get, '{}'), coalesce(p_give, '{}'));
end $$;
revoke all on function public.office_check_offer(text, text, text[], text[]) from public, anon, authenticated;

create or replace function public.office_offer(p_to text, p_give text[], p_get text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); oid bigint;
begin
  perform public.office_tidy();
  perform public.office_need_window();
  perform public.office_check_offer(my, upper(trim(p_to)), coalesce(p_give, '{}'), coalesce(p_get, '{}'));
  insert into public.office_offers (from_club, to_club, give, get, created_by)
  values (my, upper(trim(p_to)), coalesce(p_give, '{}'), coalesce(p_get, '{}'), me) returning id into oid;
  return oid;
end $$;
revoke all on function public.office_offer(text, text[], text[]) from public, anon;
grant execute on function public.office_offer(text, text[], text[]) to authenticated;

-- The club an offer was sent to accepts (true) or rejects (false) it. Returns the move id on accept, null on reject.
create or replace function public.office_respond(p_offer bigint, p_accept boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); o public.office_offers; a0 int; b0 int; mid bigint;
begin
  perform public.office_tidy();
  select * into o from public.office_offers where id = p_offer for update;
  if not found or o.to_club <> my then raise exception 'No such offer to your club.'; end if;
  if o.status <> 'pending' then raise exception 'That offer is no longer open (%).', o.status; end if;
  if not coalesce(p_accept, false) then
    update public.office_offers set status = 'rejected', decided_by = me, decided_at = now() where id = o.id;
    return null;
  end if;
  perform public.office_need_window();
  perform public.office_lock_clubs(array[o.from_club, o.to_club]);
  perform 1 from public.players where id = any (o.give || o.get) order by id for update;
  perform public.office_check_offer(o.from_club, o.to_club, o.give, o.get);
  a0 := public.office_bill(o.from_club); b0 := public.office_bill(o.to_club);
  update public.players set club = o.to_club where id = any (o.give);
  update public.players set club = o.from_club where id = any (o.get);
  perform public.office_clean_sheets(o.from_club, o.give);
  perform public.office_clean_sheets(o.to_club, o.get);
  insert into public.office_moves (kind, club, other_club, players_out, players_in, bill_before, bill_after, other_before, other_after, offer_id, made_by)
  values ('trade', o.from_club, o.to_club, o.give, o.get, a0, public.office_bill(o.from_club), b0, public.office_bill(o.to_club), o.id, me) returning id into mid;
  update public.office_offers set status = 'accepted', decided_by = me, decided_at = now(), move_id = mid where id = o.id;
  perform public.office_void_offers(o.give || o.get, o.id);
  return mid;
end $$;
revoke all on function public.office_respond(bigint, boolean) from public, anon;
grant execute on function public.office_respond(bigint, boolean) to authenticated;

-- The club an offer was sent to answers with its own offer the other way; the old one closes as 'countered'. Returns the new offer's id.
create or replace function public.office_counter(p_offer bigint, p_give text[], p_get text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); o public.office_offers; oid bigint;
begin
  perform public.office_tidy();
  select * into o from public.office_offers where id = p_offer for update;
  if not found or o.to_club <> my then raise exception 'No such offer to your club.'; end if;
  if o.status <> 'pending' then raise exception 'That offer is no longer open (%).', o.status; end if;
  perform public.office_need_window();
  perform public.office_check_offer(my, o.from_club, coalesce(p_give, '{}'), coalesce(p_get, '{}'));
  insert into public.office_offers (from_club, to_club, give, get, reply_to, created_by)
  values (my, o.from_club, coalesce(p_give, '{}'), coalesce(p_get, '{}'), o.id, me) returning id into oid;
  update public.office_offers set status = 'countered', decided_by = me, decided_at = now() where id = o.id;
  return oid;
end $$;
revoke all on function public.office_counter(bigint, text[], text[]) from public, anon;
grant execute on function public.office_counter(bigint, text[], text[]) to authenticated;

create or replace function public.office_withdraw(p_offer bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my text := public.office_my_club(); o public.office_offers;
begin
  perform public.office_tidy();
  select * into o from public.office_offers where id = p_offer for update;
  if not found or o.from_club <> my then raise exception 'No such offer from your club.'; end if;
  if o.status <> 'pending' then raise exception 'That offer is no longer open (%).', o.status; end if;
  update public.office_offers set status = 'withdrawn', decided_by = me, decided_at = now() where id = o.id;
end $$;
revoke all on function public.office_withdraw(bigint) from public, anon;
grant execute on function public.office_withdraw(bigint) to authenticated;

-- The office undoes a completed move, if its players are still where it put them.
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
  if m.kind = 'release' then
    if exists (select 1 from public.players where id = any (m.players_out) and club is not null) then raise exception 'The released player has been signed since: undo that first.'; end if;
    update public.players set club = m.club where id = any (m.players_out);
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

-- ---------------------------------------------------------------- settings

create or replace function public.office_save_settings(p jsonb) returns public.office_settings
language plpgsql security definer set search_path = public as $$
declare c public.office_settings; k text; keys text[] := array['cap', 'releases_per_window', 'window_open', 'opens_at', 'closes_at'];
begin
  if not public.is_office() then raise exception 'Only the league office can change Office settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  select * into c from public.office_settings where id = 1 for update;
  update public.office_settings set
    cap                 = coalesce((p ->> 'cap')::int, cap),
    releases_per_window = coalesce((p ->> 'releases_per_window')::int, releases_per_window),
    window_open         = coalesce((p ->> 'window_open')::boolean, window_open),
    opens_at            = case when p ? 'opens_at' then nullif(p ->> 'opens_at', '')::timestamptz else opens_at end,
    closes_at           = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    window_started_at   = case when coalesce((p ->> 'window_open')::boolean, window_open) and not window_open then now() else window_started_at end,
    updated_at          = now()
  where id = 1 returning * into c;
  perform public.office_tidy();
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a cap from 0 to 10,000,000, 0 to 50 releases, a window that closes after it opens)';
end $$;
revoke all on function public.office_save_settings(jsonb) from public, anon;
grant execute on function public.office_save_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------- reads for the pages

create or replace function public.office_squad_json(p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'position', p.position, 'wage', coalesce(p.value, 0),
                                               'offense', p.offense, 'defense', p.defense, 'number', p.number)
                            order by array_position(array['GK', 'DEF', 'MID', 'FWD'], p.position), p.value desc, p.name), '[]'::jsonb)
  from public.players p where p.club = p_club
$$;
revoke all on function public.office_squad_json(text) from public, anon, authenticated;

create or replace function public.office_roster_json(p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'positions', jsonb_object_agg(r.pos, jsonb_build_object('min', r.mn, 'max', r.mx, 'count', (select count(*) from public.players p where p.club = p_club and p.position = r.pos))),
    'short', sum(greatest(0, r.mn - (select count(*) from public.players p where p.club = p_club and p.position = r.pos))))
  from public.office_roster() r
$$;
revoke all on function public.office_roster_json(text) from public, anon, authenticated;

-- Any club's squad with wages, its wage bill and room under the cap. Any signed-in user.
create or replace function public.office_club(p_club text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.office_settings := public.office_cfg(); b int; cl public.clubs;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into cl from public.clubs where code = p_club;
  if not found then raise exception 'No such club.'; end if;
  b := public.office_bill(p_club);
  return jsonb_build_object('club', cl.code, 'name', cl.name, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b,
                            'roster', public.office_roster_json(p_club), 'squad', public.office_squad_json(p_club));
end $$;
revoke all on function public.office_club(text) from public, anon;
grant execute on function public.office_club(text) to authenticated;

create or replace function public.office_offers_json(p_where text, p_club text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'from_club', o.from_club, 'to_club', o.to_club, 'reply_to', o.reply_to, 'created_at', o.created_at,
                                               'give', public.office_players_json(o.give), 'get', public.office_players_json(o.get))
                            order by o.created_at desc), '[]'::jsonb)
  from public.office_offers o
  where o.status = 'pending' and ((p_where = 'in' and o.to_club = p_club) or (p_where = 'out' and o.from_club = p_club))
$$;
revoke all on function public.office_offers_json(text, text) from public, anon, authenticated;

-- The signed-in manager's Office.
create or replace function public.office_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare my text := public.office_my_club(); c public.office_settings; b int; used int; st text;
begin
  perform public.office_tidy();
  c := public.office_cfg(); st := public.office_window_status();
  b := public.office_bill(my);
  select count(*) into used from public.office_moves
  where club = my and kind = 'release' and undone_at is null and made_at >= public.office_window_start();
  return jsonb_build_object(
    'club', my, 'cap', c.cap, 'wage_bill', b, 'room', c.cap - b, 'over_cap', b > c.cap,
    'window', jsonb_build_object('status', st, 'open', st = 'open', 'window_open', c.window_open, 'opens_at', c.opens_at, 'closes_at', c.closes_at,
                                 'round_week', public.office_round_live()),
    'releases', jsonb_build_object('limit', c.releases_per_window, 'used', used, 'left', greatest(0, c.releases_per_window - used)),
    'roster', public.office_roster_json(my),
    'squad', public.office_squad_json(my),
    'offers_in', public.office_offers_json('in', my),
    'offers_out', public.office_offers_json('out', my));
end $$;
revoke all on function public.office_state() from public, anon;
grant execute on function public.office_state() to authenticated;
