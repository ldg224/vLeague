-- Preseason rounds: a round marked preseason is played for a preseason ladder and preseason stats (shown in purple),
-- kept apart from the real season. Additive; the live site ignores the column until the matching version is released.
-- Preseason rounds also stay "Counts for ladder: off", so the real ladder never includes them.
alter table public.rounds add column if not exists preseason boolean not null default false;
update public.rounds set preseason = true where week in (2, 3, 4);   -- Preseason Series 1 to 3
