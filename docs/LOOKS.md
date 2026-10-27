# Scoreboard looks

A **look** is how a match's scoreboard is dressed: Movember, Australia Day, New Year, Festive, Finals, and so on. The Game centre's scoreboard and the score bug drawn over the match video (broadcast view and highlights) both read the same description, so a look is made once.

## Where a match gets its look
First one that is set wins: the **match's own look** (`fixtures.look`), its match window's (`match_windows.look`), the **round's look** (`rounds.look`), then `classic`.
The Editor's Fixtures tab has a look picker on every round (the whole week) and on every match ("Same as the round" or a look of its own). Choosing saves at once.

## Files
| File | What it holds |
|---|---|
| `js/looks.js` | The registry: `PRESETS` (the looks that ship), `FX` (the effects), `resolveLook`, colour checks, the effects' DOM markup. Pure, no imports, tested. |
| `css/scoreboard.css` | The page scoreboard. The "Themed looks" section styles any theme from its colours and draws each effect. |
| `js/viewer/look-canvas.js` | The same effects drawn small on the canvas score bug. |
| `js/viewer/highlights.js` `scoreBoard()` | The score bug itself: the plate, the board, the clock block, take their colours from the theme. |
| `js/look-picker.js`, `css/look-picker.css` | The Editor's picker (a pill and a menu of previews). |
| `supabase/migrations/0071_match_looks.sql` | `fixtures.look` and the four event looks as `looks` rows. |
| `tests/looks.test.mjs` | Checks on the registry, colour cleaning and the markup. |
| `tests/looks-preview.html`, `tests/looks-canvas-preview.html`, `tests/look-picker-preview.html` | Developer previews, no sign-in. Serve the repo (`python -m http.server`) and open them. `?k=festive,movember`, `?live`, `?w=360` on the first. |

## A theme
```js
my_look: {
  name: 'Anzac Day', banner: 'ANZAC DAY', accent: '#c9b037',        // banner: the pill on the plate. accent: the picker's colour dot
  theme: {
    bg: ['#1b1b1b', '#0b0b0b'],      // board, top to bottom
    edge: '#6b6b3a',                  // board border
    ink: '#f2efe0',                   // team names, scorers
    score: ['#ffffff', '#d8d4b8'],   // the score digits, top to bottom
    plate: ['#c9b037', '#a38b1d'],   // the tab above the board, left to right
    plateInk: '#1b1400',              // text on the tab
    glow: '#c9b037',                  // the soft light round the board and the score
    clock: '#c9b037', clockInk: '#1b1400',   // the timer block on the video bug
    fx: ['stars'],                    // up to five effects
  },
},
```
Every colour is `#rrggbb`; anything else is replaced by the base theme's colour, and unknown effect names are dropped, so a look stored in the database can't put anything else on the page. A `looks` table row with `settings.theme` overlays the preset of the same key (field by field), and a row with no preset at all still works, so a look can be made or tuned in the database without a release.

## Effects (`FX`)
`shine` (a slow sweep) · `snow` · `lights` (a string of coloured bulbs along the top) · `stars` (the Southern Cross) · `sparkle` · `confetti` · `moustache` (a small line-art moustache with hairlines).

## Adding a look (the usual job)
1. Add the entry to `PRESETS` in `js/looks.js`. The key is lowercase letters, digits and `_` (2 to 24).
2. Preview it: `tests/looks-preview.html?k=my_look` (page, `&live` for a live match, `&w=360` for a phone) and `tests/looks-canvas-preview.html?k=my_look` (video bug).
3. Add a migration row to `looks` (copy `0071_match_looks.sql`; `PRESET_ROWS` in `js/looks.js` prints the settings), so a round can be given the look at once. The Editor also inserts any missing preset row when the Fixtures tab loads.
4. Add the look to the test in `tests/looks.test.mjs` if it does something new. Run `node --test "tests/*.test.mjs"`.
5. CHANGELOG, version, release as usual (`docs/RELEASING.md`).

## Adding a new effect
1. Add the name to `FX` in `js/looks.js` and its markup to `FX_HTML` (and a label to `FX_NAMES` for the picker).
2. Style it under "Themed looks" in `css/scoreboard.css` (use `var(--t-*)` colours, respect reduced motion).
3. Draw it in `drawLookFx` in `js/viewer/look-canvas.js`.
4. Add it to the loop in `tests/looks.test.mjs` ("effects").

## Rules
- No emoji or hand-drawn icons in a look; effects are drawn as shapes.
- Event looks are meant to be used for their week or day; the shipped designs follow the user's reference images (27 Oct 2026): a dark board, a broadcast-graphic finish, the same layout every time, only the skin changes.
- Keep the layout identical across looks: a look is a skin, not a new scoreboard.
