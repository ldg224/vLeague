// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The player page's charts (js/player-charts.js): ticks, the profile, the cumulative xG line, the match bars and the scatter, on small made-up numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, profileChart, cumulativeChart, matchBarsChart, scatterChart, tableOf, PRESETS } from '../js/player-charts.js';

const log = [1, 2, 3].map(i => ({ opp: 'BBB', home: i % 2 === 1, gf: i, ga: 0, res: 'W', s: { min: 90, g: i === 2 ? 2 : 0, xg: 0.6 * i } }));
const ctx = { name: c => c, pos: 'FWD', word: 'forwards' };

test('nice ticks start at 0, end at or above the max and use 1, 2 or 5 steps', () => {
  assert.deepEqual(niceTicks(7, 4), { top: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(niceTicks(0.9, 4), { top: 1, ticks: [0, 0.5, 1] });
  assert.deepEqual(niceTicks(0), { top: 1, ticks: [0, 1] });
  for (const m of [0.3, 1, 3.7, 14, 120]) { const { top, ticks } = niceTicks(m, 4); assert.ok(top >= m && ticks[0] === 0 && ticks.at(-1) === top); }
});
test('the profile shows a bar per stat with a place, colours it by class and says when it is provisional', () => {
  const groups = [{ title: 'Attacking', rows: [{ label: 'Goals', per90: '0.50', total: '3', avg: '0.30', place: 95 }, { label: 'Fouls committed', per90: '2.0', total: '9', avg: '1.0', place: 5, low: true }, { label: 'Matches', total: '3' }] }];
  const html = profileChart(groups, { eligible: false, n: 20, apps: 1, word: 'forwards' });
  assert.match(html, /pc-prow is-elite/);
  assert.match(html, /pc-prow is-poor/);
  assert.equal((html.match(/class="pc-prow/g) || []).length, 2);   // 'Matches' has no place, so no bar
  assert.match(html, /Provisional: 1 match so far/);
  assert.match(html, /95th percentile of 20 forwards/);
  assert.match(html, /fewer is better/);
  assert.doesNotMatch(profileChart(groups, { eligible: true, n: 20, apps: 5, word: 'forwards' }), /Provisional/);
  assert.match(profileChart([], { n: 0 }), /appears once/);
});
test('cumulative goals against xG: two lines, end labels, the verdict and a table', () => {
  const html = cumulativeChart(log);
  assert.match(html, /Goals 2/);
  assert.match(html, /xG 3\.6/);
  assert.equal((html.match(/class="pc-dot/g) || []).length, 3);
  assert.match(html, /below his xG/);   // 2 goals from 3.6 xG
  assert.match(html, /<table>/);
  assert.equal(cumulativeChart(log.slice(0, 1)), '');   // one match is not a line
  assert.equal(cumulativeChart(log.map(l => ({ ...l, s: { ...l.s, xg: 0 } }))), '');
});
test('match bars: one bar a match, the league average line, pills, and the picked stat', () => {
  const ms = [{ key: 'r', label: 'Rating', dp: 1, values: [6.5, 7.2, null], avg: 6.4 }, { key: 'sh', label: 'Shots', dp: 0, values: [1, 3, 2], avg: 2 }];
  const html = matchBarsChart(ms, log, 'sh', ctx);
  assert.equal((html.match(/class="pc-bar"/g) || []).length, 3);
  assert.match(html, />Avg 2\.0</);
  assert.match(html, /data-pcbar="sh" aria-pressed="true"/);
  assert.equal((matchBarsChart(ms, log, 'r', ctx).match(/class="pc-bar"/g) || []).length, 2);   // a match with no figure has no bar
  assert.equal(matchBarsChart([], log, 'r', ctx), '');
});
test('scatter: every peer a dot, him marked and linked, the middle drawn, pills for the presets', () => {
  const peers = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i, team: 'AAA', apps: 3, v: { xg: i * 0.1, g: i * 0.12, sh: i, sot: i / 2, kp: i, a: i / 3, dr: i, fd: i, pas: 30 + i, pcp: 70 + i } }));
  const html = scatterChart(peers, 'p5', '', ctx);
  assert.equal((html.match(/class="pc-sdot/g) || []).length, 6);
  assert.equal((html.match(/pc-sdot is-me/g) || []).length, 1);
  assert.match(html, /data-pid="p5"/);
  assert.equal((html.match(/data-pcsc=/g) || []).length, PRESETS.FWD.length);
  assert.equal((html.match(/class="pc-avg"/g) || []).length, 2);
  assert.equal(scatterChart(peers.slice(0, 2), 'p0', '', ctx), '');
});
test('the table escapes what it is given', () => {
  assert.match(tableOf(['A'], [['<b>x</b>']]), /&lt;b&gt;x&lt;\/b&gt;/);
});
