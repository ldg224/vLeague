// Win chance (0.34): who is likely to win a match, worked out from several things at once. No page code, no database code.
//
//   winChance(season, fx, { sheets, now }) -> { home, draw, away (0..1, add up to 1), xg: [home, away], basis, factors }
//
// How it works. Each side gets an expected number of goals (xG); the chances of every score from 0-0 to 10-10 then come from two
// Poisson distributions, and adding up the scores gives the win, draw and loss chances. The expected goals blend:
//   1. Squad quality: the starting XI's attack and defence ratings (the locked line-up once the week's sheets are out, otherwise
//      each club's best 4-3-3), with each position weighted by how much it matters for attack or defence.
//   2. Results so far: goals scored and conceded per game, pulled toward the league average while a club has played few games.
//      Results count for more as the season goes on, squad quality for more at the start.
//   3. Form: the last five results against what the table said to expect.
//   4. Home ground: how much more the home side scores in this league (measured, with a sensible start before there is data).
//   5. Head to head: a small nudge from this season's meetings of the same two clubs.
// Everything is recomputed from the season as it stood before the match, so it moves as results, line-ups and form change.
import { ladder, finished, kickoff } from './dashboard-data.js';

const SHRINK = 3;          // games' worth of league-average goals mixed into every club's scoring and conceding rates
const RATING_POWER = 1.0;  // how strongly rating differences move expected goals (not yet tuned against real matches; see docs/PLAN.md)
const START_HOME = 1.08;   // home bonus before the league has any results
const START_GOALS = 1.5;   // goals per team per game before the league has any results
const MAX_GOALS = 10;

// Which positions matter for attack and for defence (weights), and the 4-3-3 shape used when there is no line-up.
const ATT_W = { GK: 0, DEF: 0.4, MID: 1, FWD: 1.6 };
const DEF_W = { GK: 1.6, DEF: 1.4, MID: 0.8, FWD: 0.3 };
const SHAPE = { GK: 1, DEF: 4, MID: 3, FWD: 3 };

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const wavg = (rows, f, w) => { const tw = rows.reduce((s, r) => s + w[r.position], 0); return tw ? rows.reduce((s, r) => s + f(r) * w[r.position], 0) / tw : 0; };

// The eleven who count for a club: the locked sheet's line-up if there is one, else the best 4-3-3 by rating.
export function startingXI(code, players, sheet) {
  const mine = players.filter(p => p.team === code);
  const byId = new Map(mine.map(p => [p.id, p]));
  const ids = Object.values(sheet?.lineup || {}).filter(Boolean);
  const picked = ids.map(id => byId.get(id)).filter(Boolean);
  if (picked.length >= 11) return { xi: picked.slice(0, 11), fromSheet: true };
  const xi = [];
  for (const [pos, n] of Object.entries(SHAPE)) xi.push(...mine.filter(p => p.position === pos).sort((a, b) => b.offense + b.defense - (a.offense + a.defense)).slice(0, n));
  return { xi, fromSheet: false };
}

// Attack and defence ratings (1 to 10) for a club.
export function squadRatings(code, players, sheet) {
  const { xi, fromSheet } = startingXI(code, players, sheet);
  if (xi.length < 8) return { att: null, def: null, fromSheet: false, size: 0 };   // a half-drafted squad says nothing yet
  return { att: wavg(xi, p => p.offense, ATT_W), def: wavg(xi, p => p.defense, DEF_W), fromSheet, size: xi.length };
}

// The league so far, before `fx`: goals per team per game, home bonus, each club's rates and form.
function leagueState(season, fx, now) {
  const past = finished(season, now).filter(f => !f.stage && !f.exhibition && f.id !== fx.id && (!kickoff(fx) || kickoff(f) < kickoff(fx)));
  const games = past.length;
  const goals = past.reduce((s, f) => s + f.result.home + f.result.away, 0);
  const perTeam = games ? goals / (games * 2) : START_GOALS;
  const hg = past.reduce((s, f) => s + f.result.home, 0), ag = past.reduce((s, f) => s + f.result.away, 0);
  // The home bonus is measured, but pulled toward the starting value until there are a good few games.
  const raw = hg && ag ? hg / ag : START_HOME, home = (raw * games + START_HOME * 8) / (games + 8);
  const rate = {};
  for (const t of season.teams) rate[t.code] = { p: 0, gf: 0, ga: 0, pts: 0, form: [] };
  for (const f of past) {
    for (const [c, gf, ga] of [[f.home, f.result.home, f.result.away], [f.away, f.result.away, f.result.home]]) {
      const r = rate[c]; if (!r) continue;
      r.p++; r.gf += gf; r.ga += ga; r.form.push(gf > ga ? 1 : gf < ga ? 0 : 0.5);
    }
  }
  return { past, games, perTeam, home, rate };
}

// Poisson probabilities for 0..MAX_GOALS goals.
const poisson = l => { const out = [Math.exp(-l)]; for (let k = 1; k <= MAX_GOALS; k++) out.push(out[k - 1] * l / k); return out; };

