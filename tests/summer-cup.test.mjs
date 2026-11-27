// Run with:  node --test "tests/*.test.mjs"
// The Summer Cup (S-51, js/summer-cup.js): group tables, tie-breaks, the best runner-up on points per game, the semi-final seeding and the labels.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };   // dashboard-data.js reads location when it loads
const { groupTables, runnersUp, qualifiers, cupLabel, cupTag, cupCard, bracketCard, activeCup, cupInfo } = await import('../js/summer-cup.js');
const { tableOf } = await import('../js/scope.js');
const { stageName } = await import('../js/looks.js');

const CUP = { key: 'summer_2026', name: 'Summer Cup', groups: { A: ['A1', 'A2', 'A3'], B: ['B1', 'B2', 'B3'], C: ['C1', 'C2'] } };
const codes = Object.values(CUP.groups).flat();
const teams = codes.map(code => ({ code, name: code, colour: '#336699' }));
let n = 0;
const fx = (home, away, h, a, extra = {}) => ({ id: `f${++n}`, week: 10, home, away, date: '2026-01-01', time: '12:00', cup: CUP.key, cup_name: 'Summer Cup',
  ...(h == null ? {} : { result: { home: h, away: a } }), ...extra });
const season = fixtures => ({ league: 'vLeague', live_minutes: 10, teams, fixtures, cups: [CUP] });
const NOW = new Date('2027-06-01T00:00:00');
const ctx = { club: code => ({ name: code, short_name: code }), crest: () => '' };

test('a group table counts only cup group matches, three for a win', () => {
  const s = season([fx('A1', 'A2', 2, 0), fx('A2', 'A3', 1, 1), fx('A1', 'B1', 5, 0, { cup: undefined }), fx('A3', 'A1', 0, 1)]);
  const t = groupTables(s, CUP, { now: NOW }).A;
  assert.deepEqual(t.map(r => [r.team.code, r.p, r.pts]), [['A1', 2, 6], ['A3', 2, 1], ['A2', 2, 1]]);
  assert.equal(t[0].ppg, 3);
});

test('level on points: head-to-head decides before goal difference', () => {
  // A2 and A3 both on 3 points; A3 has the far better goal difference, but A2 beat A3
  const s = season([fx('A2', 'A3', 1, 0), fx('A3', 'A1', 6, 0), fx('A1', 'A2')]);
  assert.deepEqual(groupTables(s, CUP, { now: NOW }).A.map(r => r.team.code), ['A2', 'A3', 'A1']);
});

test('a hidden result counts as not played', () => {
  const f = fx('A1', 'A2', 2, 0), s = season([f]);
  assert.equal(groupTables(s, CUP, { now: NOW, hidden: new Set([f.id]) }).A[0].p, 0);
});

test('the best runner-up is picked on points per game', () => {
  const s = season([
    fx('A1', 'A2', 1, 0), fx('A2', 'A3', 1, 0), fx('A3', 'A1', 0, 1),   // A2: 3 pts from 2 = 1.5
    fx('B1', 'B2', 1, 0), fx('B2', 'B3', 0, 0), fx('B3', 'B1', 0, 1),   // B2: 1 pt from 2 = 0.5
    fx('C1', 'C2', 1, 0), fx('C2', 'C1', 1, 1),                         // C2: 1 pt from 2 = 0.5
  ]);
  const tables = groupTables(s, CUP, { now: NOW }), ru = runnersUp(tables);
  assert.equal(ru[0].team.code, 'A2'); assert.ok(ru[0].through); assert.ok(!ru[1].through);
  const q = qualifiers(tables);
  assert.equal(q.length, 4);
  assert.deepEqual(q.map(r => r.seed), [1, 2, 3, 4]);
  assert.ok(q.some(r => r.team.code === 'A2'));
});

test('cup knockouts never count for the league, group matches do', () => {
  assert.equal(tableOf(fx('A1', 'B1', null, null, { stage: 'SF' })), null);
  assert.equal(tableOf(fx('A1', 'A2', null, null)), 'season');
});

test('labels name the cup, the group and the knockout stage', () => {
  const s = season([]);
  assert.equal(cupLabel(fx('B2', 'B3'), s), 'Summer Cup · Group B');
  assert.equal(cupLabel(fx('A1', 'B1', null, null, { stage: 'SF' }), s), 'Summer Cup semi-final');
  assert.equal(cupLabel({ id: 'x', home: 'A1', away: 'A2' }, s), null);
  assert.equal(stageName(fx('A1', 'B1', null, null, { stage: 'GF' })), 'Summer Cup Final');
  assert.equal(stageName({ stage: 'GF' }), 'Grand Final');
  assert.match(cupTag(fx('C1', 'C2'), s), /data-grp="C"/);
  assert.equal(cupTag({ home: 'A1', away: 'A2' }, s), '');
});

test('the cards draw, and say who would meet if the groups ended now', () => {
  const s = season([fx('A1', 'A2', 1, 0), fx('B1', 'B2', 1, 0), fx('C1', 'C2', 1, 0)]);
  assert.ok(activeCup(s));
  const card = cupCard(s, ctx, { now: NOW });
  for (const g of ['A', 'B', 'C']) assert.match(card, new RegExp(`Group ${g}`));
  assert.match(card, /Best runner-up/);
  const ko = bracketCard(s, ctx, { now: NOW });
  assert.match(ko, /If the groups ended now/);
  assert.match(ko, /Semi-final 1/); assert.match(ko, /Final/);
  assert.equal(cupCard({ ...s, cups: [] }, ctx, { now: NOW }), '');
});

test('cupInfo: the badge text for a group match, a semi-final and the Final; null for a league match', () => {
  const s = season([]);
  assert.deepEqual(cupInfo(fx('B1', 'B2'), s), { name: 'Summer Cup', short: 'Group B', group: 'B', emblem: 'assets/summer-cup.svg' });
  assert.equal(cupInfo(fx('A1', 'B1', null, null, { stage: 'SF' }), s).short, 'Semi-final');
  assert.equal(cupInfo(fx('A1', 'B1', null, null, { stage: 'GF' }), s).short, 'Final');
  assert.equal(cupInfo(fx('A1', 'B1', null, null, { cup: undefined }), s), null);
  assert.equal(cupInfo(undefined, s), null);
});
