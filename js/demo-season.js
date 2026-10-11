// A made-up season for looking at the stats pages before any real match is played (WR-09 on). Never real data: eight invented
// clubs, 11 invented players each and six rounds of results in the same shape a saved result has (js/simulate.js,
// summariseMatch). The league page only uses it with `?demo` for the office or on localhost, and the tests use it too.
// Deterministic: the same call gives the same season.

const CLUBS = [
  ['RED', 'Redfield Lions', '#c8102e'], ['BLU', 'Bluewater Hawks', '#1d4ed8'], ['GRN', 'Greenvale Gators', '#15803d'],
  ['GLD', 'Goldcoast Stars', '#f5c518'], ['NVY', 'Northbay Owls', '#0a1f44'], ['PUR', 'Purple Ridge Foxes', '#7e22ce'],
  ['ORG', 'Orange Park Tigers', '#ea580c'], ['WHT', 'Whitehill Wolves', '#f2f2f2'],
];
const FIRST = ['Alex', 'Ben', 'Cal', 'Dan', 'Eli', 'Finn', 'Gus', 'Hugo', 'Ivan', 'Jack', 'Kai', 'Leo', 'Max', 'Noah', 'Owen', 'Pete', 'Quin', 'Ryan', 'Sam', 'Theo', 'Uri', 'Vic', 'Will', 'Zac'];
const LAST = ['Archer', 'Blake', 'Cole', 'Drake', 'Ellis', 'Ford', 'Grant', 'Hayes', 'Irwin', 'Jones', 'Knight', 'Lowe', 'Moss', 'Nash', 'Owens', 'Pratt', 'Quill', 'Reeve', 'Shaw', 'Tran', 'Voss', 'Wood', 'Young', 'Zane'];
const SHAPE = [['GK', 'GK'], ['DEF', 'LB'], ['DEF', 'LCB'], ['DEF', 'RCB'], ['DEF', 'RB'], ['MID', 'LCM'], ['MID', 'CDM'], ['MID', 'RCM'], ['FWD', 'LW'], ['FWD', 'ST'], ['FWD', 'RW']];
// 24 first names x 24 last names: 11 players a club, 8 clubs, and no two players share a name (11 is coprime with 24).
const nameOf = k => `${FIRST[k % 24]} ${LAST[(k % 24 * 7 + Math.floor(k / 24) * 11) % 24]}`;
const GOAL_WEIGHT = { GK: 0, DEF: 1, MID: 3, FWD: 8 }, ASSIST_WEIGHT = { GK: 0, DEF: 1, MID: 5, FWD: 4 };

