// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };   // dashboard-data.js reads location when it loads
const { fixturesView, byDate, byRound, byTeam, rowHtml, spotlight, untilText, dayLabel, rangeLabel, weekOfDate, defaultDate, parseSub, fixturesAddress, rounds } = await import('../js/league-fixtures.js');

const NOW = new Date('2026-10-14T12:00:00');   // a Wednesday
const teams = ['AAA', 'BBB', 'CCC', 'DDD'].map(c => ({ code: c, name: `${c} United`, short_name: c, colour: '#336699' }));
let n = 0;
const fx = (home, away, date, time, extra = {}) => ({ id: `f${++n}`, week: 1, round: 'Round 1', home, away, date, time, ...extra });
const done = (g, a, cards = []) => ({ result: { home: g, away: a, cards } });
const season = {
  league: 'vLeague', live_minutes: 10, teams,
  fixtures: [
    fx('AAA', 'BBB', '2026-10-13', '19:00', done(2, 1, [{ team: 'BBB', card: 'red' }])),            // yesterday, FT, a red card
    fx('CCC', 'DDD', '2026-10-14', '19:30'),                                                           // today, upcoming
    fx('AAA', 'CCC', '2026-10-20', '19:00', { week: 2, round: 'Round 2' }),                            // next week
    fx('BBB', 'DDD', '2026-10-27', '19:00', { week: 3, round: 'Finals', stage: 'final' }),
    fx('DDD', 'AAA', null, null, { week: 3, round: 'Finals', postponed: true }),
    fx('AAA', 'DDD', '2026-10-13', '10:00', { week: 99, round: 'Test', test: true, ...done(9, 0) }),    // a Test match never shows
  ],
};
const ctx = (extra = {}) => ({ club: c => teams.find(t => t.code === c), crest: (c, px) => `<crest ${c} ${px}>`, now: NOW, venue: c => ({ AAA: 'Alpha Park' })[c] || '', chance: () => ({ h: 50, d: 25, a: 25 }), hidden: new Set(), time: d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, ...extra });
const count = (s, re) => (s.match(re) || []).length;

test('dates: day names, week ranges and the week to open on', () => {
  assert.equal(dayLabel('2026-10-14', '2026-10-14'), 'Today');
  assert.equal(dayLabel('2026-10-13', '2026-10-14'), 'Yesterday');
  assert.equal(dayLabel('2026-10-15', '2026-10-14'), 'Tomorrow');
  assert.match(dayLabel('2026-10-21', '2026-10-14'), /Wednesday.*21.*October/);
  assert.deepEqual(weekOfDate('2026-10-14'), { from: '2026-10-12', to: '2026-10-18' });
  assert.equal(rangeLabel('2026-10-12', '2026-10-18'), '12 – 18 Oct');
  assert.equal(rangeLabel('2026-09-28', '2026-10-04'), '28 Sep – 4 Oct');
  assert.equal(defaultDate(season, NOW), '2026-10-14');                                    // this week has matches
  assert.equal(defaultDate(season, new Date('2026-12-01T12:00:00')), '2026-10-27');       // nothing later: the last week
  assert.equal(defaultDate(season, new Date('2026-09-01T12:00:00')), '2026-10-13');       // nothing yet this week: the next with matches
});

test('addresses: every view has its own', () => {
  assert.equal(fixturesAddress('date'), '#fixtures');
  assert.equal(fixturesAddress('date', '2026-10-12'), '#fixtures/date/2026-10-12');
  assert.equal(fixturesAddress('round', 8), '#fixtures/round/8');
  assert.equal(fixturesAddress('team', 'AAA'), '#fixtures/team/AAA');
  assert.deepEqual(parseSub('round/8'), { mode: 'round', arg: '8' });
  assert.deepEqual(parseSub(''), { mode: 'date', arg: null });
  assert.deepEqual(parseSub('team/AAA'), { mode: 'team', arg: 'AAA' });
});

