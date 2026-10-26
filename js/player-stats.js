// Player pages (player.html): everything a page needs about one player, worked out from the season's saved results. Pure functions, no page code,
// so tests/player-stats.test.mjs can run them without a browser.
//
//   playerView(season, id, { hidden, scope }) -> { player, row, log, groups, compare } | null
//     player   the league's player ({ id, name, team, position, number, offense, defense, value, ... }), or null when there is no such player
//     row      the player's season totals (js/season-stats.js totals(): apps, min, g, a, ... ratingSum), or null before a match
//     log      one entry per match played, oldest first: { fx, home (was his club at home), opp (club code), gf, ga, res 'W'|'D'|'L', s (his numbers), rating }
//     groups   the detailed stats: [{ title, rows: [{ label, total, per90?, avg?, cls?, fill?, tick?, low? }] }], the keeper's own set for a goalkeeper.
//              avg is the league average for his position, cls his class for that stat (CLASSES), fill and tick place his figure and the average on a 0-100 bar
//     compare  { eligible, provisional, n, word } how the classes were worked out: eligible once he and MIN_PEERS of his position have MIN_MATCHES; before that, with
//              MIN_PEERS players of 90+ minutes, the classes still show but are marked provisional (line.prov)
// A result the viewer has not opened (spoiler-free) is left out of all of it, as on the league page.
//
// Classes (like the AFL's player ratings): each stat is compared with the other players of his position who have played at least MIN_MINUTES, using the
// per-90 figure (or the percentage for accuracy). Top 10% is Elite (the blue star), the next 20% Great, the middle 40% Average, the next 20% Below average,
// the last 10% Poor. For stats where less is better (goals conceded, fouls, cards, offsides) the order is turned round. Classes only show once
// MIN_PEERS players of his position have played MIN_MATCHES matches and so has he. Before that the classes still show (a first guess from everyone with
// 90 minutes) but are marked provisional, because one game's numbers can be luck. The league average beside each stat is shown from the first match.
import { countedFixtures, totals, per90, MIN_MINUTES } from './season-stats.js';

export const MIN_PEERS = 6;
export const MIN_MATCHES = 3;
export const CLASSES = [['elite', 'Elite', 90], ['great', 'Great', 70], ['avg', 'Average', 30], ['below', 'Below average', 10], ['poor', 'Poor', 0]];
const POS_WORD = { GK: 'goalkeepers', DEF: 'defenders', MID: 'midfielders', FWD: 'forwards' };
const n1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const KEYS = { sv: 'saves', gc: 'conceded' };   // the totals keep a keeper's saves and goals conceded under longer names
const cell = (r, key) => r[KEYS[key] || key] || 0;

// One line of the list. rate: show and class the per-90 figure; pct: a percentage worked out from the totals; low: less is better;
// dp: decimals of the per-90 figure (and of the total when `tdp` is not given); plain lines (no rate, no pct) show a total only.
const L = (label, key, o = {}) => ({ label, key, ...o });
const ACC = { label: 'Pass accuracy', pct: r => (r.pas ? (100 * r.pc) / r.pas : null) };
const OUTFIELD = [
  ['Attacking', [L('Goals', 'g', { rate: 1, dp: 2 }), L('Assists', 'a', { rate: 1, dp: 2 }), L('Expected goals (xG)', 'xg', { rate: 1, dp: 2, tdp: 2 }), L('Shots', 'sh', { rate: 1, dp: 1 }),
    L('Shots on target', 'sot', { rate: 1, dp: 1 }), L('Chances created', 'kp', { rate: 1, dp: 1 }), L('Dribbles', 'dr', { rate: 1, dp: 1 }), L('Crosses', 'cr', { rate: 1, dp: 1 }),
    L('Offsides', 'off', { rate: 1, dp: 1, low: 1 })]],
  ['Passing', [L('Passes', 'pas', { rate: 1, dp: 1 }), L('Passes completed', 'pc', { rate: 1, dp: 1 }), ACC, L('Touches', 'tch', { rate: 1, dp: 1 })]],
  ['Defending', [L('Tackles won', 'tk', { rate: 1, dp: 1 }), L('Interceptions', 'int', { rate: 1, dp: 1 }), L('Clearances', 'clr', { rate: 1, dp: 1 }), L('Blocks', 'blk', { rate: 1, dp: 1 }),
    L('Aerial duels won', 'aw', { rate: 1, dp: 1 })]],
  ['Discipline', [L('Fouls committed', 'fl', { rate: 1, dp: 1, low: 1 }), L('Fouled', 'fd', { rate: 1, dp: 1 }), L('Yellow cards', 'yc', { rate: 1, dp: 2, low: 1 }), L('Red cards', 'rc'),
    L('Penalties won', 'pw'), L('Penalties conceded', 'pcn'), L('Penalties missed', 'pm')]],
];
const KEEPER = [
  ['Goalkeeping', [L('Saves', 'sv', { rate: 1, dp: 1 }), L('Goals conceded', 'gc', { rate: 1, dp: 1, low: 1 }),
    { label: 'Save percentage', pct: r => (r.saves + r.conceded ? (100 * r.saves) / (r.saves + r.conceded) : null) }, L('Clean sheets', 'cs'), L('Clearances', 'clr', { rate: 1, dp: 1 }), L('Penalties conceded', 'pcn')]],
  ['Passing', [L('Passes', 'pas', { rate: 1, dp: 1 }), L('Passes completed', 'pc', { rate: 1, dp: 1 }), ACC, L('Touches', 'tch', { rate: 1, dp: 1 })]],
  ['Discipline', [L('Yellow cards', 'yc', { rate: 1, dp: 2, low: 1 }), L('Red cards', 'rc')]],
];

