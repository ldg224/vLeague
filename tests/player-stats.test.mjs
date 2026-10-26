// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// Player pages (js/player-stats.js): totals, the match log, spoiler-free, the keeper's set and the league places, on two made-up matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playerView, averageRating, classOf, MIN_PEERS } from '../js/player-stats.js';
import { plink, playerUrl } from '../js/player-link.js';

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
  assert.equal(goals.cls, undefined);   // too few forwards for classes yet
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
test('league places list only the top ten', () => {
  const v = playerView(season, 'a1');
  assert.ok(v.ranks.length > 0 && v.ranks.length <= 5);
  assert.ok(v.ranks.every(r => r.rank <= 10));
  assert.equal(v.ranks.find(r => r.title === 'Top scorers')?.rank, 1);
});
test('a player link wraps the name, escapes the id and leaves it alone with no id', () => {
  assert.equal(playerUrl('0428'), 'player.html?id=0428');
  assert.match(plink('a"1', 'Ana'), /data-pid="a&quot;1"[^>]*>Ana<\/span>/);
  assert.equal(plink(null, 'Ana'), 'Ana');
});

test('classOf: top 10% elite, then great, average, below, poor; turned round where less is better', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(classOf(v, 10).cls, 'elite');
  assert.equal(classOf(v, 8).cls, 'great');
  assert.equal(classOf(v, 5).cls, 'avg');
  assert.equal(classOf(v, 2).cls, 'below');
  assert.equal(classOf(v, 1).cls, 'poor');
  assert.equal(classOf(v, 1, true).cls, 'elite');     // conceding least is the best
  assert.equal(classOf([0, 0, 0, 0, 0, 0, 0, 3], 0).cls, 'avg');   // ties share the middle, so a nought among noughts is average
});
test('classes and league averages show once enough players of his position have played', () => {
  const fwds = Array.from({ length: 8 }, (_, i) => ({ id: 'f' + i, name: 'F' + i, team: 'AAA', position: 'FWD', number: i, offense: 5, defense: 5, value: 1000 }));
  const res = { home: 1, away: 0, players: Object.fromEntries(fwds.map((p, i) => [p.id, P(p.name, 'AAA', 'ST', { g: i, sh: i + 1, r: 6 })])) };
  const s = { players: fwds, fixtures: [1, 2, 3].map(w => fx('x' + w, w, 'AAA', 'BBB', res)) };
  const one = playerView({ players: fwds, fixtures: [fx('y1', 1, 'AAA', 'BBB', res)] }, 'f7');
  assert.ok(!one.compare.eligible);   // one match is too little for a class
  assert.equal(one.groups[0].rows[0].cls, undefined); assert.ok(one.groups[0].rows[0].avg);   // but the average shows
  const top = playerView(s, 'f7'), bottom = playerView(s, 'f0');
  assert.ok(top.compare.eligible && top.compare.n === 8 && MIN_PEERS <= 8);
  const g = v => v.groups.find(x => x.title === 'Attacking').rows.find(r => r.label === 'Goals');
  assert.equal(g(top).cls, 'elite'); assert.equal(g(bottom).cls, 'poor');
  assert.equal(g(top).avg, '3.50');   // (0+1+...+7)/8 goals a match
  assert.ok(g(top).fill === 100 && g(top).tick === 50);
  // nobody in this league had a foul, a card or a clearance, so those lists stay off the page
  assert.ok(!top.groups.some(x => x.title === 'Discipline' || x.title === 'Defending'));
  assert.ok(top.groups.find(x => x.title === 'Attacking').rows.some(r => r.label === 'Assists'));   // goals and assists always show
});
