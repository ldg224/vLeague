# Backend: Supabase (free)

vLeague's accounts and data live in **Supabase**, a hosted Postgres database with built-in accounts. The free plan
covers this easily: 50,000 monthly active users (we need about 10), a 500 MB database, 1 GB of file storage.
The website stays on GitHub Pages; it talks to Supabase directly from the browser.

A project that gets **no activity for 7 days is paused**. It's restored from the Supabase dashboard with one click
(nothing is lost). During the season the site keeps it active.

## How it's set up (as of 0.4.0)

Project `ywkhjpfzqtfssbxbvnbl` (Sydney). The URL and the **anon public** key are in `js/config.js`; both are safe to
publish, because the database rules decide what they can do. The `service_role` key never goes in the website.

**Authentication settings**

| Setting | Value |
|---|---|
| New sign-ups | **Off**. Accounts are made or invited by the league office. |
| Site URL | `https://ldg224.github.io/vLeague/` |
| Allowed redirects | `https://ldg224.github.io/vLeague/**`, `http://localhost:8767/**` (local testing) |
| Minimum password | 8 characters |
| Email | Gmail SMTP from **vLeague &lt;vleague.admin@gmail.com&gt;** (an app password, not the account password). Up to 30 emails an hour. |

Supabase's built-in email only reaches members of the Supabase organisation, 2 an hour, so the Gmail sender is what
makes invites and password resets work.

**Database** (`supabase/migrations/`, run in order):

| Table | What | Who can read | Who can change |
|---|---|---|---|
| `clubs` | Each club's public identity: code, name, colours, crest, manager name, status | Everyone, guests too | League office |
| `profiles` | One per account: role (`manager` or `office`) and club. Made automatically for every new account. | Yourself; the office reads all | League office only (nobody can promote themselves) |
| `team_sheets` | Each club's current team sheet (formation, tactics, XI, set pieces) | That club's manager and the office | That club's manager and the office |
| `club_requests` | A manager's request to set up or change their club's name, short name, code or crest, and the office's answer | That club's manager and the office | Only through the functions below |
| `news` | League news. For now only the crest reveal posted when the office approves a club (the full news system comes in 0.7) | Everyone, guests too | League office (and the approval function) |
| `deadlines` | The line-up deadline for each week (0.6), and when that week was locked | Everyone, guests too | League office; a locked week can't be moved or deleted |
| `team_sheet_versions` | Every save of every team sheet, with the time (kept by a trigger on `team_sheets`) | League office | Nobody directly |
| `week_sheets` | Each club's team sheet as it was at the week's deadline: what Simulate plays with, and the reveal | Everyone, guests too | Nobody directly; only `lock_due_weeks()` |

`clubs.setup_at` is empty until the club's manager has sent "Set up your club" (setup.html). Every manager, the
office's own club included, is taken there at sign-in while it's empty, and never again once it's sent, until the
office presses "Set up again" (Editor → Clubs), which empties it and starts the process again.

**Line-up deadlines** (0.6, `0005_lineup_deadlines.sql`; the user's decision, 1 October 2026). The office sets a
deadline per week (Editor → Deadlines). `lock_due_weeks()` runs every minute (pg_cron job `vleague-lock-weeks`): for
each deadline that has passed, it copies every club's last save from *before* the deadline into `week_sheets`, so a
late-running job never lets a later change in. Managers keep editing `team_sheets` at any time; after week N locks,
changes count for week N+1. Clubs that never saved get no row and the engine picks their team. The s3 Editor's
Simulate reads the fixture's week from `week_sheets` (with the anon key) and refuses to run before the week is
locked. The league's time zone is Australia/Melbourne; deadlines are stored as exact instants (timestamptz).

**Functions** (0.4, in `0003_club_setup.sql`). Managers never write `clubs` or `club_requests` directly; these check
everything and give readable errors:

| Function | Who | What |
|---|---|---|
| `update_club_style(p)` | A manager, for their own club | Colours, accent, motto, manager name, stadium. Applies straight away. |
| `submit_club_request(p)` | A manager, for their own club | Name, short name, code, crest, notes. Replaces any pending request; it's a `setup` until one is approved, then `change` (only what differs). Marks the wizard done. |
| `code_available(code)` | Signed in | Is a 3-letter code free (not another club's, not asked for by another club)? |
| `review_club_request(id, approve, note)` | League office | Approve (applies it; a new code cascades everywhere; posts the crest reveal) or send back with a note. |
| `reopen_club_setup(code)` | League office | Show that club's manager the wizard again at their next sign-in; the process starts again. |
| `office_accounts()` | League office | Every account with its email, club and sign-in state, for the Editor. |

**Edge Function `invite-manager`** (`supabase/functions/invite-manager/`): the Editor's "Invite a manager". Only the
office may call it. It emails the invite (link to `set-password.html`) and links the account to its club. It runs
on Supabase because it needs the service role key. Deploy or update it with
`python supabase/functions/deploy.py invite-manager`.

Storage bucket **`crests`**: public to read; PNG or WebP up to 500 KB; a manager can only add new files, and only in
their own club's folder (`tur/…`); only the office can replace or delete a file (0.4), so a new crest goes live only
when the office approves it. Crests are 512 px.

The league office is **lukedanielgrogan@gmail.com** (role `office`), and it's the only one. It also manages
FC Turtle (club `TUR`), so it signs in to FC Turtle's Home and reaches the Editor from the footer.

**Checking the rules:** `python supabase/tests/rls_check.py` acts as a guest, a manager, an account with no club
and the office, and checks what each can read and change (53 checks; nothing is left behind). Run it after any
database change. It needs the Management API token in `C:\Users\offic\.vleague\supabase-token.txt`.

## Adding a manager

In the **Editor → Managers**: enter their email, name and club, and press **Send invite**. They get an email from
vLeague, choose a password, and go through "Set up your club". Their request then appears in **Editor → Requests**.
The same list links an existing account to a club (or unlinks it) and sends a password link.

Forgotten passwords: "Forgot password?" on the sign-in page emails a link to `set-password.html`.