export function demoSeason({ rounds = 6 } = {}) {
  let seed = 20261011;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (weights) => { let t = rnd() * weights.reduce((a, b) => a + b, 0); return weights.findIndex(w => (t -= w) < 0); };
  const dec = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

  const teams = CLUBS.map(([code, name, colour], i) => ({ code, name, short_name: name.split(' ')[0], colour, strength: 0.75 + ((i * 7) % 8) * 0.07 }));
  const squads = Object.fromEntries(teams.map((t, i) => [t.code, SHAPE.map(([line, slot], n) => ({
    id: `${t.code}${n}`, name: nameOf(i * 11 + n), line, slot, form: 0.7 + rnd() * 0.6,
  }))]));

  const side = (t, goalsFor, goalsAgainst, shotsAgainst) => {
    const xi = squads[t.code];
    const scorers = Array.from({ length: goalsFor }, () => pick(xi.map(p => GOAL_WEIGHT[p.line] * p.form)));
    const assisters = scorers.map(s => { const w = xi.map((p, i) => (i === s ? 0 : ASSIST_WEIGHT[p.line] * p.form)); return rnd() < 0.7 ? pick(w) : -1; });
    const red = rnd() < 0.07 ? 1 + Math.floor(rnd() * 10) : -1;
    const players = {};
    xi.forEach((p, i) => {
      const gk = p.line === 'GK', att = p.line === 'FWD' ? 1 : p.line === 'MID' ? 0.55 : 0.18, def = p.line === 'DEF' ? 1 : p.line === 'MID' ? 0.6 : gk ? 0 : 0.2;
      const g = scorers.filter(s => s === i).length, a = assisters.filter(s => s === i).length;
      const sh = gk ? 0 : Math.round(rnd() * 3.5 * att + g), pas = Math.round((gk ? 18 : 30 + rnd() * 30) * (p.line === 'MID' ? 1.4 : 1));
      players[p.id] = {
        name: p.name, team: t.code, slot: p.slot, min: i === red ? 25 + Math.floor(rnd() * 50) : 90, g, a, og: 0,
        sh, sot: Math.min(sh, Math.round(sh * 0.45 + g)), xg: dec(sh * 0.11 + g * 0.2), kp: Math.round(rnd() * 2.2 * att + a), pas, pc: Math.round(pas * (0.7 + rnd() * 0.22)),
        tk: Math.round(rnd() * 3 * def), int: Math.round(rnd() * 2.4 * def), clr: Math.round(rnd() * 4 * (p.line === 'DEF' ? 1 : 0.1)), blk: Math.round(rnd() * 1.6 * def),
        sv: gk ? Math.max(0, shotsAgainst - goalsAgainst) : 0, gc: gk || p.line === 'DEF' ? goalsAgainst : 0, yc: rnd() < 0.12 ? 1 : 0, rc: i === red ? 1 : 0,
        km: dec(8 + rnd() * 3, 1), fl: Math.round(rnd() * 2 * (0.5 + def)), fd: Math.round(rnd() * 2), dr: Math.round(rnd() * 3 * att), aw: Math.round(rnd() * 1.5 * def),
        off: p.line === 'FWD' ? Math.round(rnd() * 1.5) : 0, cr: Math.round(rnd() * 2.5 * (p.slot.match(/^[LR][BW]$/) ? 1.5 : 0.3)), tch: Math.round(pas * 1.7), pw: 0, pcn: 0,
        r: dec(Math.min(9.6, Math.max(4.5, 6.4 + g * 1 + a * 0.7 + (gk ? (shotsAgainst - goalsAgainst) * 0.15 - goalsAgainst * 0.25 : (rnd() - 0.4) * 1.1) + (i === red ? -1.5 : 0))), 1),
      };
    });
    return players;
  };

  const fixtures = [];
  const codes = teams.map(t => t.code);
  for (let w = 1; w <= rounds; w++) {
    const order = [codes[0], ...codes.slice(1).map((_, i) => codes[1 + ((i + w - 1) % 7)])];
    for (let m = 0; m < 4; m++) {
      const home = teams.find(t => t.code === order[m]), away = teams.find(t => t.code === order[7 - m]);
      const lam = [1.7 * home.strength / away.strength, 1.4 * away.strength / home.strength];
      const goals = lam.map(l => { let n = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s && n < 8) { n++; p *= l / n; s += p; } return n; });
      const shots = [goals[0] * 3 + 6 + Math.floor(rnd() * 8), goals[1] * 3 + 5 + Math.floor(rnd() * 8)];
      const ph = side(home, goals[0], goals[1], Math.round(shots[1] * 0.4)), pa = side(away, goals[1], goals[0], Math.round(shots[0] * 0.4));
      const sum = (pl, k) => Object.values(pl).reduce((n, p) => n + p[k], 0);
      const team = (pl, i) => ({
        goals: goals[i], xg: dec(sum(pl, 'xg')), possession: dec(i ? 100 - 50 - (home.strength - away.strength) * 12 : 50 + (home.strength - away.strength) * 12, 1),
        shots: shots[i], shots_on_target: sum(pl, 'sot'), big_chances: Math.round(sum(pl, 'xg') / 0.4), passes: sum(pl, 'pas'), passes_completed: sum(pl, 'pc'),
        crosses: sum(pl, 'cr'), tackles_won: sum(pl, 'tk'), interceptions: sum(pl, 'int'), clearances: sum(pl, 'clr'), blocks: sum(pl, 'blk'), saves: sum(pl, 'sv'),
        fouls: sum(pl, 'fl'), yellow_cards: sum(pl, 'yc'), red_cards: sum(pl, 'rc'), corners: Math.round(rnd() * 8), offsides: sum(pl, 'off'),
      });
      fixtures.push({
        id: `demo-${w}-${m}`, week: w, round: `Round ${w}`, home: home.code, away: away.code, date: `2026-10-${String(10 + w * 2).padStart(2, '0')}`, time: '19:00',
        result: { home: goals[0], away: goals[1], players: { ...ph, ...pa }, stats: { home: team(ph, 0), away: team(pa, 1) } },
      });
    }
  }
  return { league: 'vLeague', season: 1, teams: teams.map(({ strength, ...t }) => t), fixtures };
}