export function winChance(season, fx, { sheets = [], now = new Date() } = {}) {
  const players = season.players || [];
  const L = leagueState(season, fx, now);
  const sheetOf = c => sheets.find(s => s.week === fx.week && s.club === c) || null;
  const R = { home: squadRatings(fx.home, players, sheetOf(fx.home)), away: squadRatings(fx.away, players, sheetOf(fx.away)) };
  // League averages of the same ratings, so a club is compared with the typical club, not with an absolute number.
  const allR = season.teams.filter(t => !t.withdrawn).map(t => squadRatings(t.code, players, null)).filter(r => r.att != null);
  const lgAtt = avg(allR.map(r => r.att)) || 5, lgDef = avg(allR.map(r => r.def)) || 5;

  const goalsRate = (code, kind) => {            // goals scored (gf) or conceded (ga) per game, shrunk toward the league
    const r = L.rate[code] || { p: 0, gf: 0, ga: 0 };
    return ((r[kind] + SHRINK * L.perTeam) / (r.p + SHRINK)) / L.perTeam;
  };
  const wRes = side => { const p = (L.rate[side]?.p) || 0; return p / (p + 4); };   // how far to trust results over ratings

  // Expected goals for one side attacking the other.
  function expected(att, dfn, atHome) {
    const ra = R[att === fx.home ? 'home' : 'away'], rd = R[dfn === fx.home ? 'home' : 'away'];
    const ratingTerm = ra.att && rd.def ? Math.pow((ra.att / rd.def) / (lgAtt / lgDef), RATING_POWER) : 1;
    const resultTerm = goalsRate(att, 'gf') * goalsRate(dfn, 'ga');
    const w = (wRes(att) + wRes(dfn)) / 2;
    let lnX = (1 - w) * Math.log(ratingTerm) + w * Math.log(resultTerm);
    const f = k => { const a = L.rate[k]?.form || []; return a.length ? avg(a.slice(-5)) - 0.5 : 0; };   // -0.5 (lost them all) .. +0.5
    lnX += 0.16 * f(att) - 0.08 * f(dfn);                                                              // form: a small push
    return { lnX, ratingTerm, resultTerm, w };
  }
  const h = expected(fx.home, fx.away, true), a = expected(fx.away, fx.home, false);
  // Head to head this season: the side that has done better in the meetings gets a slight lift.
  const meets = L.past.filter(f => (f.home === fx.home && f.away === fx.away) || (f.home === fx.away && f.away === fx.home));
  let h2h = 0;
  if (meets.length) {
    const d = avg(meets.map(f => (f.home === fx.home ? f.result.home - f.result.away : f.result.away - f.result.home)));
    h2h = Math.max(-0.06, Math.min(0.06, d * 0.03));
  }
  const homeBonus = Math.sqrt(L.home);   // split the home edge: a lift for the home side, a dip for the away side
  const xgH = L.perTeam * Math.exp(h.lnX + h2h) * homeBonus, xgA = L.perTeam * Math.exp(a.lnX - h2h) / homeBonus;
  const lh = Math.min(6, Math.max(0.15, xgH)), la = Math.min(6, Math.max(0.15, xgA));

  const ph = poisson(lh), pa = poisson(la);
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) { const p = ph[i] * pa[j]; if (i > j) home += p; else if (i === j) draw += p; else away += p; }
  const t = home + draw + away;
  const fromSheets = R.home.fromSheet && R.away.fromSheet;
  return {
    home: home / t, draw: draw / t, away: away / t, xg: [lh, la],
    basis: fromSheets ? 'line-ups' : R.home.size && R.away.size ? 'squads' : 'results',
    games: L.games,
    factors: { ratings: R, homeBonus: L.home, h2h: meets.length, resultsWeight: h.w },
  };
}

// Whole percentages that add up to exactly 100 (largest remainder), for showing win / draw / loss side by side.
export function percents({ home, draw, away }) {
  const raw = [home, draw, away].map(x => x * 100), fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) fl[i]++; });
  return fl;
}

// A club's recent results (W/D/L, newest last) and its home-only and away-only records, for the match cards.
export function clubSummary(season, code, now = new Date()) {
  const rows = ladder(season, now), row = rows.find(r => r.team.code === code) || null;
  const games = finished(season, now).filter(f => !f.stage && !f.exhibition && (f.home === code || f.away === code));
  const rec = side => {
    const r = { w: 0, d: 0, l: 0 };
    for (const f of games.filter(f => f[side] === code)) {
      const gf = side === 'home' ? f.result.home : f.result.away, ga = side === 'home' ? f.result.away : f.result.home;
      r[gf > ga ? 'w' : gf < ga ? 'l' : 'd']++;
    }
    return r;
  };
  return { rank: row?.rank ?? null, pts: row?.pts ?? 0, p: row?.p ?? 0, form: row?.form || [], home: rec('home'), away: rec('away') };
}
