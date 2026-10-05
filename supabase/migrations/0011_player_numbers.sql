-- 0.11.4: every player has a singlet number (1 to 99). Free agents can share one; at a club each number is used once.
-- If a player joins a club that already has his number, the database gives him the next free one (nearest above, then
-- from 1), so a draft never fails on a clash. Editing a number by hand to one a club mate has is refused instead.
-- The player's database ID is the existing `id` (4 digits, never reused), now shown in the Editor.

alter table public.players add column if not exists number int;
with n as (select id, ((row_number() over (order by id) - 1) % 99)::int + 1 as num from public.players where number is null)
update public.players p set number = n.num from n where p.id = n.id;
alter table public.players alter column number set not null;
alter table public.players drop constraint if exists players_number_range;
alter table public.players add constraint players_number_range check (number between 1 and 99);

create unique index if not exists players_club_number on public.players (club, number) where club is not null;

create or replace function public.players_free_number() returns trigger
language plpgsql as $$
declare n int;
begin
  if new.club is null then return new; end if;
  if tg_op = 'UPDATE' and new.club is not distinct from old.club then return new; end if;   -- number edited by hand: the index decides
  if not exists (select 1 from public.players p where p.club = new.club and p.number = new.number and p.id <> new.id) then return new; end if;
  select c into n from (
    select generate_series(new.number + 1, 99) as c union all select generate_series(1, new.number - 1)
  ) s where not exists (select 1 from public.players p where p.club = new.club and p.number = s.c and p.id <> new.id)
  order by (c < new.number), c limit 1;
  if n is null then raise exception 'That club already has a player for every number from 1 to 99.'; end if;
  new.number := n;
  return new;
end $$;
drop trigger if exists players_free_number on public.players;
create trigger players_free_number before insert or update of club on public.players
  for each row execute function public.players_free_number();
