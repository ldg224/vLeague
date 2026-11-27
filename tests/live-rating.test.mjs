// Run with:  node --test "tests/*.test.mjs"
// B-48: FotMob-style ratings from the match file's events (js/live-rating.js, same steps as js/sim/hcl_sim/rating.py).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = new URL('http://localhost/');
const { ratingsAt } = await import('../js/live-rating.js');

// A 90-minute match: AAA (home, attacking right all match for simplicity) v BBB, 4-4-2 both sides.
const match = events => ({
  teams: { home: { code: 'AAA', formation: '4-4-2' }, away: { code: 'BBB', formation: '4-4-2' } },
  players: [
    { id: 'st', team: 'AAA', slot: 'LST', position: 'FWD' }, { id: 'cm', team: 'AAA', slot: 'LCM', position: 'MID' },
    { id: 'cb', team: 'BBB', slot: 'LCB', position: 'DEF' }, { id: 'gk', team: 'BBB', slot: 'GK', position: 'GK' },
  ],
  periods: [{ period: 1, start_t: 0, end_t: 2700, home_attacks: 'right' }, { period: 2, start_t: 2700, end_t: 5400, home_attacks: 'right' }],
  events,
});
const goal = (id, t, poss = 5) => [
  { id, t, type: 'shot', team: 'AAA', player: 'st', xg: 0.3, outcome: 'goal', assist_candidate: 'cm', poss },
  { id: id + 1, t, type: 'goal', team: 'AAA', scorer: 'st', assist: 'cm', own_goal: false, shot: id, poss },
];

test('doing nothing sits around 6-7 (lower for a forward), goals lift it a lot and a hat-trick reaches 9', () => {
  const quiet = ratingsAt(match([]));
  for (const id of ['cm', 'cb', 'gk']) assert.ok(quiet[id] >= 5.5 && quiet[id] <= 7.5, `${id} ${quiet[id]}`);
  assert.ok(quiet.st < 6.0);   // a forward who does nothing in 90 minutes (the engine's forwards are busy)
  const one = ratingsAt(match(goal(1, 600)));
  assert.ok(one.st - quiet.st >= 1.2, `${quiet.st} -> ${one.st}`);
  assert.ok(one.cm > quiet.cm);   // the assist
  assert.ok(one.gk < quiet.gk && one.cb < quiet.cb);   // conceded, no clean sheet
  // A real hat-trick game: he also passes (25, 21 complete) and has two more shots on target.
  const busy = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, t: 200 + i * 150, type: 'pass', team: 'AAA', player: 'st', outcome: i < 21 ? 'complete' : 'intercepted', x: 70, poss: 9 }));
  const saved = [1, 2].map(i => ({ id: 200 + i, t: 900 + i * 900, type: 'shot', team: 'AAA', player: 'st', xg: 0.15, outcome: 'saved', poss: 11 }));
  const hat = ratingsAt(match([...goal(1, 600), ...goal(3, 1600), ...goal(5, 3600), ...busy, ...saved].sort((x, y) => x.t - y.t)));
  assert.ok(hat.st >= 9.0, String(hat.st));
});

test('an error in his own half that leads to a goal costs about a point', () => {
  // BBB's centre-back miscontrols at x 20 (BBB defends the left goal, as AAA attacks right); AAA scores 4 s later.
  const err = { id: 0, t: 596, type: 'miscontrol', team: 'BBB', player: 'cb', x: 80, y: 30, poss: 4 };
  const with_ = ratingsAt(match([err, ...goal(1, 600)])), without = ratingsAt(match([{ ...err, t: 100 }, ...goal(1, 600)]));
  assert.ok(without.cb - with_.cb >= 0.6, `${without.cb} v ${with_.cb}`);
});

test('ratings stay between 3.0 and 10.0', () => {
  const many = [];
  for (let i = 0; i < 12; i++) many.push(...goal(10 + 2 * i, 300 + i * 400));
  const r = ratingsAt(match(many));
  assert.equal(r.st, 10.0);
  assert.ok(r.gk >= 3.0);
});
