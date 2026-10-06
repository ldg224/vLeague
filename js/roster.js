// Roster logic for the Editor's Fixtures tab (0.20), kept apart from the page so it can be tested on its own:
// Melbourne times, round robins, week patterns, pairing the next week from the weeks already planned, moving and
// renumbering weeks, round labels, and the checks that find problems in a roster. Nothing here touches the page or the database.

export const WEEK_MAX = 99;
export const ZONE = 'Australia/Melbourne';

// ---------------------------------------------------------------- Melbourne time
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const partsOf = d => Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));

// Melbourne wall-clock ("2026-10-12", "19:30") to an ISO instant, correct across daylight saving.
export function melbourneToIso(date, time) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 2; i++) {   // shift by however far Melbourne's clock reads from what we asked for
    const p = partsOf(new Date(t));
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return new Date(t).toISOString();
}
export const toLocalInput = iso => { if (!iso) return ''; const p = partsOf(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export const dateOf = iso => toLocalInput(iso).slice(0, 10);
export const timeOf = iso => toLocalInput(iso).slice(11, 16);
export const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMinutes = (time, mins) => { const [h, m] = time.split(':').map(Number); const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
export const weekdayOf = date => new Date(`${date}T12:00:00Z`).getUTCDay();   // 0 = Sunday
export const mondayOf = date => addDays(date, -((weekdayOf(date) + 6) % 7));
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

// Move a kick-off by whole days, keeping its Melbourne clock time even across daylight saving.
export const shiftIso = (iso, days) => melbourneToIso(addDays(dateOf(iso), days), timeOf(iso));

// ---------------------------------------------------------------- round robin and week patterns
// Round robin by the circle method: every club plays every other once; an odd number of clubs gets a bye each week.
export function roundRobin(codes, double = false) {
  const teams = [...codes];
  if (teams.length % 2) teams.push(null);
  const n = teams.length, weeks = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i], b = teams[n - 1 - i];
      if (a && b) games.push(r % 2 ? [b, a] : [a, b]);   // home and away swap on alternate weeks, to keep it fair
    }
    weeks.push(games);
    teams.splice(1, 0, teams.pop());
  }
  return double ? [...weeks, ...weeks.map(w => w.map(([a, b]) => [b, a]))] : weeks;
}

// One week's games spread over the blocks in order. A block with games = 0 (and the last block) takes whatever is left.
// Each block starts on its weekday on or after `base`; its games are `gap` minutes apart.
export function placeWeek(games, base, wins) {
  const out = [], left = [...games], baseDay = weekdayOf(base);
  wins.forEach((w, i) => {
    const n = (w.games > 0 && i < wins.length - 1) ? Math.min(w.games, left.length) : left.length;
    const day = addDays(base, (w.day - baseDay + 7) % 7);
    left.splice(0, n).forEach(([h, a], k) => out.push({ h, a, win: i, at: melbourneToIso(day, addMinutes(w.time, k * w.gap)) }));
  });
  return out;
}

