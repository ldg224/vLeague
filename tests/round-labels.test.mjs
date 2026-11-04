// Run with:  node --test "tests/*.test.mjs"
// Round codes (2 Nov 2026): preseason P1, P2, P3; the season 1 to 22; then SF and GF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roundLabels } from '../js/roster.js';

const rounds = [2, 3, 4].map((w, i) => ({ week: w, kind: 'preseason', numbered: false, name: `[PRE] Series ${i + 1}` }))
  .concat(Array.from({ length: 22 }, (_, i) => ({ week: 5 + i, kind: 'regular', numbered: true, name: i === 0 ? 'Opening Week' : null })))
  .concat([{ week: 27, kind: 'finals', numbered: false, name: 'Semi Finals' }, { week: 28, kind: 'regular', numbered: false, name: 'Grand Final' }]);
const m = roundLabels(rounds.map(r => r.week), rounds);

test('preseason rounds are P1, P2, P3 and do not use up a round number', () => {
  assert.deepEqual([2, 3, 4].map(w => m.get(w).short), ['P1', 'P2', 'P3']);
  assert.equal(m.get(2).label, 'Round P1 · [PRE] Series 1');
});
test('the season runs 1 to 22', () => {
  assert.equal(m.get(5).label, 'Round 1 · Opening Week'); assert.equal(m.get(6).label, 'Round 2'); assert.equal(m.get(26).short, '22');
});
test('the finals are SF and GF', () => {
  assert.equal(m.get(27).short, 'SF'); assert.equal(m.get(27).label, 'Semi Finals');
  assert.equal(m.get(28).short, 'GF'); assert.equal(m.get(28).label, 'Grand Final');
  assert.equal(roundLabels([30], [{ week: 30, kind: 'finals', numbered: false }]).get(30).label, 'Semi-finals');
  const tp = roundLabels([29], [{ week: 29, kind: 'finals', numbered: false, name: 'Third Place Final' }]).get(29);
  assert.equal(tp.short, 'TP'); assert.equal(tp.label, 'Third Place Final');
});
