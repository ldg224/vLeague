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
