-- 0.32: the office decides when managers can see the Draft page, with one switch ("Make page visible").
-- Visible is separate from the draft's status, so managers can read the draft and build their queues before it starts.
-- Queues and auto-pick settings already work in any status (0023); the pick itself still needs a live draft (make_pick).
-- Drafts that are already live, paused or finished stay visible, so nothing changes for a draft in progress.

alter table public.drafts add column if not exists visible boolean not null default false;
update public.drafts set visible = true where status in ('live', 'paused', 'done');
