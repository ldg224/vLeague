-- Club money (22 Nov 2026): the league office records the money it collects from each club, in Editor → Clubs.
-- Each payment is one row (amount, the day it was recorded, a short note). An optional fee per club lets the Editor
-- show who has paid in full and who still owes. Office only: managers can't see or change any of it.
-- Safe to re-run. Needs 0001 (is_office).

create table if not exists public.club_payments (
  id           bigserial primary key,
  club         text not null references public.clubs (code) on update cascade on delete cascade,
  amount_cents int not null check (amount_cents between 1 and 100000000),
  paid_on      date not null default current_date,
  note         text check (note is null or length(note) <= 80),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists club_payments_club on public.club_payments (club, paid_on);

create table if not exists public.money_settings (
  id        int primary key default 1 check (id = 1),
  fee_cents int check (fee_cents is null or fee_cents between 0 and 100000000),   -- what each club is meant to pay; null = not set
  updated_at timestamptz not null default now()
);
insert into public.money_settings (id) values (1) on conflict (id) do nothing;

alter table public.club_payments enable row level security;
alter table public.money_settings enable row level security;
revoke all on public.club_payments from anon, authenticated;
revoke all on public.money_settings from anon, authenticated;

drop policy if exists club_payments_office on public.club_payments;
create policy club_payments_office on public.club_payments for all to authenticated
  using (public.is_office()) with check (public.is_office());
grant select, insert, update, delete on public.club_payments to authenticated;
grant usage on sequence public.club_payments_id_seq to authenticated;

drop policy if exists money_settings_office on public.money_settings;
create policy money_settings_office on public.money_settings for all to authenticated
  using (public.is_office()) with check (public.is_office());
grant select, update on public.money_settings to authenticated;
