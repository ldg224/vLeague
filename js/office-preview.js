// The Office's localhost preview (office.html?preview): made-up clubs, players, offers and moves, and an api that makes the moves in memory with the
// same checks as the database, so the page can be looked at and screenshotted without signing in. Nothing here touches the database.
//   previewOffice({ mine, office, window: 'open' | 'closed' | 'round', short: 'DEF' | 'none', over: 6200 (your bill that far over the cap), applied }) -> { clubs, api }
import { check, bill, POSITIONS, rosterOf, penaltyPoints, DEFAULT_LIMIT } from './office-model.js';

const CLUBS = [
  ['TUR', 'Turin United', '#1d3f8a', '#ffffff'], ['SKS', 'Skyline SC', '#c62828', '#ffffff'], ['CCF', 'Coast City FC', '#0f7b6c', '#f2f2f2'],
  ['DTP', 'Dockside Town', '#263238', '#ffca28'], ['LFC', 'Lakeside FC', '#7b1fa2', '#ffffff'], ['NGY', 'Northgate Youth', '#ef6c00', '#212121'],
  ['VVS', 'Valley Vets', '#2e7d32', '#ffffff'], ['ARC', 'Arcadia Rovers', '#fbc02d', '#1a237e'], ['BHR', 'Bayhill Rangers', '#0277bd', '#ffffff'],
  ['MRS', 'Marsh Rise', '#5d4037', '#ffe0b2'], ['PNX', 'Phoenix Athletic', '#ad1457', '#ffffff'],
];
const FIRST = ['Leo', 'Marco', 'Sami', 'Jonah', 'Kai', 'Tomás', 'Ravi', 'Ivan', 'Theo', 'Luca', 'Omar', 'Hugo', 'Felix', 'Niko', 'Arlo', 'Dario', 'Ezra', 'Mateo', 'Kenji', 'Tariq', 'Rafa', 'Owen', 'Yusuf', 'Bruno'];
const LAST = ['Silva', 'Okafor', 'Brandt', 'Moreau', 'Tanaka', 'Rossi', 'Haddad', 'Novak', 'Kerr', 'Duarte', 'Lindqvist', 'Mensah', 'Costa', 'Byrne', 'Petrov', 'Nakamura', 'Ferreira', 'Walsh', 'Ahmadi', 'Keane', 'Vidal', 'Osei', 'Larsen', 'Moretti', 'Quinn'];
const LOOKS = ['euro', 'latin', 'mena', 'southasian', 'eastasian', 'black', 'pacific'];
const SHAPE = { GK: 2, DEF: 5, MID: 5, FWD: 4 };
const FREE = { GK: 3, DEF: 8, MID: 7, FWD: 6 };

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