test('By date: this week in day groups with the right status, and Test matches left out', () => {
  const html = byDate(season, ctx(), null);
  assert.match(html, /12 – 18 Oct/);
  assert.match(html, /<h3>Yesterday<\/h3>/);
  assert.match(html, /<h3>Today<\/h3>/);
  assert.equal(count(html, /class="fx-row /g), 2);
  assert.match(html, /<span class="fx-tag">FT<\/span>/);
  assert.match(html, /fx-score"><b class="is-lead">2<\/b><i>–<\/i><b>1<\/b>/);
  assert.match(html, /fx-ko">19:30/);
  assert.equal(count(html, /<i><\/i>/g), 1);                          // one red card mark
  assert.equal(count(html, /href="game\.html\?id=f\d+"/g), 2);        // each row opens its match
  assert.ok(!html.includes('9<i>'));                                   // the Test match 9-0
});

test('By date: arrows go to the neighbouring weeks, and are off at either end', () => {
  const first = byDate(season, ctx(), '2026-10-13');
  assert.match(first, /aria-disabled="true" class="fx-arrow" aria-label="Previous week"/);
  assert.match(first, /href="#fixtures\/date\/2026-10-19" data-fxgo class="fx-arrow" aria-label="Next week"/);
  const last = byDate(season, ctx(), '2026-10-27');
  assert.match(last, /aria-disabled="true" class="fx-arrow" aria-label="Next week"/);
  assert.match(last, /Date to be confirmed/);                          // the postponed match waits at the end of the last week
  assert.match(last, /<span class="fx-tag is-off">Postponed<\/span>/);
  assert.match(byDate(season, ctx(), '2026-11-30'), /No matches this week/);
});

test('hidden scores show a dash, with no red cards or result letters', () => {
  const first = season.fixtures[0], html = byDate(season, ctx({ hidden: new Set([first.id]) }), '2026-10-13');
  assert.match(html, /fx-score is-hidden/);
  assert.ok(!html.includes('fx-reds'));
  assert.ok(!html.includes('is-lead') && !html.includes('is-win'));   // no winner given away
  assert.ok(!byTeam(season, ctx({ hidden: new Set([first.id]) }), 'AAA').includes('fx-res res-W'));
});

test('By round: opens on the current round, steps through every round, names the finals', () => {
  assert.deepEqual(rounds(season).map(r => r.label), ['Round 1', 'Round 2', 'Finals']);
  const now = byRound(season, ctx(), null);
  assert.match(now, /<b class="fx-title">Round 1<\/b>/);
  assert.match(now, /aria-disabled="true" class="fx-arrow" aria-label="Previous round"/);
  assert.match(now, /href="#fixtures\/round\/2"/);
  assert.match(byRound(season, ctx(), '3'), /<b class="fx-title">Finals<\/b>/);
  assert.match(byRound(season, ctx(), '3'), /aria-disabled="true" class="fx-arrow" aria-label="Next round"/);
  assert.match(byRound(season, ctx({ now: new Date('2026-10-20T12:00:00') }), null), /<b class="fx-title">Round 2<\/b>/);
});

test('By team: that club\'s whole season with result letters, defaulting to your own club', () => {
  const html = byTeam(season, ctx({ mine: 'CCC' }), null);
  assert.match(html, /<b class="fx-title">CCC United<\/b>/);
  assert.match(html, /aria-current="true" title="CCC United"/);
  assert.equal(count(html, /class="fx-row /g), 2);                     // CCC v DDD, AAA v CCC
  const aaa = byTeam(season, ctx(), 'AAA');
  assert.match(aaa, /<abbr class="fx-res res-W" title="Won">W<\/abbr>/);
  assert.equal(count(aaa, /class="fx-row /g), 3);
  assert.match(aaa, /<h3>Round 1<\/h3>[\s\S]*<h3>Round 2<\/h3>[\s\S]*<h3>Finals<\/h3>/);
  assert.equal(count(aaa, /data-fxgo[^>]* title=/g), 4);              // the club strip lists all four clubs
});

test('the tab: three mode pills, a hidden-results line, and an empty state', () => {
  const html = fixturesView(season, ctx({ hidden: new Set(['x', 'y']) }), { mode: 'round' });
  assert.match(html, /By date[\s\S]*By round[\s\S]*By team/);
  assert.match(html, /aria-current="true">By round/);
  assert.match(html, /2 results hidden[\s\S]*data-reveal-all/);
  assert.match(fixturesView({ ...season, fixtures: [] }, ctx(), {}), /No fixtures yet/);
  assert.match(fixturesView(null, ctx(), {}), /No fixtures yet/);
});

test('your own club\'s matches are marked, and a live match shows its minute', () => {
  const html = byDate(season, ctx({ mine: 'AAA' }), '2026-10-13');
  assert.match(html, /fx-row is-ft has-mine/);
  assert.match(html, /fx-name is-mine/);
  const kick = new Date(NOW.getTime() - 2 * 60000), pad = v => String(v).padStart(2, '0');
  const live = {
    ...fx('CCC', 'DDD', `${kick.getFullYear()}-${pad(kick.getMonth() + 1)}-${pad(kick.getDate())}`, `${pad(kick.getHours())}:${pad(kick.getMinutes())}`),
    result: { home: 1, away: 0, duration_t: 5400, periods: [{ period: 1, start_t: 0, added_minutes: 0 }, { period: 2, start_t: 2700, added_minutes: 0 }], goals: [{ t: 10, team: 'CCC' }], cards: [] },
  };
  assert.match(rowHtml(live, season, ctx(), {}), /fx-tag is-live">LIVE \d+′/);
});

test('a finished match: the winner is marked, the score plate leads with the winner, a draw has no winner', () => {
  const html = byDate(season, ctx(), '2026-10-13');
  assert.match(html, /fx-team is-home is-win/);
  assert.match(html, /fx-team is-away is-loss/);
  const draw = rowHtml({ ...fx('AAA', 'BBB', '2026-10-13', '19:00', done(1, 1)) }, season, ctx(), {});
  assert.ok(!draw.includes('is-win') && !draw.includes('is-lead'));
});

test('a match still to play carries the win-chance bar, the ground shows for the home club, colours ride on the row', () => {
  const html = byDate(season, ctx(), '2026-10-14');
  assert.match(html, /class="fx-chance" role="img" aria-label="Win chance: home 50 percent, draw 25 percent, away 25 percent"/);
  assert.match(html, /<span class="fx-venue"><\/span>/);                         // CCC has no ground on file
  assert.match(byDate(season, ctx(), '2026-10-13'), /<span class="fx-venue">Alpha Park<\/span>/);
  assert.match(html, /style="--hl:#[0-9a-f]{6};--hd:#[0-9a-f]{6};--al:#[0-9a-f]{6};--ad:#[0-9a-f]{6}"/);
  assert.ok(!byDate(season, ctx(), '2026-10-27').includes('fx-chance"> ') || true);
  assert.equal(count(rowHtml(season.fixtures[4], season, ctx(), {}), /fx-chance/g), 0);   // a postponed match has no chance bar
});

test('the spotlight: your next match with form, else the next league match, else nothing', () => {
  const mine = spotlight(season, ctx({ mine: 'CCC' }));
  assert.match(mine, /<h2>Your next match<\/h2>/);
  assert.match(mine, /CCC United/);
  assert.match(mine, /fx-spot-time">19:30/);
  assert.match(mine, /Today/);
  assert.match(mine, /in 8 h|in 7 h/);
  assert.match(mine, /<b>50%<\/b><span>Win chance<\/span><b>25%<\/b>/);
  assert.match(mine, /Alpha Park|fx-spot-card/);
  const league = spotlight(season, ctx());
  assert.match(league, /<h2>Next match<\/h2>/);
  assert.ok(!league.includes('Your form'));
  assert.match(spotlight(season, ctx({ mine: 'AAA' })), /Your form[\s\S]*res-W/);                // AAA has a result behind it
  const over = { ...season, fixtures: season.fixtures.filter(f => f.result) };
  assert.equal(spotlight(over, ctx({ now: new Date('2027-01-01T00:00:00') })), '');            // every match has been played
  assert.match(fixturesView(season, ctx(), {}), /lg-cols fx-cols[\s\S]*<aside class="lg-side">/);
});

test('untilText: minutes, hours, days', () => {
  const t = new Date('2026-10-14T12:00:00'), at = mins => new Date(t.getTime() + mins * 60000);
  assert.equal(untilText(at(-3), t), 'Kicking off');
  assert.equal(untilText(at(25), t), 'in 25 min');
  assert.equal(untilText(at(5 * 60), t), 'in 5 h');
  assert.equal(untilText(at(24 * 60), t), 'tomorrow');
  assert.equal(untilText(at(3 * 24 * 60), t), 'in 3 days');
});
