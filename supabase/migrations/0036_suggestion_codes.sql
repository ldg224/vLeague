-- 0.46.1: every "Suggest changes" submission gets a reference: B-nn for an issue (bug), S-nn for a suggestion, counting on from
-- the cards already on the Trello board (B-05 and S-18 at the time of writing). The `suggest` Edge Function calls
-- next_suggestion_code(); nobody can call it from the website. Needs 0035. Safe to re-run (the counters are only seeded once).

alter table public.suggestions add column if not exists code text;

create table if not exists public.id_counters (
  prefix text primary key check (prefix in ('B', 'S')),
  last   int  not null default 0
);
insert into public.id_counters (prefix, last) values ('B', 5), ('S', 18) on conflict (prefix) do nothing;
alter table public.id_counters enable row level security;
revoke all on public.id_counters from anon, authenticated;

create or replace function public.next_suggestion_code(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare p text := case p_kind when 'issue' then 'B' when 'suggestion' then 'S' end; n int;
begin
  if p is null then raise exception 'Unknown kind.'; end if;
  update public.id_counters set last = last + 1 where prefix = p returning last into n;
  return p || '-' || lpad(n::text, 2, '0');
end $$;
revoke all on function public.next_suggestion_code(text) from public, anon, authenticated;
grant execute on function public.next_suggestion_code(text) to service_role;
