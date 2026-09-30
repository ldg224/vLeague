# vLeague

Virtual football. The home of vLeague from Season 1: sign in, manage your club, and (soon) everything else.

- Live site: https://ldg224.github.io/vLeague/
- Plain HTML, CSS and JavaScript on GitHub Pages; no build step.
- Accounts and data: Supabase (free plan). Setup: `docs/BACKEND.md`.
- Brand: the vLeague crest, the Material Blue ramp with white as the accent, Oswald + Figtree
  (full rules in the s3 site's `docs/BRAND.md`).

## Pages

| Page | What it does |
|---|---|
| `index.html` | Sign in (email + password). A signed-in visitor goes straight through. |
| `hello.html` | The first signed-in page. Without a session it sends you back to sign in. |

## Files

- `js/config.js`: the Supabase project URL and anon key (empty until the backend is set up).
- `js/auth.js`: sign in, current user, sign out (Supabase Auth, loaded from jsDelivr).
- `js/signin.js`, `js/hello.js`: the two pages. `js/photos.js`: the photo cross-fade.
- `css/site.css`: brand tokens and styles.
- `assets/brand/`: crest, favicon, app icon. `assets/img/`: photos from Unsplash (Unsplash License),
  credited on the pages: Jannes Glas, Pascal Müller, Sudhanshu Walzade.
