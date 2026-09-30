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
- Line-ups can't be revealed at T-10 in the database yet, because kick-off times only move in with fixtures (0.8).
  Until then, team sheets are private to the club and the office.

### 0.4: Set up your club
- [ ] Four-step wizard at first sign-in: name (≤25) / short name (≤12) / 3-letter code; primary and secondary
      colour with live contrast check; crest upload with previews; manager name, stadium, motto, notes for the office.
- [ ] The accent colour computed on save and previewed exactly.
- [ ] Office approval queue (approve, or send back with a note); a crest reveal posted to news on approval.
      Later changes to name, code or crest go back for approval; colours and motto change instantly.
- [ ] Editor: invite a manager and link them to a club.

### 0.5: Home
- [ ] Home, My club, Inbox and League, with the club band and accents.
- [ ] Home: next match with countdown and "line-up locks in …", what needs doing, last result, table position,
      league activity feed.

### 0.6: My club
- [ ] The XI on a pitch (tap to swap, formation, captain, set pieces, tactics), saved to `team_sheets`.
- [ ] Lock at T-10 and the team-sheet reveal graphic on both clubs' sites and the dashboard.
- [ ] The s3 editor's Simulate reads team sheets from Supabase; the s3 Manager Hub retires.

### 0.7: Inbox and press
- [ ] One inbox: news for this club, press conferences, deadlines; only things that need action or matter.
- [ ] News audiences: one club, several, all clubs, guests only, everyone.
- [ ] Press conference opening 24 hours before kick-off; answers quoted in the match preview; the press effect kept.
- [ ] Reactions on results, news and press answers.

### 0.8: The Editor moves in
- [ ] Fixtures, results, Simulate, news composer, approvals and history in the app, on Supabase.
- [ ] Results hidden until kick-off and line-ups until T-10, both enforced by the database.
- [ ] season.json retired as the source of truth; match files published to this site's Pages.
- [ ] Optional league events such as deadline day, set up and scheduled from the Editor (off by default).

### 0.9: Match centre
- [ ] The 3D broadcast view, live and after full time.
- [ ] Momentum graph and shot map from the engine; ratings on coloured chips; match report; Man of the Match.
- [ ] Team and Player of the Week after each round.

### 0.10: Installable app and notifications
- [ ] Add to home screen; opt-in push (asked only on a tap): line-ups out, kick-off, goals for your club, full time,
      "your line-up locks in 1 hour and isn't set", news for your club. (iPhone: works once installed, iOS 16.4+.)

### 0.11: Predictor
- [ ] Managers predict every fixture, with a leaderboard; guests predict on their own device with a personal streak.

### 0.12: Club pages
- [ ] A page per club (with its accents): squad, results, derbies, head-to-head.

### 1.0: vLeague runs on its own
- [ ] The s3 site becomes a read-only archive pointing here; final design, accessibility and phone-speed pass.

### After 1.0
- Public "Enter a club" page with a registration window. Deadline day's free-agent claim window and live ticker.
  Scheduled kit reveals.
