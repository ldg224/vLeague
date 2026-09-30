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
| `index.html` | Sign in (email + password). A signed-in visitor goes straight through. |
| `dashboard.html` | The guest dashboard: live/next match board with line-ups (from 10 min before kick-off), the week's matches, table, league news for guests, leaders. Reads the s3 site's public data for now. |
| `hello.html` | The first signed-in page. Without a session it sends you back to sign in. |

## Files

- `js/config.js`: the Supabase project URL and anon key (empty until the backend is set up).
- `js/auth.js`: sign in, current user, sign out (Supabase Auth, loaded from jsDelivr).
- `js/signin.js`, `js/hello.js`: the sign-in and hello pages. `js/dashboard.js` + `js/dashboard-data.js` + `css/dashboard.css`: the dashboard (`?src=` loads other data, on localhost only). `js/photos.js`: the photo cross-fade.
- `css/site.css`: brand tokens and styles.
- `assets/brand/`: crest, favicon, app icon. `assets/img/`: photos from Unsplash (Unsplash License),
  credited on the pages: Jannes Glas, Pascal Müller, Sudhanshu Walzade.
