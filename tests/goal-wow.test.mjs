import test from 'node:test';
import assert from 'node:assert/strict';
import { goalMoments, shortlist, clipWindow, describe } from '../js/goal-wow.js';

const fx = { id: 'f1', home: 'AAA', away: 'BBB' };
const file = {
  players: [{ id: 'p1', name: 'Ryan Zane' }, { id: 'p2', name: 'Sam Low' }],
  events: [
    { id: 1, t: 100, type: 'pass', team: 'AAA', poss: 5 }, { id: 2, t: 102, type: 'pass', team: 'AAA', poss: 5 }, { id: 3, t: 103, type: 'take_on', team: 'AAA', poss: 5, won: true },
    { id: 4, t: 105, type: 'shot', team: 'AAA', player: 'p1', poss: 5, x: 80, y: 20, xg: 0.03, body: 'foot', subtype: 'open', speed: 34, id_: 0 },
    { id: 5, t: 106, type: 'goal', team: 'AAA', scorer: 'p1', poss: 5, x: 105, y: 33, shot: 4, minute: 85, score: [1, 1] },
    { id: 6, t: 300, type: 'shot', team: 'BBB', player: 'p2', poss: 9, x: 100, y: 34, xg: 0.7, body: 'foot', subtype: 'open', speed: 20 },
    { id: 7, t: 301, type: 'goal', team: 'BBB', scorer: 'p2', poss: 9, x: 0, y: 34, shot: 6, minute: 10, score: [1, 0] },
    { id: 8, t: 400, type: 'shot', team: 'AAA', player: 'p1', poss: 11, x: 94, y: 34, xg: 0.76, subtype: 'penalty' },
    { id: 9, t: 401, type: 'goal', team: 'AAA', scorer: 'p1', poss: 11, x: 105, y: 34, shot: 8, minute: 30, score: [2, 0] },
    { id: 10, t: 500, type: 'goal', team: 'BBB', scorer: 'p1', poss: 12, x: 105, y: 34, shot: null, minute: 40, own_goal: true, score: [3, 0] },
  ],
};

test('penalties and own goals are left out', () => {
  assert.equal(goalMoments(file, fx).length, 2);
});

test('a long, unlikely, well-built goal outscores a tap-in', () => {
  const [far, tap] = goalMoments(file, fx);
  assert.ok(far.wow > tap.wow + 30, `${far.wow} v ${tap.wow}`);
  assert.equal(far.scorerName, 'Ryan Zane');
  assert.equal(far.passes, 2);
  assert.equal(far.takeOns, 1);
  assert.equal(far.key, 'f1:5');
});

test('the clip is 5 seconds around the goal', () => {
  const [a, b] = clipWindow({ t: 106 });
  assert.equal(b - a, 5);
  assert.ok(a < 106 && b > 106);
});

test('shortlist keeps the best first and at most 3 per match', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ fixture: 'a', wow: 90 - i, t: i }))
    .concat([{ fixture: 'b', wow: 10, t: 0 }]);
  const s = shortlist(many, 15);
  assert.equal(s.filter(m => m.fixture === 'a').length, 3);
  assert.equal(s[0].wow, 90);
  assert.equal(s.length, 4);
});

test('describe reads as a short line', () => {
  assert.match(describe(goalMoments(file, fx)[0]), /m, 2 passes?|xG/);
});
