// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The Stakes tab's pure parts (MU-1): payout, the closing clock and the page's html for a few states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { payout, closesIn, stakesView, statName, STEPS, stepsFor, stakeChips, DEFAULTS, defaultStakeFor, bestCols, averageText, RESULTS, resultLabel } from '../js/stakes.js';
import { readSettings } from '../js/editor-stakes.js';

const o = { crest: () => '<i class="c"></i>', name: c => c };
const line = (id, my) => ({ kind: 'player', line_id: id, fixture: 'f1', week: 1, home: 'AAA', away: 'BBB', starts_at: '2026-11-01T08:00:00Z', player_id: 'p' + id, player_name: 'Hudson <Allen>', team: 'AAA', pos: 'GK', stat: 'sv', line: 3.5, my_side: my ? 'over' : null, my_stake: my ? 100 : null, my_status: my ? 'open' : null });
const state = (x = {}) => ({ wallet: { coins: 1000 }, slate: [line(1), line(2, true)], board: [], history: [], picked: null, busy: false, msg: null, ...x });

test('the payout is 1.9 times the stake, rounded down', () => {
  assert.equal(payout(100), 190);
  assert.equal(payout(10), 19);
  assert.equal(payout(55), 104);
});
test('closing clock', () => {
  const t = Date.parse('2026-11-01T08:00:00Z');
  assert.equal(closesIn('2026-11-01T08:00:00Z', t + 1000), 'Closing');
  assert.equal(closesIn('2026-11-01T08:00:00Z', t - 30 * 60000), 'Closes in 30 min');
  assert.equal(closesIn('2026-11-01T08:00:00Z', t - 125 * 60000), 'Closes in 2 h 5 min');
  assert.equal(closesIn('2026-11-01T08:00:00Z', t - 3 * 86400000), 'Closes in 3 days');
});
test('stat names', () => { assert.equal(statName('sv'), 'Saves'); assert.equal(statName('sot'), 'Shots on target'); });
test('the page shows coins, lines and escapes names', () => {
  const html = stakesView(state(), o);
  assert.match(html, /1,000/);
  assert.match(html, /Hudson &lt;Allen&gt;/);
  assert.doesNotMatch(html, /Hudson <Allen>/);
  assert.equal((html.match(/class="lg-card st-stake/g) || []).length, 2);
});
test('a line with a pick is locked and says what it pays; one without offers both sides', () => {
  const html = stakesView(state(), o);
  assert.match(html, /pays <b>190<\/b>/);
  assert.match(html, /Take back/);
  assert.equal((html.match(/disabled/g) || []).length, 2);   // the two side buttons of the picked line
});
test('choosing a side opens the stake picker, and a stake above the balance is not offered', () => {
  const html = stakesView(state({ wallet: { coins: 60 }, picked: { line: 1, side: 'over', stake: 50 } }), o);
  assert.match(html, /data-st="place"/);
  assert.match(html, /Wins <b>95<\/b> Coins back/);
  assert.doesNotMatch(html, /data-n="100"/);
  assert.match(html, /All in · 60/);
});
test('with no lines the page says how they appear; with no wallet it waits', () => {
  assert.match(stakesView(state({ slate: [] }), o), /submitted their team sheets/);
  assert.match(stakesView({ ...state(), wallet: null, slate: [] }, o), /Opening your wallet/);
});
test('the tour has a step for the wallet, a line, the sides, the stake and the board', () => {
  assert.equal(STEPS.length, 5);
  assert.ok(STEPS.every(s => s.title && s.text));
});

test('the stake buttons follow the settings', () => {
  assert.deepEqual(stakeChips(DEFAULTS, 1000), [10, 50, 100, 1000]);
  assert.deepEqual(stakeChips({ ...DEFAULTS, max_stake: 100 }, 1000), [10, 50, 100]);
  assert.deepEqual(stakeChips({ ...DEFAULTS, min_stake: 20 }, 150), [20, 100, 150]);
  assert.deepEqual(stakeChips(DEFAULTS, 5), []);
  assert.deepEqual(stakeChips({ ...DEFAULTS, max_stake: 60 }, 1000), [10, 50, 60]);
});
test('a pick pays at the multiplier it was placed at', () => {
  assert.equal(payout(100, 2), 200); assert.equal(payout(100, '1.50'), 150); assert.equal(payout(55), 104);
  const html = stakesView(state({ slate: [{ ...line(2, true), my_mult: 2.5 }] }), o);
  assert.match(html, /pays <b>250<\/b>/);
});
test('the page follows the settings: closed note, hidden leaderboard', () => {
  const open = stakesView(state({ cfg: { ...DEFAULTS } }), o), shut = stakesView(state({ cfg: { ...DEFAULTS, betting_open: false, show_board: false } }), o);
  assert.doesNotMatch(open, /closed for now/); assert.match(open, /Leaderboard/);
  assert.match(shut, /Stakes is closed for now/); assert.doesNotMatch(shut, /Leaderboard/);
  assert.match(shut, /class="st-side under"[^>]*disabled/);
});
test('the tour quotes the real numbers', () => {
  const t = stepsFor({ ...DEFAULTS, start_coins: 500, daily_topup: 0, multiplier: 2, lock_minutes: 15 }).map(s => s.text).join(' ');
  assert.match(t, /500 Coins\./); assert.doesNotMatch(t, /more each day/); assert.match(t, /2 times/); assert.match(t, /15 minutes before kick-off/);
});
test('the Editor form becomes the object the database takes', () => {
  const f = new FormData();
  for (const [k, v] of [['lines_per_week', '6'], ['lines_per_match', '2'], ['start_coins', '500'], ['daily_topup', ''], ['multiplier', '2.5'], ['min_stake', '20'], ['max_stake', ''], ['show_board', 'on'], ['stats', 'sv'], ['stats', 'tk']]) f.append(k, v);
  const o2 = readSettings(f);
  assert.equal(o2.lines_per_week, 6); assert.equal(o2.lines_per_match, 2); assert.equal(o2.start_coins, 500); assert.equal(o2.multiplier, 2.5); assert.equal(o2.min_stake, 20);
  assert.equal(o2.max_stake, 0);                 // blank = no limit
  assert.ok(!('daily_topup' in o2));             // blank is left alone
  assert.equal(o2.show_board, true); assert.deepEqual(o2.stats, ['sv', 'tk']);
  assert.equal(readSettings(new FormData()).show_board, false);   // an unticked box is off
});

test('the starting stake is five times the smallest when you can afford it', () => {
  assert.equal(defaultStakeFor(DEFAULTS, 1000), 50);
  assert.equal(defaultStakeFor(DEFAULTS, 30), 10);
  assert.equal(defaultStakeFor({ ...DEFAULTS, min_stake: 20 }, 1000), 100);
});

test('the grid picks columns that fill every row, never one card alone underneath', () => {
  assert.equal(bestCols(8, 4), 4);    // two full rows
  assert.equal(bestCols(9, 4), 3);    // three full rows
  assert.equal(bestCols(6, 4), 3);
  assert.equal(bestCols(10, 5), 5);   // two full rows
  assert.equal(bestCols(10, 4), 2);   // five rows of two beats 4+4+2
  assert.equal(bestCols(7, 4), 4);    // 4 + 3, the last row nearly full
  assert.equal(bestCols(5, 3), 3);    // 3 + 2, not 4 + 1
  assert.equal(bestCols(1, 4), 1); assert.equal(bestCols(2, 4), 2);
  for (const max of [2, 3, 4, 5]) for (let n = 2; n <= 12; n++) { const c = bestCols(n, max), rem = n % c; assert.ok(c <= max && (rem === 0 || rem >= 2 || n <= c), `${n} cards in ${max}: ${c}`); }
});
test('every round writes its column counts onto its grid, and a card never grows to hold the chooser', () => {
  const slate = Array.from({ length: 8 }, (_, i) => ({ ...line(i + 1), week: 2 }));
  const html = stakesView(state({ slate, picked: { line: 3, side: 'over', stake: 50 } }), o);
  assert.match(html, /class="st-grid" style="--c-lg:4;--c-md:2;--c-sm:2"/);
  assert.equal((html.match(/class="st-sheet is-over"/g) || []).length, 1);   // one chooser open, over its own card
  assert.doesNotMatch(html, /st-stakebox/);
});

test('the leaderboard is along the top, above the cards, and hidden when switched off', () => {
  const board = [1, 2, 3, 4, 5, 6, 7].map(i => ({ rank: i, club: 'AAA', name: 'M' + i, coins: 2000 - i, won: 1, settled: 2, mine: i === 7 }));
  const html = stakesView(state({ board, slate: [line(1)] }), o);
  assert.ok(html.indexOf('st-boardstrip') > -1 && html.indexOf('st-boardstrip') < html.indexOf('Round 1 stakes'));
  assert.equal((html.match(/<li class="[^"]*"><i class="st-rank">/g) || []).length, 6);   // the top five and you
  assert.match(html, /class="me"><i class="st-rank">7/);
  assert.doesNotMatch(stakesView(state({ board, slate: [line(1)], cfg: { ...DEFAULTS, show_board: false } }), o), /st-boardstrip/);
});
test('the Editor can switch the lineup off', () => {
  const f = new FormData(); f.append('score_all', 'on');
  assert.equal(readSettings(f).score_all, true);
  assert.equal(readSettings(new FormData()).score_all, false);
});

// ---- the game predictors ----

test('a card only calls the number the player\'s average when it is his own', () => {
  assert.equal(averageText({ usual: 33.84, usual_src: 'own', pos: 'MID' }), 'Averages 33.8 a match');
  assert.equal(averageText({ usual: 3.5, usual_src: 'position', pos: 'GK' }), 'Keepers average 3.5 a match');
  assert.equal(averageText({ usual: 1.69, usual_src: 'position', pos: 'FWD' }), 'Forwards average 1.7 a match');
  assert.equal(averageText({ usual: 32.5, usual_src: 'default', pos: 'MID' }), 'Starting line, no matches yet');
  assert.equal(averageText({ usual: null }), '');
  const html = stakesView(state({ slate: [{ ...line(1), usual: 3.5, usual_src: 'position', pos: 'GK' }] }), o);
  assert.match(html, /Keepers average 3\.5 a match/); assert.doesNotMatch(html, /Averages 3\.5/);
});

// ---- the game predictors: Team A win, Draw or Team B win ----
const resultLine = (id, my) => ({ line_id: id, kind: 'result', featured: false, fixture: 'f' + id, week: 1, home: 'AAA', away: 'BBB', starts_at: '2026-11-01T08:00:00Z', locks_at: '2026-11-01T08:00:00Z',
  player_id: null, player_name: null, team: null, pos: null, stat: null, line: null, usual: null, my_side: null, my_result: my || null, my_home: null, my_away: null,
  my_stake: my ? 100 : null, my_status: my ? 'open' : null, my_mult: my ? (my === 'draw' ? 3 : 2.2) : null, my_mult2: null });
const ROW = /<li class="st-pr[\s\S]*?<\/li>/g;

test('every game has its own predictor row with three choices, and none of them is a big card', () => {
  const html = stakesView(state({ slate: [line(1), resultLine(7), { ...resultLine(8), fixture: 'f10' }] }), o);
  assert.match(html, /Game predictors/);
  assert.equal((html.match(ROW) || []).length, 2);
  assert.equal((html.match(/class="lg-card st-stake/g) || []).length, 1);          // only the player stake is a card
  assert.match(html, /Round 1 · 2 games/);
  assert.match(html, /Round 1 stakes/); assert.match(html, /1 stake</);
  const row = html.match(ROW)[0];
  assert.equal((row.match(/data-st="rpick"/g) || []).length, 3);
  assert.deepEqual([...row.matchAll(/data-which="(\w+)"/g)].map(m => m[1]), RESULTS);
  assert.match(row, /AAA win/); assert.match(row, />Draw</); assert.match(row, /BBB win/);
  assert.match(row, /pays 2\.2×/); assert.match(row, /pays 3×/);
  assert.match(row, /Tap a result to pick it/); assert.match(row, /Pick a result/);
});
test('choosing a result lights it up, the others stay, and the button names the pick and follows the stake', () => {
  const row = stakesView(state({ slate: [resultLine(7)], rs: { 7: { pick: 'away', stake: 100 } } }), o).match(ROW)[0];
  assert.match(row, /st-rr is-away on/); assert.match(row, /aria-pressed="true"/); assert.equal((row.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(row, /st-rr is-home off/); assert.match(row, /You picked/);
  assert.match(row, /Lock in: BBB win/); assert.match(row, /<b>100<\/b>/); assert.doesNotMatch(row, /placeresult"[^>]*disabled/);
  assert.match(row, /data-st="stakecycle"/);
});
test('nothing is locked in until a result is picked', () => {
  const row = stakesView(state({ slate: [resultLine(7)] }), o).match(ROW)[0];
  assert.match(row, /data-st="placeresult"[^>]*disabled/);
});
test('a placed pick is locked, shows its pick and what it pays at the payout it was placed at', () => {
  const row = stakesView(state({ slate: [resultLine(7, 'draw')] }), o).match(ROW)[0];
  assert.match(row, /has-pick/); assert.doesNotMatch(row, /placeresult/);
  assert.match(row, /Locked in: Draw/); assert.match(row, /Pays <b>300<\/b> if you are right/); assert.match(row, /Take back/);
  assert.equal((row.match(/data-st="rpick"[^>]*disabled/g) || []).length, 3);
  assert.match(row, /st-rr is-draw on/);
});
test('resultLabel names the pick', () => {
  assert.equal(resultLabel('home', 'Turtle', 'SKS'), 'Turtle win'); assert.equal(resultLabel('away', 'Turtle', 'SKS'), 'SKS win'); assert.equal(resultLabel('draw', 'Turtle', 'SKS'), 'Draw');
});
test('the tour has a predictor step only when there are predictors, quoting the payouts', () => {
  assert.ok(!stepsFor(DEFAULTS, false).some(s => /predictor/i.test(s.title)));
  const s = stepsFor({ ...DEFAULTS, result_win_mult: 2.5, result_draw_mult: 3.5 }, true).find(x => /predictor/i.test(x.title));
  assert.match(s.text, /2\.5 times/); assert.match(s.text, /3\.5 times/); assert.match(s.text, /Draw/);
});
test('the Editor form carries the win and draw payouts and the switch', () => {
  const f = new FormData();
  for (const [k, v] of [['result_win_mult', '2.5'], ['result_draw_mult', '3.5'], ['score_all', 'on']]) f.append(k, v);
  const o3 = readSettings(f);
  assert.equal(o3.result_win_mult, 2.5); assert.equal(o3.result_draw_mult, 3.5); assert.equal(o3.score_all, true);
  assert.ok(!('score_exact_mult' in o3) && !('score_per_week' in o3));
});
test('history names a result pick and the final score', () => {
  const html = stakesView(state({ history: [{ kind: 'result', home: 'AAA', away: 'BBB', result: 'home', stake: 100, status: 'won', payout: 220, act_home: 2, act_away: 1 }], slate: [line(1)] }), o);
  assert.match(html, /AAA v BBB/); assert.match(html, /AAA win · it finished 2–1/);
});
