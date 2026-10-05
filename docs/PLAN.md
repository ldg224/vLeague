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

### 0.9: Light mode
- [ ] A Theme setting (Dark / Light / System). Colour tokens replace the hard-coded colours; the pitch and matchday
      board stay dark on purpose. No second per-club accent for light mode (user's decision, 5 October 2026: clubs
      have already registered, so club colours stay as they are).

### 0.10: Inbox and press
- [ ] One inbox: news for this club, press conferences, deadlines; only things that need action or matter.
- [ ] News audiences: one club, several, all clubs, guests only, everyone.
- [ ] Press conference opening 24 hours before kick-off; answers quoted in the match preview; the press effect kept.
- [ ] Reactions on results, news and press answers.

### 0.11: The Editor moves in
- [ ] Fixtures, results, Simulate, news composer, approvals and history in the app, on Supabase.
- [ ] Results hidden until kick-off, enforced by the database.
- [ ] season.json retired as the source of truth; match files published to this site's Pages.
- [ ] Optional league events such as deadline day, set up and scheduled from the Editor (off by default).

### 0.12: Match centre
- [ ] The 3D broadcast view, live and after full time.
- [ ] Momentum graph and shot map from the engine; ratings on coloured chips; match report; Man of the Match.
- [ ] Team and Player of the Week after each round.

### 0.13: Installable app and notifications
- [ ] Add to home screen; opt-in push (asked only on a tap): line-ups out, kick-off, goals for your club, full time,
      "your line-up locks in 1 hour and isn't set", news for your club. (iPhone: works once installed, iOS 16.4+.)

### 0.14: Predictor
- [ ] Managers predict every fixture, with a leaderboard; guests predict on their own device with a personal streak.

### 0.15: Club pages
- [ ] A page per club (with its accents): squad, results, derbies, head-to-head.

### 1.0: vLeague runs on its own
- [ ] The s3 site becomes a read-only archive pointing here; final design, accessibility and phone-speed pass.

### After 1.0
- Public "Enter a club" page with a registration window. Deadline day's free-agent claim window and live ticker.
  Scheduled kit reveals.
