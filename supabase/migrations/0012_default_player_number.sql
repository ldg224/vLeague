-- 0.11.5: a player added without a number (an older cached copy of the Editor page, or any other caller) gets a usual
-- number for his position instead of being refused. Runs before the club-clash trigger (triggers fire alphabetically).

create or replace function public.players_default_number() returns trigger
language plpgsql as $$
declare pool int[];
begin
  if new.number is null then
    pool := case new.position
      when 'GK'  then array[1, 12, 13, 21, 30]
      when 'DEF' then array[2, 3, 4, 5, 15, 16, 22, 23]
      when 'MID' then array[6, 8, 10, 14, 17, 18, 20]
      else            array[7, 9, 11, 19, 24, 27] end;
    new.number := pool[1 + floor(random() * array_length(pool, 1))::int];
  end if;
  return new;
end $$;
drop trigger if exists players_default_number on public.players;
create trigger players_default_number before insert on public.players
  for each row execute function public.players_default_number();
