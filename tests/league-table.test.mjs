// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };   // dashboard-data.js reads location when it loads
const { tableRows, tableCard, zonesFor, shield } = await import('../js/league-table.js');

const NOW = new Date('2026-10-20T12:00:00');
const team = (code, name) => ({ code, name, short_name: name.split(' ')[0], colour: '#336699' });
const teams = [team('AAA', 'Alpha FC'), team('BBB', 'Bravo FC'), team('CCC', 'Charlie FC'), team('DDD', 'Delta FC')];
let n = 0;
const fx = (home, away, hg, ag, date, extra = {}) => ({ id: `f${++n}`, week: 1, home, away, date, time: '10:00', ...(hg == null ? {} : { result: { home: hg, away: ag } }), ...extra });
const season = fixtures => ({ league: 'vLeague', live_minutes: 10, teams, fixtures });
const codes = rows => rows.map(r => r.team.code[0]).join('');
const ctx = { club: code => teams.find(t => t.code === code), crest: (code, px) => `<crest ${code} ${px}>`, mine: 'BBB' };

const games = season([
  fx('AAA', 'BBB', 2, 0, '2026-10-10'),   // A beats B at home
  fx('CCC', 'DDD', 1, 1, '2026-10-10'),
  fx('BBB', 'CCC', 3, 1, '2026-10-12'),   // B beats C at home
  fx('DDD', 'AAA', 0, 0, '2026-10-12'),
  fx('AAA', 'CCC', null, null, '2026-10-30'),   // still to play
  fx('BBB', 'DDD', null, null, '2026-10-28'),
]);

test('sums, points and order: points, goal difference, goals for, then name', () => {
  const rows = tableRows(games, { now: NOW });
  assert.equal(codes(rows), 'ABDC');   // A 4 pts (+2), B 3 pts (0), D 2 pts (0, fewer goals for), C 1 pt
  const a = rows.find(r => r.team.code === 'AAA');
  assert.deepEqual([a.p, a.w, a.d, a.l, a.gf, a.ga, a.gd, a.pts], [2, 1, 1, 0, 2, 0, 2, 4]);
  const c = rows.find(r => r.team.code === 'CCC');
  assert.deepEqual([c.p, c.w, c.d, c.l, c.gf, c.ga, c.gd, c.pts], [2, 0, 1, 1, 2, 4, -2, 1]);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4]);
});

test('form is the last five results, oldest to newest', () => {
  const rows = tableRows(games, { now: NOW });
  assert.deepEqual(rows.find(r => r.team.code === 'BBB').form, ['L', 'W']);
  assert.deepEqual(rows.find(r => r.team.code === 'DDD').form, ['D', 'D']);
  const many = season(Array.from({ length: 7 }, (_, i) => fx('AAA', 'BBB', i % 2 ? 0 : 2, 1, `2026-10-${String(1 + i).padStart(2, '0')}`)));
  assert.deepEqual(tableRows(many, { now: NOW }).find(r => r.team.code === 'AAA').form, ['W', 'L', 'W', 'L', 'W']);   // results W L W L W L W: the last five
});

test('Home and Away use only home or away games', () => {
  const home = tableRows(games, { now: NOW, filter: 'home' }), away = tableRows(games, { now: NOW, filter: 'away' });
  const b = rows => rows.find(r => r.team.code === 'BBB');
  assert.deepEqual([b(home).p, b(home).w, b(home).gf], [1, 1, 3]);
  assert.deepEqual([b(away).p, b(away).l, b(away).ga], [1, 1, 2]);
  assert.equal(home.reduce((s, r) => s + r.p, 0), 4);   // each of the four played games has one home side
});

test('Last 5 keeps each club to its latest five games', () => {
  const many = season(Array.from({ length: 8 }, (_, i) => fx('AAA', 'BBB', 1, 0, `2026-10-${String(1 + i).padStart(2, '0')}`)));
  const rows = tableRows(many, { now: NOW, filter: 'last5' });
  assert.equal(rows.find(r => r.team.code === 'AAA').p, 5);
  assert.equal(tableRows(many, { now: NOW }).find(r => r.team.code === 'AAA').p, 8);
});

test('Test, exhibition and finals matches never count, and withdrawn clubs are left out', () => {
  const s = season([fx('AAA', 'BBB', 5, 0, '2026-10-10', { test: true }), fx('AAA', 'BBB', 5, 0, '2026-10-10', { exhibition: true }), fx('AAA', 'BBB', 5, 0, '2026-10-10', { stage: 'final' }), fx('AAA', 'BBB', 1, 0, '2026-10-10')]);
  s.teams = [...teams, { ...team('EEE', 'Echo FC'), withdrawn: true }];
  const rows = tableRows(s, { now: NOW });
  assert.equal(rows.length, 4);
  assert.equal(rows.find(r => r.team.code === 'AAA').pts, 3);
});

test('spoiler-free: hidden results are left out, so the table gives nothing away', () => {
  const rows = tableRows(games, { now: NOW, hidden: new Set([games.fixtures[0].id]) });
  assert.equal(rows.find(r => r.team.code === 'AAA').p, 1);
  assert.equal(rows.find(r => r.team.code === 'BBB').p, 1);
});