// Work the blocks a week was played in back out of its kick-off times: one block per day, in order, with the first
// kick-off, the games that day and the usual gap. The last block takes whatever is left (games 0), like a pattern does.
export function inferBlocks(isoTimes) {
  const times = isoTimes.filter(Boolean).sort();
  if (!times.length) return null;
  const days = new Map();
  for (const t of times) { const d = dateOf(t); if (!days.has(d)) days.set(d, []); days.get(d).push(t); }
  const blocks = [...days.entries()].map(([d, ts]) => {
    const gaps = ts.slice(1).map((t, i) => Math.round((new Date(t) - new Date(ts[i])) / 60000)).filter(g => g > 0);
    const freq = new Map(); gaps.forEach(g => freq.set(g, (freq.get(g) || 0) + 1));
    const gap = gaps.length ? [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : 90;
    return { day: weekdayOf(d), time: timeOf(ts[0]), games: ts.length, gap: Math.min(600, gap) };
  });
  blocks[blocks.length - 1].games = 0;
  return blocks;
}

// ---------------------------------------------------------------- the weeks that exist, and their labels
// Every week number that has a match or a round, in order.
export function weekNumbers(fixtures, rounds = []) {
  return [...new Set([...fixtures.map(f => f.week), ...rounds.map(r => r.week)])].sort((a, b) => a - b);
}

// How each week is called. A numbered week is "Round N", where N is its count among numbered weeks (or the number
// you picked); a week without a number shows only its name. `short` is what fits on a small tab.
export function roundLabels(weeks, rounds) {
  const byWeek = new Map((rounds || []).map(r => [r.week, r]));
  const out = new Map();
  let count = 0;
  for (const w of weeks) {
    const r = byWeek.get(w) || {};
    const numbered = r.numbered !== false;
    if (numbered) count++;
    const no = numbered ? (r.number_override ?? count) : null;
    const base = numbered ? `Round ${no}` : (r.kind === 'finals' ? 'Finals' : 'Special round');
    out.set(w, { no, numbered, name: r.name || null, label: r.name ? (numbered ? `${base} · ${r.name}` : r.name) : base, short: numbered ? String(no) : '★' });
  }
  return out;
}

// ---------------------------------------------------------------- moving weeks around
// Each builder returns a map of { oldWeek: newWeek } for the database function office_move_weeks (every week keeps its
// matches, name, look and lock rule). `weeks` is the sorted list of week numbers in use.
export const mapSwap = (a, b) => (a === b ? {} : { [a]: b, [b]: a });

// Take the week at `from` and drop it into the place of the week at `to`; the weeks between slide along. The same
// week numbers stay in use, so a gap in the numbering stays where it is.
export function mapReorder(weeks, from, to) {
  const i = weeks.indexOf(from), j = weeks.indexOf(to);
  if (i < 0 || j < 0 || i === j) return {};
  const order = [...weeks]; order.splice(i, 1); order.splice(j, 0, from);
  const map = {};
  order.forEach((w, k) => { if (w !== weeks[k]) map[w] = weeks[k]; });
  return map;
}

// Open a gap: week `at` and every week after it move up by `n`. Null when it would go past week 99.
export function mapInsertGap(weeks, at, n = 1) {
  const later = weeks.filter(w => w >= at);
  if (!later.length) return {};
  if (later[later.length - 1] + n > WEEK_MAX) return null;
  return Object.fromEntries(later.map(w => [w, w + n]));
}

// Close the gaps: the weeks become start, start+1, start+2... in their current order.
export function mapCompact(weeks, start = 1) {
  const map = {};
  weeks.forEach((w, k) => { if (w !== start + k) map[w] = start + k; });
  return start + weeks.length - 1 > WEEK_MAX ? null : map;
}

// Put the weeks in order of their first kick-off (weeks with no times keep their place relative to each other, last).
export function mapByDate(weeks, firstKick) {
  const order = [...weeks].sort((a, b) => {
    const x = firstKick.get(a), y = firstKick.get(b);
    if (x && y) return x < y ? -1 : x > y ? 1 : a - b;
    return x ? -1 : y ? 1 : a - b;
  });
  const map = {};
  order.forEach((w, k) => { if (w !== weeks[k]) map[w] = weeks[k]; });
  return map;
}

// Reverse the whole order.
export function mapReverse(weeks) {
  const map = {};
  weeks.forEach((w, k) => { const to = weeks[weeks.length - 1 - k]; if (to !== w) map[w] = to; });
  return map;
}

export const invertMap = map => Object.fromEntries(Object.entries(map).map(([a, b]) => [b, Number(a)]));

// ---------------------------------------------------------------- what has been played between whom
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Read the roster for pairing: how often each pair has met (and when last), each club's home and away games, byes and
// recent venues. Only weeks before `before` count, so a week can be re-planned from what came before it.
// byeMap (from byeMapOf) is the byes the office has set: week -> Set of club codes. A week with some set counts exactly
// those; a week with none falls back to guessing (a club that sat out a week where nearly everyone else played).
export const byeMapOf = (rounds = []) => new Map(rounds.filter(r => r.byes?.length).map(r => [r.week, new Set(r.byes)]));
export function statsOf(fixtures, codes, before = Infinity, byeMap = null) {
  const meet = new Map(), last = new Map(), lastHome = new Map(), home = new Map(), away = new Map(), byes = new Map(), lastBye = new Map(), venues = new Map();
  codes.forEach(c => { home.set(c, 0); away.set(c, 0); byes.set(c, 0); venues.set(c, []); });
  const used = fixtures.filter(f => f.week < before);
  const weeks = [...new Set(used.map(f => f.week))].sort((a, b) => a - b);
  for (const w of weeks) {
    const games = used.filter(f => f.week === w).sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
    for (const f of games) {
      const k = pairKey(f.home, f.away);
      meet.set(k, (meet.get(k) || 0) + 1); last.set(k, w); lastHome.set(k, f.home);
      if (home.has(f.home)) { home.set(f.home, home.get(f.home) + 1); venues.get(f.home).push('H'); }
      if (away.has(f.away)) { away.set(f.away, away.get(f.away) + 1); venues.get(f.away).push('A'); }
    }
    const playing = new Set(games.flatMap(f => [f.home, f.away])), set = byeMap?.get(w);
    if (set) { for (const c of codes) if (set.has(c) && !playing.has(c)) { byes.set(c, byes.get(c) + 1); lastBye.set(c, w); } }
    // Otherwise a bye only counts in a week where nearly everyone played (a short week of two games is a choice, not a bye).
    else if (games.length * 2 >= codes.length - 1) {
      for (const c of codes) if (!playing.has(c)) { byes.set(c, byes.get(c) + 1); lastBye.set(c, w); }
    }
  }
  return { meet, last, lastHome, home, away, byes, lastBye, venues, weeks };
}

// ---------------------------------------------------------------- pairing the next week
// A small seeded random number generator, so "Re-roll" gives a new shuffle and the same seed gives the same week.
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The cheapest way to pair everyone up. Up to 22 clubs it is exact (every pairing is considered); more than that it
// starts from a greedy pairing and keeps swapping partners while that gets cheaper.
function bestMatching(n, cost) {
  if (n === 0) return [];
  if (n <= 22) {
    const size = 1 << n, best = new Float64Array(size).fill(Infinity), pick = new Int32Array(size).fill(-1);
    best[0] = 0;
    for (let mask = 0; mask < size - 1; mask++) {
      const cur = best[mask];
      if (cur === Infinity) continue;
      let i = 0; while (mask & (1 << i)) i++;
      for (let j = i + 1; j < n; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << i) | (1 << j), v = cur + cost(i, j);
        if (v < best[next]) { best[next] = v; pick[next] = i * 32 + j; }
      }
    }
    const pairs = [];
    for (let mask = size - 1; mask > 0;) { const p = pick[mask]; const i = p >> 5, j = p & 31; pairs.push([i, j]); mask &= ~((1 << i) | (1 << j)); }
    return pairs;
  }
  const left = [...Array(n).keys()], pairs = [];
  while (left.length) {
    const i = left.shift();
    let bj = 0; left.forEach((j, k) => { if (cost(i, j) < cost(i, left[bj])) bj = k; });
    pairs.push([i, left.splice(bj, 1)[0]]);
  }
  for (let pass = 0, improved = true; improved && pass < 50; pass++) {
    improved = false;
    for (let x = 0; x < pairs.length; x++) for (let y = x + 1; y < pairs.length; y++) {
      const [a, b] = pairs[x], [c, d] = pairs[y], now = cost(a, b) + cost(c, d);
      if (cost(a, c) + cost(b, d) < now - 1e-9) { pairs[x] = [a, c]; pairs[y] = [b, d]; improved = true; }
      else if (cost(a, d) + cost(b, c) < now - 1e-9) { pairs[x] = [a, d]; pairs[y] = [b, c]; improved = true; }
    }
  }
  return pairs;
}

