# Draft (planned, 0.21)

A limited-time, slow ("asynchronous") draft, modelled on getdraftednow.com: a live board, queue-ranked auto-picks, per-pick
timers the office can pause and extend, and commissioner overrides. Managers pick players into their clubs; the office runs it.

## What getdraftednow does (what we copy)

- Live draft board: current pick, order, available players and recent picks update for everyone without a refresh.
- **Queue**: each drafter ranks players ahead of time; if their timer runs out the best available player in the queue is taken.
- **Timers** per pick (minutes or hours); the commissioner can pause, resume and extend.
- **Commissioner controls**: override a pick, pause, set the order, roster rules.
- Notifications when it's your turn, with a warning before an auto-pick.
- (Not copied: magic invite links, we already have accounts.)

## What vLeague needs (from the brief)

1. **Auto-assign players**: the office can fill rosters automatically (best available by value, within each club's budget/roster size).
2. **Editable draft order**: any order, any pick, including snake or custom per round; swap picks between clubs.
3. **Queue**: each manager ranks players; the draft uses it.
4. **Auto-pick setting per club** (the manager chooses, the office can override):
   - `always`: pick from my queue the moment it's my turn.
   - `on_miss`: pick from my queue only if I miss my turn (the pick timer runs out).
   - `after_minutes`: pick from my queue after N minutes of my turn (N set by the manager, not above the pick timer).
   - `never`: the queue is only a reference; a missed turn is skipped or auto-picked by the office's choice.
5. **Active team value page**: each club's roster with every player's value and the club total, live as picks are made.
6. A **limited-time Draft section** for managers (only visible while a draft is open).

## Data (shared contract between the manager side and the admin side)

All tables: readable by everyone signed in; written only as noted. Pick-making goes through one database function so the rules
(whose turn, player free, deadline) can't be bypassed.

| Table | Columns | Who writes |
|---|---|---|
| `drafts` | `id`, `name`, `status` (`setup`/`live`/`paused`/`done`), `opens_at`, `closes_at`, `pick_minutes`, `on_timeout` (`skip`/`queue`/`best_value`), `rounds`, `current_pick`, `pick_deadline` | office |
| `draft_order` | `draft`, `pick_no`, `club` | office (editable until the pick is made) |
| `draft_picks` | `draft`, `pick_no`, `club`, `player`, `made_at`, `how` (`manual`/`queue`/`auto`/`office`) | only `make_pick()` / `office_set_pick()` |
| `draft_queue` | `draft`, `club`, `rank`, `player` | that club's manager |
| `draft_prefs` | `draft`, `club`, `mode` (`always`/`on_miss`/`after_minutes`/`never`), `minutes` | that club's manager (office can edit) |

Functions: `make_pick(draft, player)` (the manager whose turn it is), `office_set_pick(draft, pick_no, club, player)` (override),
`office_advance(draft)` (pause/resume/extend/skip), `draft_tick()` (pg_cron, every minute: applies auto-pick rules when a
deadline passes or a club's `after_minutes` is reached), `office_autofill(draft)` (auto-assign the rest).
A pick sets `players.club` (and so each club's value). **Active team value** = sum of `players.value` for a club's current roster
(a view, `club_values`).

## Build order (admin side, this session)

1. Migration `0023_draft.sql`: the five tables, RLS, `make_pick`, `office_set_pick`, `office_advance`, `club_values` view;
   rolled-back tests added to `rls_check.py`.
2. Migration `0024_draft_tick.sql`: `draft_tick()` + pg_cron job (auto-pick by `draft_prefs`, timers, notifications queued in `email_log`).
3. Editor → **Draft** tab, in this order: (a) create a draft (name, window, pick timer, rounds, snake); (b) **draft order** editor
   (drag to reorder, swap picks, snake/reverse/randomise buttons, per-pick overrides); (c) live board with pause/resume/extend/skip/
   override-a-pick; (d) **Auto-assign the rest** with a preview and Undo; (e) every club's queue and auto-pick mode, visible and editable.
4. Email: "you're on the clock" and "auto-pick in N minutes" (reuse `send-reminders`).
5. Release 0.21.0.

## Build order (manager side, other session)

1. A **Draft** page/section, shown only while a draft is `live` or `paused` and inside `opens_at`..`closes_at`.
2. Board: whose turn, countdown to `pick_deadline`, recent picks, available players (search + position filter).
3. **My queue**: add/remove/reorder players (`draft_queue`), with a "Pick now" button when it's my turn (`make_pick`).
4. **Auto-pick settings** (`draft_prefs`): the four modes above, with the minutes box for `after_minutes`.
5. **Team values** page: every club's roster and total (`club_values`), mine highlighted, live.
