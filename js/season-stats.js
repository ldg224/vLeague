// Season stats (WR-08): adds up the season's saved results into player and team totals, and ranks them for the stat cards
// (Overview, Player stats, Team stats). Pure functions, no page code, so it can be tested on its own (tests/season-stats.test.mjs).
//
//   const fixtures = countedFixtures(finished(season));     // finished league matches only
//   const { players, teams } = totals(fixtures);             // one row per player / club
//   rank(players, PLAYER_CARDS.find(c => c.id === 'scorers'))   // [{ row, value, rank }], best first, ties share a rank
//
// A result keeps each player's numbers in short keys (js/simulate.js, summariseMatch): g goals, a assists, min minutes, sh shots,
// sot shots on target, xg, kp key passes, pas / pc passes and completed, tk tackles won, int, clr, blk, sv saves, gc goals
// conceded, yc / rc cards, fl fouls, dr dribbles, aw aerials won, cr crosses, r rating. Matches saved before WR-07 have no
// fl / dr / aw / off / cr / tch, so those count as 0 for them.

// A per-90 or rating list ignores anyone with fewer minutes than this, so a 10-minute cameo can't top it. Nobody is
// substituted in this league (a player plays the whole match unless sent off), so 90 is one full match.
export const MIN_MINUTES = 90;

const PLAYER_SUMS = ['min', 'g', 'a', 'og', 'sh', 'sot', 'xg', 'kp', 'pas', 'pc', 'tk', 'int', 'clr', 'blk', 'yc', 'rc', 'fl', 'fd', 'dr', 'aw', 'off', 'cr', 'tch', 'pw', 'pcn'];
const TEAM_SUMS = ['xg', 'shots', 'shots_on_target', 'big_chances', 'passes', 'passes_completed', 'crosses', 'tackles_won', 'interceptions',
  'clearances', 'saves', 'fouls', 'yellow_cards', 'red_cards', 'corners', 'offsides', 'possession'];
const KEEPER = 'GK';
const NOTE_MIN = `Players with at least ${MIN_MINUTES} minutes played`, NOTE_GK = `Goalkeepers with at least ${MIN_MINUTES} minutes in goal`;

// League matches with a result: not a Test match, not an exhibition round.
// Where a player plays: from the formation slot he was last picked in (GK, LB, LCB, CDM, LCM, LW, ST...).
export const lineOf = slot => (slot === KEEPER ? 'GK' : /B$/.test(slot || '') ? 'DEF' : /(^|[LR])ST$|^[LR]W$|^CF$/.test(slot || '') ? 'FWD' : 'MID');
export const POSITIONS = [['all', 'All'], ['FWD', 'Forwards'], ['MID', 'Midfielders'], ['DEF', 'Defenders'], ['GK', 'Goalkeepers']];

export const countedFixtures = list => list.filter(f => f.result?.players && !f.test && !f.exhibition);

const blank = (keys, extra) => Object.assign(Object.fromEntries(keys.map(k => [k, 0])), extra);

