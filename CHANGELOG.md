# Changelog

Every published version of the vLeague app. Newest first. How versions work and how to roll back:
`docs/RELEASING.md`.

## 0.8.2 (2026-10-05)

- **Fixed:** reverted 0.8.1 (bulk "Add clubs" in the Editor), which didn't work. The Editor is back as it was in 0.8.0.

## 0.8.0 (2026-10-02)

Clearer and simpler all round, after a look at everything a new manager would trip over.

- **Changed:** Settings is its own tab next to League (in the bottom bar on phones), instead of hiding behind the club
  crest at the top right. Settings is for managers only.
- **Removed:** the Start page setting. Everyone lands on Home.
- **Moved:** the office's "clubs without a team" email is a checkbox in Editor → Deadlines.
- **Fixed:** a new team sheet now saves itself as soon as you open it. Before, it showed a full XI but said "Not
  saved", so a manager who didn't press Save got the engine's team.
- **Changed:** on phones, tapping a position on the pitch opens the player list from the bottom of the screen, with
  that position's players first. Tapping a player first scrolls you to the pitch.
- **Changed:** tactics show the presets; the five sliders are under Custom.
- **Changed:** Inbox posts you've read stay read on all your devices.
- **Changed:** matches open in the same tab from Home, like they do from League.
- **Fixed:** opening the dashboard while signed in no longer signs you out; the corner button says Home instead.
- **Changed:** dashboard "Leaders" is "Top players". The empty board shows "Season 1" with the first kick-off.
- **Changed:** sign-in always shows the form ("View as guest" isn't remembered). `index.html?reset` opens Forgot
  password.
- **Changed:** invite links say "Welcome to vLeague" with your club's name. An expired link goes straight to "Get a
  new link".
- **Changed:** club setup is 3 steps (Club, Colours, Details) with no Review step, and one preview instead of five.
  A crest is optional (the code badge stands in). The code stays as it is unless you tap Change. Colours start from
  a default instead of an error.
- **Changed:** Edit club has a button per card. Club (name, code, crest): "Send to the office". Colours and Details:
  "Save". Changing only the note to the office no longer sends a request.
- **Changed:** Editor: one state per club (No manager, Invited, Setting up, Waiting for approval, Active). Changing an
  account's club asks first, and a club can't get a second manager. Deadlines has "Set all empty weeks to 1 h before
  kick-off". Database errors are in plain words. The header link says Home.
- **Removed:** hint lines, intro paragraphs and developer messages ("docs/BACKEND.md", "isn't switched on yet",
  "Result soon").
- **Changed:** the roadmap: light mode is 0.9 now, and everything after moves back one.

## 0.7.0 (2026-10-01)

Settings, and email reminders that only arrive when they're useful.

- **Added:** Settings, behind your club crest at the top right (it replaces the Sign out button; Sign out is in
  Settings now). Account: name, email, password, sign out, sign out on all devices. Appearance: accent (club colour
  or vLeague blue) and text size (four steps, with a preview). Matches: spoiler-free results, 12 or 24-hour clock,
  start page. Accessibility: reduce motion. Text size and motion are kept on this device; the rest follows your
  account.
- **Added:** spoiler-free results. Scores you haven't seen show as "Show score" on Home and League, and your place,
  points and form leave those results out until you show them ("N results hidden · Show all"). Opening a match
  counts as seeing it.
- **Added:** email reminders. A deadline reminder only if your club hasn't picked a team since the last week locked
  (24 hours before, 3 hours before, both, or off). Also: club changes sent back (on), line-ups out with your
  opponent's XI (off), a Monday round-up of the week's results (off), and for the league office, clubs without a team
  (on). Never twice, never between 10 pm and 8 am, and every email has a one-click "Turn these off". "Send me a test
  email" in Settings.
- **Changed:** every page follows the text size setting, including body text.
- **Added:** database tables `user_settings` and `email_log`, the reminder rules, and Edge Functions `send-reminders`
  and `email-unsubscribe` (migration `0006_settings_and_reminders.sql`). 16 more security checks (69 in all).
- **Changed:** the roadmap: 0.8 is light mode (a Theme setting), and everything after moves back one.

## 0.6.0 (2026-10-01)

Pick your team, with a line-up deadline each week.

- **Added:** My club → Team sheet: your XI on a pitch. Pick one of the engine's four formations, tap a slot then a
  player (or two players to swap), choose the captain, penalty, free-kick and corner takers, and set tactics with
  presets or five sliders. It saves itself as you go. Squad (ratings and stats) is its own tab.
- **Added:** a line-up deadline for each week, set by the league office (Editor → Deadlines). At the deadline every
  club's team sheet is locked for that week; managers can keep editing and changes count for the next week.
- **Added:** the reveal. Once a week locks, both clubs' XIs show on pitches on each club's Home, and the line-ups
  show on the dashboard's matchday board.
- **Changed:** Home's match card shows when your line-up locks and has "Pick your XI" again.
- **Changed:** line-ups now come out at the week's deadline instead of 10 minutes before kick-off.
- **Added:** database tables `deadlines`, `team_sheet_versions` and `week_sheets`, and a job that locks each week on
  time, to the second (migration `0005_lineup_deadlines.sql`). 12 more security checks (53 in all).
- **Changed (s3 site):** the Editor's Simulate plays each match with its week's locked team sheets and waits until
  the week is locked. The old Manager Hub's Lineup and Tactics tabs point to My club; press stays there for now.

## 0.5.1 (2026-10-01)

Home is about your club; League is about everyone.

- **Changed:** Home no longer repeats League. It shows the match card (full width), then **Your season** (position,
  points, W-D-L, goal difference, form and your last match) and **Coming up** (your next matches). The mini table
  and "Around the league" are gone: the full table and every match are on League, news is in Inbox.
- **Changed:** the To do card is gone. Unread news shows as the count on the Inbox tab; club changes with the league
  office show as a notice at the top of Home (with "Fix and resend" when they come back).
- **Removed:** the "Pick your XI" button on the match card until the XI picker arrives in 0.6.

## 0.5.0 (2026-10-01)

Home, and the four places a manager moves between.

- **Added:** Home, My club, Inbox and League, with a nav in the top bar (a bar along the bottom on phones) and an
  unread count on Inbox.
- **Added:** Home: the next match with a countdown and when the line-up locks (a live score and minute during the
  match), what needs doing (pick your XI, unread inbox, club changes sent back), the last result, your place in the
  table and what's happening around the league.
- **Added:** League: the full table with your club's row marked and form, matches by week with live and full-time
  scores, top scorers and assists.
- **Added:** My club: crest, motto, manager and code, Edit club, and the squad with appearances, goals, assists and
  average rating.
- **Added:** Inbox: league news for your club and crest reveals, newest first, with read and unread.
- **Changed:** win, draw and loss colours are shared by every page (`css/site.css`).

## 0.4.2 (2026-10-01)

- **Fixed:** on long signed-in pages (like Edit club), the club-colour glow repeated down the page every screen
  height and the footer sat in the middle of the page. The glow now shows once at the top, and the footer sits at the
  bottom.

## 0.4.1 (2026-10-01)

Tidier "Set up your club".

- **Changed:** much less text in the wizard and on Edit club: no intro paragraph or step counter, fewer hints,
  "Optional" next to optional fields, and the colour step only speaks up when it changes your colour.
- **Changed:** on Edit club, each section shows a small "Needs approval" or "Saves instantly" tag. The review step
  has tighter rows with Edit links.
- **Fixed:** an empty blue box under the title on every step.

## 0.4.0 (2026-10-01)

Set up your club.

- **Added:** "Set up your club" (setup.html), a wizard every manager goes through once at sign-in, the league
  office's own club included: name, short name and 3-letter code (checked live); primary and secondary colour with a
  contrast check and an exact preview of the club's accent; crest upload (fitted to 512 px, with previews on the
  band, the Home card and a table row); manager name, stadium, motto and notes for the office. It isn't shown again
  once sent, until the office switches it back on for that club.
