import test from 'node:test';
import assert from 'node:assert/strict';
import { snap, gridSize, partnerOf, mirrored, roleOf, checks, isCentral } from '../js/shape-smart.js';
import { spotsOf } from '../js/pitch.js';

test('snap rounds to the grid, and to half a percent when free', () => {
  assert.deepEqual(snap(12.3, 47.9, 5), [10, 50]);
  assert.deepEqual(snap(12.3, 47.9, 0), [12.5, 48]);
  assert.equal(gridSize('coarse'), 10);
  assert.equal(gridSize('nope'), 5);   // unknown = medium
});

test('mirror partners pair left and right slots only', () => {
  const slots = ['GK', 'LB', 'LCB', 'RCB', 'RB', 'CDM', 'LW', 'ST', 'RW'];
  assert.equal(partnerOf('LB', slots), 'RB');
  assert.equal(partnerOf('RCB', slots), 'LCB');
  assert.equal(partnerOf('ST', slots), null);
  assert.equal(partnerOf('LM', slots), null);   // no RM in this formation
  assert.ok(isCentral('CDM') && !isCentral('LW'));
  assert.deepEqual(mirrored(20, 40), [80, 40]);
});

test('role names follow where a spot stands', () => {
  assert.equal(roleOf(10, 26, 'DEF'), 'LB');
  assert.equal(roleOf(10, 33, 'DEF'), 'LWB');
  assert.equal(roleOf(90, 33, 'DEF'), 'RWB');
  assert.equal(roleOf(40, 24, 'DEF'), 'CB');
  assert.equal(roleOf(50, 41, 'MID'), 'CDM');
  assert.equal(roleOf(40, 50, 'MID'), 'CM');
  assert.equal(roleOf(8, 50, 'MID'), 'LM');
  assert.equal(roleOf(50, 65, 'AM'), 'CAM');
  assert.equal(roleOf(85, 65, 'AM'), 'RW');
  assert.equal(roleOf(50, 82, 'FWD'), 'ST');
  assert.equal(roleOf(10, 78, 'FWD'), 'LW');
});

const pts = f => Object.entries(spotsOf(f, null)).filter(([s]) => s !== 'GK').map(([slot, s]) => ({ slot, x: s.x, y: s.y, line: s.line }));

test('the presets pass the checks', () => {
  for (const f of ['4-3-3', '4-4-2', '4-2-3-1']) assert.deepEqual(checks(pts(f)), [], f);
});

test('checks catch a staggered back line, crowding and a missing flank', () => {
  const s = pts('4-3-3');
  const stagger = s.map(p => (p.slot === 'LB' ? { ...p, y: 35 } : p));
  assert.ok(checks(stagger).some(c => c.kind === 'line'));
  const crowd = s.map(p => (p.slot === 'RCM' ? { ...p, x: 52, y: 50 } : p.slot === 'CDM' ? { ...p, x: 50, y: 49 } : p));
  assert.ok(checks(crowd).some(c => c.kind === 'crowd'));
  const noRight = s.map(p => (p.x > 76 ? { ...p, x: 60 } : p));
  assert.ok(checks(noRight).some(c => c.kind === 'side' || c.kind === 'narrow'));
});