export function totals(fixtures) {
  const players = new Map(), teams = new Map();
  const team = code => teams.get(code) || teams.set(code, blank(TEAM_SUMS, {
    code, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, xga: 0, ratingSum: 0,
  })).get(code);

  for (const f of fixtures) {
    const r = f.result;
    const goals = { [f.home]: r.home, [f.away]: r.away };
    for (const [id, s] of Object.entries(r.players)) {
      const row = players.get(id) || players.set(id, blank(PLAYER_SUMS, {
        id, name: s.name, team: s.team, apps: 0, ratingSum: 0, gkMin: 0, saves: 0, conceded: 0, cs: 0,
      })).get(id);
      row.team = s.team;   // the club it last played for
      row.pos = lineOf(s.slot);
      row.apps++;
      row.ratingSum += s.r || 0;
      for (const k of PLAYER_SUMS) row[k] += s[k] || 0;
      if (s.slot === KEEPER) {
        row.gkMin += s.min || 0;
        row.saves += s.sv || 0;
        row.conceded += s.gc || 0;
        if (!s.gc && (s.min || 0) >= 60) row.cs++;
      }
    }

    for (const side of ['home', 'away']) {
      const code = f[side], other = side === 'home' ? 'away' : 'home', t = team(code), mine = r.stats?.[side] || {}, theirs = r.stats?.[other] || {};
      const gf = goals[code], ga = goals[f[other]];
      t.p++;
      t.gf += gf; t.ga += ga;
      if (gf > ga) t.w++; else if (gf < ga) t.l++; else t.d++;
      if (!ga) t.cs++;
      t.xga += theirs.xg || 0;
      for (const k of TEAM_SUMS) t[k] += mine[k] || 0;
      const own = Object.values(r.players).filter(p => p.team === code);
      t.ratingSum += own.length ? own.reduce((n, p) => n + (p.r || 0), 0) / own.length : 0;
    }
  }

  for (const t of teams.values()) t.pts = t.w * 3 + t.d;
  return { players: [...players.values()], teams: [...teams.values()] };
}

// ---------- values ----------
export const per90 = (row, key) => (row.min ? row[key] * 90 / row.min : 0);
export const perMatch = (row, key) => (row.p ? row[key] / row.p : 0);
const rating = row => (row.apps ? row.ratingSum / row.apps : 0);
const keeperMin = row => row.gkMin;

// ---------- the stat cards ----------
// note: a line the full list shows under its title when the card has a minimum. value(row): the number ranked. dp: decimals shown (and used to decide ties). low: lower is better (goals conceded...); every other
// card, discipline included, lists the most. zero: a 0 can be listed.
// qualifies(row): who may be ranked (default: anyone who played). Player cards give `group` for the Player stats tab headings.
const count = (id, group, title, key, extra = {}) => ({ id, group, title, value: r => r[key], dp: 0, ...extra });
const rate90 = (id, group, title, key, extra = {}) => ({ id, group, title, value: r => per90(r, key), dp: 1, qualifies: r => r.min >= MIN_MINUTES, note: NOTE_MIN, ...extra });
const gk = { qualifies: r => keeperMin(r) >= MIN_MINUTES, note: NOTE_GK };

export const PLAYER_CARDS = [
  count('scorers', 'Top stats', 'Top scorers', 'g'),
  count('assists', 'Top stats', 'Top assists', 'a'),
  { id: 'ga', group: 'Top stats', title: 'Goals + assists', value: r => r.g + r.a, dp: 0 },
  { id: 'rating', group: 'Top stats', title: 'Top rated', value: rating, dp: 1, qualifies: r => r.min >= MIN_MINUTES, note: NOTE_MIN },
  count('minutes', 'Top stats', 'Minutes played', 'min'),

  rate90('g90', 'Attack', 'Goals per 90', 'g', { dp: 2 }),
  { id: 'xg', group: 'Attack', title: 'xG', value: r => r.xg, dp: 2 },
  rate90('xg90', 'Attack', 'xG per 90', 'xg', { dp: 2 }),
  rate90('sh90', 'Attack', 'Shots per 90', 'sh'),
  rate90('sot90', 'Attack', 'Shots on target per 90', 'sot'),
  count('kp', 'Attack', 'Chances created', 'kp'),
  rate90('pc90', 'Attack', 'Accurate passes per 90', 'pc'),
  count('cr', 'Attack', 'Crosses', 'cr'),
  count('dr', 'Attack', 'Dribbles', 'dr'),

  rate90('tk90', 'Defence', 'Tackles won per 90', 'tk'),
  rate90('int90', 'Defence', 'Interceptions per 90', 'int'),
  rate90('clr90', 'Defence', 'Clearances per 90', 'clr'),
  rate90('blk90', 'Defence', 'Blocks per 90', 'blk'),

  { id: 'cs', group: 'Goalkeeping', title: 'Clean sheets', value: r => r.cs, dp: 0, ...gk },
  { id: 'savepct', group: 'Goalkeeping', title: 'Save percentage', value: r => 100 * r.saves / (r.saves + r.conceded), dp: 0, unit: '%',
    qualifies: r => keeperMin(r) >= MIN_MINUTES && r.saves + r.conceded > 0, note: NOTE_GK },
  { id: 'sv90', group: 'Goalkeeping', title: 'Saves per 90', value: r => r.saves * 90 / r.gkMin, dp: 1, ...gk },
  { id: 'gc90', group: 'Goalkeeping', title: 'Goals conceded per 90', value: r => r.conceded * 90 / r.gkMin, dp: 1, low: true, zero: true, ...gk },

  rate90('fl90', 'Discipline', 'Fouls per 90', 'fl'),
  count('yc', 'Discipline', 'Yellow cards', 'yc'),
  count('rc', 'Discipline', 'Red cards', 'rc'),
];

