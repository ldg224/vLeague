// Demo data for the match page (match.html?id=demo-1-0&demo=6), the same switch as the league page's ?demo: the league's real clubs and kits with
// made-up players, results, scorers, red cards and locked line-ups, so the match page can be judged before a real season is played. Works on
// localhost and for the office only; never real data.
//   demoMatchSeason(clubRows, rounds) -> a season (js/demo-season.js) plus: players (the squads, with numbers and values), each result's goals and
//                                        cards, and demoSheets: { CODE: { formation, lineup, captain, club } } as if every club had locked its team
import { demoSeason } from './demo-season.js';
import { lineOf } from './season-stats.js';

const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

export function demoMatchSeason(rows, rounds = 6) {
  const active = (rows || []).filter(r => r.status === 'active' && r.colour);
  const season = demoSeason({ rounds, clubs: active.length >= 4 ? active : undefined });
  const byId = new Map(), latest = {};
  for (const f of season.fixtures) {
    const goals = [], cards = [];
    for (const [id, p] of Object.entries(f.result.players)) {
      if (!byId.has(id)) byId.set(id, { id, name: p.name, team: p.team, position: lineOf(p.slot), number: 1 + hash(id) % 98, value: 40000 + (hash(id) % 90) * 10000, slot: p.slot });
      latest[p.team] = latest[p.team] || {};
      latest[p.team][p.slot] = id;
      for (let i = 0; i < p.g; i++) goals.push({ team: p.team, scorer: id, scorer_name: p.name, minute: 5 + (hash(`${f.id}${id}${i}`) % 85), own_goal: false });
      if (p.rc) cards.push({ team: p.team, player: id, name: p.name, card: 'red', minute: 30 + (hash(`${f.id}${id}`) % 55) });
    }
    goals.sort((a, b) => a.minute - b.minute).forEach((g, i) => { g.t = g.minute * 60 + i; });
    cards.forEach(c => { c.t = c.minute * 60; });
    f.result.goals = goals;
    f.result.cards = cards;
  }
  season.players = [...byId.values()];
  const captain = code => latest[code]?.CDM || latest[code]?.ST || null;
  season.demoSheets = Object.fromEntries(season.teams.map(t => [t.code, { club: t.code, formation: '4-3-3', lineup: latest[t.code] || {}, captain: captain(t.code), kit: null }]));
  return season;
}
