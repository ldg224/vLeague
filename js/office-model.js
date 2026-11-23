// The Office's sums (S-35): plain functions with no page or database, so the tests can run them. They mirror the database's own checks
// (supabase/migrations/0091_office.sql, office_check) so a button can say why it is off before anyone presses it; the database checks again either way.
//   money(n) -> "$7,450"                        short(n) -> "$7.5k"
//   bill(squad) -> the sum of the squad's wages, plus squad.fees (0096: the club's release fees, set by withFees)
//   withFees(squad, fees) -> the squad array carrying its club's release fees   releaseFee(player) -> 10% of his wage
//   rosterOf(squad, rules) -> { GK: { min, max, count }, ... } and short
//   check({ squad, cap, limit, rules, out, in, code }) -> null when the move is allowed, else a plain sentence why not
//   after({ squad, cap, out, in }) -> { bill, room, over, by, points }
//   penaltyPoints(over) -> the cap penalty ladder (0092_cap_penalties.sql, office_penalty_points); LADDER its steps
//   penaltyChange(b0, b1, cap) -> "Your cap penalty goes from 0 to 3 points." or '' when it stays at 0
//   windowText(window, now) -> "Window open, closes Fri 5:30 pm" / "Window closed" ...
//   windowFromSettings(settings row, now) -> { status, ... } for pages with no office_state()
//   keepPicks(ids, squad) -> the trade builder's picks still at that club
//   tradeView({ mine, theirs, give, get, cap, rules, me, them }) -> the value meter's numbers and both clubs' checks
//   need(position, roster) -> 2 the club is short there, 1 it has room, 0 the position is full (the Market's smart order)

// Cap penalty points (Admin Explains Ep. 02): a club may go over the cap up to the limit (office_settings.over_limit, $30,000), and gets points by how far
// over it is. They are shown as pending through the season and taken off at the end of the regular season (Editor > Office, Apply cap penalties).
// [the most over, in $, points]; past the last step the ladder stays at its top (as office_penalty_points).
export const LADDER = [[0, 0], [5000, 1], [10000, 3], [15000, 6], [20000, 10], [25000, 15], [30000, 21]];
export const DEFAULT_LIMIT = 30000;
export function penaltyPoints(over) {
  const o = Number(over) || 0;
  if (o <= 0) return 0;
  const step = LADDER.find(([top]) => o <= top);
  return step ? step[1] : LADDER[LADDER.length - 1][1];
}
export const pts = n => `${n} point${n === 1 ? '' : 's'}`;

export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
export const POS_NAME = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
// 0093: a minimum for each position, no maximum, and 15 to 16 players in all.
export const DEFAULT_RULES = { GK: { min: 1, max: Infinity }, DEF: { min: 4, max: Infinity }, MID: { min: 3, max: Infinity }, FWD: { min: 3, max: Infinity }, squad: { min: 15, max: 16 } };

export const money = n => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-AU')}`;
export const short = n => {
  const v = Math.abs(Number(n) || 0), s = n < 0 ? '−' : '';
  return v >= 1000 ? `${s}$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${s}$${v}`;
};
export const wageOf = p => Number(p?.wage ?? p?.value ?? 0) || 0;
// Release fees (0096_release_fees.sql): a release past the window's limit costs 10% of the player's wage, on the club's wage bill until the office
// clears it. A squad array carries its club's fees as .fees, so every bill below (the cap, the penalty, a trade's sums) counts them.
export const FEE_PCT = 10;
export const releaseFee = p => Math.round(wageOf(p) / 10);   // as office_release_fee: the wage is whole dollars, so x.5 is exact and rounds up
export const withFees = (squad, fees) => { const s = [...(squad || [])]; s.fees = Number(fees) || 0; return s; };
export const bill = squad => (squad || []).reduce((t, p) => t + wageOf(p), 0) + (Number(squad?.fees) || 0);