const mean = (id, group, title, key, extra = {}) => ({ id, group, title, value: r => perMatch(r, key), dp: 1, ...extra });
export const TEAM_CARDS = [
  { id: 'trating', group: 'Top stats', title: 'Average rating', value: r => r.ratingSum / r.p, dp: 2 },
  mean('tgoals', 'Top stats', 'Goals per match', 'gf', { dp: 2 }),
  mean('tconceded', 'Top stats', 'Goals conceded per match', 'ga', { dp: 2, low: true, zero: true }),
  { id: 'tposs', group: 'Top stats', title: 'Possession', value: r => r.possession / r.p, dp: 0, unit: '%' },
  { id: 'tcs', group: 'Top stats', title: 'Clean sheets', value: r => r.cs, dp: 0 },

  { id: 'txg', group: 'Attack', title: 'xG', value: r => r.xg, dp: 1 },
  { id: 'txgdiff', group: 'Attack', title: 'xG difference', value: r => r.xg - r.xga, dp: 1, zero: true, signed: true },
  mean('tsot', 'Attack', 'Shots on target per match', 'shots_on_target'),
  { id: 'tbig', group: 'Attack', title: 'Big chances', value: r => r.big_chances, dp: 0 },
  mean('tpc', 'Attack', 'Accurate passes per match', 'passes_completed', { dp: 0 }),
  mean('tcr', 'Attack', 'Crosses per match', 'crosses'),
  { id: 'tcor', group: 'Attack', title: 'Corners', value: r => r.corners, dp: 0 },

  { id: 'txga', group: 'Defence', title: 'xG conceded', value: r => r.xga, dp: 1, low: true, zero: true },
  { id: 'ttk', group: 'Defence', title: 'Tackles won', value: r => r.tackles_won, dp: 0 },
  { id: 'tint', group: 'Defence', title: 'Interceptions', value: r => r.interceptions, dp: 0 },
  mean('tclr', 'Defence', 'Clearances per match', 'clearances'),
  mean('tsv', 'Defence', 'Saves per match', 'saves'),

  mean('tfl', 'Discipline', 'Fouls per match', 'fouls'),
  { id: 'tyc', group: 'Discipline', title: 'Yellow cards', value: r => r.yellow_cards, dp: 0 },
  { id: 'trc', group: 'Discipline', title: 'Red cards', value: r => r.red_cards, dp: 0 },
];