export function previewOffice({ mine = 'TUR', office = false, window = 'open', short = 'DEF', over = null, applied = false } = {}) {
  const r = rng(35), players = [];
  let n = 0;
  const make = (team, position, lean = 0) => {
    const value = Math.round((2400 + r() * 11000 + lean) / 100) * 100, att = 3 + r() * 6.5, def = 3 + r() * 6.5, d1 = v => Math.round(v * 10) / 10;
    n++;
    // ratings on the players table's 1 to 10 scale, one decimal, as the real ones
    players.push({ id: `p${n}`, name: `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`, team, position, number: (n % 30) + 1,
      offense: d1(position === 'FWD' ? Math.max(att, 6.5 + r() * 2) : position === 'GK' ? Math.min(att, 2 + r()) : att), defense: d1(position === 'GK' || position === 'DEF' ? Math.max(def, 6 + r() * 2.5) : def),
      value: Math.max(2400, Math.min(13400, value)), look: LOOKS[n % LOOKS.length], face: n % 5 });
  };
  CLUBS.forEach(([code], i) => { for (const pos of POSITIONS) for (let k = 0; k < SHAPE[pos]; k++) make(code, pos, (i % 4) * 250 - 300); });
  for (const pos of POSITIONS) for (let k = 0; k < FREE[pos]; k++) make('', pos, -1500);
  // TUR (the default "you") just under the cap, so the bar and the checks have something to say; SKS over it.
  const nudge = (code, target) => { const sq = players.filter(p => p.team === code); const f = target / bill(sq); sq.forEach(p => { p.value = Math.round(p.value * f / 100) * 100; }); };
  nudge(mine, 121400); nudge(mine === 'SKS' ? 'TUR' : 'SKS', 129700);
  // "you" one player short (a defender by default, &short=none for a full squad), so the Market's need order and the checks have something to show
  if (POSITIONS.includes(short)) { const gone = players.filter(p => p.team === mine && p.position === short).sort((a, b) => a.value - b.value)[0]; if (gone) gone.team = ''; }
  // &over=6200: "you" that far over the cap (to look at the penalty points); the squad's wages are scaled, then the last player takes the rounding
  if (over != null && Number.isFinite(Number(over))) {
    nudge(mine, 125000 + Number(over));
    const sq0 = players.filter(p => p.team === mine), d = 125000 + Number(over) - bill(sq0);
    if (sq0.length) sq0[sq0.length - 1].value += d;
  }

  const clubs = CLUBS.map(([code, name, colour, colour2]) => ({ code, name, short_name: code, colour, colour2, crest_path: null }));
  const cfg = { cap: 125000, over_limit: DEFAULT_LIMIT, releases_per_window: 2, window_open: window !== 'closed', closes_at: new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString(), opens_at: null };
  const ago = h => new Date(Date.now() - h * 3600000).toISOString();
  const sq = code => players.filter(p => p.team === code);
  const pick = (code, pos, i = 0) => sq(code).filter(p => p.position === pos).sort((a, b) => b.value - a.value)[i];
  const json = p => ({ id: p.id, name: p.name, position: p.position, club: p.team, wage: p.value, offense: p.offense, defense: p.defense, number: p.number });
  let offerId = 10, moveId = 100;
  const offers = [
    { id: ++offerId, from_club: 'CCF', to_club: mine, give: [pick('CCF', 'MID', 1).id], get: [pick(mine, 'MID', 0).id], status: 'pending', reply_to: null, created_at: ago(5) },
    { id: ++offerId, from_club: mine, to_club: 'LFC', give: [pick(mine, 'FWD', 3).id], get: [pick('LFC', 'FWD', 2).id], status: 'pending', reply_to: null, created_at: ago(26) },
  ];
  const moves = [];
  const log = (kind, club, other, out, inn, b0, b1, o0, o1, h = 0) => moves.unshift({ id: ++moveId, kind, club, other_club: other, players_out: out, players_in: inn, bill_before: b0, bill_after: b1, other_before: o0, other_after: o1, made_at: ago(h), undone_at: null });
  // a little history (the players named are made up, so the log just reads well)
  const fa = players.filter(p => !p.team);
  log('release', 'NGY', null, [fa[0].id], [], 125700, 125700 - fa[0].value, null, null, 50);
  log('sign', 'VVS', null, [], [fa[1].id], 115100, 115100 + fa[1].value, null, null, 30);
  log('trade', 'DTP', 'BHR', [pick('DTP', 'DEF', 2).id], [pick('BHR', 'DEF', 3).id], 127000, 126100, 118800, 119700, 20);
  moves[0].undone_at = null;

  let used = 0;
  const myCode = office ? null : mine;
  const status = () => (window === 'round' ? 'round' : cfg.window_open ? 'open' : 'closed');
  const need = () => { const st = status(); if (st === 'closed') throw new Error('The transfer window is closed.'); if (st === 'round') throw new Error('No moves while a round is being played (from the line-up lock to the last game).'); };
  const rules = { GK: { min: 2, max: 2 }, DEF: { min: 5, max: 5 }, MID: { min: 5, max: 5 }, FWD: { min: 4, max: 4 } };
  const ok = (code, out, inn) => { const why = check({ squad: sq(code), cap: cfg.cap, limit: cfg.over_limit, rules, out, inn, name: code }); if (why) throw new Error(why); };
  const byId = id => players.find(p => p.id === id);
  const later = v => new Promise(res => setTimeout(() => res(v), 150));
  const roster = code => { const ro = rosterOf(sq(code), rules); return { positions: ro.positions, short: ro.short }; };
  const offerJson = o => ({ ...o, give: o.give.map(byId).filter(Boolean).map(json), get: o.get.map(byId).filter(Boolean).map(json) });

  const api = {
    async state() {
      if (!myCode) throw new Error('Only a club manager can make moves.');
      const b = bill(sq(myCode));
      return later({ club: myCode, cap: cfg.cap, wage_bill: b, room: cfg.cap - b, over_cap: b > cfg.cap,
        over_limit: cfg.over_limit, limit: cfg.cap + cfg.over_limit, over: Math.max(0, b - cfg.cap), penalty_points: penaltyPoints(b - cfg.cap), penalties_applied: Boolean(applied),
        window: { status: status(), open: status() === 'open', window_open: cfg.window_open, opens_at: cfg.opens_at, closes_at: cfg.closes_at, round_week: window === 'round' ? 6 : null },
        releases: { limit: cfg.releases_per_window, used, left: Math.max(0, cfg.releases_per_window - used) }, roster: roster(myCode), squad: sq(myCode).map(json),
        offers_in: offers.filter(o => o.status === 'pending' && o.to_club === myCode).map(offerJson),
        offers_out: offers.filter(o => o.status === 'pending' && o.from_club === myCode).map(offerJson) });
    },
    settings: async () => ({ ...cfg }),
    players: async () => players.map(p => ({ ...p })),
    moves: async () => moves.map(m => ({ ...m })),
    async release(id) {
      need(); const p = byId(id);
      if (!p || p.team !== myCode) throw new Error('That player is not in your squad.');
      if (used >= cfg.releases_per_window) throw new Error(`You have used all ${cfg.releases_per_window} releases for this window.`);
      ok(myCode, [p], []);
      const b0 = bill(sq(myCode)); p.team = ''; used++;
      log('release', myCode, null, [id], [], b0, bill(sq(myCode)));
      return later(moveId);
    },
    async sign(id) {
      need(); const p = byId(id);
      if (!p) throw new Error('No such player.');
      if (p.team) throw new Error(`That player is not a free agent (he is at ${p.team}).`);
      ok(myCode, [], [p]);
      const b0 = bill(sq(myCode)); p.team = myCode;
      log('sign', myCode, null, [], [id], b0, bill(sq(myCode)));
      return later(moveId);
    },
    async offer(to, give, get) {
      need();
      if (!give.length && !get.length) throw new Error('Put at least one player in the deal.');
      ok(myCode, give.map(byId), get.map(byId)); ok(to, get.map(byId), give.map(byId));
      offers.unshift({ id: ++offerId, from_club: myCode, to_club: to, give, get, status: 'pending', reply_to: null, created_at: new Date().toISOString() });
      return later(offerId);
    },
    async respond(id, yes) {
      const o = offers.find(x => x.id === id);
      if (!o || o.status !== 'pending') throw new Error('That offer is no longer open.');
      if (!yes) { o.status = 'rejected'; return later(null); }
      need();
      ok(o.from_club, o.give.map(byId), o.get.map(byId)); ok(o.to_club, o.get.map(byId), o.give.map(byId));
      const b0 = bill(sq(o.from_club)), o0 = bill(sq(o.to_club));
      o.give.forEach(pid => { byId(pid).team = o.to_club; }); o.get.forEach(pid => { byId(pid).team = o.from_club; });
      o.status = 'accepted';
      log('trade', o.from_club, o.to_club, o.give, o.get, b0, bill(sq(o.from_club)), o0, bill(sq(o.to_club)));
      return later(moveId);
    },
    async counter(id, give, get) {
      const o = offers.find(x => x.id === id);
      if (!o || o.status !== 'pending') throw new Error('That offer is no longer open.');
      const nid = await api.offer(o.from_club, give, get);
      o.status = 'countered'; offers[0].reply_to = id;
      return nid;
    },
    async withdraw(id) { const o = offers.find(x => x.id === id); if (!o || o.status !== 'pending') throw new Error('That offer is no longer open.'); o.status = 'withdrawn'; return later(null); },
  };
  return { clubs, api };
}
