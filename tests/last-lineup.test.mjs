// Run with:  node --test "tests/*.test.mjs"
// S-46 "Use last week's line-up": copySheet turns a round's submitted sheet into the sheet to work on.
import test from 'node:test';
import assert from 'node:assert/strict';
const { FORMATIONS, copySheet, normaliseSheet } = await import('../js/pitch.js');

const POS = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'GK', 'DEF', 'MID', 'FWD', 'MID'];
const squad = POS.map((position, i) => ({ id: i + 1, name: `P${i + 1}`, position, offense: 50, defense: 50 }));
const slots = Object.keys(FORMATIONS['4-3-3']);
const lineup = Object.fromEntries(slots.map((s, i) => [s, String(i + 1)]));
const prev = { formation: '4-3-3', lineup, tactics: { pressing: 0.75 }, captain: '9', penalties: '10', freekicks: '6', corners: '7', kit: 'away', boost: true };

test('everything carries over, except the Boosted Captain', () => {
  const { sheet, gaps } = copySheet(prev, squad);
  assert.deepEqual(gaps, []);
  assert.deepEqual(sheet.lineup, lineup);
  assert.equal(sheet.formation, '4-3-3');
  assert.equal(sheet.captain, '9');
  assert.equal(sheet.penalties, '10');
  assert.equal(sheet.kit, 'away');
  assert.equal(sheet.tactics.pressing, 0.75);
  assert.equal('boost' in sheet, false);
  assert.deepEqual(sheet.bench.map(p => p.id ?? p).map(String).sort(), ['12', '13', '14', '15', '16']);
});

test('a player who cannot play now leaves his spot empty, and the captain armband goes with him', () => {
  const avail = squad.filter(p => p.id !== 9 && p.id !== 3);   // 9 banned, 3 released
  const { sheet, gaps } = copySheet(prev, avail);
  const slot9 = slots[8], slot3 = slots[2];
  assert.equal(sheet.lineup[slot9], undefined);
  assert.equal(sheet.lineup[slot3], undefined);
  assert.deepEqual(gaps.map(g => g.slot).sort(), [slot3, slot9].sort());
  assert.deepEqual(gaps.map(g => g.id).sort(), ['3', '9']);
  assert.equal(sheet.captain, null);
  assert.equal(sheet.penalties, '10');
  // the normal load still fills empty spots, as before
  assert.equal(Object.keys(normaliseSheet(prev, avail).lineup).length, slots.length);
});

test('no sheet to copy gives an ordinary default sheet and no gaps', () => {
  const { gaps } = copySheet(null, squad);
  assert.deepEqual(gaps, []);
});
