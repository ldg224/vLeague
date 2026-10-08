# Versions and releases

Every change that goes live is a numbered version, so we always know what's on the site and can go back to any
earlier one quickly.

## Version numbers: MAJOR.MINOR.PATCH

| Bump | When | Example |
|---|---|---|
| **Patch** 0.2.**1** | Fixes and small tweaks: wording, spacing, a bug. Nothing new for people to use. | 0.1.0 → 0.1.1 removed a headline |
| **Minor** 0.**3**.0 | Something new: a page, a feature, a new kind of data. | 0.1.1 → 0.2.0 added guest access |
| **Major** **1**.0.0 | 1.0.0 = the app runs the league on its own (league data in Supabase, s3 site retired). After that, only for changes that break old data or links. | |

While we're on 0.x, minor versions can change things freely.

## Releasing a version

1. Pull first (`git pull --rebase`); the user sometimes edits on github.com.
2. Pick the number (table above).
3. Set it in **`js/version.js`** (`VERSION`), which the site shows in the footer.
4. Add it to the top of **`CHANGELOG.md`**: number, date, and what changed under Added / Changed / Fixed / Removed,
   in plain words. Also add one line under the heading, `Headlines: first | second` (2 items at most, a few words each, friendly: "Rewind a live match"). That line alone is the managers' "What's new" note on Home; a version without it shows nothing.
5. Commit with the version in the message, e.g. `0.2.1: fix the week arrows on phones`, and push.
6. Tag and publish the release (tags are how we find a version later):
   ```powershell
   git tag -a v0.2.1 -m "0.2.1"
   git push origin v0.2.1
   gh release create v0.2.1 --title "0.2.1" --notes "<that version's changelog section>"
   ```
7. Check the live site once Pages has rebuilt (about a minute): the footer shows the new number.
   Pages sometimes skips a push. If `gh api repos/ldg224/vLeague/pages/builds/latest` still shows the previous
   commit after a couple of minutes, start the build yourself: `gh api -X POST repos/ldg224/vLeague/pages/builds`.

One version per push to the live site. Several commits can go into one version; tag the last one.

## Something broke: going back

Find the last good version in `CHANGELOG.md` or with `git tag`.

- **Undo one version** (the usual fix): revert its commits, so history stays intact.
  ```powershell
  git revert --no-edit v0.2.0..v0.2.1
  ```
  Then release that as a new **patch** (e.g. 0.2.2, "Reverted 0.2.1: <why>").
- **Put the whole site back to an old version** in one step:
  ```powershell
  git checkout v0.2.0 -- .
  git commit -m "0.2.2: restore 0.2.0 (<why>)"
  ```
  then release as above.
- **Just look at an old version** without changing anything: `git switch --detach v0.1.1` (back with `git switch main`).

Never force-push or move a tag that's already published; always go forward with a new version.
