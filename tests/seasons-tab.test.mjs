// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const { grandFinal, seasonsView } = await import('../js/seasons-tab.js');

const fx = (id, stage, home, away, result) => ({ id, stage, home, away, ...(result ? { result } : {}) });
const history = {
  leagues: [{ id: 1, name: 'Old League', sort: 1 }, { id: 2, name: 'vLeague', sort: 2 }],
  comps: [{ id: 1, name: 'Heineken C League', winner_art: 'cup.png', runner_art: null }],
  seasons: [{ id: 5, name: 'Season 2', sort: 2, league: 1 }, { id: 4, name: 'Season 1', sort: 1, league: 1 }, { id: 6, name: 'Empty season', sort: 0, league: 1 }],
  past: [{ id: 1, name: 'Pectorial Flys', code: 'PCF', manager_name: 'Jeho Ryou' }],
  awards: [
    { id: 1, season: 5, competition: 1, place: 'winner', club: 'SKS', past_team: null, art_path: null },
    { id: 2, season: 5, competition: 1, place: 'runner_up', club: 'TUR', past_team: null, art_path: null },
    { id: 3, season: 4, competition: 1, place: 'winner', club: 'TUR', past_team: null, art_path: null },
    { id: 4, season: 4, competition: 1, place: 'runner_up', club: null, past_team: 1, art_path: null },
  ],
};
const o = (extra = {}) => ({ current: { label: 'Season 1', live: true }, final: null, history, club: c => ({ name: `${c} FC` }), crest: (c, px) => `<crest ${c} ${px}>`, trophy: p => `/t/${p}`, office: false, ...extra });

test('the grand final decides the season only once it is played, and a draw leaves it open', () => {
  assert.equal(grandFinal([fx('a', 'SF', 'AAA', 'BBB', { home: 1, away: 0 })]), null);                 // only a semi-final
  assert.equal(grandFinal([fx('g', 'GF', 'AAA', 'BBB')]), null);                                         // not played
  assert.deepEqual(grandFinal([fx('g', 'GF', 'AAA', 'BBB', { home: 2, away: 1 })]), { winner: 'AAA', runnerUp: 'BBB' });
  assert.deepEqual(grandFinal([fx('g', 'GF', 'AAA', 'BBB', { home: 0, away: 3 })]), { winner: 'BBB', runnerUp: 'AAA' });
  assert.equal(grandFinal([fx('g', 'GF', 'AAA', 'BBB', { home: 1, away: 1 })]), null);
  assert.deepEqual(grandFinal([fx('g', 'GF', 'AAA', 'BBB', { home: 2, away: 1 })], { hidden: new Set(['g']) }), { hiddenFinal: true });   // a hidden result is never given away
});

test('the current season is In progress with both places still to be decided', () => {
  const html = seasonsView(o());
  assert.match(html, /<h3>Season 1<\/h3><span class="ss-pill is-live">In progress<\/span>/);
  assert.equal((html.match(/To be decided/g) || []).length, 2);
  assert.match(html, /<p class="ss-comp">League<\/p>/);   // a neutral label: the old competition's name and trophy stay with the old seasons
});

test('once the final is decided the current season shows its winner and runner-up with crests', () => {
  const html = seasonsView(o({ final: { winner: 'AAA', runnerUp: 'BBB' } }));
  assert.match(html, /Finished/); assert.doesNotMatch(html, /To be decided/);
  assert.match(html, /<crest AAA 28><b>AAA FC<\/b>/); assert.match(html, /<crest BBB 28><b>BBB FC<\/b>/);
});

test('a hidden final is not given away', () => {
  const html = seasonsView(o({ final: null, hiddenCount: 1 }));
  assert.match(html, /1 result hidden[\s\S]*data-reveal-all/); assert.match(html, /In progress/);
});

test('previous seasons come from History, newest first, with past teams on a badge', () => {
  const html = seasonsView(o());
  assert.ok(html.indexOf('>Season 2<') < html.indexOf('>Season 1<', html.indexOf('>Season 2<')));   // newest first within a name
  assert.match(html, /<crest SKS 28><b>SKS FC<\/b>/); assert.match(html, /<span class="ss-badge" aria-hidden="true">PCF<\/span><b>Pectorial Flys<\/b>/);
  assert.match(html, /No winners recorded yet/);                               // a season with no awards still has a card
  const alone = seasonsView(o({ history: null }));   // History not loaded (or empty): just the current season
  assert.match(alone, /Season 1/); assert.doesNotMatch(alone, /Season 2/);
});

test('seasons are grouped by the name the league ran under, newest name first, the current season leading its group', () => {
  const html = seasonsView(o());
  const v = html.indexOf('>vLeague</h3>'), old = html.indexOf('>Old League</h3>');
  assert.ok(v > 0 && old > v, 'the newest name comes first');
  assert.ok(html.indexOf('In progress') > v && html.indexOf('In progress') < old, 'the current season sits in the newest name\'s group');
  assert.ok(html.indexOf('>Season 2<') > old);   // the old seasons sit under the old name
});

test('the headings: the newest name in vLeague blue, earlier names in green, and no number overall anywhere', () => {
  const html = seasonsView(o());
  assert.match(html, /<h3 class="ss-league is-now">vLeague<\/h3>/); assert.match(html, /<h3 class="ss-league is-before">Old League<\/h3>/);
  assert.doesNotMatch(html, /overall/);
});

test('a season with no league counts as the newest name', () => {
  const h = { ...history, seasons: [{ id: 9, name: 'Season 1b', sort: 5, league: null }] };
  const html = seasonsView(o({ history: h }));
  assert.ok(html.indexOf('Season 1b') > html.indexOf('>vLeague</h3>') && !html.includes('>Old League</h3>'));
});

test('the current season recorded in History shows once: in progress until it has a winner, then as that record', () => {
  const rec = { id: 8, name: 'Season 1', sort: 3, league: 2 };
  const h = { ...history, seasons: [rec, ...history.seasons] };
  const open = seasonsView(o({ history: h }));
  assert.equal((open.match(/<h3>Season 1<\/h3>/g) || []).length, 2);   // the old league's Season 1 and the current one: not three
  assert.match(open, /In progress/); assert.match(open, /To be decided/);
  const won = seasonsView(o({ history: { ...h, awards: [...history.awards, { id: 9, season: 8, competition: 1, place: 'winner', club: 'SKS', past_team: null, art_path: null }] } }));
  assert.equal((won.match(/<h3>Season 1<\/h3>/g) || []).length, 2);
  assert.doesNotMatch(won, /In progress/); assert.match(won, /<crest SKS 28>/);
});

test('a past team shows its logo once it has one, and its code on a badge until then', () => {
  const withLogo = { ...history, past: [{ ...history.past[0], crest_path: 'pcf.png' }] };
  const html = seasonsView(o({ history: withLogo }));
  assert.match(html, /<img class="ss-logo" src="\/t\/pcf\.png"[^>]*><b>Pectorial Flys<\/b>/);
  assert.doesNotMatch(html, /ss-badge/);
  assert.match(seasonsView(o()), /<span class="ss-badge" aria-hidden="true">PCF<\/span>/);
});
