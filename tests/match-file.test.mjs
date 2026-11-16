// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// B-42: telling an old version of a match file from the newest one, and the warning shown over an old one.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: 'localhost', search: '', href: 'http://localhost/' };
const { resultVersion, fileVersion, isStale, staleBanner } = await import('../js/match-file.js');

const file = (seed, home, away) => ({ engine: { seed, version: '2.4' }, result: { home, away } });
const fx = (seed, home, away) => ({ id: 'r3-aaa-bbb', result: { seed, engine: '2.4', home, away } });

test('a file and its result name the same version', () => {
  assert.equal(fileVersion(file(77, 2, 1)), resultVersion(fx(77, 2, 1).result));
  assert.equal(resultVersion({}), null); assert.equal(fileVersion({}), null);
});
test('a file from before the match was played again is old', () => {
  assert.equal(isStale(fx(77, 2, 1), file(77, 2, 1)), false);
  assert.equal(isStale(fx(91, 0, 0), file(77, 2, 1)), true);    // new seed and score
  assert.equal(isStale(fx(77, 1, 1), file(77, 2, 1)), true);    // same seed, different result (other line-ups)
});
test('the database being newer than the page and the file also counts', () => {
  const d = { ...file(77, 2, 1), latest: '91|2.4|0-0' };
  assert.equal(isStale(fx(77, 2, 1), d), true);
  assert.equal(isStale(fx(77, 2, 1), { ...file(77, 2, 1), latest: '77|2.4|2-1' }), false);
});
test('no version on either side, or a demo match, never warns', () => {
  assert.equal(isStale({ result: {} }, file(77, 2, 1)), false);
  assert.equal(isStale(fx(91, 0, 0), {}), false);
  assert.equal(isStale({ ...fx(91, 0, 0), demoFile: {} }, file(77, 2, 1)), false);
});
test('the warning says what happened and offers the new match', () => {
  const h = staleBanner();
  assert.match(h, /role="alert"/); assert.match(h, /old version of this match/); assert.match(h, /data-stale-reload/); assert.match(h, /Load the new match/);
  assert.match(staleBanner({ busy: true }), /disabled/);
});
