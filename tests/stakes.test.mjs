// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The Stakes tab's pure parts (MU-1): payout, the closing clock and the page's html for a few states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { payout, closesIn, stakesView, statName, STEPS } from '../js/stakes.js';

const o = { crest: () => '<i class="c"></i>', name: c => c };
const line = (id, my) => ({ line_id: id, fixture: 'f1', week: 1, home: 'AAA', away: 'BBB', starts_at: '2026-11-01T08:00:00Z', player_id: 'p' + id, player_name: 'Hudson <Allen>', team: 'AAA', pos: 'GK', stat: 'sv', line: 3.5, my_side: my ? 'over' : null, my_stake: my ? 100 : null, my_status: my ? 'open' : null });
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
  assert.equal((html.match(/class="st-line/g) || []).length, 2);
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
  assert.match(html, /wins <b>95<\/b> Coins back/);
  assert.doesNotMatch(html, /data-n="100"/);
  assert.match(html, /All in · 60/);
});
test('with no lines the page says how they appear; with no wallet it waits', () => {
  assert.match(stakesView(state({ slate: [] }), o), /submitted its team sheet/);
  assert.match(stakesView({ ...state(), wallet: null, slate: [] }, o), /Opening your wallet/);
});
test('the tour has a step for the wallet, a line, the sides, the stake and the board', () => {
  assert.equal(STEPS.length, 5);
  assert.ok(STEPS.every(s => s.title && s.text));
});
