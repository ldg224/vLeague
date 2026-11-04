import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostSides, arcPoint } from '../js/boost-intro.js';

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
