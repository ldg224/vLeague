// Demo data for the match page (match.html?id=demo-1-0&demo=6), the same switch as the league page's ?demo: the league's real clubs and kits with
// made-up players, results, scorers, red cards and locked line-ups, so the match page can be judged before a real season is played. Works on
// localhost and for the office only; never real data.
//   demoMatchSeason(clubRows, rounds) -> a season (js/demo-season.js) plus: players (the squads, with numbers and values), each result's goals and
//                                        cards, and demoSheets: { CODE: { formation, lineup, captain, club } } as if every club had locked its team
import { demoSeason } from './demo-season.js';
import { lineOf } from './season-stats.js';

const hash = id => [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
// Attack and defence ratings (1 to 10) as the real players have them: forwards attack, defenders and keepers defend, a made-up spread around that.
const BASE = { GK: [4, 8], DEF: [5, 8], MID: [7, 7], FWD: [8, 4] };

// A made-up match file for a demo match, in the shape of the real one (js/match-file.js): periods, shots with expected goals spread through the match to
// add up to the result's totals, the goals (score after each), cards, added time and the end of each half, and the team stats.
function demoFile(f) {
  const r = f.result, events = [], T = m => (m <= 45 ? m * 60 : 2940 + (m - 45) * 60);
  let id = 0;
  const players = Object.entries(r.players).map(([pid, p]) => ({ id: pid, name: p.name, team: p.team }));
  const score = { [f.home]: 0, [f.away]: 0 };
  for (const g of r.goals) {
    const t = T(g.minute);
    events.push({ id: id++, t: t - 3, minute: String(g.minute), type: 'shot', team: g.team, player: g.scorer, xg: 0.25 + (hash(`${f.id}${g.t}`) % 40) / 100, on_target: true, subtype: 'open' });
    score[g.team]++;
    events.push({ id: id++, t, minute: String(g.minute), type: 'goal', team: g.team, scorer: g.scorer, own_goal: false, assist: null, score: [score[f.home], score[f.away]], shot: id - 2 });
  }
  for (const [code, side] of [[f.home, 'home'], [f.away, 'away']]) {
    const s = r.stats[side], extra = Math.max(0, s.shots - r.goals.filter(g => g.team === code).length);
    const goalXg = events.filter(e => e.type === 'shot' && e.team === code).reduce((a, e) => a + e.xg, 0), left = Math.max(0, s.xg - goalXg);
    for (let i = 0; i < extra; i++) {
      const m = 1 + (hash(`${f.id}${code}${i}`) % 89), t = T(m);
      events.push({ id: id++, t, minute: String(m), type: 'shot', team: code, player: null, xg: extra ? left / extra : 0, on_target: i % 3 === 0, subtype: 'open' });
    }
  }
  for (const c of r.cards) events.push({ id: id++, t: T(c.minute), minute: String(c.minute), type: 'card', team: c.team, player: c.player, card: 'red' });
  for (const [pid, p] of Object.entries(r.players)) if (p.yc) { const m = 8 + (hash(`${f.id}y${pid}`) % 80); events.push({ id: id++, t: T(m), minute: String(m), type: 'card', team: p.team, player: pid, card: 'yellow' }); }
  events.push({ id: id++, t: 2700, minute: '45', type: 'added_time', minutes: 4 }, { id: id++, t: 2940, minute: '45+4', type: 'period_end', period: 1 }, { id: id++, t: 5940, minute: '90+5', type: 'period_end', period: 2 });
  events.sort((a, b) => a.t - b.t);
  return { periods: [{ period: 1, start_t: 0, end_t: 2940, added_minutes: 4 }, { period: 2, start_t: 2940, end_t: 5940, added_minutes: 5 }], events, players, byId: Object.fromEntries(players.map(p => [p.id, p])), stats: { teams: r.stats }, result: { duration_t: 5940 } };
}

export function demoMatchSeason(rows, rounds = 6) {
  const active = (rows || []).filter(r => r.status === 'active' && r.colour);
  const season = demoSeason({ rounds, clubs: active.length >= 4 ? active : undefined });
  const byId = new Map(), latest = {};
  for (const f of season.fixtures) {
    const goals = [], cards = [];
    for (const [id, p] of Object.entries(f.result.players)) {
      if (!byId.has(id)) byId.set(id, { id, name: p.name, team: p.team, position: lineOf(p.slot), number: 1 + hash(id) % 98, value: 8000 + (hash(id) % 50) * 100, offense: Math.max(1, Math.min(10, BASE[lineOf(p.slot)][0] + (hash(id + 'o') % 3) - 1)), defense: Math.max(1, Math.min(10, BASE[lineOf(p.slot)][1] + (hash(id + 'd') % 3) - 1)), slot: p.slot });
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
  for (const f of season.fixtures) f.demoFile = demoFile(f);
  season.players = [...byId.values()];
  const captain = code => latest[code]?.CDM || latest[code]?.ST || null;
  season.demoSheets = Object.fromEntries(season.teams.map(t => [t.code, { club: t.code, formation: '4-3-3', lineup: latest[t.code] || {}, captain: captain(t.code), kit: null }]));
  return season;
}
