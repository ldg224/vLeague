# vLeague

Virtual football. The home of vLeague from Season 1: sign in, manage your club, and (soon) everything else.

- Live site: https://ldg224.github.io/vLeague/
- Plain HTML, CSS and JavaScript on GitHub Pages; no build step.
- Accounts and data: Supabase (free plan). Setup: `docs/BACKEND.md`.
- What's next: `docs/PLAN.md`. What changed in each version: `CHANGELOG.md`. How to release or roll back: `docs/RELEASING.md`.
- Brand: the vLeague crest, the Material Blue ramp with white as the accent, Oswald + Figtree
  (full rules in the s3 site's `docs/BRAND.md`).

## Pages

| Page | What it does |
|---|---|
| `index.html` | Sign in (email + password), "Forgot password?", and "View as guest". A signed-in visitor goes to their page. |
| `set-password.html` | Where invite and password-reset emails land: choose a password, then on to your page. |
| `dashboard.html` | The guest profile: live/next match board with line-ups (from 10 min before kick-off), the week's matches, table, league news for guests, leaders. Signs out anyone who arrives signed in. Reads the s3 site's public data for now. |
| `home.html` | A manager's Home (placeholder until 0.5: shows their club). |
| `editor.html` | The league office's Editor (placeholder until 0.8: lists the clubs and which have a manager account). |

## Files

- `js/config.js`: the Supabase project URL and anon key (safe to publish; the database rules decide what it can do).
- `js/auth.js`: sign in and out, profile and landing page, password reset and set, guest flag, `db()` (Supabase Auth, loaded from jsDelivr).
- `js/signin.js`, `js/set-password.js`: the sign-in pages. `js/member.js` + `js/home.js` + `js/editor.js` + `css/member.css`: the signed-in pages.
- `js/dashboard.js` + `js/dashboard-data.js` + `css/dashboard.css`: the dashboard (`?src=` loads other data, on localhost only).
- `js/version.js`: the version shown in footers.
- `css/site.css`: brand tokens, buttons, messages and the sign-in pages.
- `supabase/migrations/`: the database setup, in order. `supabase/tests/rls_check.py`: checks the security rules as guest, manager and office.
- `assets/brand/`: crest, favicon, app icon. `assets/img/stadium-dusk.jpg`: the dashboard's board photo, by Pascal Müller on Unsplash (Unsplash License).
