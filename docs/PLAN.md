# vLeague app: plan

Agreed on 30 September 2026 (Alpha and Bravo's research and plan, reviewed and approved by the user), reorganised on
8 October 2026. Work is tracked by **code and ID, not version number** (version numbers change too fast). Versions
still exist for releasing and rolling back: see `docs/RELEASING.md`. What shipped in each version: `CHANGELOG.md`.

**The idea:** a manager doesn't "open the manager portal"; they sign in and walk into their club (their colours,
next match, XI, inbox). Guests get one beautiful matchday page. One league, one site.

## How items are labelled

| Code | Meaning | Use for |
|---|---|---|
| **EU-nn** | Essential update | Bugs, broken or missing core behaviour, things that must work |
| **VU-nn** | Visual update | Layout, look and feel, polish; nothing is broken |
| **FU-nn** | Future update | New features and ideas (not started) |
| **T-nn** | Testing | Checks and rehearsals to run, and tuning against real results |

IDs are permanent: never reuse one, never renumber. Mention the ID in commit messages and in `CHANGELOG.md` when an item
ships (for example "EU-02: re-registration no longer says 'joined'"). When an item is finished, move it to **Done** with
the date, not a version number.

**Status:** `Open` (clear and ready) · `Check` (may already be fixed; verify first) · `Needs detail` (too vague to start;
the question is written under it) · `Decision` (the user must choose before work starts).

---

## Decisions (the user's, kept for reference)

- **A club's primary colour runs its whole page (6 October 2026).** It replaces the earlier "accents only" rule. The page,
  cards, band, buttons, tabs, links and charts take the colour as picked; text on it is white or dark, and coloured text is
  lightened so a dark club still reads. There is no separate accent colour. The Editor and signed-out pages stay vLeague
  navy and blue. No second per-club colour for light mode (5 October 2026: clubs have already registered).
- **Guests stay fully signed out.** The dashboard is the guest profile and signs out anyone who arrives signed in. No guest accounts.
- **No chat, ever, and nothing sent to the league's WhatsApp group** (it stays for personal messages). Reactions on the site
  instead. The league doesn't use Discord.
- **Registration:** "Set up your club" at a manager's first sign-in; every manager (the office's club too) sees it once, until the
  office presses "Set up again" for that club (1 October 2026). A public "Enter a club" page with a registration window only after launch.
- **Line-up lock:** line-ups lock before the first match of the week, never later than the first kick-off (not T-10, because results are
  often simulated in advance). League time zone: Australia/Melbourne. Managers keep editing; changes count for the next week.
- **Weekly budget** is $125,000. Player prices come from ratings (`500 + 7500 * ((rating-1)/8)^1.8`), never stored. The cap is a guide
  the Draft page shows; it doesn't block a pick.
- **Squads** are 16 (XI + 5 bench: 2 GK, 5 DEF, 5 MID, 4 FWD) as the target; the app never blocks a club with fewer (11 including a GK can be simulated).
- **Press conferences** open 24 hours before kick-off. **Preset answers, not typed text** (6 October 2026): each question has a few
  answers with a tone (confident, humble, deflecting), moving four meters (fans, happiness, team and opposition performance, capped at 3%).
  The Team and Opposition meters change the match; chosen answers are quoted in the Inbox.
- **vLeague stands on its own** (5 October 2026): the s3 site stays a standalone test site. vLeague starts clean: **no history import** for now.
- **Match files (about 2 MB each)** are kept in a private `matches` bucket (readable from kick-off); Supabase keeps result summaries.
  Free plan: 500 MB database and 5 GB monthly transfer are nowhere near; a weekly backup export and keep-alive are optional extras.
- **Finals bracket view:** after launch. **Season planner** (rounds, match windows, scoreboard looks, rhythms): waits, and only the parts found missing get built (7 October 2026).
- **Club pages:** the League's short codes cover it for now (7 October 2026); a page per club exists (`club.html`).
- Four places for managers: **Home, My club, Inbox, League** (plus Matches, Draft, Settings). The office also gets the **Editor**.

---

## Open work

### EU: Essential updates

