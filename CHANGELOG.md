# Changelog

Every published version of the vLeague app. Newest first. How versions work and how to roll back:
`docs/RELEASING.md`.

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
