-- The Stakes leaderboard lists every active club by club name, not just the managers who have opened Stakes (a wallet only exists after that).
-- Office accounts count too. A club whose manager has not played yet shows at the starting Coins. Same columns as before, so nothing on the page's data side changes.
create or replace function public.stakes_board() returns table (rank bigint, club text, name text, coins int, won int, settled int, mine boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (select start_coins from public.stakes_settings where id = 1),
  per as (
    select c.code, c.name,
           coalesce((select max(w.coins) from public.stakes_wallets w join public.profiles pr on pr.id = w.user_id where pr.club = c.code), (select start_coins from cfg)) as coins,
           (select count(*)::int from public.stakes_picks k join public.profiles pr on pr.id = k.user_id where pr.club = c.code and k.status = 'won') as won,
           (select count(*)::int from public.stakes_picks k join public.profiles pr on pr.id = k.user_id where pr.club = c.code and k.status in ('won', 'lost')) as settled,
           exists (select 1 from public.profiles me where me.id = auth.uid() and me.club = c.code) as mine
    from public.clubs c where c.status = 'active'
  )
  select rank() over (order by p.coins desc), p.code, p.name, p.coins, p.won, p.settled, p.mine
  from per p
  where auth.uid() is not null and (select show_board from public.stakes_settings where id = 1)
  order by 1, 3
$$;
revoke all on function public.stakes_board() from public, anon;
grant execute on function public.stakes_board() to authenticated;