// Try to pair `nodes` with nobody paired twice and every pair allowed by ok(a, b), picking at random so repeated tries
// find different answers. Null when it can't be done (or takes too long to find out).
function randomPerfect(nodes, ok, rand) {
  const left = new Set(nodes), pairs = [];
  let steps = 0;
  const go = () => {
    if (!left.size) return true;
    if (++steps > 20000) return false;
    let best = null, bestN = null;
    for (const a of left) {
      const n = nodes.filter(b => b !== a && left.has(b) && ok(a, b));
      if (!n.length) return false;
      if (!best || n.length < bestN.length) { best = a; bestN = n; }
    }
    for (let i = bestN.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bestN[i], bestN[j]] = [bestN[j], bestN[i]]; }
    left.delete(best);
    for (const b of bestN) { left.delete(b); pairs.push([best, b]); if (go()) return true; pairs.pop(); left.add(b); }
    left.add(best);
    return false;
  };
  return go() ? pairs : null;
}

// Whether the games still to be played (pairs where ok(a, b)) can be spread over weeks without a rematch, looking
// `depth` weeks ahead. With an odd number of clubs one sits out each week.
function canFinish(nodes, ok, depth, rand) {
  if (!nodes.some((a, i) => nodes.slice(i + 1).some(b => ok(a, b)))) return true;
  for (let t = 0; t < 10; t++) {
    let m = null;
    if (nodes.length % 2 === 0) m = randomPerfect(nodes, ok, rand);
    else for (const v of [...nodes].sort(() => rand() - 0.5)) { m = randomPerfect(nodes.filter(x => x !== v), ok, rand); if (m) break; }
    if (!m) return false;
    if (depth <= 1) return true;
    const used = new Set(m.map(([a, b]) => pairKey(a, b)));
    if (canFinish(nodes, (a, b) => ok(a, b) && !used.has(pairKey(a, b)), depth - 1, rand)) return true;
  }
  return false;
}

