// Run with:  node --test "tests/*.test.mjs"
// The stat cards must read what the engine really saves: a match file goes through summariseMatch (js/simulate.js), the summary is what the results
// table holds (and loadSeason hands the page), and every Player and Team card must rank real numbers from it (no NaN, nobody missing).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };
const { summariseMatch } = await import('../js/simulate.js');
const { totals, rank, PLAYER_CARDS, TEAM_CARDS, countedFixtures, format } = await import('../js/season-stats.js');

const pstat = o => ({ minutes: 90, goals: 0, assists: 0, own_goals: 0, shots: 2, shots_on_target: 1, xg: 0.3, key_passes: 1, passes: 30, passes_completed: 24,
  tackles_won: 2, interceptions: 1, clearances: 1, blocks: 1, saves: 0, goals_conceded: 0, yellow: 0, red: 0, distance_km: 9, rating: 6.8,
  fouls: 1, fouled: 1, take_ons: 1, aerials_won: 1, offsides: 0, crosses: 1, touches: 50, ...o });
const tstat = o => ({ possession: 52, xg: 1.4, shots: 10, shots_on_target: 4, big_chances: 1, passes: 300, passes_completed: 250, crosses: 8, tackles_won: 12,
  interceptions: 8, clearances: 15, saves: 3, fouls: 10, yellow_cards: 1, red_cards: 1, corners: 5, offsides: 2, ...o });
const squad = (team, tag) => ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LCM', 'CM', 'RCM', 'LW', 'ST', 'RW'].map((slot, i) => ({ id: `${team}-${tag}${i}`, name: `${team} ${tag} ${i}`, team, slot }));
const file = (home, away, hg, ag) => {
  const players = [...squad(home, 'h'), ...squad(away, 'a')], st = {};
  for (const p of players) st[p.id] = pstat({ goals: p.id.endsWith('-h9') ? hg : p.id.endsWith('-a9') ? ag : 0, assists: p.id.endsWith('-h8') ? 1 : 0, saves: p.slot === 'GK' ? 3 : 0, yellow: p.id.endsWith('-h1') ? 1 : 0, red: p.id.endsWith('-a1') ? 1 : 0, goals_conceded: p.slot === 'GK' ? (p.team === home ? ag : hg) : 0, rating: 6 + (p.id.charCodeAt(p.id.length - 1) % 5) / 2 });
  return { players, events: [], stats: { players: st, teams: { home: tstat({}), away: tstat({ possession: 48 }) } }, frames: { data: [[0], [6000]] }, periods: [], result: { home: hg, away: ag }, engine: { version: 'x', seed: 1 } };
};
const fixtures = countedFixtures([['AAA', 'BBB', 2, 1, 1], ['BBB', 'CCC', 0, 0, 2], ['CCC', 'AAA', 1, 3, 3]].map(([h, a, hg, ag, week], i) => ({ id: `f${i}`, week, home: h, away: a, result: summariseMatch(file(h, a, hg, ag)) })));

test('a saved match summary is counted, and every Player card ranks real numbers from it', () => {
  assert.equal(fixtures.length, 3);
  const { players } = totals(fixtures);
  assert.ok(players.length >= 30);
  for (const c of PLAYER_CARDS) {
    const r = rank(players, c);
    assert.ok(r.length > 0, `${c.title}: nobody ranked`);
    assert.ok(r.every(x => Number.isFinite(x.value)), `${c.title}: a value is not a number`);
    assert.doesNotMatch(format(r[0].value, c), /NaN|undefined|Infinity/, c.title);
  }
});

test('and every Team card ranks real numbers for the clubs (a card that lists only non-zero values, like clean sheets, may leave a club out)', () => {
  const { teams } = totals(fixtures);
  assert.equal(teams.length, 3);
  for (const c of TEAM_CARDS) {
    const r = rank(teams, c);
    assert.ok(r.length >= 1 && r.length <= 3, `${c.title}: ${r.length} clubs ranked`);
    assert.ok(r.every(x => Number.isFinite(x.value)), `${c.title}: a value is not a number`);
  }
});
