-- 0096 release fees: releases past the window's limit go through with a fee of 10% of the wage, on the bill until the office clears it.
do $$
declare t1 text; t2 text; t3 text; t4 text; t5 text; l1 text; l2 text; l3 text; fa text; b0 int; sq int; m3 bigint; m4 bigint; f3 bigint; st jsonb; n int;
begin
  t1 := pg_temp.pl('TUR', 'MID', 1); t2 := pg_temp.pl('TUR', 'MID', 2); t3 := pg_temp.pl('TUR', 'FWD', 1, true); t4 := pg_temp.pl('TUR', 'DEF', 1);
  t5 := pg_temp.pl('TUR', 'GK', 1);
  l1 := pg_temp.pl('LAU', 'MID', 1); l2 := pg_temp.pl('LAU', 'MID', 2); l3 := pg_temp.pl('LAU', 'DEF', 1);
  update public.office_settings set cap = 10000000, squad_min = 11, pos_min = '{"GK": 0, "DEF": 0, "MID": 0, "FWD": 0}'::jsonb;
  delete from public.office_release_fees where club in ('TUR', 'LAU');   -- a known start (rolled back)

  perform pg_temp.ok('fee: 10% of the wage, rounded to the dollar', public.office_release_fee(12345) = 1235 and public.office_release_fee(0) = 0);

  -- ---- within the limit: free
  perform pg_temp.act('tur');
  perform public.office_release(t1);
  perform public.office_release(t2);
  perform pg_temp.act('su');
  perform pg_temp.ok('within the limit: no fee', not exists (select 1 from public.office_release_fees where club = 'TUR'));

  -- ---- past the limit: allowed, with a fee on the bill
  sq := (select sum(value) from public.players where club = 'TUR')::int;
  perform pg_temp.act('tur');
  m3 := public.office_release(t3);
  perform pg_temp.act('su');
  select id into f3 from public.office_release_fees where club = 'TUR' and player = t3 and cleared_at is null;
  perform pg_temp.ok('past the limit: the release goes through', pg_temp.club_of(t3) is null and m3 is not null);
  perform pg_temp.ok('past the limit: a fee of 10% of his wage, tied to the move', exists (select 1 from public.office_release_fees where id = f3 and move_id = m3
    and wage = pg_temp.wage(t3) and fee = round(pg_temp.wage(t3) * 0.1)::int));
  perform pg_temp.ok('the bill counts the fee', public.office_bill('TUR') = sq - pg_temp.wage(t3) + round(pg_temp.wage(t3) * 0.1)::int,
    public.office_bill('TUR')::text);
  perform pg_temp.ok('the move logs the bill with the fee', (select bill_after from public.office_moves where id = m3) = public.office_bill('TUR'));
  perform pg_temp.act('tur');
  m4 := public.office_release(t4);
  st := public.office_state();
  perform pg_temp.act('su');
  perform pg_temp.ok('state: the fees listed and added up, used past the limit', (st ->> 'fees')::int = round(pg_temp.wage(t3) * 0.1)::int + round(pg_temp.wage(t4) * 0.1)::int
    and jsonb_array_length(st -> 'release_fees') = 2 and (st #>> '{releases,used}')::int = 4 and (st #>> '{releases,left}')::int = 0
    and (st #>> '{releases,fee_pct}')::int = 10 and (st ->> 'wage_bill')::int = public.office_bill('TUR'), st::text);
  perform pg_temp.act('lau');
  perform pg_temp.ok('office_club: shows the fees', (public.office_club('TUR') ->> 'fees')::int = (st ->> 'fees')::int);
  perform pg_temp.act('tur');

  -- ---- the manager cannot get rid of it
  perform public.office_sign(t3);   -- sign him back
  perform pg_temp.act('su');
  perform pg_temp.ok('signing him back keeps the fee', exists (select 1 from public.office_release_fees where id = f3 and cleared_at is null));
  update public.office_settings set window_started_at = now() + interval '1 second';
  perform pg_temp.act('tur');
  st := public.office_state();
  perform pg_temp.ok('a new window: the count starts again, the fees stay', (st #>> '{releases,used}')::int = 0 and jsonb_array_length(st -> 'release_fees') = 2, st::text);
  perform pg_temp.err('a manager cannot clear a fee', format('select public.office_clear_release_fees(array[%s]::bigint[])', f3), 'Only the league office');
  perform pg_temp.err('a manager cannot write the fees table', format('update public.office_release_fees set cleared_at = now() where id = %s', f3), 'permission denied');
  perform pg_temp.err('a manager cannot delete a fee', format('delete from public.office_release_fees where id = %s', f3), 'permission denied');
  perform pg_temp.act('lau');
  perform pg_temp.ok('everyone signed in reads the fees', (select count(*) from public.office_release_fees where club = 'TUR' and cleared_at is null) = 2);
  perform pg_temp.act('anon');
  perform pg_temp.err('a signed-out visitor reads nothing', 'select count(*) from public.office_release_fees', 'permission denied');

  -- ---- the fee counts against the cap (over_limit 0 here: a hard cap)
  perform pg_temp.act('su');
  update public.office_settings set cap = public.office_bill('TUR') + pg_temp.wage(pg_temp.pl(null, 'DEF', 1)) - 1;
  fa := pg_temp.pl(null, 'DEF', 1);
  perform pg_temp.act('tur');
  perform pg_temp.err('the cap counts the fees: a signing that only fits without them is refused', format('select public.office_sign(%L)', fa), 'over the cap');
  perform pg_temp.act('su');
  update public.office_settings set cap = 10000000;

  -- ---- the office clears one, then all; undoing a release clears its fee
  perform pg_temp.act('office');
  n := public.office_clear_release_fees(array[f3]);
  perform pg_temp.act('su');
  perform pg_temp.ok('office: clears one fee', n = 1 and (select cleared_at is not null from public.office_release_fees where id = f3)
    and public.office_fees('TUR') = round(pg_temp.wage(t4) * 0.1)::int);
  perform pg_temp.act('office');
  perform public.office_undo(m4);
  perform pg_temp.act('su');
  perform pg_temp.ok('office: undoing a release clears its fee', public.office_fees('TUR') = 0 and pg_temp.club_of(t4) = 'TUR'
    and (select note from public.office_release_fees where move_id = m4) = 'release undone');

  -- ---- queued releases past the limit are not refused; each past the limit gets its fee when the window opens
  update public.office_settings set window_open = false;
  perform pg_temp.act('lau');
  perform pg_temp.ok('queue: three releases wait (no cap on releases waiting)', public.office_release(l1) is null and public.office_release(l2) is null and public.office_release(l3) is null);
  perform pg_temp.act('office');
  perform public.office_save_settings('{"window_open": true}'::jsonb);
  perform pg_temp.act('su');
  perform pg_temp.ok('queue: all three go through when the window opens', pg_temp.club_of(l1) is null and pg_temp.club_of(l2) is null and pg_temp.club_of(l3) is null,
    (select string_agg(status || ' ' || coalesce(note, ''), '; ') from public.office_queue where club = 'LAU'));
  perform pg_temp.ok('queue: only the third carries a fee', (select count(*) from public.office_release_fees where club = 'LAU' and cleared_at is null) = 1
    and exists (select 1 from public.office_release_fees where club = 'LAU' and player = l3 and fee = round(pg_temp.wage(l3) * 0.1)::int));

  -- ---- clear all (the end of the season)
  perform pg_temp.act('office');
  n := public.office_clear_release_fees(null);
  perform pg_temp.act('su');
  perform pg_temp.ok('office: clear all clears every fee still standing', n >= 1 and not exists (select 1 from public.office_release_fees where cleared_at is null));
  perform pg_temp.act('office');
  perform pg_temp.err('office: nothing left to clear', 'select public.office_clear_release_fees(null)', 'no release fees');
  perform pg_temp.act('su');
end $$;
select name, ok, detail from t_log order by n;