- **Added:** colours, accent, motto, manager name and stadium change straight away. Name, short name, code and crest
  go to the league office for approval; Home shows "Waiting for the league office", or the office's note with
  "Fix and resend". "Edit club" on Home for later changes.
- **Added:** Editor tabs. **Requests**: each request against the club as it is, with the crest, colours and a
  preview; Approve (applies it, a new code carries through everywhere, and a crest reveal is posted to the new
  news table) or Send back with a note. **Clubs**: status, manager account, and "Set up again". **Managers**:
  invite a manager by email (the new `invite-manager` Edge Function), link or unlink an account, send a password link.
- **Changed:** managers can only add crest files, never replace or delete them, so a new crest goes live only when
  the office approves it.
- **Added:** database tables `club_requests` and `news`, the functions behind all of this, and 26 more security
  checks (41 in all, `supabase/tests/rls_check.py`). Migrations `0003_club_setup.sql` and `0004_crest_storage.sql`.

## 0.3.1 (2026-09-30)

- **Changed:** anyone with a club now signs in to their club's Home, including the league office account, which
  also manages FC Turtle. Office accounts get a quiet "Editor" link in Home's footer, and the Editor has a
  "My club" link back. Only an office account with no club goes straight to the Editor.

## 0.3.0 (2026-09-30)