| ID | Item | Status |
|---|---|---|
| EU-01 | **League week tabs can't be scrolled across.** The row of round buttons (`.weektabs`) scrolls sideways with its scrollbar hidden, so on a computer there is no way to move along it without touch. Add arrows and/or mouse-wheel scrolling; keep swipe on phones. | Open |
| EU-02 | **Re-registration news says "[club] join vLeague".** Every time the office approves a setup (including "Set up again") the database posts the same "joined" news (`0003_club_setup.sql`). It should only say that the first time; later it should say the club updated its details (or post nothing). | Open |
| EU-03 | **Second yellow cards show as yellows, not reds.** The broadcast knows about second yellows, but the Game centre timeline and line-ups only tell "yellow" from "anything else", and the match file's card event may not mark the second one. Find what the match file records, then show a second yellow as a red (with the yellow before it). Verify with T-03. | Check |
| EU-04 | **Draft tab missing / clock running before the start date.** The tab is meant to always show for managers with a preview (done earlier), and the draft clock runs in the database every minute. Check on the live site that the tab shows and the clock does not run before the draft's start date; fix if not. Verify with T-02. | Check |
| EU-05 | **"Fix draft mode".** Too vague to start. *Needs from you:* what goes wrong (a screen, a button, the order, the clock, auto-pick, emails), as a manager or as the office? One example is enough. | Needs detail |
| EU-06 | **Can't go back during a live game** (to see a goal or a card again). Live matches are held to the live clock on purpose, with no controls (video controls were removed during live on 7 October). *Decision:* allow rewinding to anything already played (never ahead of live), or only jump back to key moments (goals, cards) from the Timeline? | Decision |
| EU-07 | **Highlights are laggy.** Smoothing was added earlier, but it is still slow. *Needs from you:* which device and browser, and where it stutters (start, camera moves, replays). Then profile. | Needs detail |
| EU-08 | **More options in Editor → Fixtures.** That tab was deliberately cut down to three jobs in a clean-up. *Needs from you:* which options you miss (for example moving a whole week, byes by hand, swapping home and away, bulk time changes). | Needs detail |
| EU-09 | **Retire the old match pages and the s3 dependency.** Match files already come from the `matches` bucket; remove what still points at s3 and confirm the `?src=` local-test path is the only use left. | Open |

### VU: Visual updates

| ID | Item | Status |
|---|---|---|
| VU-01 | **News editor looks bad and isn't centred** (Editor → News). Centre it, tidy spacing and the composer/preview layout to match Players and Fixtures. | Open |
| VU-02 | **Possession meter is on for the whole game and blocks extra time.** Show it like the stats panel: appears now and then, hides in between, and never covers the extra-time banner. | Open |
| VU-03 | **Line-ups are not ordered.** Show each XI in a fixed order: GK, then DEF, MID, FWD (by pitch slot), bench after. Applies before the match (locked sheet) and after. | Open |
| VU-04 | **No shirt numbers in line-ups.** Players already have a number (1 to 99) in the database. Show it beside the name in the Game centre line-ups, both before and after the match. | Open |

### FU: Future updates

Ideas from the user (8 October 2026) unless noted.

| ID | Item | Status |
|---|---|---|
| FU-01 | **History page:** past winners and runners-up from HCL. Conflicts with "no history import", so the office would enter past seasons by hand in the Editor. *Needs:* which seasons, and what to show beyond winner and runner-up. | Needs detail |
| FU-02 | **Goal of the week.** *Needs:* who picks it (the office, or a vote by managers)? Would it use highlight clips? | Needs detail |
| FU-03 | **In-season tournaments** for extra championship points or just bragging rights. *Needs:* how many, which clubs, points awarded, and how they fit with the fixture list. | Needs detail |
| FU-04 | **Win probability updating during a match** (today the chance is worked out before kick-off only, in `js/match-model.js`). Show it moving with the score, minute and red cards. | Open |
| FU-05 | **Live match ratings for players** (today ratings appear at full time). Show running ratings in the line-ups as the match goes. | Open |
| FU-06 | **Player traits** (examples: solo player, likes to flop, only passes to the best players). *Needs:* the list of traits, whether they change the simulation or are just flavour, and who sets them. | Needs detail |
| FU-07 | **Draft queue shows predicted money.** Likely: next to each queued player, the budget left if the queue is picked in order. *Needs:* confirm that is what you meant. | Needs detail |
| FU-08 | **2D pitch for line-ups,** as done in the s2 site. Show the XI on a pitch in the Game centre. | Open |
| FU-09 | **Instagram account** for the league. Not an app change; a league task (the plan's rule about WhatsApp doesn't cover it). Could later link from the footer. | Decision |
| FU-10 | **Optional league events,** such as deadline day, set up and scheduled from the Editor (off by default). | Open |
| FU-11 | **Match centre extras:** momentum graph and shot map from the engine; a written match report; ratings on coloured chips. | Open |
| FU-12 | **Team and Player of the Week** after each round. | Open |
| FU-13 | **Installable app and notifications.** Add to home screen; opt-in push (asked only on a tap): line-ups out, kick-off, goals for your club, full time, "your line-up locks in 1 hour and isn't set", news for your club. (iPhone: works once installed, iOS 16.4+.) | Open |
| FU-14 | **Predictor:** managers predict every fixture, with a leaderboard; guests predict on their own device with a personal streak. | Open |
| FU-15 | **Office edits the press question bank** in the Editor; quotes also shown in a match preview on Home. | Open |
| FU-16 | **Reactions on results** in the Game centre (reactions on news and press answers exist). | Open |