// The roster rules from office_state().roster.positions ({ GK: { min, max, count } }) or the draft's defaults.
export const rulesFrom = roster => {
  const out = {};
  for (const pos of POSITIONS) { const r = roster?.positions?.[pos]; out[pos] = r ? { min: Number(r.min), max: r.max == null ? Infinity : Number(r.max) } : { ...DEFAULT_RULES[pos] }; }
  out.squad = { min: Number(roster?.squad_min ?? DEFAULT_RULES.squad.min), max: Number(roster?.squad_max ?? DEFAULT_RULES.squad.max) };
  return out;
};
export function rosterOf(squad, rules = DEFAULT_RULES) {
  const positions = {};
  let shortBy = 0, overBy = 0;
  for (const pos of POSITIONS) {
    const count = (squad || []).filter(p => p.position === pos).length, r = rules[pos] || DEFAULT_RULES[pos];
    positions[pos] = { min: r.min, max: r.max, count };
    shortBy += Math.max(0, r.min - count); overBy += Math.max(0, count - r.max);
  }
  const sq = rules.squad || DEFAULT_RULES.squad;
  return { positions, short: shortBy, over: overBy, total: (squad || []).length, squadMin: sq.min, squadMax: sq.max };
}

// How much a club needs a player in this position, for the Market's default order (positions you are short at first, then ones with room).
export const NEED = ['Full', 'Room', 'Need'];
export function need(position, roster) {
  const g = roster?.positions?.[position];
  if (!g) return 0;
  if (g.count < g.min) return 2;
  return g.count < g.max && !(roster.total >= roster.squadMax) ? 1 : 0;
}

const ids = list => new Set((list || []).map(p => (typeof p === 'object' ? p.id : p)));
// The squad after `out` leave and `inn` join (players as objects).
// The fees go with it; `fee` adds one (a release past the limit).
export const squadAfter = (squad, out = [], inn = [], fee = 0) => { const gone = ids(out); return withFees([...(squad || []).filter(p => !gone.has(p.id)), ...inn], (Number(squad?.fees) || 0) + fee); };

export function after({ squad, cap, out = [], inn = [], fee = 0 }) {
  const b = bill(squadAfter(squad, out, inn, fee));
  return { bill: b, room: cap - b, over: b > cap, by: Math.max(0, b - cap), points: penaltyPoints(b - cap) };
}

