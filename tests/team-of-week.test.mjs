// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const { teamOfWeek, weekSummaries, teamOfWeekCard, SHAPE } = await import('../js/team-of-week.js');

const teams = ['AAA', 'BBB'].map(c => ({ code: c, name: `${c} United`, short_name: c, colour: '#336699' }));
let n = 0;
// A player line: slot decides the position (GK, LB..., CM..., ST...).
const pl = (team, slot, r, extra = {}) => [`p${++n}`, { name: `Player ${n}`, team, slot, min: 90, g: 0, a: 0, r, ...extra }];
const squad = (team, rs) => ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LCM', 'CM', 'RCM', 'LW', 'ST', 'RW'].map((slot, i) => pl(team, slot, rs[i]));
const fixture = (week, home, away, players) => ({ id: `f${++n}`, week, round: `Round ${week}`, home, away, result: { home: 1, away: 0, players: Object.fromEntries(players) } });
const A = squad('AAA', [6.1, 7.2, 6.5, 7.0, 6.8, 7.5, 6.0, 6.9, 7.1, 8.4, 6.6]);
const B = squad('BBB', [8.9, 5.5, 6.2, 6.3, 7.7, 7.8, 5.9, 6.4, 7.3, 6.0, 8.0]);
const fixtures = [fixture(1, 'AAA', 'BBB', [...A, ...B]), fixture(2, 'AAA', 'BBB', squad('AAA', Array(11).fill(6.5)))];
const ctx = { club: c => teams.find(t => t.code === c), crest: (c, px) => `<crest ${c} ${px}>`, mine: 'BBB' };

test('the XI is a 4-3-3 of the best rated in each line', () => {
  const t = teamOfWeek(fixtures, 1);
  assert.deepEqual(SHAPE.map(([pos, k]) => [pos, t.lines[pos].length, k]).map(([, got, want]) => got === want), [true, true, true, true]);
  assert.deepEqual(t.lines.FWD.map(p => p.rating), [8.4, 8.0, 7.3]);   // ST 8.4, BBB's RW 8.0, then the best of the rest
  assert.deepEqual(t.lines.GK.map(p => p.rating), [8.9]);               // the better of the two goalkeepers
  assert.equal(t.lines.DEF.length, 4);
  assert.ok(t.lines.DEF.every(p => p.pos === 'DEF'));
});

test('the star goes to the single best rating, ties to goals and assists', () => {
  assert.equal(teamOfWeek(fixtures, 1).lines.GK[0].id, teamOfWeek(fixtures, 1).star);   // 8.9 is the best of the round
  const tie = fixture(3, 'AAA', 'BBB', [pl('AAA', 'ST', 8, { g: 1 }), pl('BBB', 'ST', 8, { g: 3 })]);
  const t = teamOfWeek([tie], 3);
  assert.equal(t.star, t.lines.FWD.find(p => p.g === 3).id);
});

test('a round only part played shows the players it has; players who did not play or have no rating are left out', () => {
  const part = fixture(4, 'AAA', 'BBB', [pl('AAA', 'ST', 7), pl('AAA', 'GK', 0), pl('BBB', 'LB', 6.6, { min: 0 })]);
  const t = teamOfWeek([part], 4);
  assert.equal(t.lines.FWD.length, 1); assert.equal(t.lines.GK.length, 0); assert.equal(t.lines.DEF.length, 0);
});

test('a player in two matches of one round gets his average', () => {
  const id = 'same', one = fixture(5, 'AAA', 'BBB', [[id, { name: 'Twice', team: 'AAA', slot: 'ST', min: 90, g: 1, a: 0, r: 8 }]]), two = fixture(5, 'BBB', 'AAA', [[id, { name: 'Twice', team: 'AAA', slot: 'ST', min: 90, g: 0, a: 1, r: 7 }]]);
  const p = teamOfWeek([one, two], 5).lines.FWD[0];
  assert.equal(p.rating, 7.5); assert.equal(p.g, 1); assert.equal(p.a, 1);
});

test('weekSummaries lists every played round, oldest first, with the player of the week', () => {
  const s = weekSummaries(fixtures, w => `Round ${w}`);
  assert.deepEqual(s.map(r => r.week), [1, 2]);
  assert.equal(s[0].star.rating, 8.9);
  assert.equal(s[1].label, 'Round 2');
});

test('the card: opens on the latest round, arrows by button, a menu newest first with the star, the star badge, own club marked, crests', () => {
  const html = teamOfWeekCard(fixtures, ctx);
  assert.match(html, /Team of the week/);
  assert.match(html, /data-twmenu[^>]*>[\s\S]*?Round 2/);                       // the latest played round is shown
  assert.match(html, /data-tw="1" data-dir="prev"/);                           // there is an earlier round
  assert.doesNotMatch(html, /data-dir="next"/);                                // and no later one
  assert.ok(html.indexOf('Round 2') < html.indexOf('Round 1'));                // the menu lists the newest first
  const one = teamOfWeekCard(fixtures, ctx, { week: 1 });
  assert.equal((one.match(/<li class="tw-p/g) || []).length, 11);
  assert.equal((one.match(/is-star/g) || []).length, 1);                      // one star
  assert.match(one, /is-mine/); assert.match(one, /<crest AAA 18>/);
  assert.match(one, /Player \d+ · 8\.9/);                                      // the menu says who was player of the week
});

test('empty and hidden states', () => {
  assert.match(teamOfWeekCard([], ctx), /No matches played yet/);
  assert.match(teamOfWeekCard([], ctx, { hiddenCount: 2 }), /2 results hidden[\s\S]*data-reveal-all/);
  assert.doesNotMatch(teamOfWeekCard(fixtures, ctx), /d+ results? hidden/);
});