// Pair up the clubs for one week, learning from the weeks already in `fixtures` (only weeks before `week` count).
//   codes      the clubs that may play
//   rest       clubs that must sit this week out
//   fixed      [[home, away], ...] games already decided; their clubs aren't paired again
//   avoid      how strongly to avoid rematches: 'strict' (rematch only when there's no choice), 'normal'
//   recent     weeks within which a rematch is least wanted
//   byeWeeks   the byes already set (byeMapOf), so the bye rotation counts them
// Everyone is paired with someone new while that is possible, looking ahead so the last weeks of a round robin still
// work out; after that (a second round) the pairs that met longest ago come first. Returns
// { games: [[home, away], ...], byes: [codes], rematches, fresh }.
export function pairWeek({ codes, fixtures, week = Infinity, rest = [], fixed = [], seed = 1, recent = 4, avoid = 'normal', byeWeeks = null }) {
  const rand = rng(seed), st = statsOf(fixtures, codes, week, byeWeeks);
  const fixedClubs = new Set(fixed.flat()), resting = new Set(rest);
  const base = codes.filter(c => !fixedClubs.has(c) && !resting.has(c));
  const byes = [...resting].filter(c => codes.includes(c));
  const met = (a, b) => st.meet.get(pairKey(a, b)) || 0;
  const unmet = (a, b) => !met(a, b);
  // Who sits out if the number is odd: the fewest byes so far, then whoever has waited longest.
  const byeScore = c => (st.byes.get(c) || 0) * 1000 - (week - (st.lastBye.get(c) ?? -99)) * 3 + rand() * 2;
  const byeOrder = base.length % 2 ? [...base].sort((a, b) => byeScore(a) - byeScore(b)) : [null];

  const costFor = pool => (i, j) => {
    const a = pool[i], b = pool[j], m = met(a, b);
    let c = m * m * 10000 * (avoid === 'strict' ? 4 : 1);
    if (m) { const gap = week - (st.last.get(pairKey(a, b)) ?? -99); if (gap <= recent) c += (recent - gap + 1) * 400; }
    return c + rand() * 60;
  };
  let pairs = null, out = byeOrder[0];
  // Late in a round robin only a few new opponents are left per club, so search for a week of all-new pairings that
  // leaves the following weeks workable.
  const degree = c => codes.filter(x => x !== c && unmet(c, x)).length;
  if (base.length >= 2 && Math.max(...base.map(degree)) <= 7) {
    search: for (const cand of byeOrder.slice(0, 6)) {
      const pool = base.filter(c => c !== cand);
      let loose = null;
      for (let t = 0; t < 60; t++) {
        const m = randomPerfect(pool, unmet, rand);
        if (!m) break;
        loose = loose || m;
        const used = new Set(m.map(([a, b]) => pairKey(a, b)));
        if (canFinish(codes.filter(c => !fixedClubs.has(c) && !resting.has(c)), (a, b) => unmet(a, b) && !used.has(pairKey(a, b)), 2, rand)) { pairs = m; out = cand; break search; }
      }
      if (loose && !pairs) { pairs = loose; out = cand; break; }
    }
  }
  if (!pairs) {
    const pool = base.filter(c => c !== out);
    pairs = bestMatching(pool.length, costFor(pool)).map(([i, j]) => [pool[i], pool[j]]);
  }
  if (out) byes.push(out);

  // Home and away: whoever has hosted less lately hosts now; a rematch swaps the venue.
  const form = c => { const v = st.venues.get(c) || []; let run = 0; for (let k = v.length - 1; k >= 0 && v[k] === v[v.length - 1]; k--) run++; return v.length ? (v[v.length - 1] === 'H' ? run : -run) : 0; };
  const hc = new Map(base.map(c => [c, (st.home.get(c) || 0) - (st.away.get(c) || 0)]));
  const games = [];
  pairs.sort(() => rand() - 0.5);
  for (const [a, b] of pairs) {
    const k = pairKey(a, b), sa = hc.get(a) + 2 * form(a), sb = hc.get(b) + 2 * form(b);
    let h;
    if (sa !== sb) h = sa < sb ? a : b;
    else if (st.lastHome.has(k)) h = st.lastHome.get(k) === a ? b : a;
    else h = rand() < 0.5 ? a : b;
    const aw = h === a ? b : a;
    hc.set(h, hc.get(h) + 1); hc.set(aw, hc.get(aw) - 1);
    games.push([h, aw]);
  }
  return { games, byes, rematches: games.filter(([a, b]) => met(a, b)).length, fresh: games.filter(([a, b]) => !met(a, b)).length };
}

