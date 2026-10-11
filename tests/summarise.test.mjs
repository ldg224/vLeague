// Run with:  node --test "tests/*.test.mjs"
// summariseMatch (js/simulate.js) on a hand-made match file: the stats WR-07 added, and penalties counted from foul events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseMatch } from '../js/simulate.js';

const stats = o => ({ minutes: 90, goals: 0, assists: 0, own_goals: 0, shots: 0, shots_on_target: 0, xg: 0, key_passes: 0, passes: 0, passes_completed: 0,
  tackles_won: 0, interceptions: 0, clearances: 0, blocks: 0, saves: 0, goals_conceded: 0, yellow: 0, red: 0, distance_km: 9, rating: 6.5,
  fouls: 0, fouled: 0, take_ons: 0, aerials_won: 0, offsides: 0, crosses: 0, touches: 0, ...o });
const match = events => ({
  players: [{ id: 'a1', name: 'Ana', team: 'AAA', slot: 'ST' }, { id: 'a2', name: 'Alf', team: 'AAA', slot: 'GK' }, { id: 'b1', name: 'Bo', team: 'BBB', slot: 'CB' }],
  events,
  stats: { players: { a1: stats({ fouled: 2, take_ons: 4, aerials_won: 1, crosses: 3, touches: 55, offsides: 1 }), a2: stats({ saves: 2 }), b1: stats({ fouls: 2 }) }, teams: { home: {}, away: {} } },
  frames: { data: [[0], [6000]] }, periods: [], result: { home: 1, away: 0 }, engine: { version: '0.2.0', seed: 1 },
});

test('the new player stats are kept under short keys', () => {
  const s = summariseMatch(match([]));
  const ana = s.players.a1;
  assert.deepEqual([ana.fl, ana.fd, ana.dr, ana.aw, ana.off, ana.cr, ana.tch], [0, 2, 4, 1, 1, 3, 55]);
  assert.equal(s.players.b1.fl, 2);
});

test('a foul that gave a penalty counts as a penalty won for the fouled player and conceded for the fouler', () => {
  const s = summariseMatch(match([
    { type: 'foul', player: 'b1', on: 'a1', penalty: true, t: 10, minute: '1' },
    { type: 'foul', player: 'b1', on: 'a1', t: 20, minute: '2' },   // an ordinary foul: not a penalty
  ]));
  assert.deepEqual([s.players.a1.pw, s.players.a1.pcn], [1, 0]);
  assert.deepEqual([s.players.b1.pw, s.players.b1.pcn], [0, 1]);
});

test('no penalty fouls leaves the penalty counts at 0', () => {
  const s = summariseMatch(match([{ type: 'foul', player: 'b1', on: 'a1', t: 10, minute: '1' }]));
  assert.deepEqual(Object.values(s.players).map(p => p.pw + p.pcn), [0, 0, 0]);
});
