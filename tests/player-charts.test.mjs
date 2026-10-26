// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The player page's profile chart (js/player-charts.js) on small made-up numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { profileChart, tableOf } from '../js/player-charts.js';


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
test('the table escapes what it is given', () => {
  assert.match(tableOf(['A'], [['<b>x</b>']]), /&lt;b&gt;x&lt;\/b&gt;/);
});
