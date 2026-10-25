// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const R = await import('../js/roster.js');

const codes = ['A', 'B', 'C', 'D', 'E', 'F'];
const flat = weeks => weeks.flatMap(w => w.games.map(([home, away]) => ({ week: w.week, home, away })));

test('a planned season is a clean double round robin', () => {
  const p = R.planSeason({ codes, fixtures: [], firstWeek: 1, rounds: 10, seed: 3 });
  assert.equal(p.weeks.length, 10);
  const m = R.meetMatrix(flat(p.weeks));
  assert.equal(m.size, 15);
  assert.ok([...m.values()].every(e => e.total === 2));
  assert.equal(p.pairSpread, 0);
  assert.ok(p.quality >= 80, p.notes.join('; '));
  for (const w of p.weeks) assert.equal(new Set(w.games.flat()).size, 6);   // nobody twice in a round
});

test('it carries on from rounds already played, and odd numbers get fair byes', () => {
  const odd = ['A', 'B', 'C', 'D', 'E'];
  const first = R.planSeason({ codes: odd, fixtures: [], firstWeek: 1, rounds: 2, seed: 1 });
  const rest = R.planSeason({ codes: odd, fixtures: flat(first.weeks), byeWeeks: new Map(first.weeks.map(w => [w.week, new Set(w.byes)])), firstWeek: 3, rounds: 3, seed: 1 });
  const m = R.meetMatrix([...flat(first.weeks), ...flat(rest.weeks)]);
  assert.equal(m.size, 10);
  assert.ok([...m.values()].every(e => e.total === 1));
  assert.equal(new Set([...first.weeks, ...rest.weeks].flatMap(w => w.byes)).size, 5);   // every club sits out once
});

test('defaultRounds finishes the cycle, or starts a new one', () => {
  assert.equal(R.defaultRounds(6, 0), 5);
  assert.equal(R.defaultRounds(6, 3), 2);
  assert.equal(R.defaultRounds(6, 5), 5);
  assert.equal(R.defaultRounds(5, 2), 3);
});
