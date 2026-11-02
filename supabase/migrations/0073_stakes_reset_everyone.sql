-- Reset wallets reaches everyone (2 Nov 2026): a wallet is only made when a manager first opens Stakes, so the reset used to skip anyone who had not yet, and they
-- later started at the setting's starting Coins instead of the reset amount. Now every account gets a wallet at the reset amount, opened or not. Safe to re-run.
create or replace function public.stakes_reset(p_coins int default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.stakes_settings := public.stakes_cfg(); target int; w record; n int := 0; today date := (now() at time zone 'Australia/Melbourne')::date;
begin
  if not public.is_office() then raise exception 'only the league office can reset wallets'; end if;
  target := coalesce(p_coins, c.start_coins);
  if target < 0 or target > 1000000 then raise exception 'pick an amount from 0 to 1,000,000'; end if;
  delete from public.stakes_picks where status = 'open';
  for w in select user_id, coins from public.stakes_wallets for update loop
    update public.stakes_wallets set coins = target, claimed_on = today where user_id = w.user_id;
    insert into public.stakes_ledger (user_id, delta, reason, balance_after) values (w.user_id, target - w.coins, 'reset', target);
    n := n + 1;
  end loop;
  for w in select pr.id as user_id from public.profiles pr where not exists (select 1 from public.stakes_wallets x where x.user_id = pr.id) loop
    insert into public.stakes_wallets (user_id, coins, claimed_on) values (w.user_id, target, today);
    insert into public.stakes_ledger (user_id, delta, reason, balance_after) values (w.user_id, target, 'reset', target);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.stakes_reset(int) from public, anon;
grant execute on function public.stakes_reset(int) to authenticated;