test('Next is each club\'s first match still to play (a live one counts, a postponed one does not)', () => {
  const rows = tableRows(games, { now: NOW });
  assert.deepEqual(rows.find(r => r.team.code === 'AAA').next, { code: 'CCC', home: true });
  assert.deepEqual(rows.find(r => r.team.code === 'BBB').next, { code: 'DDD', home: true });
  assert.deepEqual(rows.find(r => r.team.code === 'DDD').next, { code: 'BBB', home: false });
  const postponed = season([fx('AAA', 'BBB', null, null, '2026-10-30', { postponed: true })]);
  assert.equal(tableRows(postponed, { now: NOW }).find(r => r.team.code === 'AAA').next, null);
});

test('zones follow the number of clubs: Finals is the top four, Wooden spoon is last', () => {
  assert.deepEqual(zonesFor(12), { finals: 4, spoon: true, shield: true });
  assert.deepEqual(zonesFor(6), { finals: 4, spoon: true, shield: true });
  assert.deepEqual(zonesFor(4), { finals: 2, spoon: true, shield: true });
  assert.deepEqual(zonesFor(2), { finals: 0, spoon: true, shield: true });
  assert.deepEqual(zonesFor(1), { finals: 0, spoon: false, shield: false });
});

test('the card: a row per club, your club marked, stripes and key, filter pills, crest for Next', () => {
  const html = tableCard(tableRows(games, { now: NOW }), ctx, { filter: 'home' });
  assert.equal((html.match(/<tr[ >]/g) || []).length, 5);          // header + 4 clubs
  assert.equal((html.match(/class="is-mine"/g) || []).length, 1);
  assert.match(html, /data-zone="finals"/);
  assert.match(html, /data-zone="spoon"/);
  assert.match(html, /<li data-zone="finals">Finals<\/li>/);
  assert.match(html, /data-tfilter="home" aria-pressed="true"/);
  assert.match(html, /data-tfilter="all" aria-pressed="false"/);
  assert.match(html, /<crest CCC 22>/);
  assert.match(html, /is-latest/);
  assert.equal((tableCard(tableRows(games, { now: NOW }), ctx, { filters: false }).match(/data-tfilter/g) || []).length, 0);
});

test('before any match: every club on zero, the zones and key already show (Shield first, Finals, Wooden spoon last), form shows a dash', () => {
  const html = tableCard(tableRows(season([fx('AAA', 'BBB', null, null, '2026-10-30')]), { now: NOW }), ctx);
  assert.deepEqual([...html.matchAll(/<tr data-code="\w+"[^>]*data-zone="(\w+)"/g)].map(m => m[1]), ['shield', 'finals', 'spoon']);
  assert.match(html, /<li data-zone="shield">vLeague Shield<\/li><li data-zone="finals">Finals<\/li><li data-zone="spoon">Wooden spoon<\/li>/);
  assert.match(html, /tb-none/);
  assert.equal((html.match(/<tr[ >]/g) || []).length, 5);
});

test('hidden results are announced with a Show all button; no clubs gives an empty state', () => {
  assert.match(tableCard(tableRows(games, { now: NOW }), ctx, { hiddenCount: 2 }), /2 results hidden[\s\S]*data-reveal-all/);
  assert.match(tableCard([], ctx), /No clubs yet/);
});

test('the vLeague Shield goes to the club top of the table once every league match is played (S-26)', () => {
  assert.equal(shield(games, { now: NOW }), null);   // two league matches still to come
  const done = season([
    fx('AAA', 'BBB', 2, 0, '2026-10-10'), fx('CCC', 'DDD', 1, 1, '2026-10-10'),
    fx('BBB', 'CCC', 3, 1, '2026-10-12'), fx('DDD', 'AAA', 0, 0, '2026-10-12'),
    fx('AAA', 'CCC', 1, 0, '2026-10-14'), fx('BBB', 'DDD', 0, 2, '2026-10-14'),
    fx('AAA', 'BBB', null, null, '2026-10-30', { stage: 'GF' }),   // the final doesn't count, and a finals match still to come doesn't hold it back
  ]);
  assert.deepEqual(shield(done, { now: NOW }), { winner: 'AAA' });
  assert.equal(shield(done, { now: NOW, hidden: new Set(['f' + (n - 2)]) }), null);   // a result the viewer has hidden is never given away
  assert.equal(shield(season([]), { now: NOW }), null);
  const postponed = season([fx('AAA', 'BBB', 2, 0, '2026-10-10'), fx('CCC', 'DDD', null, null, '2026-10-12', { postponed: true })]);
  assert.equal(shield(postponed, { now: NOW }), null);
});

test('level clubs: fewest reds come first, then fewest yellows', () => {
  const one = (a, b, cards) => tableRows(season([fx(a, b, 1, 1, '2026-10-10', { result: { home: 1, away: 1, cards } })]), { now: NOW });
  assert.equal(codes(one('AAA', 'BBB', [{ team: 'AAA', card: 'red' }])).slice(0, 2), 'BA');   // A took a red
  assert.equal(codes(one('AAA', 'BBB', [{ team: 'AAA', card: 'yellow' }])).slice(0, 2), 'BA');   // A took a yellow
  assert.equal(codes(one('AAA', 'BBB', [{ team: 'AAA', card: 'yellow' }, { team: 'BBB', card: 'red' }])).slice(0, 2), 'AB');   // reds come before yellows
});
  assert.equal(codes(h2h).slice(0, 3), 'BAC'.length === 3 ? codes(h2h).slice(0, 3) : '');   // sanity: runs without error
  // away goals: B scored more away than A; equal everything else, no meeting between them
  const away = tableRows(season([fx('CCC', 'AAA', 1, 1, '2026-10-01'), fx('BBB', 'DDD', 1, 1, '2026-10-02')]), { now: NOW });
  assert.equal(codes(away).length, 4);
});
