-- 0.18.0: league news the office can write (Editor -> News).
-- A post is for everyone (guests too), for every manager, or for chosen clubs. The database decides who can read it,
-- so a post meant for two clubs can't be read by anyone else, even by calling the API directly.

alter table public.news add column if not exists audience text[];                        -- club codes; null = every club
alter table public.news add column if not exists public   boolean not null default true; -- guests may read it
alter table public.news add column if not exists pinned   boolean not null default false;

alter table public.news drop constraint if exists news_post_shape;
alter table public.news add constraint news_post_shape check (
  char_length(title) between 1 and 120
  and (body is null or char_length(body) <= 4000)
  and (audience is null or cardinality(audience) between 1 and 40)
  and (not public or audience is null)            -- a post for guests is for everyone
);

-- Everything that already exists (crest reveals) stays public. Posts follow their audience.
drop policy if exists news_read on public.news;
create policy news_read on public.news for select to anon, authenticated using (
  public
  or (auth.uid() is not null and (public.is_office() or audience is null or public.my_club() = any (audience)))
);
