// The Office's sums (S-35, js/office-model.js) and the Editor's settings form (js/editor-office.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { money, short, bill, rosterOf, check, after, windowText, windowReason, windowFromSettings, keepPicks, tradeView, fairness, rulesFrom } from '../js/office-model.js';
import { readOffice, localInput, fromLocal } from '../js/editor-office.js';

const P = (id, position, value) => ({ id, position, value, name: id });
// a legal squad: GK 2, DEF 5, MID 5, FWD 4, each wage 7,000 -> 112,000
const squad = () => [...['GK', 'GK'], ...Array(5).fill('DEF'), ...Array(5).fill('MID'), ...Array(4).fill('FWD')].map((pos, i) => P(`p${i}`, pos, 7000));

test('money and short', () => {
  assert.equal(money(125000), '$125,000');
  assert.equal(money(-4700), '−$4,700');
  assert.equal(short(7450), '$7.5k');
  assert.equal(short(125000), '$125k');
});

test('bill and roster', () => {
  const s = squad();
  assert.equal(bill(s), 112000);
  const r = rosterOf(s);
  assert.equal(r.short, 0); assert.equal(r.over, 0); assert.equal(r.positions.DEF.count, 5);
  assert.deepEqual(rulesFrom({ positions: { GK: { min: 1, max: 3, count: 2 } } }).GK, { min: 1, max: 3 });
  assert.deepEqual(rulesFrom(null).FWD, { min: 4, max: 4 });
});

test('release: one short is fine, two short is not', () => {
  const s = squad();
  assert.equal(check({ squad: s, cap: 125000, out: [s[2]] }), null);
  const one = s.filter(p => p.id !== 'p2');
  assert.match(check({ squad: one, cap: 125000, out: [one[3]] }), /2 players short/);
});

test('signing: a full position is refused, the cap is enforced', () => {
  const s = squad(), fa = P('fa', 'DEF', 9000);
  assert.match(check({ squad: s, cap: 125000, inn: [fa] }), /too many defenders/);
  const shortSquad = s.filter(p => p.id !== 'p2');   // a defender gone
  assert.equal(check({ squad: shortSquad, cap: 125000, inn: [fa] }), null);
  assert.match(check({ squad: shortSquad, cap: 110000, inn: [fa] }), /over the \$110,000 cap/);
});

test('over the cap: only moves that lower the bill', () => {
  const s = squad();   // 112,000 against a 100,000 cap
  assert.equal(check({ squad: s, cap: 100000, out: [s[2]] }), null);
  assert.match(check({ squad: s, cap: 100000, out: [s[2]], inn: [P('x', 'DEF', 7000)] }), /over the cap/);
  assert.deepEqual(after({ squad: s, cap: 100000, out: [s[2]] }), { bill: 105000, room: -5000, over: true });
});

test('trade view: totals, difference and both checks', () => {
  const mine = squad(), theirs = squad().map(p => ({ ...p, id: `t${p.id}`, value: 9000 }));
  const tv = tradeView({ mine, theirs, give: ['p7'], get: ['tp8'], cap: 115000, them: 'CCF' });
  assert.equal(tv.giveTotal, 7000); assert.equal(tv.getTotal, 9000); assert.equal(tv.diff, 2000);
  assert.equal(tv.me.bill, 114000); assert.equal(tv.me.why, null);
  assert.equal(tv.them.bill, 142000); assert.equal(tv.them.why, null);   // over the cap, but the deal lowers CCF's bill
  const worse = tradeView({ mine, theirs, give: ['p7'], get: ['tp8', 'tp9'], cap: 115000, them: 'CCF' });
  assert.match(worse.me.why, /over the \$115,000 cap/);
  assert.ok(tradeView({ mine, theirs, cap: 115000 }).empty);
});

test('fairness wording', () => {
  assert.equal(fairness(0, 0), '');
  assert.equal(fairness(10000, 10400), 'An even deal');
  assert.equal(fairness(5000, 10000), 'You get a lot more value');
  assert.equal(fairness(10000, 8000), 'You give more value');
});

test('window text', () => {
  const now = new Date(2026, 10, 16, 12, 0);
  assert.equal(windowText({ status: 'open', closes_at: new Date(2026, 10, 20, 17, 30).toISOString() }, now), 'Window open, closes Fri 5:30 pm');
  assert.equal(windowText({ status: 'closed' }, now), 'Window closed');
  assert.equal(windowText({ status: 'round', round_week: 6 }, now), 'Window paused while round 6 is played');
  assert.equal(windowReason({ status: 'open' }), null);
  assert.match(windowReason({ status: 'closed' }), /closed/);
});

test('editor settings form', () => {
  const f = new Map([['cap', '130000'], ['releases_per_window', ''], ['opens_at', ''], ['closes_at', '2026-11-20T17:30']]);
  const out = readOffice({ get: k => (f.has(k) ? f.get(k) : null) });
  assert.equal(out.cap, 130000); assert.ok(!('releases_per_window' in out)); assert.equal(out.opens_at, '');
  assert.equal(localInput(out.closes_at), '2026-11-20T17:30');
  assert.equal(fromLocal(''), '');
});

test('a position over its maximum may not grow, even when the total over stays the same', () => {
  // two defenders over (office edits), midfield full: swapping two defenders for two midfielders keeps "two over" but takes midfield over
  const s = [...squad(), P('xd1', 'DEF', 7000), P('xd2', 'DEF', 7000)];
  assert.match(check({ squad: s, cap: 1e6, out: [s[2], s[3]], inn: [P('m1', 'MID', 7000), P('m2', 'MID', 7000)] }), /too many midfielders/);
  assert.equal(check({ squad: s, cap: 1e6, out: [s[2]] }), null);   // bringing defence down is fine
});

test('window from the settings row (no office_state)', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.equal(windowFromSettings(null, now).status, 'closed');
  assert.equal(windowFromSettings({ window_open: false }, now).status, 'closed');
  assert.equal(windowFromSettings({ window_open: true }, now).status, 'open');
  assert.equal(windowFromSettings({ window_open: true, closes_at: '2026-11-16T11:00:00Z' }, now).status, 'closed');
  assert.equal(windowFromSettings({ window_open: true, opens_at: '2026-11-17T00:00:00Z' }, now).status, 'not_yet');
  assert.equal(windowFromSettings({ window_open: true, opens_at: '2026-11-15T00:00:00Z', closes_at: '2026-11-18T00:00:00Z' }, now).status, 'open');
});

test('trade picks keep only players still at the club', () => {
  const s = squad();
  assert.deepEqual(keepPicks(['p3', 'gone', 'p1'], s), ['p3', 'p1']);
  assert.deepEqual(keepPicks(['p3'], []), []);
  assert.deepEqual(keepPicks(null, s), []);
});
