// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { statCard, statPage, listAddress, initialsCrest } from '../js/stat-card.js';
import { rank, PLAYER_CARDS, TEAM_CARDS, lineOf } from '../js/season-stats.js';

const scorers = PLAYER_CARDS.find(c => c.id === 'scorers'), clean = TEAM_CARDS.find(c => c.id === 'tcs');
const clubs = { RED: { code: 'RED', name: 'Redfield Lions', short_name: 'Redfield', colour: '#c8102e' }, WHT: { code: 'WHT', name: 'Whitehill Wolves', colour: '#f2f2f2' } };
const ctx = { club: code => clubs[code], crest: (code, px) => `<crest ${code} ${px}>` };
const player = (name, g, team = 'RED') => ({ name, team, g, id: name });
const count = (html, re) => (html.match(re) || []).length;

test('three entries: three rows, the leader gets the pill in their club colour, and a link to the full list', () => {
  const html = statCard(scorers, rank([player('Ana', 5), player('Bea', 3, 'WHT'), player('Cy', 2)], scorers, 3), ctx);
  assert.equal(count(html, /class="sc-row[ "]/g), 3);
  assert.equal(count(html, /sc-val is-lead/g), 1);
  assert.match(html, /--c:#c8102e;--on:#ffffff/);          // red club: white text on the pill
  assert.match(html, /--c:#f2f2f2;--on:#0a0f19/);          // white club: dark text on the pill, so it reads
  assert.ok(html.includes(`href="${listAddress(scorers)}"`));
  assert.equal(listAddress(scorers), '#stats/scorers');
});

test('one entry: one row and the link stays', () => {
  const html = statCard(scorers, rank([player('Ana', 5)], scorers, 3), ctx);
  assert.equal(count(html, /class="sc-row[ "]/g), 1);
  assert.ok(html.includes('class="sc-more"'));
});

test('no entries: the empty state, no rows and no link to an empty list', () => {
  const html = statCard(scorers, [], ctx);
  assert.equal(count(html, /class="sc-row[ "]/g), 0);
  assert.ok(html.includes('No matches played yet'));
  assert.ok(!html.includes('sc-more'));
  assert.ok(html.includes('is-empty'));
});

test('a card with a minimum says so in its empty state and its full list', () => {
  const per90 = PLAYER_CARDS.find(c => c.id === 'g90');
  assert.ok(statCard(per90, [], ctx).includes('at least 90 minutes'));
  assert.ok(statPage(per90, rank([{ name: 'Ana', team: 'RED', min: 90, g: 1 }], per90), ctx).includes('at least 90 minutes'));
});

test('team rows show the rank, crest and club name', () => {
  const html = statCard(clean, rank([{ code: 'RED', p: 2, cs: 2 }, { code: 'WHT', p: 2, cs: 1 }], clean, 3), ctx, { kind: 'team' });
  assert.equal(count(html, /class="sc-rank"/g), 2);
  assert.ok(html.includes('<crest RED 30>') && html.includes('Redfield Lions') && html.includes('Whitehill Wolves'));
});

const pageOpts = { title: 'Player stats', cards: PLAYER_CARDS, seasonLine: 'vLeague · Season 1 · 6 matches played' };

test('the full page has the top bar, a banner in the leading club colour that says who leads, and every row with its rank', () => {
  const ranked = rank([player('Ana', 5), player('Bea', 3, 'WHT'), player('Cy', 3), player('Di', 1)], scorers);
  const html = statPage(scorers, ranked, ctx, pageOpts);
  assert.ok(html.includes('class="sp-top"') && html.includes('Player stats'));
  assert.match(html, /class="sp-banner" style="--c:#c8102e;--on:#ffffff"/);
  assert.ok(html.includes('<b>Ana</b> is the top scorer with 5 goals'));
  assert.ok(html.includes('vLeague · Season 1 · 6 matches played'));
  assert.equal(count(html, /<li class="sc-row" data-rank=/g), 4);
  assert.equal(count(html, /data-rank="2"/g), 2);          // Bea and Cy share second place
  assert.equal(count(html, /data-rank="4"/g), 1);          // and the next rank skips
  assert.ok(html.includes('href="#stats"'));
});

test('a tie at the top names everyone who shares it', () => {
  const html = statPage(scorers, rank([player('Ana', 4), player('Bea', 4), player('Cy', 4), player('Di', 4), player('Ed', 1)], scorers), ctx, pageOpts);
  assert.ok(html.includes('<b>Ana</b>, <b>Bea</b> and 2 others share the top spot with 4'));
  assert.ok(statPage(scorers, rank([player('Ana', 4), player('Bea', 4)], scorers), ctx, pageOpts).includes('<b>Ana</b> and <b>Bea</b> share the top spot with 4'));
});

test('a club banner names the club, and a single goal is not "1 goals"', () => {
  const tc = TEAM_CARDS.find(c => c.id === 'tgoals');
  assert.ok(statPage(tc, rank([{ code: 'RED', p: 2, gf: 4 }], tc), ctx, { kind: 'team', title: 'Team stats', cards: TEAM_CARDS }).includes('<b>Redfield Lions</b> score the most goals per match with 2.00'));
  assert.ok(statPage(scorers, rank([player('Ana', 1)], scorers), ctx, pageOpts).includes('with 1 goal<'));
});

test('the stat switcher lists every stat of the kind, the current one ticked, and position pills keep the stat', () => {
  const html = statPage(scorers, rank([player('Ana', 2)], scorers), ctx, { ...pageOpts, position: 'MID' });
  assert.equal(count(html, /role="menuitemradio"/g), PLAYER_CARDS.length);
  assert.equal(count(html, /aria-checked="true"/g), 1);
  assert.ok(html.includes('href="#stats/assists"'));
  assert.ok(html.includes('href="#stats/scorers/MID" aria-current="true"'));
  assert.equal(listAddress(scorers, 'all'), '#stats/scorers');
  assert.ok(!statPage(clean, rank([{ code: 'RED', p: 1, cs: 1 }], clean), ctx, { kind: 'team', cards: TEAM_CARDS }).includes('sp-pills'));   // clubs have no positions
});

test('an empty position says so instead of showing an empty list', () => {
  const html = statPage(scorers, [], ctx, { ...pageOpts, position: 'GK' });
  assert.ok(html.includes('Nobody in this position qualifies yet.') && html.includes('No players to show') && !html.includes('No matches played yet'));
  assert.ok(!html.includes('sp-banner'));
});

test('positions come from the formation slot', () => {
  const lines = s => lineOf(s);
  assert.deepEqual(['GK', 'LB', 'RCB', 'CDM', 'LCM', 'RM', 'LW', 'ST', 'RST'].map(lines), ['GK', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD']);
});

test('names are escaped', () => {
  const html = statCard(scorers, rank([player('<img src=x onerror=alert(1)>', 3)], scorers, 3), ctx);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('a club without a logo gets a colour disc, with its code only when it is big enough to read', () => {
  assert.ok(initialsCrest(clubs.RED, 'RED', 30).includes('<i>RED</i>'));
  assert.ok(initialsCrest(clubs.RED, 'RED', 16).includes('is-dot'));
  assert.ok(initialsCrest({ colour: 'not a colour' }, 'XYZ', 30).includes('--c:#64748b'));
});
