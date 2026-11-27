// Run with:  node --test "tests/*.test.mjs"
// S-52: knockout matches level after 90 minutes play extra time (periods 3 and 4, 15 minutes each), then a penalty shootout.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = new URL('http://localhost/');
const { clockAt, addedAt, pensText, winnerOf } = await import('../js/dashboard-data.js');
const { grandFinal } = await import('../js/seasons-tab.js');
const { summariseMatch } = await import('../js/simulate.js');

const periods = [
  { period: 1, start_t: 0, end_t: 2950, added_minutes: 1 }, { period: 2, start_t: 2950, end_t: 5900, added_minutes: 3 },
  { period: 3, start_t: 5900, end_t: 6850, added_minutes: 0 }, { period: 4, start_t: 6850, end_t: 7800, added_minutes: 2 },
];

test('the clock runs on through extra time', () => {
  assert.equal(clockAt(periods, 5900 + 61), '91:01');
  assert.equal(clockAt(periods, 6850 + 30), '105:30');
  assert.equal(clockAt(periods, 6850 + 900 + 60), '121:00');   // into added time at the end of extra time
  assert.equal(addedAt(periods, 6850 + 899), 0);
  assert.equal(addedAt(periods, 6850 + 901), 2);
  assert.equal(addedAt(periods, 5900 + 901), 0);   // none announced at the end of the first half of extra time
  assert.equal(clockAt(periods, 2950 + 60), '46:00');   // the 90 minutes are as before
});

test('the shootout decides a level knockout', () => {
  const fx = { home: 'AAA', away: 'BBB' };
  assert.equal(winnerOf(fx, { home: 1, away: 1, pens: { home: 3, away: 4, winner: 'BBB' } }), 'BBB');
  assert.equal(winnerOf(fx, { home: 2, away: 1 }), 'AAA');
  assert.equal(winnerOf(fx, { home: 1, away: 1 }), null);
  assert.equal(pensText({ home: 1, away: 1, pens: { home: 3, away: 4 } }), '3-4 pens');
  assert.equal(pensText({ home: 1, away: 0 }), '');
});

test('the league Grand Final is not the cup final, and a shootout gives it a winner', () => {
  const cupFinal = { id: 'c', stage: 'GF', cup: 'summer_2026', home: 'CCC', away: 'DDD', result: { home: 3, away: 0 } };
  const gf = { id: 'g', stage: 'GF', home: 'AAA', away: 'BBB', result: { home: 2, away: 2, extra_time: true, pens: { home: 5, away: 4, winner: 'AAA' } } };
  assert.deepEqual(grandFinal([cupFinal, gf]), { winner: 'AAA', runnerUp: 'BBB' });
  assert.equal(grandFinal([cupFinal]), null);
  assert.equal(grandFinal([{ ...gf, result: { home: 1, away: 1 } }]), null);   // an old draw with no shootout stays for the office
});

test('the saved result keeps extra time and the shootout, but shootout goals are not goals', () => {
  const st = { minutes: 120, goals: 0, assists: 0, own_goals: 0, shots: 0, shots_on_target: 0, xg: 0, key_passes: 0, passes: 0, passes_completed: 0,
    tackles_won: 0, interceptions: 0, clearances: 0, blocks: 0, saves: 0, goals_conceded: 0, yellow: 0, red: 0, distance_km: 12, rating: 6.5,
    fouls: 0, fouled: 0, take_ons: 0, aerials_won: 0, offsides: 0, crosses: 0, touches: 0 };
  const d = {
    players: [{ id: 'a1', name: 'Ana', team: 'AAA', slot: 'ST' }, { id: 'b1', name: 'Bo', team: 'BBB', slot: 'ST' }],
    events: [], stats: { players: { a1: st, b1: st }, teams: { home: {}, away: {} } }, frames: { data: [[0], [78000]] }, periods,
    engine: { version: '0.5.0', seed: 1 },
    result: { home: 0, away: 0, goals: [], extra_time: true,
      pens: { home: 1, away: 0, winner: 'AAA', first: 'AAA', kicks: [
        { round: 1, team: 'AAA', player: 'a1', keeper: null, outcome: 'scored', score: [1, 0] },
        { round: 1, team: 'BBB', player: 'b1', keeper: null, outcome: 'saved', score: [1, 0] }] } },
  };
  const s = summariseMatch(d);
  assert.equal(s.extra_time, true);
  assert.deepEqual([s.home, s.away, s.goals.length], [0, 0, 0]);
  assert.deepEqual([s.pens.home, s.pens.away, s.pens.winner], [1, 0, 'AAA']);
  assert.deepEqual(s.pens.kicks.map(k => [k.name, k.outcome]), [['Ana', 'scored'], ['Bo', 'saved']]);
  assert.equal(s.players.a1.g, 0);
  const plain = summariseMatch({ ...d, result: { home: 1, away: 0, goals: [] } });
  assert.ok(!('pens' in plain) && !('extra_time' in plain));
});
