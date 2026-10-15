// Run with:  node --test "tests/*.test.mjs"
// Custom formations (S-30): the site's generator (js/pitch.js) must build exactly what the match engine does (js/sim/hcl_sim/tactics.py).
// tests/custom-formations.json is the engine's own output for every valid name; js/sim/tests/test_engine.py checks the engine still produces it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { FORMATIONS, customFormation, customNames, isFormation, formationFromSlots, normaliseSheet, reshape, positionPenalty } = await import('../js/pitch.js');
const engine = JSON.parse(readFileSync(new URL('./custom-formations.json', import.meta.url), 'utf8'));

test('every custom formation is built as the engine builds it', () => {
  assert.deepEqual(customNames().sort(), Object.keys(engine).sort());
  for (const [name, slots] of Object.entries(engine)) {
    const mine = customFormation(name);
    assert.deepEqual(Object.keys(mine).sort(), Object.keys(slots).sort(), name);
    for (const [slot, [line, across, want]] of Object.entries(slots)) assert.deepEqual([mine[slot].line, mine[slot].across, mine[slot].want], [line, across, want], `${name} ${slot}`);
  }
});

test('a custom formation has eleven distinct slots with one goalkeeper', () => {
  for (const name of Object.keys(engine)) {
    const slots = FORMATIONS[name], wants = Object.values(slots).map(s => s.want);
    assert.equal(Object.keys(slots).length, 11, name);
    assert.equal(wants.filter(w => w === 'GK').length, 1, name);
    assert.ok(wants.filter(w => w === 'DEF').length >= 3, name);
  }
});

test('names that are not formations are refused; presets stay as they were', () => {
  for (const bad of ['9-1', '4-4-3', '2-5-3', '6-3-1', '4-0-6', '4-4-2-0', '1-1-1-1-6', 'abc', '', null, undefined, 442]) assert.equal(isFormation(bad), false, String(bad));
  assert.deepEqual(Object.keys(FORMATIONS), ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']);   // the picker lists presets only
  assert.ok(isFormation('4-4-2') && isFormation('4-1-4-1') && '3-4-3' in FORMATIONS);
});

test('a played match is matched back to its formation from the slots', () => {
  assert.equal(formationFromSlots(Object.keys(FORMATIONS['4-3-3'])), '4-3-3');
  assert.equal(formationFromSlots(Object.keys(FORMATIONS['4-1-4-1'])), '4-1-4-1');
  assert.equal(formationFromSlots(['GK', 'ST']), null);
});

test('a sheet with a custom formation is kept, and switching to it keeps same-named slots', () => {
  const squad = [];
  for (const [pos, n] of [['GK', 2], ['DEF', 6], ['MID', 6], ['FWD', 4]]) for (let i = 0; i < n; i++) squad.push({ id: String(squad.length + 1), name: `P ${squad.length + 1}`, position: pos, offense: 5, defense: 5 });
  const sheet = normaliseSheet({ formation: '4-1-4-1', lineup: {} }, squad);
  assert.equal(sheet.formation, '4-1-4-1'); assert.equal(Object.keys(sheet.lineup).length, 11);
  assert.equal(normaliseSheet({ formation: '9-1' }, squad).formation, '4-3-3');
  const back = reshape(sheet.lineup, '4-1-4-1', '4-4-2', squad);
  for (const slot of ['GK', 'LB', 'LCB', 'RCB', 'RB']) assert.equal(back[slot], sheet.lineup[slot], slot);
});

test('the out-of-position rating cost grows with the distance from the slot (S-25), as in the engine', () => {
  assert.equal(positionPenalty('DEF', 'DEF'), 0);
  assert.equal(positionPenalty('MID', 'DEF'), 0.5); assert.equal(positionPenalty('DEF', 'MID'), 0.5); assert.equal(positionPenalty('FWD', 'MID'), 0.5);
  assert.equal(positionPenalty('DEF', 'FWD'), 3); assert.equal(positionPenalty('FWD', 'DEF'), 3);
  assert.equal(positionPenalty('GK', 'FWD'), 4); assert.equal(positionPenalty('FWD', 'GK'), 4); assert.equal(positionPenalty('DEF', 'GK'), 3.5);
  assert.equal(positionPenalty(undefined, 'GK'), 0);
});
