// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const { grandFinal, seasonsView } = await import('../js/seasons-tab.js');

const fx = (id, stage, home, away, result) => ({ id, stage, home, away, ...(result ? { result } : {}) });
const history = {
  comps: [{ id: 1, name: 'Heineken C League', winner_art: 'cup.png', runner_art: null }],
  seasons: [{ id: 5, name: 'Season 2', sort: 2 }, { id: 4, name: 'Season 1', sort: 1 }, { id: 6, name: 'Empty season', sort: 0 }],
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
  assert.match(html, /Heineken C League/);
});

test('once the final is decided the current season shows its winner and runner-up with crests', () => {
  const html = seasonsView(o({ final: { winner: 'AAA', runnerUp: 'BBB' } }));
  assert.match(html, /Finished/); assert.doesNotMatch(html, /To be decided/);
  assert.match(html, /<crest AAA 28><b>AAA FC<\/b>/); assert.match(html, /<crest BBB 28><b>BBB FC<\/b>/);
  assert.match(html, /\/t\/cup\.png/);   // the competition's trophy beside the winner
});

test('a hidden final is not given away', () => {
  const html = seasonsView(o({ final: null, hiddenCount: 1 }));
  assert.match(html, /1 result hidden[\s\S]*data-reveal-all/); assert.match(html, /In progress/);
});

test('previous seasons come from History, newest first, with past teams on a badge', () => {
  const html = seasonsView(o());
  assert.ok(html.indexOf('Season 2') < html.indexOf('>Season 1<', html.indexOf('Previous seasons')));
  assert.match(html, /Previous seasons/);
  assert.match(html, /<crest SKS 28><b>SKS FC<\/b>/); assert.match(html, /<span class="ss-badge" aria-hidden="true">PCF<\/span><b>Pectorial Flys<\/b>/);
  assert.match(html, /No winners recorded yet/);                               // a season with no awards still has a card
  assert.doesNotMatch(seasonsView(o({ history: null })), /Previous seasons/);  // History not loaded (or empty): just the current season
});
