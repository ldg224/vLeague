// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The player page's maps (js/player-maps.js) on a tiny made-up match file: the away player's points are turned to attack left to right, the heat grid
// counts his frames, and each map says what it shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMaps, mergeMaps, shotMap, passMap, heatMap, defMap, pitchSvg } from '../js/player-maps.js';

// Home attacks right in period 1; the away player (idx 1, id 'b1') therefore attacks left in period 1 and right in period 2.
const file = {
  match: { home: 'AAA', away: 'BBB' },
  players: [{ idx: 0, id: 'a1', team: 'AAA' }, { idx: 1, id: 'b1', team: 'BBB' }],
  periods: [{ period: 1, start_t: 0, end_t: 100, home_attacks: 'right' }, { period: 2, start_t: 100, end_t: 200, home_attacks: 'left' }],
  frames: { fps: 5, scale: 10, fields: ['t', 'p0_x', 'p0_y', 'p1_x', 'p1_y'], data: [[10, 100, 100, 150, 200], [20, 100, 100, 150, 200], [1100, 100, 100, 900, 300]] },
  events: [
    { type: 'shot', period: 1, minute: '10', player: 'b1', x: 20, y: 30, xg: 0.3, outcome: 'goal', on_target: true },
    { type: 'shot', period: 2, minute: '60', player: 'b1', x: 90, y: 40, xg: 0.1, outcome: 'off_target' },
    { type: 'pass', period: 1, minute: '11', player: 'b1', x: 50, y: 34, end_x: 30, end_y: 34, outcome: 'complete', subtype: 'short' },
    { type: 'pass', period: 1, minute: '12', player: 'b1', x: 50, y: 34, end_x: 45, end_y: 20, outcome: 'intercepted' },
    { type: 'tackle', period: 1, minute: '15', player: 'b1', x: 40, y: 10, won: true },
    { type: 'control', period: 1, minute: '16', player: 'b1', x: 30, y: 10, how: 'interception' },
    { type: 'shot', period: 1, minute: '17', player: 'a1', x: 90, y: 30, xg: 0.5, outcome: 'saved' },   // someone else's
  ],
};

test('the away player attacking left in period 1 is turned round, and period 2 is left alone', () => {
  const m = extractMaps(file, 'b1');
  assert.deepEqual(m.shots.map(s => [s.x, s.y]), [[85, 38], [90, 40]]);   // (20,30) -> (105-20, 68-30); (90,40) as it is
  assert.equal(m.shots.length, 2);                                       // a1's shot is not his
  assert.equal(m.shots[0].on, true); assert.equal(m.shots[1].on, false);
  assert.deepEqual(m.passes.map(p => [p.x, p.y, p.ex, p.ey, p.ok]), [[55, 34, 75, 34, true], [55, 34, 60, 48, false]]);
  assert.deepEqual(m.def.map(d => d.kind), ['tackle', 'interception']);
});
test('the heat grid counts his frames and turns them the same way', () => {
  const m = extractMaps(file, 'b1');
  assert.equal(m.frames, 3);
  assert.equal(m.grid.reduce((a, b) => a + b, 0), 3);
  // frames 1 and 2 (period 1): (15, 20) -> (90, 48); frame 3 (period 2, 110s): (90, 30) as it is
  const GW = 21, GH = 14, cell = (x, y) => Math.floor((y / 68) * GH) * GW + Math.floor((x / 105) * GW);
  assert.equal(m.grid[cell(90, 48)], 2); assert.equal(m.grid[cell(90, 30)], 1);
});
test('a player not in the file gives empty maps; merging adds matches up', () => {
  const none = extractMaps(file, 'zzz');
  assert.equal(none.shots.length + none.passes.length + none.frames, 0);
  const all = mergeMaps([extractMaps(file, 'b1'), extractMaps(file, 'b1')]);
  assert.equal(all.matches, 2); assert.equal(all.shots.length, 4); assert.equal(all.frames, 6);
});
test('each map draws its marks and says what it shows', () => {
  const m = mergeMaps([extractMaps(file, 'b1')]);
  const shots = shotMap(m);
  assert.equal((shots.match(/class="pm-shot is-/g) || []).length, 2 + 3);   // two shots plus the three in the key
  assert.match(shots, /2 shots · 1 goals · 0\.40 xG/); assert.match(shots, /is-half/);
  const passes = passMap(m);
  assert.equal((passes.match(/class="pm-pass /g) || []).length, 2);
  assert.match(passes, /2 passes · 50% completed/);
  assert.match(heatMap(m), /Average position/);
  const def = defMap(m);
  assert.match(def, /1 tackle \(1 won\)/); assert.match(def, /1 interception/);
  assert.match(shotMap(mergeMaps([extractMaps(file, 'zzz')])), /No shots/);
  assert.match(heatMap(mergeMaps([extractMaps(file, 'zzz')])), /No position data/);
});
test('the pitch is drawn once, half or whole, and labelled', () => {
  assert.match(pitchSvg({ label: 'x' }), /viewBox="-2 -2 109 72"/);
  assert.match(pitchSvg({ half: true, label: 'y' }), /viewBox="50.5 -2 56.5 72"/);
});
