// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The Stakes tab's pure parts (MU-1): payout, the closing clock and the page's html for a few states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { payout, closesIn, stakesView, statName, STEPS, stepsFor, stakeChips, DEFAULTS, stepGoals, defaultStakeFor, bestCols } from '../js/stakes.js';
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

// ---- guess the score ----
const scoreLine = (id, my, featured = true) => ({ line_id: id, kind: 'score', featured, fixture: 'f9', week: 1, home: 'AAA', away: 'BBB', starts_at: '2026-11-01T08:00:00Z', locks_at: '2026-11-01T08:00:00Z', player_id: null, player_name: null, team: null, pos: null, stat: null, line: null, usual: null,
  my_side: null, my_home: my ? 2 : null, my_away: my ? 1 : null, my_stake: my ? 100 : null, my_status: my ? 'open' : null, my_mult: my ? 8 : null, my_mult2: my ? 2 : null });

test('the score steps stay between 0 and 9', () => {
  assert.equal(stepGoals(0, -1), 0); assert.equal(stepGoals(9, 1), 9); assert.equal(stepGoals(3, 1), 4); assert.equal(stepGoals(3, -1), 2);
});
test('the starting stake is five times the smallest when you can afford it', () => {
  assert.equal(defaultStakeFor(DEFAULTS, 1000), 50);
  assert.equal(defaultStakeFor(DEFAULTS, 30), 10);
  assert.equal(defaultStakeFor({ ...DEFAULTS, min_stake: 20 }, 1000), 100);
});
test('a score card has a + and a - under each team, both clubs, and says what each result pays', () => {
  const html = stakesView(state({ slate: [scoreLine(7)], sc: { 7: { h: 2, a: 0, stake: 100, open: true } } }), o);
  assert.match(html, /st-scorecard/);
  const card = html.match(/<article class="lg-card st-stake st-scorecard[\s\S]*?<\/article>/)[0];
  assert.equal((card.match(/data-st="step"/g) || []).length, 4);          // minus and plus for each side
  assert.equal((card.match(/data-which="h"/g) || []).length, 2); assert.equal((card.match(/data-which="a"/g) || []).length, 2);
  assert.match(html, /data-score="h"[^>]*>2</); assert.match(html, /data-score="a"[^>]*>0</);
  assert.match(html, /Exact score pays <b>800<\/b>, the right result <b>200<\/b>/);
  assert.match(html, /Stake 100 on 2–0/);
  assert.match(html, /data-st="placescore"/);
});
test('the minus is off at 0 and the plus at 9', () => {
  const html = stakesView(state({ slate: [scoreLine(7)], sc: { 7: { h: 0, a: 9, stake: 50 } } }), o);
  assert.match(html, /data-which="h" data-d="-1"[^>]*disabled/); assert.doesNotMatch(html, /data-which="h" data-d="1"[^>]*disabled/);
  assert.match(html, /data-which="a" data-d="1"[^>]*disabled/);
});
test('a placed score prediction is locked and shows what it pays at the multipliers it was placed at', () => {
  const html = stakesView(state({ slate: [scoreLine(7, true)] }), o);
  const card = html.match(/<article class="lg-card st-stake st-scorecard[\s\S]*?<\/article>/)[0];
  assert.doesNotMatch(card, /data-st="step"/); assert.doesNotMatch(card, /placescore/);
  assert.match(html, /2–1<\/b> · 100 Coins<br>exact pays <b>800<\/b>, result <b>200<\/b>/);
  assert.match(html, /Take back/);
});
test('a score card and a player card sit in the same round', () => {
  const html = stakesView(state({ slate: [line(1), scoreLine(7)] }), o);
  assert.equal((html.match(/class="lg-card st-stake/g) || []).length, 2);
  assert.equal((html.match(/Round 1 stakes/g) || []).length, 1);
});
test('the tour has a score step only when there is a score card', () => {
  assert.ok(!stepsFor(DEFAULTS, false).some(s => /score/i.test(s.title)));
  const s = stepsFor({ ...DEFAULTS, score_exact_mult: 10, score_result_mult: 2.5 }, true).find(x => /score/i.test(x.title));
  assert.match(s.text, /10 times/); assert.match(s.text, /2\.5 times/);
});
test('the Editor form carries the score settings', () => {
  const f = new FormData();
  for (const [k, v] of [['score_per_week', '3'], ['score_exact_mult', '10'], ['score_result_mult', '2.5']]) f.append(k, v);
  const o3 = readSettings(f);
  assert.equal(o3.score_per_week, 3); assert.equal(o3.score_exact_mult, 10); assert.equal(o3.score_result_mult, 2.5);
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

test('the lineup at the bottom has a narrow row for every game, with the predictor, the stake and one button', () => {
  const html = stakesView(state({ slate: [line(1), scoreLine(7, false, true), { ...scoreLine(8, false, false), fixture: 'f10' }], sc: { 8: { h: 3, a: 0, stake: 50 } } }), o);
  assert.match(html, /Call every game/);
  assert.equal((html.match(/class="st-lurow/g) || []).length, 2);               // every score line, featured or not
  assert.equal((html.match(/class="lg-card st-stake st-scorecard/g) || []).length, 1);   // but only the featured one is also a card
  const row = html.match(/<li class="st-lurow[\s\S]*?<\/li>/g).pop();            // the one that is only in the lineup
  assert.equal((row.match(/data-st="step"/g) || []).length, 4);
  assert.match(row, /<b class="st-lunum">3<\/b>/); assert.match(row, /Stake 3–0/);
  assert.match(row, /data-st="lucycle"/); assert.match(row, /data-st="placescore"/);
});
test('a placed row in the lineup is locked and shows what it pays', () => {
  const html = stakesView(state({ slate: [scoreLine(7, true)] }), o);
  const row = html.match(/<li class="st-lurow[\s\S]*?<\/li>/)[0];
  assert.match(row, /has-pick/); assert.doesNotMatch(row, /data-st="step"/);
  assert.match(row, /exact <b>800<\/b> · result <b>200<\/b>/); assert.match(row, /Take back/);
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
