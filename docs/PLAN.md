# vLeague app: roadmap

Agreed on 30 September 2026 (Alpha and Bravo's research and plan, reviewed and approved by the user).
One minor version per step, released with the rules in `docs/RELEASING.md`. Tick items off as they ship.

**The idea:** a manager doesn't "open the manager portal"; they sign in and walk into their club (their colours,
next match, XI, inbox). Guests get one beautiful matchday page. One league, one site.

## Decisions

- **Club colours lean the design; they don't change the page.** The page stays vLeague navy with blue buttons and a
  white LIVE. A club shows only as accents: the band across the top, the crest, a soft glow behind its Home match
  card, its pitch, its charts, its table row. The accent is worked out once when colours are saved and lifted if
  too dark to see (Lads United's navy); white or grey clubs use vLeague blue.
- **Guests stay fully signed out.** The dashboard is the guest profile and signs out anyone who arrives signed in.
  No guest accounts for now.
- **No chat, ever, and nothing sent to the league's WhatsApp group** (it stays for personal messages). Reactions on
  the site instead. The league doesn't use Discord.
- **Registration:** "Set up your club" at a manager's first sign-in now (0.4); a public "Enter a club" page with a
  registration window only after 1.0.
- **Deadline day:** not now, but the Editor gets the option to set one up (off by default).
- **No history import** for now.
- **Match files (about 2 MB each) stay on GitHub Pages**; Supabase keeps only result summaries. Its free plan allows
  5 GB of downloads a month.
- Four places for managers: **Home, My club, Inbox, League**. The office also gets the **Editor**.

## Steps

### 0.1 – 0.2: done
Sign-in page, "View as guest", the guest dashboard, the dashboard as the guest profile, version numbers.

### 0.3: Foundation (done in 0.3.0)
- [x] Supabase tables `clubs`, `profiles`, `team_sheets` with row-level security; `crests` bucket; 8 clubs imported
      with crests; the league office account.
- [x] Auth settings: sign-ups off, site URL, redirects, Gmail sender, 8-character passwords.
- [x] "Set your password" page (invites and resets), "Forgot password?", sign-in goes to Home or Editor by role.
- [x] Placeholder Home and Editor; security checks (`supabase/tests/rls_check.py`).
- Team sheets are private to the club and the office; from 0.6 each week's locked copy is public.

### 0.4: Set up your club (done in 0.4.0)
- [x] Four-step wizard at first sign-in: name (≤25) / short name (≤12) / 3-letter code; primary and secondary
      colour with live contrast check; crest upload with previews; manager name, stadium, motto, notes for the office.
- [x] The accent colour computed on save and previewed exactly.
- [x] Office approval queue (approve, or send back with a note); a crest reveal posted to news on approval.
      Later changes to name, code or crest go back for approval; colours and motto change instantly.
- [x] Editor: invite a manager and link them to a club.
- Every manager (the office's club too) sees the wizard once; it isn't shown again until the office presses
  "Set up again" for that club, which starts the process again. (User's decision, 1 October 2026.)
- Known limits, for a later patch: a short name can't be cleared once set; the accent a manager saves isn't
  re-checked by the database; a crest path isn't checked to exist.

### 0.5: Home (done in 0.5.0)
- [x] Home, My club, Inbox and League, with the club band and accents.
- [x] Home: next match with countdown and "line-up locks in …", what needs doing, last result, table position,
      league activity feed.

### 0.6: My club (done in 0.6.0)
- [x] The XI on a pitch (tap to swap, formation, captain, set pieces, tactics), saved to `team_sheets`.
- [x] A line-up deadline per week, set by the office (Editor → Deadlines). At the deadline every club's sheet is
      locked for that week and revealed on both clubs' Homes and the dashboard. Managers keep editing; changes
      count for the next week. (User's decision, 1 October 2026: not T-10, because results are often simulated in
      advance. League time zone: Australia/Melbourne.)
- [x] The s3 editor's Simulate reads team sheets from Supabase; the s3 Manager Hub's line-up and tactics tabs point to My club (press stays there until 0.10).

### 0.7: Settings and email reminders (done in 0.7.0)
- [x] Settings (settings.html), its own tab from 0.8.0 (managers only): account (name, email, password, sign out, sign
      out everywhere), email reminders, accent (club colour or vLeague blue), text size, spoiler-free results,
      12/24-hour clock, reduce motion (start page dropped in 0.8.0). Appearance stays per device; the rest follows the account.
- [x] Email reminders that are useful, not annoying: a deadline reminder only when the club hasn't picked a team
      (24 h, 3 h, both or off), club changes sent back, line-ups out (opt-in), weekly round-up (opt-in), and for the
      office, clubs without a team. Never twice, never between 10 pm and 8 am, one-click unsubscribe in every email.

### 0.8: Clearer and simpler (done in 0.8.0)
- [x] A review of everything a new manager sees: Settings as a tab, a team sheet that saves itself, a phone-friendly
      player picker, 3-step club setup with an optional crest, plainer Editor states and copy.

### 0.9: Light mode (done in 0.9.0)
- [x] A Theme setting (Dark / Light / System), per device, Dark by default. Colour tokens replace the hard-coded colours; the pitch and matchday
      board stay dark on purpose. No second per-club accent for light mode (user's decision, 5 October 2026: clubs
      have already registered, so club colours stay as they are).

### 0.10: Manager phone numbers (done in 0.10.0)
- [x] A pinned Inbox post asks every manager for a phone number; stored privately (that club and the office only).
- [x] Editor → Phones: who has added one, Copy all, Download CSV.

### 0.11: Teams and players on Supabase (players done in 0.11.0)
Agreed 5 October 2026: vLeague stops relying on the s3 site (s3 stays a standalone test site, neither affects the
other). Players come first so everything else can use them. Clubs are already in Supabase (0.8.1 to 0.8.6).
vLeague starts clean: no fixtures or results are carried over from s3 (decided 5 October 2026).
- [ ] `players` table (`0008_players.sql`): id (4-digit text, so the 80 old ids keep working; new ones from a
      sequence), name, position (GK/DEF/MID/FWD), offense and defense (1 to 10), club (empty = free agent).
      Everyone can read; only the league office writes (`is_office()`). The 80 s3 players are copied in once as a
      starting pool, with their ids, as free agents unless their club exists here.
- [ ] **Editor → Players**, built for speed:
      1. *Generate*: pick how many (default "fill every club to 16, plus 20 free agents"), press Generate, see a
         preview table, re-roll any single row, Accept. Nothing is saved until Accept.
      2. *Table*: every player, filter by club / position / free agents, edit a cell in place, move a player to a
         club (or free agent), delete. Changes save as you go with an Undo toast.
      3. *Paste a list*: one player per line (`Name, FWD, 8, 3`); anything missing is filled in.
- [ ] **Name generator** (`js/names.js`, loaded only in the Editor): about 18 cultures with first and last names,
      the culture picked per player at random (weighted, editable); never repeats a first name or a last name
      across the whole pool, checked against existing players too, so no two players look alike.
- [ ] **Rating generator**: a position-shaped spread, not flat random: GKs are defence-heavy, DEF lean defence,
      FWD lean offence, MID balanced; most players 4 to 7 with a few stars and a few weak links. A "Squad
      strength" slider (low / even / mixed) so generated clubs are about equal by default. At least 2 GKs per
      club and at least 24 in the pool.
- [ ] Squads are 16 (XI + 5 bench: 2 GK, 5 DEF, 5 MID, 4 FWD) as the target the generator fills; the app never
      blocks a club with fewer (a squad needs only 11 including a GK to be simulated).
- [ ] The app reads squads from Supabase (My club, the dashboard's top players, line-up picker); the shared loader
      is cached in the browser for a few minutes and fetches only the columns a page needs (about 25 KB total).
- [ ] The weekly budget and prices (`500 + 7500 * ((rating-1)/8)^1.8`) are NOT in 0.11; they come with squads in
      0.12 once the real cap is confirmed. Prices will be worked out from ratings, never stored.
- Free-plan care: a few small reads per page; 500 MB database and 5 GB monthly transfer are nowhere near. A weekly
  backup export and keep-alive are optional extras.

### 0.12: Fixtures and results on Supabase (design agreed 5 October 2026; not started)
vLeague starts clean: no fixtures or results are copied from the s3 test site. After this release nothing in the app
reads s3 any more (the dashboard, Home, League, Editor, the club page and the reminder emails all read Supabase).
- [ ] `fixtures` table: id (text like `w1-tur-sks`), week, home and away (club codes), kick-off as one `timestamptz`
      (entered in Melbourne time), stage (null, SF, GF), postponed flag. Everyone reads; only the office writes.
- [ ] `results` table, one row per fixture: score, goals, cards, team stats, player ratings and Man of the Match (the
      compact summary the s3 engine already makes), plus `file` (the match file's name). **Hidden until kick-off, enforced
      by the database** (row-level security compares kick-off to `now()`), so a result can't be read early even by
      someone calling the API directly. The office reads it any time.
- [ ] Editor → Fixtures: add one, add a whole week, "Generate a season" (round robin, home and away balanced, byes for an
      odd number of clubs), set dates and times, postpone, restore, remove a result. Standings are worked out from these.
- [ ] Replace the app's `loadSeason()` (dashboard-data.js) with reads from Supabase; keep the same shape so pages need
      few changes. Logos come from the `crests` bucket. `send-reminders` reads fixtures from Supabase.
- [ ] Match files (about 2 MB each) stay out of the database; 0.13 publishes them on this site's Pages.
- Checks: security checks for who can read a hidden result; the table, top players and form leave hidden results out.

### 0.13: Simulate, news and the old site retires
- [ ] Simulate, news composer, approvals and history in the app. Optional league events such as deadline day, set up
      and scheduled from the Editor (off by default).
- [ ] season.json retired as the source of truth; match files published to this site's Pages.

### 0.14: Inbox and press
- [ ] One inbox: news for this club, press conferences, deadlines; only things that need action or matter.
- [ ] News audiences: one club, several, all clubs, guests only, everyone.
- [ ] Press conference opening 24 hours before kick-off; answers quoted in the match preview; the press effect kept.
- [ ] Reactions on results, news and press answers.

### 0.15: Match centre
- [ ] The 3D broadcast view, live and after full time.
- [ ] Momentum graph and shot map from the engine; ratings on coloured chips; match report; Man of the Match.
- [ ] Team and Player of the Week after each round.

### 0.16: Installable app and notifications
- [ ] Add to home screen; opt-in push (asked only on a tap): line-ups out, kick-off, goals for your club, full time,
      "your line-up locks in 1 hour and isn't set", news for your club. (iPhone: works once installed, iOS 16.4+.)

### 0.17: Predictor
- [ ] Managers predict every fixture, with a leaderboard; guests predict on their own device with a personal streak.

### 0.18: Club pages
- [ ] A page per club (with its accents): squad, results, derbies, head-to-head.

### 1.0: vLeague runs on its own
- [ ] The s3 site becomes a read-only archive pointing here; final design, accessibility and phone-speed pass.

### After 1.0
- Public "Enter a club" page with a registration window. Deadline day's free-agent claim window and live ticker.
  Scheduled kit reveals.
