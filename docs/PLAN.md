# vLeague app: plan

What's still to do on the vLeague app, roughly in order. Tick items off (or delete them) as they ship.
Last updated 2026-09-30.

**Where we are:** sign-in page (`index.html`) and a placeholder signed-in page (`hello.html`), backed by
Supabase Auth with sign-ups off. League data still lives in the s3 site (`hcl-s3\data\season.json`,
`matches/`, `data/teams/`).

---

## 1. Guest access

Visitors without an account can still follow the league: **watch matches, see results and the table, and read
league news**. They don't see anything that belongs to a club or the league office.

### How it works

- [x] **"View as guest"** button (Bravo, 2026-09-30) under the Sign in button on `index.html`. No account, no Supabase session:
      guests just browse the public pages. Remember the choice (`localStorage` `vleague-guest`) so a returning
      guest skips the sign-in screen; "Sign in" stays in the top bar for them.
- [ ] **One page shell for both.** Every page checks `currentUser()`: signed in → full view; no session →
      guest view. Pages that are members-only (manager hub, press, editor) send guests back to sign in with a
      short "Sign in to manage your club" message instead of a blank page.
- [ ] **The rule is enforced by the database, not the page.** Hiding things in the HTML isn't security. Guests
      use the anon key with no session (Postgres role `anon`); Row Level Security gives `anon` read access
      only to public tables/views. Everything else needs `authenticated`.
- [ ] Add a `mode` helper to `js/auth.js` (`'member' | 'guest'`) so pages don't repeat the check.
- [x] Guest dashboard `dashboard.html` (Alpha, 2026-09-30): matchday board, matches by week, table, news, leaders. Top bar: crest, Matches, Table, News, and a "Sign in" button. Member top bar adds My club, Press,
      and (for the league office) Editor.

### What guests see vs. members

Decided 2026-09-30: guests see **all league information** (ratings, stats, everything public). What they don't get
is anything personalised: no "my club" views, no voting or forms. Everything for guests lives on **one central
dashboard** (`dashboard.html`); news is a small section on it, not its own page.

| Area | Guest | Member (manager) | League office |
|---|---|---|---|
| Fixtures, kick-off times, results | ✅ | ✅ | ✅ |
| Live match broadcast + full-time match viewer | ✅ | ✅ | ✅ |
| League table, finals bracket, awards, top scorers | ✅ | ✅ | ✅ |
| Player ratings, detailed match stats | ✅ | ✅ | ✅ |
| Club pages: name, crest, colours, squad list, manager name | ✅ | ✅ | ✅ |
| Line-ups | ✅ from 10 min before kick-off | own club always; others from 10 min before | ✅ |
| News: posts sent to "guests only" or "everyone" | ✅ (small section on the dashboard) | ❌ guest-only / ✅ everyone | ✅ |
| News: posts sent to all teams, or to one or more teams | ❌ | ✅ if in the audience | ✅ |
| Poll results | ❌ never (guests can read a poll post, not vote or see results) | ✅ | ✅ |
| Forms, registration, read receipts | ❌ | ✅ | ✅ |
| Tactics, formation, set-piece takers | ❌ | own club only | ✅ |
| Manager hub, press room, personalised views | ❌ | ✅ | ✅ |
| Editor (fixtures, simulate, teams, history) | ❌ | ❌ | ✅ |

### News audiences (new)

Each post goes to exactly one of these (replaces the s3 site's `visibility` + `audience` pair):

| Send to | Stored as | Who sees it |
|---|---|---|
| One team or a group of teams | `audience: ["TUR", "LAU"]` | Those clubs' managers + league office |
| All teams | `audience: "teams"` | Every manager + league office |
| Guests only | `audience: "guests"` | Guests (dashboard) + league office |
| Everyone | `audience: "all"` | Guests, managers, league office |

- [x] Dashboard reads old s3 posts as: `visibility: "public"` → everyone; `visibility: "managers"` → teams
      (by their `audience`). Done in `js/dashboard-data.js`.
- [ ] Editor: the "Send to" picker with those four options.

### Line-ups: hidden until 10 minutes before kick-off

- [x] Dashboard shows the line-ups of the featured match from kick-off −10 min, with a "Line-ups at 7:50 pm"
      note before that.
- [ ] **Enforce it in the database** (a view over `team_settings` that only returns another club's XI once
      `kickoff - interval '10 minutes' <= now()`). Right now the s3 team files (`data/teams/*.json`) are public
      files, so anyone who knows the URL can read an XI early. This is fixed only when line-ups move to Supabase.

### Still open

- [ ] Any rate limit / abuse concern with guest reads? (Free plan limits are generous; probably fine.)

---

## 2. League data into Supabase

- [ ] Design tables: `seasons`, `teams`, `players`, `fixtures`, `results` (summary), `match_files`
      (Supabase Storage bucket for the `.json.gz` files), `news`, `news_responses`, `team_settings`
      (tactics/XI), `profiles` (user → role + club).
- [ ] Roles: `profiles.role` = `manager` | `office`; `profiles.team` for managers.
- [ ] RLS policies, written and tested per role (anon / manager / office). Keep them in `docs/SCHEMA.sql`.
- [ ] **Results hidden until kick-off, enforced server-side**: a view (or policy) that only returns a result
      once `kickoff <= now()`. Today this is only a front-end rule in `hcl-s3\js\data.js`.
- [ ] One-off import script from `season.json`, `data/teams/*.json` and `matches/` (Python, run locally with
      the service_role key from an env var, never committed).
- [ ] Decide when the s3 site stops being the source of truth (read-only archive? redirect?).

## 3. Public pages (guest + member)

Port from the s3 site, reading from Supabase instead of `season.json`. Reuse the existing modules where possible.

- [ ] Matches / home: week tabs, each match once, live and full-time states (`status`, `liveSimTime`).
- [ ] Match page: live broadcast + viewer (`match.html` equivalent, loading the match file from Storage).
- [ ] Table (`ladder()` from `js/league.js`, points adjustments, finals).
- [ ] News feed using the shared renderer (`js/news.js` + `css/news.css`), filtered by visibility.
- [ ] Awards.
- [ ] Club pages.
- [ ] "League updated" refresh popup → Supabase Realtime instead of polling `season.json`.

## 4. Member pages

- [ ] Replace `hello.html` with a real landing page ("My club": next match, deadlines, unread news).
- [ ] Manager hub (formation, tactics, XI, captain, set pieces) writing to `team_settings`; retire the
      Google Apps Script relay.
- [ ] Press room.
- [ ] News interactions: read receipts, polls, forms, registration.
- [ ] Account: change password, "Forgot password" (Supabase reset email; needs the Site URL set).

## 5. League office (editor)

- [ ] Port edit mode (`admin.html` tabs: Needs attention, Fixtures, News, Teams, League, History, Settings) to
      write to Supabase; drop the encrypted GitHub token + PIN flow.
- [ ] Simulate in the browser (Pyodide engine from `hcl-s3\js\sim\`) and upload the result to Storage.
- [ ] History / undo: replace git-commit history with an `audit` table.

## 6. Housekeeping

- [ ] Keep the free project from pausing out of season (7 days idle): a weekly GitHub Action ping, or accept it.
- [ ] Brand check on every new page (`hcl-s3\docs\BRAND.md`): never show "Heineken", "HCL" or "Season 3".
- [ ] Cache busting like the s3 site's `tools/stamp_version.py` once there are more JS modules.
- [ ] Update `README.md` pages table and root `CLAUDE.md` as pages land.
