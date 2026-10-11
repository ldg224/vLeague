// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { statCard, statList, listAddress, initialsCrest } from '../js/stat-card.js';
import { rank, PLAYER_CARDS, TEAM_CARDS } from '../js/season-stats.js';

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
  assert.ok(statList(per90, rank([{ name: 'Ana', team: 'RED', min: 90, g: 1 }], per90), ctx).includes('at least 90 minutes'));
});

test('team rows show the rank, crest and club name', () => {
  const html = statCard(clean, rank([{ code: 'RED', p: 2, cs: 2 }, { code: 'WHT', p: 2, cs: 1 }], clean, 3), ctx, { kind: 'team' });
  assert.equal(count(html, /class="sc-rank"/g), 2);
  assert.ok(html.includes('<crest RED 30>') && html.includes('Redfield Lions') && html.includes('Whitehill Wolves'));
});

test('the full list shows every row with its rank, ties share one, and a back link', () => {
  const ranked = rank([player('A', 4), player('B', 4), player('C', 4), player('D', 1)], scorers);
  const html = statList(scorers, ranked, ctx, { back: '#stats' });
  assert.equal(count(html, /data-rank="1"/g), 3);
  assert.equal(count(html, /data-rank="4"/g), 1);
  assert.equal(count(html, /sc-val is-lead/g), 3);        // everyone on the top rank
  assert.ok(html.includes('href="#stats"') && html.includes('4 players'));
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
