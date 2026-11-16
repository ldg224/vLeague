// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// S-36: the line-up pills are Average rating, Season stats, Ratings and Value (Contributions removed).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: 'localhost', search: '', href: 'http://localhost/' };
const { VIEWS, seasonLine, ratingBadges } = await import('../js/match-lineup.js');

test('the four views, no Contributions', () => {
  assert.deepEqual(VIEWS.map(v => v[0]), ['rating', 'season', 'ratings', 'value']);
  assert.ok(!VIEWS.some(v => /contrib/i.test(v[0] + v[1])));
});
test('Season stats: apps, then goals and assists only when there are some', () => {
  assert.match(seasonLine({ apps: 9, g: 3, a: 2 }), /9 apps<\/span><span class="ml-s-ga">3G 2A/);
  assert.match(seasonLine({ apps: 1, g: 0, a: 1 }), /1 app<\/span><span class="ml-s-ga">1A/);
  assert.doesNotMatch(seasonLine({ apps: 4 }), /ml-s-ga/);
  assert.match(seasonLine(undefined), /0 apps/);
});
test('Ratings: attack and defence, coloured by how good', () => {
  const h = ratingBadges({ offense: 8, defense: 4 });
  assert.match(h, /is-hi"[^>]*>ATT 8/); assert.match(h, /is-bad"[^>]*>DEF 4/);
  assert.match(ratingBadges({ offense: 5, defense: 7 }), /is-lo"[^>]*>ATT 5/);
});