// Why a club may not make this move, in a plain sentence, or null if it may. `name` is how the club is called in the sentence ("You", "CCF").
// `limit`: how far over the cap a club may go (office_settings.over_limit; 0 makes the cap a hard limit, as before 0092).
export function check({ squad, cap, limit = 0, rules = DEFAULT_RULES, out = [], inn = [], name = 'You' }) {
  const you = name === 'You', top = cap + (Number(limit) || 0);
  const b0 = bill(squad), next = squadAfter(squad, out, inn), b1 = bill(next);
  if (b1 > top && b1 >= b0) {
    if (b0 > top) {
      return limit
        ? `${you ? 'You are' : `${name} is`} more than ${money(limit)} over the cap, so ${you ? 'you' : 'they'} can only make moves that lower the wage bill.`
        : `${you ? 'You are' : `${name} is`} over the cap, so ${you ? 'you' : 'they'} can only make moves that lower the wage bill.`;
    }
    return `${you ? 'Your' : `${name}’s`} wage bill would be ${money(b1)}, ${money(b1 - cap)} over the ${money(cap)} cap${limit ? ` (${money(limit)} over at most)` : ''}.`;
  }
  const r0 = rosterOf(squad, rules), r1 = rosterOf(next, rules);
  // As the database (0093): a position under its minimum that the move makes smaller; more than the squad's most; fewer than its least.
  const pos = POSITIONS.find(p => r1.positions[p].count < r1.positions[p].min && r1.positions[p].count < r0.positions[p].count);
  if (pos) return `${you ? 'You' : name} would have too few ${POS_NAME[pos].toLowerCase()} (${r1.positions[pos].min} at least).`;
  if (r1.total > r1.squadMax && r1.total > r0.total) return `${you ? 'You' : name} would have ${r1.total} players (${r1.squadMax} at most).`;
  if (r1.total < r1.squadMin && r1.total < r0.total) {
    return `${you ? 'You' : name} would have only ${r1.total} players (${r1.squadMin} at least): sign or trade for a player first.`;
  }
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const clock = d => { const h = d.getHours(), m = d.getMinutes(); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
// "Fri 5:30 pm" within a week, "Fri 27 Nov, 5:30 pm" further out.
export function when(iso, now = new Date()) {
  const d = new Date(iso), days = (d - now) / 86400000;
  return days >= -1 && days < 6 ? `${DAYS[d.getDay()]} ${clock(d)}` : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(d)}`;
}
export function windowText(w, now = new Date()) {
  const st = w?.status || 'closed';
  if (st === 'open') return w.closes_at ? `Window open, closes ${when(w.closes_at, now)}` : 'Window open';
  if (st === 'round') return `Window paused while ${w.round_week ? `round ${w.round_week}` : 'a round'} is played`;
  if (st === 'not_yet') return w.opens_at ? `Window opens ${when(w.opens_at, now)}` : 'Window opens soon';
  return 'Window closed';
}
// The window from the office_settings row, for a page that has no office_state() (the office, an account with no club): the switch and the dates,
// as office_window_status() reads them (it cannot know about a round being played or a draft).
export function windowFromSettings(set, now = new Date()) {
  if (!set) return { status: 'closed' };
  const t = iso => (iso ? new Date(iso).getTime() : null), o = t(set.opens_at), c = t(set.closes_at), n = now.getTime();
  const status = !set.window_open || (c != null && c <= n) ? 'closed' : o != null && o > n ? 'not_yet' : 'open';
  return { status, open: status === 'open', window_open: Boolean(set.window_open), opens_at: set.opens_at || null, closes_at: set.closes_at || null };
}
// Picks in the trade builder that still stand after the squads changed: only ids of players still at that club, in the order picked.
export const keepPicks = (ids, squad) => { const at = new Set((squad || []).map(p => p.id)); return (ids || []).filter(id => at.has(id)); };
// Why nothing can be done now, or null when the window is open.
export function windowReason(w) {
  const st = w?.status || 'closed';
  if (st === 'open') return null;
  if (st === 'round') return 'No moves while a round is being played.';
  if (st === 'not_yet') return 'The transfer window is not open yet.';
  return 'The transfer window is closed.';
}

// How a move changes a club's cap penalty, as a sentence for the confirm steps ('' when the club stays on or under the cap).
export function penaltyChange(b0, b1, cap, who = 'Your') {
  const p0 = penaltyPoints(b0 - cap), p1 = penaltyPoints(b1 - cap);
  if (!p0 && !p1) return '';
  if (p0 === p1) return `${who} cap penalty stays at ${pts(p1)}.`;
  return `${who} cap penalty goes from ${p0} to ${pts(p1)}.`;
}

// The value meter: what each side puts in, the difference, and how both wage bills move, with each club's check.
export function tradeView({ mine, theirs, give = [], get = [], cap, limit = 0, rules = DEFAULT_RULES, them = 'They' }) {
  const g = (mine || []).filter(p => give.includes(p.id)), t = (theirs || []).filter(p => get.includes(p.id));
  const giveTotal = bill(g), getTotal = bill(t);
  const me = after({ squad: mine, cap, out: g, inn: t }), other = after({ squad: theirs, cap, out: t, inn: g });
  const empty = !g.length && !t.length;
  return {
    give: g, get: t, giveTotal, getTotal, diff: getTotal - giveTotal, empty,
    me: { before: bill(mine), pointsBefore: penaltyPoints(bill(mine) - cap), ...me, why: empty ? null : check({ squad: mine, cap, limit, rules, out: g, inn: t, name: 'You' }) },
    them: { before: bill(theirs), pointsBefore: penaltyPoints(bill(theirs) - cap), ...other, why: empty ? null : check({ squad: theirs, cap, limit, rules, out: t, inn: g, name: them }) },
  };
}
// How even a deal is, for the meter's needle: -1 (you give far more) to 1 (you get far more); 0 is even.
export const balance = (giveTotal, getTotal) => (giveTotal + getTotal ? (getTotal - giveTotal) / Math.max(giveTotal, getTotal) : 0);
export function fairness(giveTotal, getTotal) {
  if (!giveTotal && !getTotal) return '';
  const b = balance(giveTotal, getTotal);
  if (Math.abs(b) < 0.08) return 'An even deal';
  if (b > 0) return b > 0.35 ? 'You get a lot more value' : 'You get more value';
  return b < -0.35 ? 'You give a lot more value' : 'You give more value';
}
