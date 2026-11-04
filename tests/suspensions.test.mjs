import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suspensions } from '../js/simulate.js';

const fx = (id, date, home, away, result) => ({ id, date, time: '17:00', home, away, week: 2, result });
const season = {
  players: [{ id: 7, team: 'AAA' }],
  fixtures: [
    fx('a', '2026-10-24', 'AAA', 'BBB', { cards: [{ card: 'red', player: 7, team: 'AAA', name: 'Smith' }] }),
    fx('b', '2026-10-31', 'CCC', 'AAA', null),
    fx('c', '2026-11-07', 'AAA', 'BBB', null),
  ],
};

test('a red card bans the player for the club\'s next game only', () => {
  const s = suspensions(season);
  assert.deepEqual(s.get('b').map(x => x.player), ['7']);
  assert.equal(s.get('c'), undefined);
  assert.equal(s.get('a'), undefined);
});

test('a second yellow bans too; a plain yellow does not', () => {
  const t = structuredClone(season);
  t.fixtures[0].result.cards = [{ card: 'yellow', player: 7, team: 'AAA' }];
  assert.equal(suspensions(t).size, 0);
  t.fixtures[0].result.cards = [{ card: 'second_yellow', player: 7, team: 'AAA' }];
  assert.equal(suspensions(t).get('b').length, 1);
});

// Preseason bans stay in preseason (user, 4 Nov 2026): one with no preseason game left waits for next season's preseason.
const phased = cards => ({
  players: [{ id: 7, team: 'AAA' }],
  fixtures: [
    { ...fx('p1', '2026-10-24', 'AAA', 'BBB', { cards }), preseason: true },
    { ...fx('p2', '2026-10-31', 'CCC', 'AAA', null), preseason: true },
    fx('r1', '2026-11-07', 'AAA', 'BBB', null),
    fx('r2', '2026-11-14', 'BBB', 'AAA', null),
  ],
});

test('a preseason red is served in the club\'s next preseason game', () => {
  const s = suspensions(phased([{ card: 'red', player: 7, team: 'AAA' }]));
  assert.deepEqual(s.get('p2').map(x => x.player), ['7']);
  assert.equal(s.get('r1'), undefined);
});

test('a ban from the club\'s last preseason game does not reach the real season', () => {
  for (const card of ['red', 'second_yellow']) {
    const t = phased([]);
    t.fixtures[1].result = { cards: [{ card, player: 7, team: 'AAA' }] };
    assert.equal(suspensions(t).size, 0);
  }
});

test('a club with a bye in the last preseason round keeps its ban out of the real season too', () => {
  const t = phased([{ card: 'second_yellow', player: 7, team: 'AAA' }]);
  t.fixtures.splice(1, 1);
  assert.equal(suspensions(t).size, 0);
});

test('a red in the real season still bans the next real game', () => {
  const t = phased([]);
  t.fixtures[2].result = { cards: [{ card: 'red', player: 7, team: 'AAA' }] };
  assert.deepEqual(suspensions(t).get('r2').map(x => x.player), ['7']);
});
