# Draft (planned, 0.21)

A limited-time, slow ("asynchronous") draft, modelled on getdraftednow.com: a live board, queue-ranked auto-picks, per-pick
timers the office can pause and extend, and commissioner overrides. Managers pick players into their clubs; the office runs it.

## What getdraftednow does (what we copy)

- Live draft board: current pick, order, available players and recent picks update for everyone without a refresh.
- **Queue**: each drafter ranks players ahead of time; if their timer runs out the best available player in the queue is taken.
- **League-wide auto-pick** (0038): the office can set `drafts.auto_after_minutes`; every club's queue then picks that many active minutes into its turn, and managers can't change it (the clock ignores their own setting; the draft page shows it locked). Blank = managers choose.
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
6. A **Draft section** for managers, shown once the office switches **Make page visible** on (0.32).

## Data (shared contract between the manager side and the admin side)

All tables: readable by everyone signed in; written only as noted. Pick-making goes through one database function so the rules
(whose turn, player free, deadline) can't be bypassed.

| Table | Columns | Who writes |
|---|---|---|
| `drafts` | `id`, `name`, `status` (`setup`/`live`/`paused`/`done`), `opens_at`, `closes_at`, `pick_minutes`, `on_timeout` (`skip`/`queue`/`best_value`), `rounds`, `current_pick`, `pick_deadline`, `visible` (0.32, the Make page visible switch) | office |
| `draft_order` | `draft`, `pick_no`, `club` | office (editable until the pick is made) |
| `draft_picks` | `draft`, `pick_no`, `club`, `player`, `made_at`, `how` (`manual`/`queue`/`auto`/`office`) | only `make_pick()` / `office_set_pick()` |
| `draft_queue` | `draft`, `club`, `rank`, `player` | that club's manager |
| `draft_prefs` | `draft`, `club`, `mode` (`always`/`on_miss`/`after_minutes`/`never`), `minutes` | that club's manager (office can edit) |

Functions: `make_pick(draft, player)` (the manager whose turn it is), `office_set_pick(draft, pick_no, club, player)` (override),
`office_advance(draft)` (pause/resume/extend/skip), `draft_tick()` (pg_cron, every 5 seconds since 0037: applies auto-pick rules when a
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

1. A **Draft** page/section, shown when `drafts.visible` is true (0.32), in any status. Managers can read it and build queues before the
   draft starts; picking needs `live` and inside `opens_at`..`closes_at`. (Before 0.32: live or paused inside the window.)
2. Board: whose turn, countdown to `pick_deadline`, recent picks, available players (search + position filter).
3. **My queue**: add/remove/reorder players (`draft_queue`), with a "Pick now" button when it's my turn (`make_pick`).
4. **Auto-pick settings** (`draft_prefs`): the four modes above, with the minutes box for `after_minutes`.
5. **Team values** page: every club's roster and total (`club_values`), mine highlighted, live.

## Active times (0.28)

`drafts.quiet` is a list of quiet windows when the pick timer doesn't run: `[{"days":[0..6],"from":"22:00","to":"07:00"}]`
(days it starts on, 0 = Sunday; Melbourne time; `to` at or before `from` ends the next morning). Only the clock stops: picks by
managers and the office still work in quiet time. `pick_deadline` is always "N active minutes after `pick_started`", worked out
by `_draft_add_active()` when a pick starts (and when the office extends or resumes); `office_set_quiet()` changes the schedule
and keeps the current pick's remaining active time; `draft_quiet_state()` tells the page whether it's quiet now and how much
active time is left, so the clock can freeze. "After N minutes" auto-picks count active minutes from `pick_started`. A club on
"always" still picks the moment it's its turn.

## A missed pick is a random pick (0.28.1)

A turn that times out with nothing usable in the queue, and the office's "Random pick for them", pick a random free player the
club may take (`_draft_random_fit()`, which uses `_draft_can_pick()`: position maximums, and minimums that stay reachable). The
pick is only skipped (`how = 'skip'`) if nobody left fits. The stored `on_timeout` values are unchanged: `skip` now means "random
player who fits", `queue` means "queue, else random who fits", `best_value` is the best-value player who fits.

## Emails, live updates and the phone page (0.29)

Two emails go through the normal reminder system (`due_emails()` in `0031_draft_notifications.sql`, composed by `send-reminders`):
`draft_turn` ("you're on the clock", once per pick) and `draft_warn` (about 120 minutes of active timer left, only for picks of 180
minutes or more). The setting is `email.draft` = `both` (default) | `turn` | `off`; unsubscribing from either switches it off. They aren't
sent in the draft's quiet times, between 10 pm and 8 am Melbourne, or to a club whose auto-pick is "always". The page subscribes to
Supabase realtime on `draft_picks` and `drafts` (they're in the `supabase_realtime` publication) and refreshes on any change, with the
15 s poll as a backup. Players' cards and the pick dialog are `<dialog>` elements built in `js/draft.js`.

## Taking a pick back (0039, 0.52.0)
The pick on the clock is the lowest pick with no row in `draft_picks`, so picks no longer have to be made in order. `office_remove_pick(draft, pick_no)` deletes one made pick and frees its player; the clock moves to the lowest open pick (fresh timer if live; a finished draft is paused). The Editor shows a red × on each made pick. Queues are saved with `save_draft_queue()` (one transaction).
