import test from 'node:test';
import assert from 'node:assert/strict';
const { possPair } = await import('../js/possession.js');

test('B-39: possession always adds up to 100 (47.5 and 52.5 used to show 48 and 53)', () => {
  assert.deepEqual(possPair(47.5, 52.5), [48, 52]);
  for (let h = 0; h <= 100; h += 0.1) { const [a, b] = possPair(h, 100 - h); assert.equal(a + b, 100); assert.ok(a >= 0 && b >= 0); }
  assert.deepEqual(possPair(30, 10), [75, 25]);                // counts of time, not percentages
  assert.deepEqual(possPair(null, undefined), [50, 50]);       // nothing yet
});
