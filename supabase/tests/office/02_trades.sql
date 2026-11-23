-- Trades: offer, reject, withdraw, counter, accept, checks on both clubs, offers voided or expired, ownership changed before accept.
do $$
declare t1 text; t2 text; t3 text; l1 text; l2 text; l3 text; l4 text; lm text; o1 bigint; o2 bigint; o3 bigint; o4 bigint; o5 bigint; o7 bigint; o9 bigint; o8 bigint;
  mid bigint; ta int; la int; st jsonb; n int; x text; y text; diff int; sb int; lb int;
begin
  t1 := pg_temp.pl('TUR', 'DEF', 1); t2 := pg_temp.pl('TUR', 'DEF', 2); t3 := pg_temp.pl('TUR', 'DEF', 3);
  l1 := pg_temp.pl('LAU', 'DEF', 1); l2 := pg_temp.pl('LAU', 'DEF', 2); l3 := pg_temp.pl('LAU', 'DEF', 3); l4 := pg_temp.pl('LAU', 'DEF', 4); lm := pg_temp.pl('LAU', 'MID', 1);
  update public.office_settings set cap = 10000000;

  -- ---- an offer, who sees it, reject
  perform pg_temp.act('tur');
  o1 := public.office_offer('LAU', array[t1], array[l1]);
  perform pg_temp.ok('offer: TUR sees its offer', (select count(*) from public.office_offers where id = o1) = 1);
  perform pg_temp.ok('offer: in TUR''s offers out', (public.office_state() -> 'offers_out') @> jsonb_build_array(jsonb_build_object('id', o1)));
  perform pg_temp.err('offer: the sender cannot accept its own offer', format('select public.office_respond(%s, true)', o1), 'No such offer to your club');
  perform pg_temp.act('lau');
  perform pg_temp.ok('offer: LAU sees it in offers in, with the players', (public.office_state() -> 'offers_in') @> jsonb_build_array(jsonb_build_object('id', o1, 'give', jsonb_build_array(jsonb_build_object('id', t1)))));
  perform pg_temp.act('sks');
  perform pg_temp.ok('RLS: another club cannot read the offer', (select count(*) from public.office_offers where id = o1) = 0);
  perform pg_temp.err('another club cannot answer the offer', format('select public.office_respond(%s, true)', o1), 'No such offer to your club');
  perform pg_temp.act('noclub');
  perform pg_temp.ok('RLS: an account with no club cannot read the offer', (select count(*) from public.office_offers) = 0);
  perform pg_temp.act('office');
  perform pg_temp.ok('RLS: the office reads every offer', (select count(*) from public.office_offers where id = o1) = 1);
  perform pg_temp.act('lau');
  perform public.office_respond(o1, false);
  perform pg_temp.act('su');
  perform pg_temp.ok('reject: offer closed, nobody moved', (select status from public.office_offers where id = o1) = 'rejected' and pg_temp.club_of(t1) = 'TUR' and pg_temp.club_of(l1) = 'LAU');

  -- ---- withdraw
  perform pg_temp.act('tur');
  o2 := public.office_offer('LAU', array[t1], array[l1]);
  perform pg_temp.act('lau');
  perform pg_temp.err('withdraw: only the sender can withdraw', format('select public.office_withdraw(%s)', o2), 'No such offer from your club');
  perform pg_temp.act('tur');
  perform public.office_withdraw(o2);
  perform pg_temp.act('lau');
  perform pg_temp.err('withdraw: a withdrawn offer cannot be accepted', format('select public.office_respond(%s, true)', o2), 'no longer open (withdrawn)');

  -- ---- offers that break the rules are refused when sent
  perform pg_temp.act('tur');
  perform pg_temp.err('offer: not to your own club', format('select public.office_offer(%L, %L, %L)', 'TUR', array[t1], array[]::text[]), 'another club');
  perform pg_temp.err('offer: needs a player', format('select public.office_offer(%L, %L, %L)', 'LAU', array[]::text[], array[]::text[]), 'at least one player');
  perform pg_temp.err('offer: cannot give another club''s player', format('select public.office_offer(%L, %L, %L)', 'LAU', array[l2], array[l1]), 'no longer at TUR');
  perform pg_temp.err('squad: a trade leaving TUR with 3 DEF is refused (at least 4)', format('select public.office_offer(%L, %L, %L)', 'LAU', array[t1, t2], array[lm, pg_temp.pl('LAU', 'MID', 2)]), 'TUR would have too few players at DEF');
  perform pg_temp.err('squad: a 2-for-1 that gives LAU a sixth DEF is refused', format('select public.office_offer(%L, %L, %L)', 'LAU', array[t1, t2], array[l1]), 'LAU would have 17 players');

  -- ---- counter, then accept: the players swap and the sheets are cleaned
  o3 := public.office_offer('LAU', array[t1], array[l1]);
  perform pg_temp.act('su');
  insert into public.team_sheets (club, formation) values ('TUR', '4-4-2') on conflict (club) do nothing;
  update public.team_sheets set lineup = jsonb_build_object('LB', t1), captain = t1 where club = 'TUR';
  perform pg_temp.act('lau');
  o4 := public.office_counter(o3, array[l2], array[t1]);
  perform pg_temp.act('su');
  perform pg_temp.ok('counter: the old offer closes as countered', (select status from public.office_offers where id = o3) = 'countered');
  perform pg_temp.ok('counter: a new offer the other way', exists (select 1 from public.office_offers where id = o4 and from_club = 'LAU' and to_club = 'TUR' and reply_to = o3 and give = array[l2] and get = array[t1] and status = 'pending'));
  ta := public.office_bill('TUR'); la := public.office_bill('LAU');
  perform pg_temp.act('lau');
  perform pg_temp.err('counter: a countered offer cannot be countered again', format('select public.office_counter(%s, %L, %L)', o3, array[l2], array[t1]), 'no longer open');
  perform pg_temp.act('tur');
  mid := public.office_respond(o4, true);
  perform pg_temp.act('su');
  perform pg_temp.ok('accept: the players swap', pg_temp.club_of(t1) = 'LAU' and pg_temp.club_of(l2) = 'TUR');
  perform pg_temp.ok('accept: logged as a trade with both clubs'' bills', exists (select 1 from public.office_moves where id = mid and kind = 'trade' and club = 'LAU' and other_club = 'TUR' and players_out = array[l2] and players_in = array[t1]
      and bill_before = la and bill_after = public.office_bill('LAU') and other_before = ta and other_after = public.office_bill('TUR') and offer_id = o4));
  perform pg_temp.ok('accept: the offer is accepted with its move', (select status = 'accepted' and move_id = mid from public.office_offers where id = o4));
  perform pg_temp.ok('accept: the player who left is out of TUR''s sheet', (select captain is null and not (lineup ? 'LB') from public.team_sheets where club = 'TUR'));

  -- ---- a pending offer is voided when one of its players moves
  perform pg_temp.act('tur');
  o5 := public.office_offer('LAU', array[t2], array[l3]);
  perform pg_temp.act('lau');
  perform public.office_release(l3);
  perform pg_temp.act('su');
  perform pg_temp.ok('void: releasing a player voids offers that hold him', (select status from public.office_offers where id = o5) = 'void');
  perform pg_temp.act('lau');
  perform public.office_sign(pg_temp.pl(null, 'DEF', 1));

  -- ---- the players moved before the accept
  perform pg_temp.act('tur');
  o7 := public.office_offer('LAU', array[t3], array[l4]);
  perform pg_temp.act('su');
  update public.players set club = null where id = l4;   -- the office moved him by hand
  perform pg_temp.act('lau');
  perform pg_temp.err('accept: refused when a player is no longer where he was', format('select public.office_respond(%s, true)', o7), 'no longer at LAU');
  perform pg_temp.act('su');
  update public.players set club = 'LAU' where id = l4;
  perform pg_temp.ok('accept: nobody moved after the refusal', pg_temp.club_of(t3) = 'TUR' and (select status from public.office_offers where id = o7) = 'pending');

  -- ---- the cap is checked again on accept
  update public.office_settings set cap = least(public.office_bill('TUR'), public.office_bill('LAU')) - 1;
  perform pg_temp.act('lau');
  perform pg_temp.err('accept: the cap is checked again', format('select public.office_respond(%s, true)', o7), 'cap');
  perform pg_temp.act('su');
  update public.office_settings set cap = 10000000;

  -- ---- the window closes: offers stay open, can still be sent, and an accepted trade waits for the window (0093)
  perform pg_temp.act('office');
  perform public.office_save_settings('{"window_open": false}');
  perform pg_temp.act('su');
  perform pg_temp.ok('closed: pending offers stay open', (select status from public.office_offers where id = o7) = 'pending');
  perform pg_temp.act('tur');
  o9 := public.office_offer('LAU', array[t3], array[l4]);
  perform pg_temp.ok('closed: an offer can still be sent', (select status from public.office_offers where id = o9) = 'pending' and public.office_state() #>> '{window,status}' = 'closed');
  perform pg_temp.act('lau');
  perform pg_temp.ok('closed: accepting returns no move (it waits)', public.office_respond(o9, true) is null);
  perform pg_temp.ok('closed: accepting queues the trade, nothing moves yet', pg_temp.club_of(t3) = 'TUR'
    and (select status from public.office_offers where id = o9) = 'queued' and exists (select 1 from public.office_queue where offer_id = o9 and status = 'queued'),
    format('club_of t3 %s, offer %s, queue %s, window %s', pg_temp.club_of(t3), (select status from public.office_offers where id = o9), (select status from public.office_queue where offer_id = o9), 'n/a'));
  perform pg_temp.act('tur');
  perform pg_temp.ok('closed: both clubs see the waiting trade', exists (select 1 from jsonb_array_elements(public.office_state() -> 'queue') e where (e.value ->> 'kind') = 'trade' and (e.value ->> 'status') = 'queued'));
  perform pg_temp.act('office');
  perform public.office_save_settings('{"window_open": true}');
  perform pg_temp.act('su');
  perform pg_temp.ok('open: the queued trade goes through when the window opens', pg_temp.club_of(t3) = 'LAU' and pg_temp.club_of(l4) = 'TUR'
    and (select status from public.office_queue where offer_id = o9) = 'done' and (select status from public.office_offers where id = o9) = 'accepted');
  -- ---- each club in a trade checked on its own: SKS over the cap may trade if its bill goes down, while LAU stays under
  perform pg_temp.act('su');
  select s.id, l.id, s.value - l.value into x, y, diff from public.players s join public.players l on l.position = s.position
  where s.club = 'SKS' and l.club = 'LAU' and s.value > l.value order by s.value - l.value, s.id, l.id limit 1;
  sb := public.office_bill('SKS'); lb := public.office_bill('LAU');
  update public.office_settings set cap = sb - diff - 1;   -- SKS is still over after the trade
  perform pg_temp.ok('over-cap trade: a pair exists that keeps LAU under (test precondition)', lb + diff <= sb - diff - 1, format('diff %s, SKS %s, LAU %s', diff, sb, lb));
  perform pg_temp.act('sks');
  o8 := public.office_offer('LAU', array[x], array[y]);
  perform pg_temp.act('lau');
  perform public.office_respond(o8, true);
  perform pg_temp.act('su');
  perform pg_temp.ok('over-cap trade: goes through when it lowers the over-cap club''s bill', pg_temp.club_of(x) = 'LAU' and pg_temp.club_of(y) = 'SKS' and public.office_bill('SKS') = sb - diff);
  perform pg_temp.act('sks');
  perform pg_temp.err('over-cap trade: one that raises the over-cap club''s bill is refused', format('select public.office_offer(%L, %L, %L)', 'LAU', array[y], array[x]), 'SKS would have a wage bill');
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('LAU');   -- LAU exactly at the cap: TUR's bill would fall, LAU's would rise
  perform pg_temp.act('lau');
  perform pg_temp.err('trade: the other club is checked on its own', format('select public.office_offer(%L, %L, %L)', 'TUR', array[pg_temp.pl('LAU', 'DEF', 1)], array[pg_temp.pl('TUR', 'DEF', 1, true)]), 'LAU would have a wage bill');
  perform pg_temp.act('su');
end $$;
select name, ok, detail from t_log order by n;