// ---------- what a card says about its leader (the banner on the full page) ----------
// say(value text) finishes the sentence "<name> ...": "Theo Archer is the top scorer with 5 goals". sub(row) is the line under a name
// in the full list; without one it is the number of matches.
const pl = (v, one, many = `${one}s`) => `${v} ${Number(v) === 1 ? one : many}`;
const SAY = {
  scorers: v => `is the top scorer with ${pl(v, 'goal')}`, assists: v => `has the most assists with ${v}`,
  ga: v => `has the most goals and assists with ${v}`, rating: v => `is the top rated player, averaging ${v}`,
  minutes: v => `has played the most minutes, ${v}`, g90: v => `scores the most goals per 90 minutes with ${v}`,
  xg: v => `has the highest xG with ${v}`, xg90: v => `has the highest xG per 90 minutes with ${v}`,
  sh90: v => `takes the most shots per 90 minutes with ${v}`, sot90: v => `has the most shots on target per 90 minutes with ${v}`,
  kp: v => `has created the most chances with ${v}`, pc90: v => `completes the most passes per 90 minutes with ${v}`,
  cr: v => `has delivered the most crosses with ${v}`, dr: v => `has won the most dribbles with ${v}`,
  tk90: v => `wins the most tackles per 90 minutes with ${v}`, int90: v => `makes the most interceptions per 90 minutes with ${v}`,
  clr90: v => `makes the most clearances per 90 minutes with ${v}`, blk90: v => `makes the most blocks per 90 minutes with ${v}`,
  cs: v => `has the most clean sheets with ${v}`, savepct: v => `has the best save percentage with ${v}`,
  sv90: v => `makes the most saves per 90 minutes with ${v}`, gc90: v => `concedes the fewest goals per 90 minutes with ${v}`,
  fl90: v => `commits the most fouls per 90 minutes with ${v}`, yc: v => `has the most yellow cards with ${v}`, rc: v => `has the most red cards with ${v}`,
  trating: v => `have the best average rating, ${v}`, tgoals: v => `score the most goals per match with ${v}`,
  tconceded: v => `concede the fewest goals per match with ${v}`, tposs: v => `have the most possession with ${v}`,
  tcs: v => `have the most clean sheets with ${v}`, txg: v => `have the highest xG with ${v}`, txgdiff: v => `have the best xG difference, ${v}`,
  tsot: v => `have the most shots on target per match with ${v}`, tbig: v => `have created the most big chances with ${v}`,
  tpc: v => `complete the most passes per match with ${v}`, tcr: v => `deliver the most crosses per match with ${v}`,
  tcor: v => `have won the most corners with ${v}`, txga: v => `have conceded the lowest xG, ${v}`,
  ttk: v => `have won the most tackles with ${v}`, tint: v => `have made the most interceptions with ${v}`,
  tclr: v => `make the most clearances per match with ${v}`, tsv: v => `make the most saves per match with ${v}`,
  tfl: v => `commit the most fouls per match with ${v}`, tyc: v => `have the most yellow cards with ${v}`, trc: v => `have the most red cards with ${v}`,
};
const SUB = {
  scorers: r => `${(r.xg || 0).toFixed(1)} xG`, assists: r => pl(r.kp || 0, 'chance created', 'chances created'),
  ga: r => `${pl(r.g || 0, 'goal')}, ${pl(r.a || 0, 'assist')}`,
};
for (const c of [...PLAYER_CARDS, ...TEAM_CARDS]) { c.say = SAY[c.id]; c.sub = SUB[c.id]; }
export const matchesOf = r => pl(r.apps ?? r.p ?? 0, 'match', 'matches');

// ---------- ranking ----------
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

// Rows for a card, best first, each { row, value, rank }. Equal values (as shown, to the card's decimals) share a rank, and
// the next rank skips (1, 1, 3). Rows that don't qualify, can't be worked out, or sit on 0 (unless the card allows it) are left out.
export function rank(rows, card, limit = Infinity) {
  const list = rows
    .filter(r => !card.qualifies || card.qualifies(r))
    .map(row => ({ row, value: round(card.value(row), card.dp ?? 0) }))
    .filter(x => Number.isFinite(x.value) && (card.zero || x.value !== 0))
    .sort((a, b) => (card.low ? a.value - b.value : b.value - a.value) || String(a.row.name || a.row.code).localeCompare(String(b.row.name || b.row.code)));
  list.forEach((x, i) => { x.rank = i && list[i - 1].value === x.value ? list[i - 1].rank : i + 1; });
  return list.slice(0, limit);
}

// What a card's value looks like on screen: "12", "7.4", "63%", "+2.1".
export function format(value, card) {
  const text = card.dp ? value.toFixed(card.dp) : String(value);
  return `${card.signed && value > 0 ? '+' : ''}${text}${card.unit || ''}`;
}
