// The Office's sums (S-35, js/office-model.js) and the Editor's settings form (js/editor-office.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { money, short, bill, need, NEED, rosterOf, check, after, windowText, windowReason, windowFromSettings, keepPicks, tradeView, fairness, rulesFrom, penaltyPoints, penaltyChange, LADDER } from '../js/office-model.js';
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
  assert.deepEqual(rulesFrom(null).FWD, { min: 3, max: Infinity });   // 0093: a minimum, no maximum
  assert.deepEqual(rulesFrom(null).squad, { min: 15, max: 16 });
  assert.equal(rulesFrom({ positions: { GK: { min: 1, max: null } } }).GK.max, Infinity);
});

test('release: one short is fine, two short is not', () => {
  const s = squad();
  assert.equal(check({ squad: s, cap: 125000, out: [s[2]] }), null);
  const one = s.filter(p => p.id !== 'p2');
  assert.match(check({ squad: one, cap: 125000, out: [one[3]] }), /too few defenders \(4 at least\)|at least/);   // 0093
});

test('signing: a full position is refused, the cap is enforced', () => {
  const s = squad(), fa = P('fa', 'DEF', 9000);
  assert.match(check({ squad: s, cap: 125000, inn: [fa] }), /17 players \(16 at most\)/);   // 0093: the squad's size, not the position
  const shortSquad = s.filter(p => p.id !== 'p2');   // a defender gone
  assert.equal(check({ squad: shortSquad, cap: 125000, inn: [fa] }), null);
  assert.match(check({ squad: shortSquad, cap: 110000, inn: [fa] }), /over the \$110,000 cap/);
});

test('over the cap: only moves that lower the bill', () => {
  const s = squad();   // 112,000 against a 100,000 cap
  assert.equal(check({ squad: s, cap: 100000, out: [s[2]] }), null);
  assert.match(check({ squad: s, cap: 100000, out: [s[2]], inn: [P('x', 'DEF', 7000)] }), /over the cap/);
  assert.deepEqual(after({ squad: s, cap: 100000, out: [s[2]] }), { bill: 105000, room: -5000, over: true, by: 5000, points: 1 });
});

// Cap penalty points (0092): the ladder, the limit and how a move changes the points.
test('penalty ladder: every boundary', () => {
  const cases = [[-500, 0], [0, 0], [1, 1], [5000, 1], [5001, 3], [10000, 3], [10001, 6], [15000, 6], [15001, 10], [20000, 10], [20001, 15], [25000, 15], [25001, 21], [30000, 21], [30001, 21]];
  for (const [over, p] of cases) assert.equal(penaltyPoints(over), p, `${over} over`);
  assert.equal(LADDER.at(-1)[0], 30000);
});

test('over the cap: allowed up to the limit, refused past it, a club past it may still lower its bill', () => {
  const s = squad().filter(p => p.id !== 'p2'), cap = 108000;   // 105,000 with a defender gone
  const fa = P('fa', 'DEF', 9000);   // signing him: 114,000, $6,000 over
  assert.match(check({ squad: s, cap, inn: [fa] }), /over the \$108,000 cap\.$/);   // no limit: the cap is a hard limit (0091)
  assert.equal(check({ squad: s, cap, limit: 30000, inn: [fa] }), null);
  assert.equal(check({ squad: s, cap, limit: 6000, inn: [fa] }), null);   // exactly at the limit
  assert.match(check({ squad: s, cap, limit: 5999, inn: [fa] }), /\$6,000 over the \$108,000 cap \(\$5,999 over at most\)/);
  const far = squad();   // 112,000 against a cap of 70,000: $42,000 over, past the limit
  assert.equal(check({ squad: far, cap: 70000, limit: 30000, out: [far[2]] }), null);   // a release lowers the bill
  assert.match(check({ squad: far.filter(p => p.id !== 'p2'), cap: 70000, limit: 30000, inn: [P('x', 'DEF', 8000)] }), /more than \$30,000 over the cap/);
  const a = after({ squad: s, cap, inn: [fa] });
  assert.deepEqual([a.by, a.points], [6000, 3]);
});

test('penalty change sentence', () => {
  assert.equal(penaltyChange(90000, 99000, 100000), '');
  assert.equal(penaltyChange(99000, 106200, 100000), 'Your cap penalty goes from 0 to 3 points.');
  assert.equal(penaltyChange(106200, 101000, 100000), 'Your cap penalty goes from 3 to 1 point.');
  assert.equal(penaltyChange(101000, 104000, 100000, 'CCF’s'), 'CCF’s cap penalty stays at 1 point.');
});

