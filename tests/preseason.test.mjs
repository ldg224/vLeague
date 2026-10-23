import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };   // dashboard-data.js reads location when it loads
const { hasPreseason, phaseOf, scoped } = await import('../js/preseason.js');

const fx = (id, date, extra = {}) => ({ id, week: 1, home: 'A', away: 'B', date, time: '12:00', ...extra });
const season = {
  teams: [{ code: 'A' }, { code: 'B' }],
  fixtures: [
    fx('p1', '2026-10-23', { preseason: true, exhibition: true, result: { home: 1, away: 0 } }),
    fx('r1', '2026-11-08', {}),
    fx('t', '2026-10-01', { test: true }),
  ],
};

test('phase is pre until the first real match kicks off, then season', () => {
  assert.equal(phaseOf(season, new Date('2026-11-07T12:00')), 'pre');
  assert.equal(phaseOf(season, new Date('2026-11-08T12:00')), 'season');
});
test('a league with no preseason round is always in the season phase and is returned as is', () => {
  const plain = { fixtures: [fx('r1', '2026-11-08')] };
  assert.equal(hasPreseason(plain), false);
  assert.equal(phaseOf(plain, new Date('2026-01-01')), 'season');
  assert.equal(scoped(plain, 'pre'), plain);
});
test('pre scope keeps only preseason matches and lets them count; season scope leaves them out', () => {
  const pre = scoped(season, 'pre'), reg = scoped(season, 'season');
  assert.deepEqual(pre.fixtures.map(f => f.id), ['p1']);
  assert.equal(pre.fixtures[0].exhibition, false);
  assert.deepEqual(reg.fixtures.map(f => f.id), ['r1', 't']);
  assert.equal(season.fixtures[0].exhibition, true, 'the original is untouched');
});

const { tableRows, tableCard } = await import('../js/league-table.js');
test('the preseason table counts preseason results only, and the season table leaves them out', () => {
  const s = {
    league: 'vLeague', live_minutes: 10, teams: [{ code: 'A', name: 'Alpha', colour: '#369' }, { code: 'B', name: 'Bravo', colour: '#369' }],
    fixtures: [fx('p1', '2026-10-23', { preseason: true, exhibition: true, result: { home: 2, away: 0 } }), fx('r1', '2026-11-08', { result: { home: 0, away: 1 } })],
  };
  const now = new Date('2026-12-01T12:00');
  const pre = tableRows(scoped(s, 'pre'), { now }), reg = tableRows(scoped(s, 'season'), { now });
  assert.deepEqual([pre[0].team.code, pre[0].pts, pre[0].p], ['A', 3, 1]);
  assert.deepEqual([reg[0].team.code, reg[0].pts, reg[0].p], ['B', 3, 1]);
  const html = tableCard(pre, { club: c => ({ name: c }), crest: () => '' }, { pre: true, title: 'Preseason table' });
  assert.match(html, /lg-table is-pre/);
  assert.doesNotMatch(html, /tb-key/);
});
