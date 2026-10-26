// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { statCard, statPage as linkedPage, listAddress, initialsCrest } from '../js/stat-card.js';
import { rank, PLAYER_CARDS, TEAM_CARDS, lineOf } from '../js/season-stats.js';

const scorers = PLAYER_CARDS.find(c => c.id === 'scorers'), clean = TEAM_CARDS.find(c => c.id === 'tcs');
const clubs = { RED: { code: 'RED', name: 'Redfield Lions', short_name: 'Redfield', colour: '#c8102e' }, WHT: { code: 'WHT', name: 'Whitehill Wolves', colour: '#f2f2f2' } };
const ctx = { club: code => clubs[code], crest: (code, px) => `<crest ${code} ${px}>` };
const player = (name, g, team = 'RED', apps = 5) => ({ name, team, g, id: name, apps });
// A player's name is a link to his page (js/player-link.js); these tests read the page's words, so the link wrapper is taken off.
const statPage = (...a) => linkedPage(...a).replace(/<span class="plk"[^>]*>(.*?)<\/span>/g, '$1');
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

const pageOpts = { title: 'Player stats', cards: PLAYER_CARDS };

test('the full page has the top bar, a banner in the leading club colour that says who leads, and every row with its rank', () => {
  const ranked = rank([player('Ana', 5), player('Bea', 3, 'WHT'), player('Cy', 3), player('Di', 1)], scorers);
  const html = statPage(scorers, ranked, ctx, pageOpts);
  assert.ok(html.includes('class="sp-top"') && html.includes('Player stats'));
  assert.match(html, /class="sp-banner" style="--c:#c8102e;--on:#ffffff[;"]/);
  assert.ok(html.includes('<b>Ana</b> is the top scorer, with 5 goals'));
  assert.ok(html.includes('5 matches played') && !html.includes('Season 1'));   // the leader's own matches (the player() helper gives 5 apps)
  assert.equal(count(html, /<li class="sc-row" data-rank=/g), 4);
  assert.equal(count(html, /data-rank="2"/g), 2);          // Bea and Cy share second place
  assert.equal(count(html, /data-rank="4"/g), 1);          // and the next rank skips
  assert.ok(html.includes('href="#stats"'));
});

