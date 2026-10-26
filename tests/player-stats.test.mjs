// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// Player pages (js/player-stats.js): totals, the match log, spoiler-free, the keeper's set and the league places, on two made-up matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playerView, averageRating, classOf, MIN_PEERS } from '../js/player-stats.js';
import { plink, wirePlayerLinks } from '../js/player-link.js';

const P = (name, team, slot, o = {}) => ({ name, team, slot, min: 90, g: 0, a: 0, sh: 0, sot: 0, xg: 0, kp: 0, pas: 20, pc: 15, tk: 0, int: 0, clr: 0, blk: 0, sv: 0, gc: 0, yc: 0, rc: 0, fl: 0, fd: 0, dr: 0, aw: 0, off: 0, cr: 0, tch: 40, km: 5, pw: 0, pcn: 0, r: 6.5, ...o });
const players = [
  { id: 'a1', name: 'Ana', team: 'AAA', position: 'FWD', number: 9, offense: 8, defense: 3, value: 5000 },
  { id: 'a2', name: 'Alf', team: 'AAA', position: 'GK', number: 1, offense: 2, defense: 8, value: 4000 },
  { id: 'b1', name: 'Bea', team: 'BBB', position: 'MID', number: 8, offense: 5, defense: 5, value: 3000 },
  { id: 'free', name: 'Fred', team: '', position: 'DEF', offense: 3, defense: 6, value: 1000 },
];
const fx = (id, week, home, away, res) => ({ id, week, home, away, starts_at: `2026-11-0${week}T08:00:00Z`, round: `Round ${week}`, result: res });
const season = { players, fixtures: [
  fx('f1', 1, 'AAA', 'BBB', { home: 2, away: 0, players: { a1: P('Ana', 'AAA', 'ST', { g: 2, sh: 4, sot: 3, xg: 1.5, r: 8.6 }), a2: P('Alf', 'AAA', 'GK', { sv: 3, r: 7.4 }), b1: P('Bea', 'BBB', 'CM', { a: 0, r: 6.0 }) } }),
  fx('f2', 2, 'BBB', 'AAA', { home: 1, away: 1, players: { a1: P('Ana', 'AAA', 'ST', { g: 1, a: 1, sh: 2, sot: 1, yc: 1, r: 7.5 }), a2: P('Alf', 'AAA', 'GK', { sv: 5, gc: 1, r: 7.0 }), b1: P('Bea', 'BBB', 'CM', { g: 1, r: 7.2 }) } }),
  fx('f3', 3, 'AAA', 'BBB', null),
] };

test('no such player gives null; a player with no matches has no stats', () => {
  assert.equal(playerView(season, 'nope'), null);
  const v = playerView(season, 'free');
  assert.equal(v.row, null); assert.deepEqual(v.groups, []); assert.deepEqual(v.log, []);
});
test('totals, per 90 and the log for a forward', () => {
  const v = playerView(season, 'a1');
  assert.equal(v.row.g, 3); assert.equal(v.row.apps, 2);
  const attack = v.groups.find(g => g.title === 'Attacking').rows;
  const goals = attack.find(r => r.label === 'Goals');
  assert.equal(goals.total, '3'); assert.equal(goals.per90, '1.50');
  assert.equal(goals.cls, undefined);   // too few forwards for any class yet
  assert.equal(attack.find(r => r.label === 'Shots').total, '6');
  assert.equal(v.log.length, 2);
  assert.deepEqual(v.log.map(l => [l.fx.id, l.home, l.opp, l.res, l.gf, l.ga]), [['f1', true, 'BBB', 'W', 2, 0], ['f2', false, 'BBB', 'D', 1, 1]]);
  assert.equal(averageRating(v.row), 8.1);
});
test('a keeper gets the goalkeeping set and a save percentage', () => {
  const v = playerView(season, 'a2');
  const gk = v.groups.find(g => g.title === 'Goalkeeping').rows;
  assert.equal(gk.find(r => r.label === 'Saves').total, '8');
  assert.equal(gk.find(r => r.label === 'Save percentage').total, '89%');
  assert.ok(!v.groups.some(g => g.title === 'Attacking'));
});
test('a match the viewer has not opened is left out of everything', () => {
  const v = playerView(season, 'a1', { hidden: new Set(['f2']) });
  assert.equal(v.row.g, 2); assert.equal(v.log.length, 1);
});
test('a player link wraps the name, escapes the id and leaves it alone with no id', () => {
  assert.match(plink('a"1', 'Ana'), /data-pid="a&quot;1"[^>]*>Ana<\/span>/);
  assert.equal(plink(null, 'Ana'), 'Ana');
});
test('a click or Enter on a name opens that player and stops the row under it', () => {
  const handlers = {}, opened = [];
  globalThis.document = { addEventListener: (type, fn, capture) => { handlers[type] = { fn, capture }; } };
  wirePlayerLinks({ open: id => opened.push(id) });
  assert.equal(handlers.click.capture, true);   // runs before the row's own click
  const name = { dataset: { pid: '0602' } };
  let stopped = 0, prevented = 0;
  const event = (extra = {}) => ({ target: { closest: sel => (sel === '[data-pid]' ? name : null), ...extra }, button: 0, key: 'Enter', preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  handlers.click.fn(event());
  assert.deepEqual(opened, ['0602']); assert.equal(stopped, 1); assert.equal(prevented, 1);
  handlers.click.fn(event({ closest: () => null }));          // a click elsewhere on the row: not ours
  handlers.click.fn({ ...event(), button: 2 });                // a right click: not ours
  assert.equal(opened.length, 1);
  const key = event(); key.target = name; key.target.closest = () => name;
  handlers.keydown.fn(key);
  assert.deepEqual(opened, ['0602', '0602']);
  delete globalThis.document;
});