test('trade view: both clubs’ points before and after', () => {
  const mine = squad(), theirs = squad().map(p => ({ ...p, id: `t${p.id}`, value: p.value + 500 }));   // 112,000 and 120,000
  const tv = tradeView({ mine, theirs, give: ['p2'], get: ['tp2'], cap: 115000, limit: 30000, them: 'CCF' });
  assert.deepEqual([tv.me.pointsBefore, tv.me.points, tv.them.pointsBefore, tv.them.points], [0, 0, 1, 1]);
  assert.equal(tv.me.why, null);
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
  const f = new Map([['cap', '130000'], ['over_limit', '25000'], ['releases_per_window', ''], ['opens_at', ''], ['closes_at', '2026-11-20T17:30']]);
  const out = readOffice({ get: k => (f.has(k) ? f.get(k) : null) });
  assert.equal(out.cap, 130000); assert.equal(out.over_limit, 25000); assert.ok(!('releases_per_window' in out)); assert.equal(out.opens_at, '');
  assert.equal(localInput(out.closes_at), '2026-11-20T17:30');
  assert.equal(fromLocal(''), '');
  // 0093: the squad's size and each position's least
  const g = new Map([['squad_min', '15'], ['squad_max', '16'], ['min_GK', '1'], ['min_DEF', '4'], ['min_MID', ''], ['min_FWD', '3']]);
  const o2 = readOffice({ get: k => (g.has(k) ? g.get(k) : null) });
  assert.equal(o2.squad_min, 15); assert.equal(o2.squad_max, 16);
  assert.deepEqual(o2.pos_min, { GK: 1, DEF: 4, FWD: 3 });   // a blank one is left as it is
});

test('0093: no maximum per position; a squad already over 16 may swap but not grow', () => {
  const s = [...squad(), P('xd1', 'DEF', 7000), P('xd2', 'DEF', 7000)];   // 18 players (office edits)
  assert.equal(check({ squad: s, cap: 1e6, out: [s[2], s[3]], inn: [P('m1', 'MID', 7000), P('m2', 'MID', 7000)] }), null);   // any position mix
  assert.match(check({ squad: s, cap: 1e6, inn: [P('m3', 'MID', 7000)] }), /19 players \(16 at most\)/);
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

test('need: short of a position first, then room, then full (the Market order)', () => {
  const s = squad().filter(p => p.id !== 'p2');   // a defender gone: DEF 4 of 5
  const r = rosterOf(s, { GK: { min: 2, max: 2 }, DEF: { min: 5, max: 5 }, MID: { min: 4, max: 6 }, FWD: { min: 4, max: 4 } });
  assert.equal(need('DEF', r), 2); assert.equal(NEED[need('DEF', r)], 'Need');
  assert.equal(need('MID', r), 1);   // 5 of 4 to 6: room for one more
  assert.equal(need('GK', r), 0); assert.equal(need('XX', r), 0);
});

// 0096: release fees, 10% of the wage, carried on a squad as .fees, counted by every bill.
test('release fees: on the bill, kept through moves, counted by the cap and the trade sums', async () => {
  const { withFees, releaseFee, squadAfter } = await import('../js/office-model.js');
  assert.equal(releaseFee(P('a', 'MID', 12345)), 1235);   // as office_release_fee: x.5 rounds up
  assert.equal(releaseFee(P('a', 'MID', 7000)), 700);
  const s = withFees(squad(), 1400);
  assert.equal(bill(s), 113400);
  assert.equal(bill(squadAfter(s, [s[5]])), 113400 - 7000);
  assert.equal(after({ squad: s, cap: 125000, out: [s[5]], fee: 700 }).bill, 113400 - 7000 + 700);
  // a signing that fits without the fees is over the cap with them
  assert.equal(check({ squad: squad(), cap: 119000, inn: [P('x', 'MID', 7000)], rules: { ...rulesFrom(null), squad: { min: 15, max: 17 } } }), null);
  assert.match(check({ squad: s, cap: 119000, inn: [P('x', 'MID', 7000)], rules: { ...rulesFrom(null), squad: { min: 15, max: 17 } } }), /over the/);
  const tv = tradeView({ mine: s, theirs: squad(), give: ['p5'], get: [], cap: 125000, rules: { ...rulesFrom(null), squad: { min: 15, max: 17 } } });
  assert.equal(tv.giveTotal, 7000);   // the players given, never the fees
  assert.equal(tv.me.before, 113400);
});
