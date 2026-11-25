// Run with:  node --test "tests/*.test.mjs"
// Own shape (S-49): spots dragged anywhere on the pitch name a formation by how deep they stand, and keep their players as the slots are renamed.
import test from 'node:test';
import assert from 'node:assert/strict';
const { FORMATIONS, spotsOf, nameShape, cleanShape, normaliseSheet } = await import('../js/pitch.js');

const outfield = (f, shape) => Object.entries(spotsOf(f, shape)).filter(([s]) => s !== 'GK').map(([key, sl]) => ({ key, x: sl.x, y: sl.y }));

test('every preset and custom formation names itself from its usual spots, slot for slot', () => {
  for (const f of ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-4-1', '5-3-2', '3-4-3', '4-2-1-3']) {
    const named = nameShape(outfield(f));
    assert.ok(named, f);
    assert.equal(named.formation, f);
    for (const [k, v] of Object.entries(named.map)) assert.equal(v, k, `${f} ${k}`);
  }
});

test('moving a spot into another line renames the formation and its slots', () => {
  // 4-3-3: push the holding midfielder up behind the striker
  const pts = outfield('4-3-3').map(p => (p.key === 'CDM' ? { ...p, y: 64 } : p));
  const named = nameShape(pts);
  assert.equal(named.formation, '4-2-1-3');
  assert.equal(named.map.CDM, 'CAM');
  assert.deepEqual(new Set(Object.values(named.map)), new Set(Object.keys(FORMATIONS['4-2-1-3']).filter(s => s !== 'GK')));
});

test('shapes that are not formations are refused', () => {
  const two = outfield('4-4-2').map(p => (p.key === 'LCB' || p.key === 'RCB' ? { ...p, y: 48 } : p));   // only 2 defenders
  assert.equal(nameShape(two), null);
  const fourUp = outfield('4-3-3').map(p => (p.key === 'LCM' ? { ...p, y: 80 } : p));   // 4 forwards
  assert.equal(nameShape(fourUp), null);
});

test('a stored shape is kept only when it still makes its own formation', () => {
  const moved = { ...Object.fromEntries(outfield('4-3-3').map(p => [p.key, [p.x, p.y]])), LB: [12, 34] };
  assert.deepEqual(cleanShape('4-3-3', moved).LB, [12, 34]);
  assert.equal(cleanShape('4-3-3', Object.fromEntries(outfield('4-3-3').map(p => [p.key, [p.x, p.y]]))), null, 'usual spots: no shape');
  assert.equal(cleanShape('4-3-3', { ...moved, ST: [50, 30] }), null, 'the spots make another formation');
  assert.equal(cleanShape('4-3-3', { LB: [12, 34] }), null, 'missing spots');
  assert.equal(cleanShape('4-3-3', { ...moved, LB: ['a', 3] }), null, 'not numbers');
  const far = cleanShape('4-3-3', { ...moved, LB: [-40, 30] });
  assert.deepEqual(far.LB, [5, 30], 'kept on the pitch');
});

test('normaliseSheet keeps a good shape and drops a bad one', () => {
  const squad = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, name: `P${i}`, position: i === 0 ? 'GK' : ['DEF', 'MID', 'FWD'][i % 3], offense: 5, defense: 5 }));
  const shape = { ...Object.fromEntries(outfield('4-3-3').map(p => [p.key, [p.x, p.y]])), RB: [88, 34] };
  assert.deepEqual(normaliseSheet({ formation: '4-3-3', shape }, squad).shape.RB, [88, 34]);
  assert.equal(normaliseSheet({ formation: '4-4-2', shape }, squad).shape, null);
  assert.equal(normaliseSheet(null, squad).shape, null);
});