// Swap the home and away side of every game (a mirror of an earlier week, for the return leg).
export const mirror = games => games.map(([h, a]) => [a, h]);

// ---------------------------------------------------------------- checks
// Look over the whole roster and list what looks wrong or odd. `fixtures` are { id, week, home, away, starts_at, postponed },
// `clubs` are the clubs that should be playing ({ code, name, status }), `rounds` the round rows.
export function checkRoster({ fixtures, clubs, rounds = [], names = {} }) {
  const issues = [], nm = c => names[c] || c;
  const add = (level, week, msg) => issues.push({ level, week, msg });
  const active = clubs.filter(c => c.status === 'active').map(c => c.code), activeSet = new Set(active);
  const weeks = weekNumbers(fixtures, rounds), labels = roundLabels(weeks, rounds);
  const by = new Map(weeks.map(w => [w, fixtures.filter(f => f.week === w)]));
  const byeMap = byeMapOf(rounds), st = statsOf(fixtures, active, Infinity, byeMap);
  const venues = new Map(active.map(c => [c, []])), seen = new Map();   // seen: pair -> meetings so far

  for (const w of weeks) {
    const games = by.get(w), L = labels.get(w).label;
    if (!games.length) { add('info', w, `${L} has no matches yet.`); continue; }
    const count = new Map();
    for (const f of games) for (const c of [f.home, f.away]) count.set(c, (count.get(c) || 0) + 1);
    for (const [c, n] of count) if (n > 1) add('error', w, `${nm(c)} play${n > 2 ? ` ${n} times` : ' twice'} in ${L}.`);
    for (const f of games) for (const c of [f.home, f.away]) if (!activeSet.has(c)) add('warn', w, `${nm(c)} isn’t an active club but is in ${L}.`);
    const undated = games.filter(f => !f.starts_at && !f.postponed).length;
    if (undated) add('warn', w, `${L}: ${undated} match${undated === 1 ? ' has' : 'es have'} no kick-off time.`);
    // The same club kicking off twice within 100 minutes.
    const timed = games.filter(f => f.starts_at && !f.postponed);
    for (const c of count.keys()) {
      const mine = timed.filter(f => f.home === c || f.away === c).map(f => new Date(f.starts_at).getTime()).sort();
      if (mine.some((t, i) => i && t - mine[i - 1] < 100 * 60000)) add('warn', w, `${nm(c)} have two kick-offs less than 100 minutes apart in ${L}.`);
    }
    // A club on a bye is fine. A club with neither a match nor a bye hasn't been placed yet (the roster is unfinished).
    const onBye = byeMap.get(w), loose = active.filter(c => !count.has(c) && !onBye?.has(c));
    if (loose.length) add('info', w, `${L}: ${loose.map(nm).join(', ')} ${loose.length === 1 ? 'has' : 'have'} no match or bye yet.`);
    // Rematches before a club has met everyone.
    for (const f of games) {
      const k = pairKey(f.home, f.away), before = seen.get(k) || 0;
      if (before > 0) for (const c of [f.home, f.away]) {
        const other = c === f.home ? f.away : f.home;
        const fresh = active.filter(x => x !== c && x !== other && !(seen.get(pairKey(c, x)) || 0));
        if (fresh.length && activeSet.has(c)) add('warn', w, `${nm(c)} play ${nm(other)} again in ${L} before meeting ${fresh.slice(0, 3).map(nm).join(', ')}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ''}.`);
      }
    }
    for (const f of games) { const k = pairKey(f.home, f.away); seen.set(k, (seen.get(k) || 0) + 1); if (venues.has(f.home)) venues.get(f.home).push('H'); if (venues.has(f.away)) venues.get(f.away).push('A'); }
  }
  // A week running into the next.
  for (let i = 0; i + 1 < weeks.length; i++) {
    const a = by.get(weeks[i]).filter(f => f.starts_at).map(f => f.starts_at).sort(), b = by.get(weeks[i + 1]).filter(f => f.starts_at).map(f => f.starts_at).sort();
    if (a.length && b.length && a[a.length - 1] > b[0]) add('warn', weeks[i + 1], `${labels.get(weeks[i + 1]).label} starts before ${labels.get(weeks[i]).label} has finished.`);
  }
  // Streaks of three or more home or away games.
  for (const [c, v] of venues) {
    const s = v.join('');
    const m = s.match(/H{3,}|A{3,}/);
    if (m) add('warn', null, `${nm(c)} have ${m[0].length} ${m[0][0] === 'H' ? 'home' : 'away'} games in a row.`);
  }
  // Uneven byes, and a lopsided home/away split.
  const byeN = active.map(c => st.byes.get(c) || 0);
  if (byeN.length && Math.max(...byeN) - Math.min(...byeN) >= 2) add('info', null, `Byes are uneven: ${active.filter(c => st.byes.get(c) === Math.max(...byeN)).map(nm).join(', ')} ${Math.max(...byeN)}, ${active.filter(c => st.byes.get(c) === Math.min(...byeN)).map(nm).join(', ')} ${Math.min(...byeN)}.`);
  for (const c of active) { const d = (st.home.get(c) || 0) - (st.away.get(c) || 0); if (Math.abs(d) >= 3) add('info', null, `${nm(c)} have ${st.home.get(c)} home and ${st.away.get(c)} away games.`); }
  // Two weeks showing the same round number.
  const nums = new Map();
  for (const w of weeks) { const l = labels.get(w); if (l.numbered) { if (!nums.has(l.no)) nums.set(l.no, []); nums.get(l.no).push(w); } }
  for (const [no, ws] of nums) if (ws.length > 1) add('warn', ws[1], `Round ${no} is used by more than one week.`);
  return issues;
}

// A grid of how many times each pair has met: rows and columns are clubs.
export function meetingMatrix(fixtures, codes) {
  const meet = statsOf(fixtures, codes).meet;
  return codes.map(a => codes.map(b => (a === b ? null : meet.get(pairKey(a, b)) || 0)));
}

// One club's roster: for each week, who they play, home or away, or a bye.
export function clubRoster(fixtures, week, code) {
  const f = fixtures.find(x => x.week === week && (x.home === code || x.away === code));
  return f ? { opp: f.home === code ? f.away : f.home, home: f.home === code, fixture: f } : null;
}

// ---------------------------------------------------------------- a week as plain text, for copying
export function weekText(label, games, name, when) {
  return `${label}\n${games.map(f => `  ${name(f.home)} v ${name(f.away)}${f.starts_at ? `  (${when(f.starts_at)})` : ''}${f.postponed ? '  [postponed]' : ''}`).join('\n') || '  (no matches)'}`;
}

// A new match's id: week and clubs, with a number on the end when that id is taken.
export function freshId(week, home, away, taken) {
  const base = `w${week}-${home}-${away}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 36);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) { const id = `${base}-${n}`; if (!taken.has(id)) return id; }
  return `${base}-${Date.now().toString(36)}`.slice(0, 40);
}
