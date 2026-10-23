// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };   // dashboard-data.js reads location when it loads
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { tableOf, counts, inStats } = await import('../js/scope.js');
const { hasPreseason, phaseOf, scopeNow, pickScope } = await import('../js/preseason.js');
const { tableRows, tableCard, shield } = await import('../js/league-table.js');
const { countedFixtures } = await import('../js/season-stats.js');

let n = 0;
const fx = (date, extra = {}) => ({ id: `f${++n}`, week: 1, home: 'A', away: 'B', date, time: '12:00', ...extra });
const pre = (date, extra = {}) => fx(date, { preseason: true, exhibition: true, ...extra });
const teams = [{ code: 'A', name: 'Alpha', colour: '#369' }, { code: 'B', name: 'Bravo', colour: '#369' }];
const season = fixtures => ({ league: 'vLeague', live_minutes: 10, teams, fixtures });

test('every game belongs to one table, or none', () => {
  assert.equal(tableOf(pre('2026-10-23')), 'preseason');
  assert.equal(tableOf(fx('2026-11-08')), 'season');
  assert.equal(tableOf(fx('2026-11-08', { test: true })), null);
  assert.equal(tableOf(fx('2026-11-08', { exhibition: true })), null);
  assert.equal(tableOf(fx('2026-12-20', { stage: 'GF' })), null);
  assert.equal(counts(pre('2026-10-23'), 'preseason'), true);
  assert.equal(counts(pre('2026-10-23')), false);
});
test('stats take the finals, never preseason in the season scope, and only preseason in the preseason scope', () => {
  assert.equal(inStats(fx('d', { stage: 'GF' })), true);
  assert.equal(inStats(pre('d')), false);
  assert.equal(inStats(pre('d'), 'preseason'), true);
  assert.equal(inStats(fx('d'), 'preseason'), false);
  assert.equal(inStats(fx('d', { test: true }), 'preseason'), false);
  const r = { players: {} };
  assert.deepEqual(countedFixtures([pre('d', { result: r }), fx('d', { result: r })], 'preseason').length, 1);
  assert.deepEqual(countedFixtures([pre('d', { result: r }), fx('d', { result: r })]).length, 1);
});

test('phase: preseason until every preseason game is done or the first real match kicks off', () => {
  const r = { home: 1, away: 0 };
  const open = season([pre('2026-10-23', { result: r }), pre('2026-10-30'), fx('2026-11-08')]);
  assert.equal(phaseOf(open, new Date('2026-10-31T00:00')), 'preseason', 'a preseason game still to play');
  const done = season([pre('2026-10-23', { result: r }), pre('2026-10-30', { result: r }), fx('2026-11-08')]);
  assert.equal(phaseOf(done, new Date('2026-11-05T12:00')), 'season', 'all preseason finished: the real table starts');
  assert.equal(phaseOf(open, new Date('2026-11-08T12:00')), 'season', 'the first real kick-off ends it even with a game unplayed');
  const plain = season([fx('2026-11-08')]);
  assert.equal(hasPreseason(plain), false);
  assert.equal(phaseOf(plain, new Date('2026-01-01')), 'season');
});
test('a viewer pick holds while the phase stays the same, and lapses when it changes', () => {
  const r = { home: 1, away: 0 };
  const s = season([pre('2026-10-23', { result: r }), pre('2026-10-30'), fx('2026-11-08')]);
  const before = new Date('2026-10-24T00:00');
  assert.equal(scopeNow(s, before), 'preseason');
  pickScope(s, 'season', before);
  assert.equal(scopeNow(s, before), 'season');
  assert.equal(scopeNow(s, new Date('2026-11-09T12:00')), 'season', 'phase is now season too');
  pickScope(s, 'preseason', before);
  assert.equal(scopeNow(s, new Date('2026-11-09T12:00')), 'season', 'a pick made in preseason does not hold the season back');
});

test('the preseason table counts preseason results only, and the season table leaves them out', () => {
  const s = season([pre('2026-10-23', { result: { home: 2, away: 0 } }), fx('2026-11-08', { result: { home: 0, away: 1 } })]);
  const now = new Date('2026-12-01T12:00');
  const p = tableRows(s, { now, scope: 'preseason' }), r = tableRows(s, { now });
  assert.deepEqual([p[0].team.code, p[0].pts, p[0].p], ['A', 3, 1]);
  assert.deepEqual([r[0].team.code, r[0].pts, r[0].p], ['B', 3, 1]);
  const html = tableCard(p, { club: c => ({ name: c }), crest: () => '' }, { pre: true, title: 'Preseason table' });
  assert.match(html, /lg-table is-pre/);
  assert.doesNotMatch(html, /tb-key/);
  assert.equal(shield(s, { now }).winner, 'B', 'the Shield is decided by real games only (A won the preseason game)');
});