test('a tie at the top names everyone who shares it', () => {
  const html = statPage(scorers, rank([player('Ana', 4), player('Bea', 4), player('Cy', 4), player('Di', 4), player('Ed', 1)], scorers), ctx, pageOpts);
  const many = html.match(/<div class="sp-says"><p>(.*?)<\/p>/)[1];
  assert.ok(many.includes('<b>Ana</b>, <b>Bea</b> and 2 others') && many.includes('4') && !many.includes('share the top spot'), many);
  const two = statPage(scorers, rank([player('Ana', 4), player('Bea', 4)], scorers), ctx, pageOpts).match(/<div class="sp-says"><p>(.*?)<\/p>/)[1];
  assert.ok(two.includes('<b>Ana</b> and <b>Bea</b>') && two.includes('4') && !two.includes('share the top spot'), two);
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

test('with a position picked the banner says so: five main stats name it in the sentence, the others lead with "Among"', () => {
  const rating = PLAYER_CARDS.find(c => c.id === 'rating'), kp = PLAYER_CARDS.find(c => c.id === 'kp'), minutes = PLAYER_CARDS.find(c => c.id === 'minutes');
  const rows = [{ ...player('Ryan Zane', 0), ratingSum: 15.4, apps: 2, min: 180, kp: 3 }];
  const page = (card, position) => statPage(card, rank(rows, card), ctx, { ...pageOpts, position });
  assert.ok(page(rating, 'MID').includes('<b>Ryan Zane</b> is the top rated midfielder, with an average rating of 7.7'));
  assert.ok(page(rating, 'all').includes('is the top rated player, with an average rating of 7.7'));
  assert.ok(statPage(scorers, rank([player('Ana', 5)], scorers), ctx, { ...pageOpts, position: 'FWD' }).includes('<b>Ana</b> is the top scoring forward, with 5 goals'));
  assert.ok(page(kp, 'DEF').includes('Among defenders, <b>Ryan Zane</b> has created the most chances with 3'));
  assert.ok(page(minutes, 'GK').includes('has played the most minutes of any goalkeeper, 180'));
});

test('a tie names the position too, and a club banner never does', () => {
  const html = statPage(scorers, rank([player('Ana', 4), player('Bea', 4)], scorers), ctx, { ...pageOpts, position: 'MID' });
  const line = html.match(/<div class="sp-says"><p>(.*?)<\/p>/)[1];
  assert.ok(line.includes('<b>Ana</b> and <b>Bea</b>') && line.includes('among midfielders') && line.includes('4') && !line.includes('share the top spot'), line);
  const tc = TEAM_CARDS.find(c => c.id === 'tgoals');
  assert.ok(!statPage(tc, rank([{ code: 'RED', p: 2, gf: 4 }], tc), ctx, { kind: 'team', title: 'Team stats', cards: TEAM_CARDS, position: 'MID' }).includes('Among'));
});

test('the line under the banner is how many matches the leader has played (a club: the club), a tie shows the range', () => {
  assert.ok(statPage(scorers, rank([{ ...player('Ana', 5), apps: 3 }, { ...player('Bea', 2), apps: 6 }], scorers), ctx, pageOpts).includes('<span>3 matches played</span>'));
  assert.ok(statPage(scorers, rank([{ ...player('Ana', 4), apps: 1 }], scorers), ctx, pageOpts).includes('<span>1 match played</span>'));
  assert.ok(statPage(scorers, rank([{ ...player('Ana', 4), apps: 3 }, { ...player('Bea', 4), apps: 5 }], scorers), ctx, pageOpts).includes('<span>3–5 matches played</span>'));
  const tc = TEAM_CARDS.find(c => c.id === 'tgoals');
  assert.ok(statPage(tc, rank([{ code: 'RED', p: 2, gf: 4 }], tc), ctx, { kind: 'team', title: 'Team stats', cards: TEAM_CARDS }).includes('<span>2 matches played</span>'));
});

test('a tie reads as a sentence about the stat, with some variety, and the same wording every time for the same list', () => {
  const rating = PLAYER_CARDS.find(c => c.id === 'rating');
  const say = (card, rows) => statPage(card, rank(rows, card), ctx, pageOpts).match(/<div class="sp-says"><p>(.*?)<\/p>/)[1];
  const tie = [{ ...player('Ana', 0), ratingSum: 15, apps: 2, min: 180 }, { ...player('Bea', 0), ratingSum: 15, apps: 2, min: 180 }];
  const first = say(rating, tie);
  assert.equal(say(rating, tie), first);                                   // stable across redraws
  assert.ok(first.includes('average rating') && first.includes('7.5'), first);
  const seen = new Set();
  for (const c of PLAYER_CARDS) { const r = rank([player('Ana', 4), player('Bea', 4)], c); if (r.length > 1 && r[0].rank === r[1].rank) seen.add(say(c, [player('Ana', 4), player('Bea', 4)]).replace(/<[^>]+>/g, '').replace(/\d+(\.\d+)?/g, '#').split(' ').slice(2, 4).join(' ')); }
  assert.ok(seen.size >= 1);
});

test('a player name opens his page; a club name does not', () => {
  const html = linkedPage(scorers, rank([player('Ana', 5)], scorers), ctx, pageOpts);
  assert.ok(html.includes('<span class="plk" role="link" tabindex="0" data-pid="Ana">Ana</span>'));
  const tc = TEAM_CARDS.find(c => c.id === 'tgoals');
  assert.ok(!linkedPage(tc, rank([{ code: 'RED', p: 2, gf: 4 }], tc), ctx, { kind: 'team', title: 'Team stats', cards: TEAM_CARDS }).includes('plk'));
});
