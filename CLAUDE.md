# vLeague

Virtual football league app. Managers sign in and run their club; guests get a matchday dashboard; the league office runs everything from the Editor.

- Live site: https://ldg224.github.io/vLeague/ (GitHub Pages)
- Repo: `ldg224/vLeague` (public), branch `main`. Cloned at `C:\Claude\Projects\vLeague`.
- Current version: see `js/version.js` and the top of `CHANGELOG.md`.

## Stack
- Plain HTML, CSS and JavaScript. **No build step, no framework.** Pages are `*.html` at the root; code is in `js/`, styles in `css/`.
- Backend: Supabase (free plan). Auth, tables with row-level security, `crests` bucket. Setup in `docs/BACKEND.md`. Migrations in `supabase/migrations/` (apply in order); security checks in `supabase/tests/rls_check.py`.
- `js/config.js` holds the Supabase URL and anon key. It is meant to be public; the database rules are the security. Never add a service-role key or any other secret to the repo.
- Match simulation: a Python engine in `js/sim/` (`hcl_sim`, tests in `js/sim/tests/`) and a JS port used in the browser (`js/simulate.js`, `js/sim-worker.js`). Match files (about 2 MB each) live on GitHub Pages; Supabase keeps only result summaries.
- Match viewer (broadcast, tactical, highlights) is in `js/viewer/`.

## Where to read first
- `README.md`: pages and files overview.
- `C:\Claude\Plans\vLeague\PLAN.md` (private, in the workspace repo, deliberately not in this public repo): roadmap, issues and the user's recorded decisions. Check it before changing behaviour. Work items use IDs, not version numbers: B-nn (bug), S-nn (suggestion), T-nn (testing); finished items from before 9 October 2026 keep their old EU/VU/FU IDs. The Trello board "vLeague Work" is the most up-to-date source. IDs are permanent; cite them in commits and the CHANGELOG, and move finished items to Done.
- `docs/RELEASING.md`: versioning and release steps (below).
- `docs/BACKEND.md`, `docs/DRAFT.md`, `js/sim/docs/`: backend, draft, and simulator details.
- `CHANGELOG.md`: what changed in each version.

## Product decisions to respect (from the private PLAN.md)
- A club's primary colour runs its whole page. The Editor and signed-out pages stay vLeague navy and blue.
- Guests stay fully signed out; the dashboard signs out anyone who arrives signed in. No guest accounts.
- No chat, and nothing sent to the league's WhatsApp group.
- Managers get Home, My club, Inbox, League; the office also gets the Editor.
- Brand: vLeague crest, Material Blue ramp with white accent, Oswald + Figtree.

## Releasing (summary of `docs/RELEASING.md`)
Every change that goes live is a numbered version (MAJOR.MINOR.PATCH; patch = fix or tweak, minor = something new; still 0.x).
1. `git pull --rebase` first (the user sometimes edits on github.com).
2. Set `VERSION` in `js/version.js`.
3. Add a section at the top of `CHANGELOG.md` (number, date, Added / Changed / Fixed / Removed, plain words; say whether there is a database change).
4. Commit with the version in the message, e.g. `0.41.2: fix the week arrows on phones`, push.
5. Tag and release: `git tag -a vX.Y.Z -m "X.Y.Z"`, `git push origin vX.Y.Z`, `gh release create vX.Y.Z ...`.
6. Check the footer on the live site after Pages rebuilds; if it didn't build, `gh api -X POST repos/ldg224/vLeague/pages/builds`.

One version per push to the live site. Roll back by reverting forward (new patch), never by moving a published tag.

## Rules
- This repo is **public**: never commit secrets, keys (other than the anon key), personal data, or `.env` files.
- Never force-push, rewrite history, or move a published tag without explicit approval.
- Ask before pushing, tagging or releasing: pushes go live on the real site.
- Database changes are new files in `supabase/migrations/`; never edit one that has already been applied. Re-run `supabase/tests/rls_check.py` after security-rule changes.
- Match the existing code style; keep it dependency-free and buildless.
- `__pycache__` files are currently tracked (there is no `.gitignore`). Don't add more, and ask before cleaning them up.

## Notes
- This folder is its own git repo nested inside `C:\Claude` (the claude-workspace repo). Run git here with `git -C C:\Claude\Projects\vLeague ...`, and commit vLeague changes to the vLeague repo, not the workspace repo.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Git may need `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')` in a shell started before it was installed.

