-- 0.46.0: "Suggest changes". Managers send an issue or a suggestion from the footer; the `suggest` Edge Function saves it here
-- and makes a card on the league's Trello board. Nobody reads or writes this table from the website: only the function
-- (service role) does, which also checks the sender is a manager and limits how often they can send. Safe to re-run.

create table if not exists public.suggestions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  club        text,
  kind        text not null check (kind in ('issue', 'suggestion')),
  title       text not null check (char_length(title) between 3 and 80),
  details     text check (char_length(details) <= 1500),
  card_url    text,
  status      text not null default 'new' check (status in ('new', 'sent', 'failed')),
  created_at  timestamptz not null default now()
);
create index if not exists suggestions_user_time on public.suggestions (user_id, created_at desc);

alter table public.suggestions enable row level security;
revoke all on public.suggestions from anon, authenticated;