### T: Testing

| ID | Item |
|---|---|
| T-01 | Tune the win chance against real results once there are a few rounds (`RATING_POWER` and friends in `js/match-model.js`). |
| T-02 | Rehearse a draft end to end with the page hidden and a future start date: the tab/preview, the clock, quiet times, auto-pick and emails. Settles EU-04 (and may expose EU-05). |
| T-03 | Play several **Test matches** until one has a straight red and one a second yellow; check the timeline, line-ups, stats and broadcast agree. Settles EU-03. |
| T-04 | After any security-rule change, run `supabase/tests/rls_check.py` (as guest, manager and office). |

### Launch (the old "1.0")

The app runs the league on its own.
- [ ] EU-09 done: the s3 site becomes a read-only archive pointing here.
- [ ] Final design, accessibility and phone-speed pass.

### After launch

- Public "Enter a club" page with a registration window.
- Deadline day's free-agent claim window and live ticker.
- Scheduled kit reveals.
- Finals bracket view.

---

## Done

What is built, by area. Details and dates of each change are in `CHANGELOG.md`.

- **Accounts and setup:** sign-in, "Forgot password?", set-password page, "View as guest", role-based landing (Home or Editor).
  Supabase tables with row-level security, `crests` bucket, sign-ups off, 8-character passwords. Four-step club setup
  wizard (names, colours with live contrast check, crest, manager details) with an office approval queue.
- **Manager pages:** Home (next match, countdown, "line-up locks in …", what needs doing, last result, table position, activity feed),
  My club (the XI on a pitch: formation, captain, set pieces, tactics; saves itself; phone-friendly player picker), Inbox, League,
  Matches, Settings (account, email reminders, text size, spoiler-free results, clock, reduce motion, Dark/Light/System theme), club pages.
- **Line-ups and fixtures:** per-week deadlines set by the office; at the lock every sheet is copied and revealed publicly. Fixtures,
  results, standings, the dashboard, Home, League, the Editor and reminder emails all read Supabase.
- **Players and teams on Supabase:** `players` table, Editor → Players (generate, table, paste a list), name and rating generators.
- **Simulate:** one match, a week or everything unplayed; Test match button (week 99, never counts); results stored with match files.
- **Email reminders:** deadline reminder only when no team is picked, club changes sent back, line-ups out, weekly round-up, office alerts.
  Never twice, never between 10 pm and 8 am, one-click unsubscribe.
- **News:** composer and history in the Editor (audience, pin, preview, starters, optional email); one Inbox with delete and "Clear all".
  Press conferences with preset answers; reactions on news and press answers.
- **Draft:** manager board (grid, queue, auto-pick, instant updates), office tools (create, start/pause/resume, make page visible, drag order),
  quiet times, emails. See `docs/DRAFT.md`.
- **Matches and Game centre:** a card per game with win chance, form, stadium and records; one scrolling Game centre (scoreboard in the round's look,
  broadcast / tactical / highlights viewer, stats, line-ups with ratings, Man of the match, timeline); open to guests.
- **Editor:** Clubs, Fixtures, Players, News, Draft, Phones (as part of Clubs); manager phone numbers collected through a pinned Inbox post.
