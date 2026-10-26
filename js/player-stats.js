// Player pages (player.html): everything a page needs about one player, worked out from the season's saved results. Pure functions, no page code,
// so tests/player-stats.test.mjs can run them without a browser.
//
//   playerView(season, id, { hidden, scope }) -> { player, row, log, groups, ranks } | null
//     player  the league's player ({ id, name, team, position, number, offense, defense, value, ... }), or null when there is no such player
//     row     the player's season totals (js/season-stats.js totals(): apps, min, g, a, ... ratingSum), or null before a match
//     log     one entry per match played, oldest first: { fx, home (was his club at home), opp (club code), gf, ga, res 'W'|'D'|'L', s (his numbers), rating }
//     groups  the detailed stats for the page: [{ title, rows: [{ label, total, per90?, note? }] }], the keeper's own set for a goalkeeper
//     ranks   up to four places in the league's lists (top 10 only): [{ title, rank, of, text }]
// A result the viewer has not opened (spoiler-free) is left out of all of it, as on the league page.
import { countedFixtures, totals, rank, per90, PLAYER_CARDS, MIN_MINUTES, format } from './season-stats.js';

const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const n1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

// One line of the stats list. `key` is summed from the matches; `p90` shows the per-90 figure next to the total.
const R = (label, key, o = {}) => ({ label, key, ...o });
const OUTFIELD = [
  ['Attacking', [R('Goals', 'g', { p90: 2 }), R('Assists', 'a', { p90: 2 }), R('Expected goals (xG)', 'xg', { dp: 2, p90: 2 }), R('Shots', 'sh', { p90: 1 }), R('Shots on target', 'sot', { p90: 1 }),
    R('Chances created', 'kp', { p90: 1 }), R('Dribbles', 'dr', { p90: 1 }), R('Crosses', 'cr', { p90: 1 }), R('Offsides', 'off')]],
  ['Passing', [R('Passes', 'pas', { p90: 1 }), R('Passes completed', 'pc', { p90: 1 }), { label: 'Pass accuracy', calc: t => (t.pas ? `${pct(t.pc, t.pas)}%` : '–') }, R('Touches', 'tch', { p90: 1 })]],
  ['Defending', [R('Tackles won', 'tk', { p90: 1 }), R('Interceptions', 'int', { p90: 1 }), R('Clearances', 'clr', { p90: 1 }), R('Blocks', 'blk', { p90: 1 }), R('Aerial duels won', 'aw', { p90: 1 })]],
  ['Discipline', [R('Fouls committed', 'fl', { p90: 1 }), R('Fouled', 'fd', { p90: 1 }), R('Yellow cards', 'yc'), R('Red cards', 'rc'), R('Penalties won', 'pw'), R('Penalties conceded', 'pcn'), R('Penalties missed', 'pm')]],
];
const KEEPER = [
  ['Goalkeeping', [R('Saves', 'sv', { p90: 1 }), R('Goals conceded', 'gc', { p90: 1 }), { label: 'Save percentage', calc: t => (t.sv + t.gc ? `${pct(t.sv, t.sv + t.gc)}%` : '–') }, R('Clean sheets', 'cs'), R('Clearances', 'clr', { p90: 1 }), R('Penalties conceded', 'pcn')]],
  ['Passing', [R('Passes', 'pas', { p90: 1 }), R('Passes completed', 'pc', { p90: 1 }), { label: 'Pass accuracy', calc: t => (t.pas ? `${pct(t.pc, t.pas)}%` : '–') }, R('Touches', 'tch', { p90: 1 })]],
  ['Discipline', [R('Yellow cards', 'yc'), R('Red cards', 'rc')]],
];

// Which league lists a player may be placed in, most telling first for his position.
const FAVOURITES = {
  GK: ['rating', 'savepct', 'cs', 'sv90', 'gc90', 'minutes'],
  DEF: ['rating', 'tk90', 'int90', 'clr90', 'blk90', 'ga', 'minutes'],
  MID: ['rating', 'ga', 'assists', 'kp', 'pc90', 'dr', 'xg', 'scorers', 'minutes'],
  FWD: ['rating', 'scorers', 'ga', 'g90', 'xg', 'sot90', 'assists', 'minutes'],
};

export function playerView(season, id, { hidden = new Set(), scope = 'season' } = {}) {
  const player = (season?.players || []).find(p => String(p.id) === String(id));
  if (!player) return null;
  const all = season.fixtures.filter(f => f.result?.players && !hidden.has(f.id));
  const counted = countedFixtures(all, scope);
  const { players } = totals(counted);
  const row = players.find(r => String(r.id) === String(id)) || null;

  // The match log takes every finished match he played in (preseason and finals too), in kick-off order.
  const log = [];
  for (const f of all) {
    const s = f.result.players[player.id] ?? f.result.players[String(id)];
    if (!s) continue;
    const home = s.team === f.home, gf = home ? f.result.home : f.result.away, ga = home ? f.result.away : f.result.home;
    log.push({ fx: f, home, opp: home ? f.away : f.home, gf, ga, res: gf > ga ? 'W' : gf < ga ? 'L' : 'D', s, rating: s.r ?? null });
  }
  log.sort((a, b) => String(a.fx.starts_at || a.fx.date || '').localeCompare(String(b.fx.starts_at || b.fx.date || '')) || a.fx.week - b.fx.week);

  const groups = [];
  if (row) {
    const sums = { ...row };
    // Numbers the totals do not keep (penalties missed, distance) come straight from his matches.
    sums.sv = row.saves; sums.gc = row.conceded;   // the totals keep a keeper's saves and goals conceded under longer names
    sums.pm = log.reduce((n, l) => n + (l.s.pm || 0), 0);
    sums.km = log.reduce((n, l) => n + (l.s.km || 0), 0);
    const isKeeper = player.position === 'GK';
    for (const [title, lines] of isKeeper ? KEEPER : OUTFIELD) {
      const rows = lines.map(l => {
        if (l.calc) return { label: l.label, total: l.calc(sums) };
        const total = sums[l.key] || 0;
        return { label: l.label, total: l.dp ? total.toFixed(l.dp) : String(total), ...(l.p90 != null && row.min ? { per90: per90(sums, l.key).toFixed(l.p90) } : {}) };
      }).filter(r => !(r.total === '0' && !r.per90) || /goals|assists|cards/i.test(r.label));
      if (rows.length) groups.push({ title, rows });
    }
    groups.push({ title: 'Playing time', rows: [
      { label: 'Matches', total: String(row.apps) }, { label: 'Minutes', total: String(row.min) },
      ...(sums.km ? [{ label: 'Distance covered', total: `${n1(sums.km)} km`, per90: row.min ? `${n1((sums.km * 90) / row.min)} km` : undefined }] : []),
    ] });
  }

  const ranks = [];
  if (row) {
    for (const cid of FAVOURITES[player.position] || FAVOURITES.MID) {
      const card = PLAYER_CARDS.find(c => c.id === cid);
      if (!card) continue;
      const list = rank(players, card), at = list.find(x => String(x.row.id) === String(id));
      if (at && at.rank <= 10) ranks.push({ title: card.title, rank: at.rank, of: list.length, text: format(at.value, card) });
    }
    ranks.sort((a, b) => a.rank - b.rank);
    ranks.length = Math.min(ranks.length, 5);
  }
  return { player, row, log, groups, ranks, minMinutes: MIN_MINUTES };
}

// The average rating over his matches (one decimal), or null.
export const averageRating = row => (row && row.apps && row.ratingSum ? Math.round((row.ratingSum / row.apps) * 10) / 10 : null);