Foundation: accounts, clubs and roles in the database.

- **Added:** Supabase tables for clubs, profiles (manager or league office, and their club) and team sheets, each
  with row-level security, so the database decides who can read and change what. A public `crests` storage bucket
  with the six club crests. The 8 Season 1 clubs imported. Security checks for guest, manager and office
  (`supabase/tests/rls_check.py`, 15 checks).
- **Added:** "Set your password" page for invite and reset emails, and "Forgot password?" on the sign-in page.
  Emails come from vLeague (vleague.admin@gmail.com).
- **Added:** Home (for managers; shows their club for now) and Editor (for the league office; lists the clubs and
  which have a manager account). Signing in takes you to the right one.
- **Changed:** sign-ups are off in Supabase (they had been left on), the site address is set for email links, and
  passwords need at least 8 characters.
- **Removed:** the placeholder Hello page, its photo slideshow and the two photos only it used.
- **Changed:** `docs/PLAN.md` is now the agreed roadmap to 1.0; `docs/BACKEND.md` describes the new setup;
  `docs/RELEASING.md` explains how to restart a GitHub Pages build that doesn't start.

## 0.2.5 (2026-09-30)

- **Changed:** the dashboard is the guest profile. Anyone who reaches it while signed in (for example with the
  browser's Back button) is signed out and treated as a guest from then on, and the top bar always shows
  "Sign in".
- **Removed:** the "My club" button that signed-in visitors saw on the dashboard (it only led to the
  placeholder Hello page).

## 0.2.4 (2026-09-30)

- **Fixed:** on the sign-in page, when the browser (e.g. Google autofill) fills in the email and password, the
  "Email" and "Password" labels now move up out of the way instead of sitting on top of the text, and the fields
  stay dark instead of taking Chrome's light autofill colour.

## 0.2.3 (2026-09-30)

- **Removed:** explanatory text on the dashboard: the "fixtures appear here…" line under "Season 1 kicks off
  soon", the empty-table note, the footer tagline and "League data updated…", and the long empty-state and poll
  wording. The Leaders section stays hidden until there are results.
- **Changed:** shorter wording: line-ups "Out at 7:50 pm", "No fixtures yet.", "No news yet.", "Result soon",
  "Club poll: …". The footer is just the version number.

## 0.2.2 (2026-09-30)

- **Removed:** the Matches / Table / News links in the dashboard's top bar. They only scrolled down the same
  page; the bar is now just the vLeague crest and Sign in.

## 0.2.1 (2026-09-30)

- **Changed:** a new sign-in page: one centred column (crest, email, password, Sign in, View as guest) on the
  pitch's centre circle and halfway line, which draw in once on load. Labels sit inside the fields.
- **Removed:** the photos and the extra text on the sign-in page (the subtitle, the "or" divider, the guest
  explanation and the note about accounts).
- **Added:** the version number at the bottom of the sign-in page.

## 0.2.0 (2026-09-30)

Guest access.

- **Added:** "View as guest" on the sign-in page. Guests need no account; a returning guest goes straight to the
  dashboard, and `index.html?signin` always shows the form.
- **Added:** the dashboard (`dashboard.html`): matchday board (live score and scorers, or the next kick-off with
  a countdown), line-ups from 10 minutes before kick-off, matches by week, the table, league news for guests
  (no poll results) and the leaders. It reads the s3 site's public data until the league moves to Supabase.
- **Added:** `docs/PLAN.md` (roadmap, what guests and members see, news audiences), this changelog,
  `docs/RELEASING.md`, and the version number in the dashboard footer.

## 0.1.1 (2026-09-30)

- **Changed:** the sign-in page no longer has a headline over the photos.
- **Added:** the connection to the vLeague Supabase project (project URL and anon public key in `js/config.js`),
  so signing in works.

## 0.1.0 (2026-09-30)

First version.

- **Added:** the sign-in page (email and password, "Keep me signed in") and the first signed-in page (`hello.html`).
