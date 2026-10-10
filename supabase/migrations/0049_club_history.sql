-- 0.65 (S-04): team pages. Each club gets a history the league office writes, and a list of honours.
--   history: short text (simple markdown: paragraphs, **bold**, *italic*), shown on the club's team page.
--   honours: [{ "name": "Championships", "count": 1 }, ...] in the order the office puts them.
-- Both are readable by anyone (clubs_read) and written only by the office (clubs_office_write), as with the rest of clubs.

alter table public.clubs add column if not exists history text
  check (history is null or char_length(history) <= 4000);

alter table public.clubs add column if not exists honours jsonb not null default '[]'::jsonb
  check (jsonb_typeof(honours) = 'array' and jsonb_array_length(honours) <= 20);