// The class for a figure among its peers' figures (his own included): where he stands from 0 (worst) to 100 (best), ties sharing the middle.
export function classOf(values, v, low = false) {
  const worse = values.filter(x => (low ? x > v : x < v)).length, same = values.filter(x => x === v).length;
  const place = ((worse + same / 2) / values.length) * 100;
  return { place, cls: CLASSES.find(([, , from]) => place >= from)[0] };
}

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
  let compare = { eligible: false, n: 0, word: POS_WORD[player.position] || 'players' };
  if (row) {
    const sums = { ...row, pm: log.reduce((n, l) => n + (l.s.pm || 0), 0) };
    const km = log.reduce((n, l) => n + (l.s.km || 0), 0);
    // His peers: players of the position he played, with enough minutes. A keeper's minutes are his minutes in goal.
    const minutes = r => (r.pos === 'GK' ? r.gkMin : r.min);
    const peers = players.filter(r => r.pos === row.pos && minutes(r) >= MIN_MINUTES);
    const seasoned = peers.filter(r => r.apps >= MIN_MATCHES);
    const enough = minutes(row) >= MIN_MINUTES && peers.length >= MIN_PEERS;
    compare = { eligible: enough && row.apps >= MIN_MATCHES && seasoned.length >= MIN_PEERS, provisional: false, n: peers.length, seasoned: seasoned.length, apps: row.apps, word: POS_WORD[row.pos] || 'players' };
    const valueOf = (l, r) => (l.pct ? l.pct(r) : l.rate && r.min ? per90({ min: r.min, [l.key]: cell(r, l.key) }, l.key) : null);
    const show = (v, l) => (v == null ? '–' : l.pct ? `${Math.round(v)}%` : v.toFixed(l.dp ?? 1));
    const isKeeper = row.pos === 'GK';

    for (const [title, lines] of isKeeper ? KEEPER : OUTFIELD) {
      const out = [];
      for (const l of lines) {
        const total = l.pct ? null : cell(sums, l.key);
        const mine = valueOf(l, row);
        const line = { label: l.label, total: l.pct ? show(mine, l) : l.tdp ? total.toFixed(l.tdp) : String(total) };
        if (l.rate && mine != null) line.per90 = show(mine, l);
        if ((l.rate || l.pct) && mine != null) {
          const vals = peers.map(r => valueOf(l, r)).filter(x => x != null);
          const sv = seasoned.map(r => valueOf(l, r)).filter(x => x != null);
          if (vals.length) {
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length, top = Math.max(...vals, mine, 1e-9);
            line.avg = show(avg, l);
            line.fill = Math.round((mine / top) * 100);
            line.tick = Math.round((avg / top) * 100);
            if (l.low) line.low = true;
            // Settled classes compare him with players who have played 3+ matches; before that the class is a first guess from everyone with 90 minutes, marked provisional.
            if (compare.eligible) line.cls = classOf(sv, mine, Boolean(l.low)).cls;
            else if (enough) { line.cls = classOf(vals, mine, Boolean(l.low)).cls; line.prov = true; compare.provisional = true; }
          }
        }
        // A stat he has none of, and that the league's average also rounds to nothing, stays off the list (a forward's clearances); goals and assists always show.
        if (Number(line.total) === 0 && !/^(goals|assists)$/i.test(l.label) && !(parseFloat(line.avg) >= 0.05)) continue;
        out.push(line);
      }
      if (out.length) groups.push({ title, rows: out });
    }
    groups.push({ title: 'Playing time', rows: [
      { label: 'Matches', total: String(row.apps) }, { label: 'Minutes', total: String(row.min) },
      ...(km ? [{ label: 'Distance covered', total: `${n1(km)} km`, per90: row.min ? `${n1((km * 90) / row.min)} km` : undefined }] : []),
    ] });
  }

  return { player, row, log, groups, compare, scope, minMinutes: MIN_MINUTES };
}

// The average rating over his matches (one decimal), or null.
export const averageRating = row => (row && row.apps && row.ratingSum ? Math.round((row.ratingSum / row.apps) * 10) / 10 : null);
