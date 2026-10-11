-- WR-30: the league's Instagram on the Overview page. One row (id = 1) the office edits in Editor -> News:
--   instagram_url    the account's address (a profile link on instagram.com)
--   instagram_posts  up to two post links, newest first, shown as Instagram's own embed
--   followers, posts optional numbers the office types in (Instagram's feed needs a login we don't use), shown only when set
-- Everyone can read it (it is public information); only the office writes. Additive and safe to re-run.

create or replace function public.ig_post_ok(u text) returns boolean
language sql immutable as $$ select u ~ '^https://www\.instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]{5,30}/$' $$;

create or replace function public.ig_posts_ok(a text[]) returns boolean
language sql immutable as $$ select cardinality(a) <= 2 and coalesce((select bool_and(public.ig_post_ok(p)) from unnest(a) p), true) $$;

create table if not exists public.league_social (
  id               int primary key default 1 check (id = 1),
  instagram_url    text not null default 'https://www.instagram.com/vleague.official/'
                   check (instagram_url ~ '^https://www\.instagram\.com/[A-Za-z0-9._]{1,30}/$'),
  instagram_posts  text[] not null default '{}'
                   check (public.ig_posts_ok(instagram_posts)),
  followers        int check (followers is null or followers between 0 and 100000000),
  posts            int check (posts is null or posts between 0 and 1000000),
  updated_at       timestamptz not null default now()
);

insert into public.league_social (id) values (1) on conflict do nothing;

alter table public.league_social enable row level security;
drop policy if exists league_social_read on public.league_social;
create policy league_social_read on public.league_social for select to anon, authenticated using (true);
drop policy if exists league_social_office on public.league_social;
create policy league_social_office on public.league_social for all to authenticated using (public.is_office()) with check (public.is_office());
grant select on public.league_social to anon, authenticated;
grant insert, update, delete on public.league_social to authenticated;
