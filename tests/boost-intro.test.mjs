import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostSides, arcPoint } from '../js/boost-intro.js';
import { withOwnBoost } from '../js/match-lineup.js';

const players = [{ id: '1', name: 'Tao Huang' }, { id: '2', name: 'Nick Tucker' }];
const clubName = code => ({ TUR: 'FC Turtle', SKS: 'Sky Sharks' }[code]);

test('only a sheet with the boost plays the entrance, home first', () => {
  const L = { home: { sheet: { club: 'TUR', captain: '1', boost: true } }, away: { sheet: { club: 'SKS', captain: '2', boost: true } } };
  assert.deepEqual(boostSides(L, players, clubName).map(s => [s.side, s.player, s.club]), [['home', 'Tao Huang', 'FC Turtle'], ['away', 'Nick Tucker', 'Sky Sharks']]);
  L.home.sheet.boost = false;
  assert.deepEqual(boostSides(L, players, clubName).map(s => s.side), ['away']);
});

test('a submitted sheet before the lock has no boost field, so a rival\'s boost stays hidden', () => {
  assert.deepEqual(boostSides({ home: { sheet: { club: 'TUR', captain: '1' } }, away: { sheet: null } }, players, clubName), []);
});

test('before the lock a club sees its own boost, and nobody else\'s', () => {
  const row = { club: 'TUR', captain: '1', lineup: { ST: '1' } }, own = { club: 'TUR', sheet: { boost: true } };
  const seen = viewer => boostSides({ home: { sheet: withOwnBoost(row, viewer === 'TUR' ? own : null, viewer) }, away: { sheet: null } }, players, clubName);
  assert.deepEqual(seen('TUR').map(s => s.player), ['Tao Huang']);
  assert.deepEqual(seen('SKS'), []);
  assert.deepEqual(seen(null), []);
  // The office can read every submitted sheet: a rival's still mustn't show.
  assert.equal(withOwnBoost(row, { club: 'SKS', sheet: { boost: true } }, 'SKS').boost, undefined);
  assert.equal(withOwnBoost(row, own, 'SKS').boost, undefined);
  // Their own sheet with the switch off, or no line-up to add it to.
  assert.equal(withOwnBoost(row, { club: 'TUR', sheet: { boost: false } }, 'TUR').boost, undefined);
  assert.equal(withOwnBoost(undefined, own, 'TUR'), undefined);
});

test('no captain we can name means no entrance', () => {
  assert.deepEqual(boostSides({ home: { sheet: { club: 'TUR', captain: '9', boost: true } }, away: { sheet: null } }, players, clubName), []);
  assert.deepEqual(boostSides(null, players, clubName), []);
});

test('the flight starts and ends in the right places and rises on the way', () => {
  const a = { x: 200, y: 300 }, b = { x: 60, y: 500 };
  assert.deepEqual(arcPoint(a, b, 0), a);
  assert.deepEqual(arcPoint(a, b, 1), b);
  assert.ok(arcPoint(a, b, 0.25).y < a.y);
});
