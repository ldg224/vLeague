// The Office (S-35 GM Update): a manager runs his club's wages and squad. office.html#squad | #market | #trade(/CODE) | #clubs(/CODE) | #history.
// The league header card, then the Office card (the club, the budget bar: wage bill against the cap, room left, the window, releases left) with the tabs.
//   Squad    your players in the same sortable table, each with his wage and a Release button (a confirm step shows the new bill and room first)
//   Market   free agents in the Draft's sortable table (js/sort-table.js): the positions you need first, filters, room after signing; Sign (the same confirm step)
//   Trade    the builder: your players | the value meter | their players; Send offer. Offers to you (Accept, Reject, Counter) and yours (Withdraw)
//   Clubs    any club's squad, wage bill and room; Make an offer
//   History  every move in the league, newest first
// The database (supabase/migrations/0091_office.sql) checks every move; js/office-model.js does the same sums first so a button can say why it is off.
// Localhost only, to look at it without signing in: office.html?preview&mine=TUR&theme=light#trade (made-up players, no database; moves work in memory).
import { chrome, enter, esc, clubs as loadClubs, crestUrl } from './member.js';
import { db } from './auth.js';
import { paintClub, startSilk } from './shell.js';
import { mountSubFrame } from './frame.js';
import { crest, useClubs } from './places.js';
import { paint } from './paint.js';
import { icon } from './icons.js';
import { portrait } from './portrait.js';
import { plink } from './player-link.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { POSITIONS, POS_NAME, NEED, money, bill, rulesFrom, rosterOf, check, after, need, windowText, windowReason, windowFromSettings, keepPicks, tradeView, fairness, when, penaltyPoints, penaltyChange, LADDER, pts, DEFAULT_LIMIT, squadAfter } from './office-model.js';
import { sortRows, clickSort, sortHead, sortBar } from './sort-table.js';
import { overall } from './names.js';
import { accentFor, onColour, isHex } from './club-colour.js';
import { previewOffice } from './office-preview.js';

chrome();
const main = document.getElementById('main');
const q = new URLSearchParams(location.search);
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && q.has('preview');
const TABS = [['squad', 'Squad'], ['market', 'Market'], ['trade', 'Trade'], ['clubs', 'Clubs'], ['history', 'History']];
const POS_SHORT = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' };

// ---------------------------------------------------------------- data
let api = null;          // { state(), players(), moves(), release(id), sign(id), offer(to, give, get), respond(id, yes), counter(id, give, get), withdraw(id) }
let S = { st: null, players: [], clubs: [], moves: [], my: null, readOnly: '' };
const ui = { confirm: null, err: null, note: null, busy: false, focus: null, mkt: { pos: 'ALL', q: '', max: '', fit: false }, sort: {}, trade: { other: null, give: [], get: [], counter: null } };

const clubRow = code => S.clubs.find(c => c.code === code);
const team = code => { const r = clubRow(code); return { code, name: r?.name || code, colour: r?.colour }; };
// A club's crest; a club with no crest uploaded shows its coloured initials (places.js would show an empty space).
const crestOf = (code, px) => { const h = crest(team(code), px); return clubRow(code)?.crest_path ? h : h.replace('class="crest"', 'class="crest none"').replace(/<img[^>]*>/, ''); };
const clubName = code => clubRow(code)?.short_name || clubRow(code)?.name || code;
const squadOf = code => S.players.filter(p => p.team === code);
const playerById = id => S.players.find(p => p.id === id);
const cap = () => Number(S.st?.cap ?? 125000);
const limit = () => Number(S.st?.over_limit ?? DEFAULT_LIMIT);   // how far over the cap a club may go (0092)
const rules = () => rulesFrom(S.st?.roster);
const win = () => S.st?.window || { status: 'closed' };
const waiting = () => win().status !== 'open';   // 0093: moves made now wait in the queue for the window
const queued = () => (S.st?.queue || []).filter(x => x.status === 'queued');

// Database messages in plain words. The Office's own are already sentences; anything else gets a general line.
function explain(e) {
  const m = String(e?.message || e || '');
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach vLeague. Check your connection and try again.';
  if (/jwt|session/i.test(m)) return 'You’ve been signed out. Sign in again and try once more.';
  if (/function .* does not exist|could not find the function/i.test(m)) return 'The Office isn’t switched on in the database yet.';
  return m.replace(/^ERROR:\s*/, '') || 'That didn’t work. Try again.';
}

function liveApi() {
  const rpc = async (fn, args) => { const { data, error } = await (await db()).rpc(fn, args); if (error) throw new Error(explain(error)); return data; };
  return {
    state: () => rpc('office_state'),
    settings: async () => { const { data } = await (await db()).from('office_settings').select('*').eq('id', 1).maybeSingle(); return data; },
    players: () => { forgetPlayers(); return loadPlayers({ fresh: true }); },
    moves: async () => { const { data, error } = await (await db()).from('office_moves').select('*').order('made_at', { ascending: false }).limit(200); if (error) throw new Error(explain(error)); return data; },
    release: id => rpc('office_release', { p_player: id }),
    sign: id => rpc('office_sign', { p_player: id }),
    offer: (to, give, get) => rpc('office_offer', { p_to: to, p_give: give, p_get: get }),
    respond: (id, yes) => rpc('office_respond', { p_offer: id, p_accept: yes }),
    counter: (id, give, get) => rpc('office_counter', { p_offer: id, p_give: give, p_get: get }),
    withdraw: id => rpc('office_withdraw', { p_offer: id }),
  queueCancel: id => rpc('office_queue_cancel', { p_id: id }),
  };
}

async function load() {
  const [st, players, moves] = await Promise.all([api.state().catch(e => ({ error: explain(e) })), api.players(), api.moves().catch(() => [])]);
  S.players = players; S.moves = moves || [];
  if (st?.error) {
    S.readOnly = st.error;
    const set = await api.settings?.().catch(() => null);
    S.st = { cap: set?.cap ?? 125000, over_limit: set?.over_limit ?? DEFAULT_LIMIT, window: windowFromSettings(set), roster: null, offers_in: [], offers_out: [] };
  } else { S.st = st; S.my = st.club; S.readOnly = ''; }
  tidyTrade();
}

// After the squads change (a move here or by another club), the trade builder keeps only picks still at those clubs, and drops a counter
// whose original offer has closed.
function tidyTrade() {
  const t = ui.trade;
  if (!t.other) return;
  t.give = keepPicks(t.give, squadOf(S.my));
  t.get = keepPicks(t.get, squadOf(t.other));
  if (t.counter && !(S.st?.offers_in || []).some(o => o.id === t.counter)) t.counter = null;
}

// ---------------------------------------------------------------- pieces
// A club's colour as style variables (js/club-colour.js): --k-l / --k-d its accent shade for the light / dark theme (3:1 against the card) and
// --k-on-l / --k-on-d the text that sits on it. css/office.css picks the pair for the theme on any .of-k element, so a navy or white club still reads.
// The Office wears yours (the page) and, in Trade, the other club's on their side.
function clubVars(code) {
  const c = clubRow(code)?.colour;
  if (!isHex(c)) return '';
  const l = accentFor(c, 'light'), d = accentFor(c, 'dark');
  return `--k:${c};--k-l:${l};--k-d:${d};--k-on-l:${onColour(l)};--k-on-d:${onColour(d)};`;
}
const kStyle = (code, extra = '') => { const v = clubVars(code) + extra; return v ? ` style="${v}"` : ''; };

const face = (p, size = 36) => `<span class="of-face">${portrait(p, p.team ? clubRow(p.team) : null, size, true)}</span>`;
const pos = p => `<span class="of-pos pos-${esc(p.position)}">${POS_SHORT[p.position] || esc(p.position)}</span>`;
// Ratings in the app's red-to-green chips (css/site.css .rt), as on the Draft.
const chip = (v, dec) => { const n = Number(v) || 0; return `<span class="rt rt-${Math.min(10, Math.max(1, Math.round(n)))}">${dec ? n.toFixed(1) : n}</span>`; };
const btn = (label, data, o = {}) => `<button type="button" class="of-btn${o.primary ? ' primary' : ''}${o.quiet ? ' quiet' : ''}" ${data}${o.off ? ` disabled title="${esc(o.off)}"` : ''}${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${o.icon ? icon(o.icon) : ''}<span>${label}</span></button>`;
const errAt = key => (ui.err?.key === key ? `<p class="of-err" role="alert">${icon('triangle-alert')}${esc(ui.err.text)}</p>` : '');
const noteAt = key => (ui.note?.key === key ? `<p class="of-ok" role="status">${icon('check')}${esc(ui.note.text)}</p>` : '');
const hint = (ic, text) => `<p class="of-hint">${icon(ic)}<span>${text}</span></p>`;
const myRoster = () => rosterOf(squadOf(S.my), rules());

// The budget bar: the wage bill against the cap, and a second shade for where a move would take it. Past the cap, a hatched zone up to the
// limit (cap + over_limit) is where penalty points build up; the bar ends a little past the limit.
function budgetBar(b, nextBill = null) {
  const c = cap(), lim = c + limit(), top = Math.max(lim, b, nextBill ?? 0) * 1.03, pct = v => `${Math.min(100, v / top * 100).toFixed(2)}%`;
  const nb = nextBill ?? b;
  const cls = b > c ? ' over' : '';
  return `<div class="of-bar${cls}${nextBill != null ? ' has-next' : ''}" role="img" aria-label="Wage bill ${money(b)} against the ${money(c)} cap (${money(lim)} at most)${nextBill != null ? `, ${money(nextBill)} after this move` : ''}">
    ${lim > c ? `<i class="of-bar-zone" style="left:${pct(c)};width:${pct(lim - c)}"></i>` : ''}
    <i class="of-bar-fill" style="width:${pct(Math.min(b, nb))}"></i>
    ${nextBill != null && nb !== b ? `<i class="of-bar-delta ${nb > b ? 'up' : 'down'}" style="left:${pct(Math.min(b, nb))};width:${pct(Math.abs(nb - b))}"></i>` : ''}
    <i class="of-bar-cap" style="left:${pct(c)}"><span>Cap ${money(c)}</span></i>
    ${lim > c ? `<i class="of-bar-cap of-bar-lim" style="left:${pct(lim)}"><span>Limit<small> ${money(lim)}</small></span></i>` : ''}
  </div>`;
}
// "Over by $6,200 · 3 penalty points at the end of the regular season" (or, once the office has applied them, that they are taken off).
function penaltyNote(b) {
  const over = b - cap(), p = penaltyPoints(over);
  if (over <= 0) return '';
  if (S.st?.penalties_applied) return `Over by ${money(over)} · cap penalties have been taken off the table`;
  return `Over by ${money(over)} · <b>${p} penalty point${p === 1 ? '' : 's'}</b> at the end of the regular season`;
}

// What a pending confirm would do to the bill (for the header bar).
function pendingBill() {
  const c = ui.confirm, mine = squadOf(S.my);
  if (!c) return null;
  if (c.kind === 'release') return bill(mine.filter(p => p.id !== c.id));
  if (c.kind === 'sign') { const p = playerById(c.id); return p ? bill(mine) + p.value : null; }
  return null;
}

// The squad's shape as four chips: how many of each position against the rule, short ones marked.
function rosterChips(ro) {
  return `<span class="of-roster">${POSITIONS.map(ps => {
    const g = ro.positions[ps], short = g.count < g.min;   // 0093: a minimum per position, no maximum
    return `<span class="of-rchip pos-${ps}${short ? ' short' : ''}" title="${esc(`${POS_NAME[ps]}: ${g.count}, at least ${g.min}${short ? `, ${g.min - g.count} short` : ''}`)}"><b>${ps}</b>${g.count}</span>`;
  }).join('')}<span class="of-rchip${ro.total >= ro.squadMax ? ' full' : ro.total < ro.squadMin ? ' short' : ''}" title="${esc(`Squad: ${ro.total} of ${ro.squadMin} to ${ro.squadMax}`)}"><b>Squad</b>${ro.total}/${ro.squadMax}</span></span>`;
}

function headCard() {
  const tab = here().tab;
  const tabs = `<nav class="of-tabs" aria-label="Office">${TABS.map(([id, label]) => `<a href="#${id}" data-tab="${id}"${tab === id ? ' aria-current="page"' : ''}>${label}${id === 'trade' && S.st?.offers_in?.length ? `<i class="of-count" aria-label="${S.st.offers_in.length} offers to you">${S.st.offers_in.length}</i>` : ''}</a>`).join('')}</nav>`;
  const w = win(), wOpen = w.status === 'open';
  const winPill = `<span class="of-win ${wOpen ? 'open' : 'shut'}"><i></i>${esc(windowText(w))}</span>`;
  if (!S.my) {
    return `<section class="lg-card of-head"><div class="of-hero"><div class="of-id"><span class="of-id-ic">${icon('briefcase')}</span><div><h1>Office</h1><p class="of-sub">${esc(S.readOnly || 'Every club’s squad and wages, and the league’s moves.')}</p></div>${winPill}</div></div>${tabs}</section>`;
  }
  const mine = squadOf(S.my), b = bill(mine), c = cap(), nb = pendingBill(), r = S.st.releases || { left: 0, limit: 0 };
  const moved = nb != null && nb !== b;
  return `<section class="lg-card of-head has-k">
    <div class="of-hero">
      <div class="of-id">${crestOf(S.my, 48)}<div><h1>${esc(clubRow(S.my)?.name || clubName(S.my))}</h1><p class="of-sub">Office · wages, signings and trades</p></div>${winPill}</div>
      <div class="of-figs">
        <p><span>Wage bill</span><b>${money(b)}</b>${moved ? `<em class="${nb > b ? 'up' : 'down'}">${icon('arrow-right')}${money(nb)}</em>` : ''}</p>
        <p class="${b > c ? 'over' : ''}"><span>${b > c ? 'Over the cap by' : 'Room left'}</span><b>${money(Math.abs(c - b))}</b>${moved ? `<em class="${nb > c ? 'up' : 'down'}">${icon('arrow-right')}${nb > c ? `${money(nb - c)} over` : money(c - nb)}</em>` : ''}</p>
        ${b > c || (moved && nb > c) ? `<p class="${b > c ? 'over' : ''}"><span>Penalty</span><b>${penaltyPoints(b - c)}<small> ${penaltyPoints(b - c) === 1 ? 'point' : 'points'}</small></b>${moved && penaltyPoints(nb - c) !== penaltyPoints(b - c) ? `<em class="${nb > b ? 'up' : 'down'}">${icon('arrow-right')}${pts(penaltyPoints(nb - c))}</em>` : ''}</p>` : ''}
        <p><span>Releases left</span><b>${r.left}<small> of ${r.limit}</small></b></p>
        <p class="of-figs-sq"><span>Squad · ${mine.length}</span>${rosterChips(rosterOf(mine, rules()))}</p>
      </div>
      ${budgetBar(b, nb)}
      ${b > c && nb == null ? `<p class="of-hero-note">${icon('triangle-alert')}<span>${penaltyNote(b)}.${b > c + limit() ? ` You are past the ${money(limit())} limit: you can only make moves that lower your wage bill.` : ''}</span></p>` : ''}
    </div>
    ${tabs}
  </section>`;
}

// The confirm steps' penalty sentence, with a space after it ('' when the move leaves you on or under the cap).
const penaltyLine = (b0, b1) => { const t = penaltyChange(b0, b1, cap()); return t ? `<span class="of-pen">${esc(t)}</span> ` : ''; };

const confirmInner = (key, title, lines, yes, data) => `<div><p><b>${title}</b></p><p>${lines}</p>${errAt(key)}</div>
    <div class="of-acts">${btn('Cancel', 'data-of="cancel"', { quiet: true })}${btn(yes, `${data} data-confirm`, { primary: true })}</div>`;
const confirmBody = (key, title, lines, yes, data) => `<div class="of-confirm in-offer" data-key="${key}">${confirmInner(key, title, lines, yes, data)}</div>`;

// ---------------------------------------------------------------- the player tables (Squad, Market, a club's squad)
// Sortable like the Draft's Available players (js/sort-table.js): click a heading, shift-click for a second level, the chips under the filters.
const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
const needOf = p => need(p.position, myRoster());
const COL = {
  need: { key: 'need', label: 'Need', long: 'Squad need', first: -1, val: needOf },
  position: { key: 'position', label: 'Pos', long: 'Position', first: 1, val: p => POS_ORDER[p.position] ?? 9 },
  name: { key: 'name', label: 'Player', long: 'Name', first: 1, val: p => p.name.toLowerCase() },
  number: { key: 'number', label: '#', long: 'Number', first: 1, val: p => p.number ?? 0 },
  offense: { key: 'offense', label: 'OFF', long: 'Offensive rating', first: -1, val: p => Number(p.offense) || 0 },
  defense: { key: 'defense', label: 'DEF', long: 'Defensive rating', first: -1, val: p => Number(p.defense) || 0 },
  overall: { key: 'overall', label: 'OVR', long: 'Overall rating', first: -1, val: p => overall(p) },
  value: { key: 'value', label: 'Wage', long: 'Wage', first: -1, val: p => p.value },
  room: { key: 'room', label: 'Room after', long: 'Room after signing', first: -1, val: p => -p.value },
};
const colsFor = t => (t === 'market' ? (S.my ? ['need', 'position', 'name', 'offense', 'defense', 'overall', 'value', 'room'] : ['position', 'name', 'offense', 'defense', 'overall', 'value'])
  : ['position', 'name', 'number', 'offense', 'defense', 'overall', 'value']).map(k => COL[k]);
// The Market's smart order: the positions you are short at first, then those with room, best overall first in each.
const DEFAULT_SORT = { squad: [{ key: 'position', dir: 1 }, { key: 'value', dir: -1 }], market: [{ key: 'need', dir: -1 }, { key: 'overall', dir: -1 }], club: [{ key: 'position', dir: 1 }, { key: 'value', dir: -1 }] };
const levelsFor = t => { const cols = colsFor(t), l = (ui.sort[t] || DEFAULT_SORT[t]).filter(x => cols.some(c => c.key === x.key)); return l.length ? l : [{ key: 'name', dir: 1 }]; };
const defaultsFor = t => DEFAULT_SORT[t].filter(x => colsFor(t).some(c => c.key === x.key));

const CELL = {
  need: p => { const n = needOf(p); return `<td class="c-need"><span class="of-need n${n}">${NEED[n]}</span></td>`; },
  position: (p, o) => `<td class="c-position pos-${esc(p.position)}${o.need === 2 ? ' need' : ''}">${esc(p.position)}</td>`,   // need: marked on a phone, where the Need column is hidden
  name: (p, o) => `<td class="c-name"><span class="of-pc">${face(p, 30)}<span class="of-nm">${plink(p.id, `<b>${esc(p.name)}</b>`)}${o.why ? `<small class="of-rowwhy">${esc(o.why)}</small>` : ''}</span></span></td>`,
  number: p => `<td class="c-number">${esc(p.number ?? '')}</td>`,
  offense: p => `<td class="c-offense">${chip(p.offense)}</td>`,
  defense: p => `<td class="c-defense">${chip(p.defense)}</td>`,
  overall: p => `<td class="c-overall">${chip(overall(p), 1)}</td>`,
  value: p => `<td class="c-value">${money(p.value)}</td>`,
  room: p => { const a = after({ squad: squadOf(S.my), cap: cap(), inn: [p] }); return `<td class="c-room${a.over ? ' over' : ''}">${a.over ? `−${money(a.bill - cap())}<small>${pts(a.points)}</small>` : money(a.room)}</td>`; },
};
// rows: [{ p, act, why, on, below }]; below is a full-width row under it (a confirm step or an error).
function playerTable(t, rows, empty, withAct = true) {
  const cols = colsFor(t), n = cols.length + (withAct ? 1 : 0);
  const body = rows.map(r => `<tr class="${r.on ? 'on' : ''}">${cols.map(c => CELL[c.key](r.p, r)).join('')}${withAct ? `<td class="c-act">${r.act || ''}</td>` : ''}</tr>${r.below ? `<tr class="of-below"><td colspan="${n}">${r.below}</td></tr>` : ''}`).join('');
  return `<div class="dr-tablewrap of-tablewrap"><table class="dr-table of-table ot-${t}">${sortHead({ t, levels: levelsFor(t), cols, extra: withAct ? '<th class="c-act"><span class="of-sr">Action</span></th>' : '' })}
    <tbody>${body || `<tr><td colspan="${n}" class="of-none">${empty}</td></tr>`}</tbody></table></div>`;
}
const sortChips = t => sortBar({ t, levels: levelsFor(t), cols: colsFor(t), defaults: defaultsFor(t) });

// ---------------------------------------------------------------- Squad
function squadTab() {
  if (!S.my) return `<section class="lg-card"><p class="of-empty">${esc(S.readOnly || 'Only a club manager has a squad here.')} Look at any club in <a href="#clubs">Clubs</a>.</p></section>`;
  // 0093: while the window is not open, a release waits in the queue (and its count is the releases waiting, not the ones used).
  const mine = squadOf(S.my), ro = rosterOf(mine, rules()), w = null, q = waiting(), r0 = S.st.releases || { left: 0 };
  const r = q ? { ...r0, left: Math.max(0, r0.limit - (r0.queued || 0)) } : r0;
  const queuedOut = new Set(queued().filter(x => x.kind === 'release').map(x => x.player?.id));
  const why = p => (queuedOut.has(p.id) ? 'His release is already waiting for the window.'
    : r.left <= 0 ? `You have ${q ? 'all' : 'used all'} ${r.limit} releases ${q ? 'waiting for' : 'for'} this window.` : check({ squad: mine, cap: cap(), limit: limit(), rules: rules(), out: [p] }));
  const general = r.left <= 0 ? 'x' : '';
  const rows = sortRows(mine, levelsFor('squad'), colsFor('squad')).map(p => {
    if (ui.confirm?.kind === 'release' && ui.confirm.id === p.id) {
      const a = after({ squad: mine, cap: cap(), out: [p] });
      return { p, on: true, below: confirmBody(`rel-${p.id}`, `Release ${esc(p.name)}?`,
        `${q ? 'The window isn’t open, so this waits and goes through when it opens (checked again then). After that he' : 'He'} becomes a free agent. Your wage bill goes to <b>${money(a.bill)}</b>, ${a.over ? `<b class="of-over">${money(a.bill - cap())} over the cap</b>` : `<b>${money(a.room)}</b> room`}. ${penaltyLine(bill(mine), a.bill)}${r.left - 1} release${r.left - 1 === 1 ? '' : 's'} left after this.`,
        q ? 'Queue the release' : 'Release player', `data-of="release" data-id="${esc(p.id)}"`) };
    }
    const off = why(p);
    return { p, why: off && !general ? off : '', act: btn(q ? 'Queue release' : 'Release', `data-of="ask-release" data-id="${esc(p.id)}"`, { off, label: `Release ${p.name}`, icon: 'user-minus' }),
      below: ui.err?.key === `rel-${p.id}` ? errAt(`rel-${p.id}`) : '' };
  });
  const top = q ? hint('clock', `${esc(windowText(win()))}. Moves you make now wait and go through when it opens, each checked again then.`)
    : r.left <= 0 ? hint('triangle-alert', 'You have used all your releases for this window. You can still sign and trade.')
    : ro.total < ro.squadMin ? hint('triangle-alert', `You have ${ro.total} players (${ro.squadMin} at least). Sign or trade for one before you release another.`) : '';
  return `<div class="of-cols"><section class="lg-card of-list-card">
      <div class="lg-card-head"><h2>Squad</h2><span class="of-meta">${mine.length} players · ${money(bill(mine))}</span></div>
      ${noteAt('squad')}${top}${sortChips('squad')}
      ${playerTable('squad', rows, 'Nobody in your squad. Sign players in the Market.')}
    </section>${sideCard()}</div>`;
}

// 0093: moves waiting for the window (with Take back) and how recent ones went (done, or failed with the reason).
function queueCard() {
  const all = S.st?.queue || [];
  if (!all.length) return '';
  const what = x => {
    if (x.kind === 'release') return `Release ${esc(x.player?.name || 'a player')}`;
    if (x.kind === 'sign') return `Sign ${esc(x.player?.name || 'a player')}`;
    const mine = x.from_club === S.my, give = mine ? x.give : x.get, get = mine ? x.get : x.give;
    return `Trade with ${esc(clubName(mine ? x.to_club : x.from_club))}: ${esc((give || []).map(p => p.name).join(', ') || 'nobody')} for ${esc((get || []).map(p => p.name).join(', ') || 'nobody')}`;
  };
  const row = x => `<li class="of-q is-${esc(x.status)}"><span>${what(x)}<small>${x.status === 'queued' ? 'Waiting for the window' : x.status === 'done' ? 'Went through' : x.status === 'failed' ? `Didn’t go through: ${esc(x.note || '')}` : 'Taken back'}</small></span>
      ${x.status === 'queued' ? btn('Take back', `data-of="qcancel" data-id="${x.id}"`, { quiet: true, label: `Take back: ${what(x)}` }) : ''}${errAt(`q-${x.id}`)}</li>`;
  const waitingNow = all.filter(x => x.status === 'queued'), recent = all.filter(x => x.status !== 'queued').slice(0, 4);
  return `<section class="lg-card of-queue-card"><div class="lg-card-head"><h2>Waiting for the window</h2><span class="of-meta">${waitingNow.length}</span></div>
      <ul class="of-qlist">${waitingNow.map(row).join('') || '<li class="of-none">Nothing waiting.</li>'}</ul>
      ${recent.length ? `<h3 class="of-sh">Recently</h3><ul class="of-qlist">${recent.map(row).join('')}</ul>` : ''}</section>`;
}

function sideCard() {
  const ins = S.st?.offers_in || [], outs = S.st?.offers_out || [];
  const recent = S.moves.filter(m => m.club === S.my || m.other_club === S.my).slice(0, 4);
  return `<aside class="of-side">
    ${queueCard()}
    <section class="lg-card"><div class="lg-card-head"><h2>Offers</h2><a href="#trade">Trade</a></div>
      <ul class="of-mini">
        <li><a href="#trade"><span>${icon('inbox')}Offers to you</span><b class="${ins.length ? 'hot' : ''}">${ins.length}</b></a></li>
        <li><a href="#trade"><span>${icon('send')}Your offers waiting</span><b>${outs.length}</b></a></li>
      </ul></section>
    ${recent.length ? `<section class="lg-card"><div class="lg-card-head"><h2>Your moves</h2><a href="#history">History</a></div><ul class="of-hist">${recent.map(moveRow).join('')}</ul></section>` : ''}
    <section class="lg-card"><div class="lg-card-head"><h2>How it works</h2></div>
      <ul class="of-how">
        <li>A player’s wage is his value. Your wage bill is your squad’s wages, against the ${money(cap())} cap.</li>
        <li>You may go up to ${money(limit())} over the cap, for penalty points taken off at the end of the regular season. Past that, you can only make moves that bring your bill down.</li>
        <li>Moves happen while the transfer window is open, never during a round. Moves you make while it isn’t open wait, and go through when it opens, each checked again then.</li>
        <li>A squad has ${rules().squad.min} to ${rules().squad.max} players, with at least ${POSITIONS.map(p => `${rules()[p].min} ${p}`).join(', ')}. There is no most for any position.</li>
      </ul>
      <table class="of-ladder"><caption>Penalty points</caption><thead><tr><th scope="col">Over the cap by</th><th scope="col">Points</th></tr></thead><tbody>${LADDER.slice(1).map(([top, p], i) => `<tr${S.my && penaltyPoints(bill(squadOf(S.my)) - cap()) === p ? ' class="on"' : ''}><td>${money(LADDER[i][0] + 1)} to ${money(top)}</td><td>${p}</td></tr>`).join('')}<tr><td>More than ${money(limit())}</td><td>Not allowed</td></tr></tbody></table></section>
  </aside>`;
}

// ---------------------------------------------------------------- Market
function marketTab() {
  // 0093: while the window is not open a signing waits in the queue, and is checked against the squad as it will be after the moves already waiting
  // (so a queued release makes room for a queued signing).
  const f = ui.mkt, q = waiting(), w = null;
  const qd = queued(), outs = qd.filter(x => x.kind === 'release' && x.player).map(x => x.player), ins = qd.filter(x => x.kind === 'sign' && x.player).map(x => x.player);
  const mine = S.my ? (q ? squadAfter(squadOf(S.my), outs, ins) : squadOf(S.my)) : null;
  const signing = new Set(ins.map(p => p.id));
  const rule = p => (S.my ? check({ squad: mine, cap: cap(), limit: limit(), rules: rules(), inn: [p] }) : null);
  const why = p => (!S.my ? 'Only a club manager can sign players.' : signing.has(p.id) ? 'His signing is already waiting for the window.' : w || rule(p));
  const all = S.players.filter(p => !p.team);
  const list = all.filter(p => (f.pos === 'ALL' || p.position === f.pos) && (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase()))
    && (!+f.max || p.value <= +f.max) && (!f.fit || !rule(p)));
  const blanket = !S.my || w || bill(mine) > cap() + limit() || rosterOf(mine, rules()).total >= rules().squad.max;   // one reason for every row: said once above the table
  const rows = sortRows(list, levelsFor('market'), colsFor('market')).map(p => {
    if (ui.confirm?.kind === 'sign' && ui.confirm.id === p.id) {
      const a = after({ squad: mine, cap: cap(), inn: [p] });
      return { p, on: true, below: confirmBody(`sign-${p.id}`, `Sign ${esc(p.name)}?`,
        `${q ? 'The window isn’t open, so this waits and goes through when it opens, if he is still a free agent then (first come, first served). ' : ''}His wage is ${money(p.value)}. Your wage bill goes to <b>${money(a.bill)}</b>, ${a.over ? `<b class="of-over">${money(a.bill - cap())} over the cap</b>` : `<b>${money(a.room)}</b> room left`}. ${penaltyLine(bill(mine), a.bill)}`,
        q ? 'Queue the signing' : 'Sign player', `data-of="sign" data-id="${esc(p.id)}"`) };
    }
    const off = why(p);
    // the row's own reason, short: the Room after column already shows the money, so a cap reason says just that
    const fx = S.my && after({ squad: mine, cap: cap(), inn: [p] }), rowWhy = off && !blanket ? (fx?.over && /cap/.test(off) ? `Takes you ${money(fx.bill - cap())} over the cap, past the ${money(limit())} limit` : off) : '';
    return { p, why: rowWhy, need: S.my ? needOf(p) : 0, act: S.my ? btn(q ? 'Queue' : 'Sign', `data-of="ask-sign" data-id="${esc(p.id)}"`, { off, primary: !off, label: `Sign ${p.name}` }) : '',
      below: ui.err?.key === `sign-${p.id}` ? errAt(`sign-${p.id}`) : '' };
  });
  const count = ps => all.filter(p => ps === 'ALL' || p.position === ps).length;
  const pill = (ps) => `<button type="button" class="of-pill" data-of="mpos" data-v="${ps}" aria-pressed="${f.pos === ps}">${ps === 'ALL' ? 'All' : ps}<small>${count(ps)}</small></button>`;
  return `<section class="lg-card of-list-card">
    <div class="lg-card-head"><h2>Free agents</h2><span class="of-meta">${list.length === all.length ? `${all.length} available` : `${list.length} of ${all.length}`}</span></div>
    ${noteAt('market')}
    <div class="dr-filter of-filter"><label class="dr-search">${icon('search')}<input type="search" data-f="q" placeholder="Search players" aria-label="Search players" value="${esc(f.q)}"></label>
      <div class="of-pills" role="group" aria-label="Position">${['ALL', ...POSITIONS].map(pill).join('')}</div>
      <label class="dr-max"><span>Max $</span><input type="number" inputmode="numeric" min="0" step="500" data-f="max" placeholder="Any" aria-label="Maximum wage" value="${esc(f.max)}"></label>
      ${S.my ? `<label class="dr-fit"><input type="checkbox" data-f="fit"${f.fit ? ' checked' : ''}><span>Fits my squad</span></label>` : ''}</div>
    ${sortChips('market')}
    ${q && S.my ? hint('clock', `${esc(windowText(win()))}. Signings you make now wait and go through when it opens, first come, first served.`) : ''}${S.my ? marketHint(mine) : ''}
    ${playerTable('market', rows, f.fit ? 'Nobody here fits your squad right now. Turn off Fits my squad to see everyone.' : 'No free agents match.', Boolean(S.my))}
  </section>`;
}

// Why most Sign buttons are off, said once above the list.
function marketHint(mine) {
  const ro = rosterOf(mine, rules()), full = POSITIONS.filter(p => ro.positions[p].count >= ro.positions[p].max), shortAt = POSITIONS.filter(p => ro.positions[p].count < ro.positions[p].min);
  if (bill(mine) > cap() + limit()) return hint('triangle-alert', `You are more than ${money(limit())} over the cap, so you can’t sign anyone until your wage bill is under ${money(cap() + limit())}.`);
  if (bill(mine) > cap()) return hint('triangle-alert', `${penaltyNote(bill(mine))}. A signing adds to it: Room after shows how far over it takes you.`);
  if (full.length === POSITIONS.length || ro.total >= ro.squadMax) return hint('triangle-alert', `Your squad is full (${ro.squadMax} players). Release a player in the Squad tab first.`);
  if (shortAt.length) return hint('list-ordered', `You are short of ${shortAt.map(p => POS_NAME[p].toLowerCase()).join(' and ')}, so they are listed first.`);
  return '';
}

// ---------------------------------------------------------------- Trade
const pickRow = (p, side, on) => `<li><button type="button" class="of-pick${on ? ' on' : ''}" data-of="pick" data-side="${side}" data-id="${esc(p.id)}" aria-pressed="${on}">
    <span class="of-tick">${icon('check')}</span>${face(p, 30)}
    <span class="of-who"><b>${esc(p.name)}</b><small>${pos(p)}<span>OVR ${overall(p).toFixed(1)}</span></small></span>
    <span class="of-wage">${money(p.value)}</span></button></li>`;
const pickList = (list, side, chosen) => `<ul class="of-picks">${POSITIONS.map(ps => {
  const l = list.filter(p => p.position === ps).sort((a, b) => b.value - a.value);
  return l.length ? `<li class="of-strip pos-${ps}"><h4>${POS_NAME[ps]}</h4><span>${l.length}</span></li>${l.map(p => pickRow(p, side, chosen.includes(p.id))).join('')}` : '';
}).join('')}</ul>`;

function meter(tv, other) {
  const tot = tv.giveTotal + tv.getTotal, share = tot ? tv.giveTotal / tot * 100 : 50;
  const pen = x => (x.pointsBefore || x.points ? ` · ${x.pointsBefore === x.points ? pts(x.points) : `${x.pointsBefore} ${icon('arrow-right')} ${pts(x.points)}`}` : '');
  const fx = (label, x, c, code) => `<div class="of-fxrow of-k"${kStyle(code)}><span><i class="of-dot"></i>${label}</span><b>${money(x.before)} ${icon('arrow-right')} ${money(x.bill)}</b><small class="${x.over ? 'over' : ''}">${x.over ? `${money(x.bill - c)} over the cap` : `${money(x.room)} room`}${pen(x)}</small></div>`;
  const status = (x, who) => (tv.empty ? '' : x.why ? `<p class="of-chk bad">${icon('x')}${esc(x.why)}</p>` : `<p class="of-chk ok">${icon('check')}${who}: cap and squad rules met</p>`);
  return `<div class="of-meter">
    <div class="of-sides"><div class="of-k"${kStyle(S.my)}><span>You give</span><b>${money(tv.giveTotal)}</b><small>${tv.give.length} player${tv.give.length === 1 ? '' : 's'}</small></div>
      <div class="of-k"${kStyle(other)}><span>You get</span><b>${money(tv.getTotal)}</b><small>${tv.get.length} player${tv.get.length === 1 ? '' : 's'}</small></div></div>
    <div class="of-scale${tot ? '' : ' empty'}" aria-hidden="true"><i class="of-k"${kStyle(S.my, `width:${share.toFixed(1)}%`)}></i><i class="of-k"${kStyle(other, `width:${(100 - share).toFixed(1)}%`)}></i><span></span></div>
    <p class="of-fair">${tv.empty ? 'Pick players on both sides to see the deal.' : `${esc(fairness(tv.giveTotal, tv.getTotal))}${tv.diff ? `, ${money(Math.abs(tv.diff))} ${tv.diff > 0 ? 'to you' : `to ${esc(clubName(other))}`}` : ''}`}</p>
    ${fx('Your bill', tv.me, cap(), S.my)}${fx(`${esc(clubName(other))} bill`, tv.them, cap(), other)}
    ${status(tv.me, 'You')}${status(tv.them, esc(clubName(other)))}
  </div>`;
}

function offerRow(o, dir) {
  const other = dir === 'in' ? o.from_club : o.to_club;
  const names = list => list.length ? list.map(p => `<span>${esc(p.name)} <small>${money(p.wage)}</small></span>`).join('') : '<small>nobody</small>';
  const sum = list => list.reduce((t, p) => t + Number(p.wage || 0), 0);
  const youGet = dir === 'in' ? o.give : o.get, youGive = dir === 'in' ? o.get : o.give;
  const w = null, q = waiting(), key = `offer-${o.id}`;   // 0093: offers work any time; an accepted trade waits for the window when it isn't open
  const asked = dir === 'in' && ui.confirm && ['accept', 'reject'].includes(ui.confirm.kind) && ui.confirm.id === String(o.id) ? ui.confirm.kind : null;
  const acts = dir === 'in'
    ? `${btn('Reject', `data-of="ask-reject" data-id="${o.id}"`, { quiet: true })}${btn('Counter', `data-of="counter" data-id="${o.id}"`, { off: w })}${btn('Accept', `data-of="ask-accept" data-id="${o.id}"`, { primary: !w, off: w })}`
    : btn('Withdraw', `data-of="withdraw" data-id="${o.id}"`, { quiet: true });
  let confirm = '';
  if (asked === 'accept') {
    const mine = squadOf(S.my), a = after({ squad: mine, cap: cap(), out: youGive, inn: youGet });
    confirm = confirmBody(key, `Accept ${esc(clubName(other))}’s offer?`,
      `${q ? 'The window isn’t open, so the trade waits and goes through when it opens (checked again then). After that your' : 'The players move now. Your'} wage bill goes from ${money(bill(mine))} to <b>${money(a.bill)}</b>, ${a.over ? `<b class="of-over">${money(a.bill - cap())} over the cap</b>` : `<b>${money(a.room)}</b> room`}. ${penaltyLine(bill(mine), a.bill)}`,
      q ? 'Accept (waits for the window)' : 'Accept trade', `data-of="accept" data-id="${o.id}"`);
  } else if (asked === 'reject') {
    confirm = confirmBody(key, `Reject ${esc(clubName(other))}’s offer?`, 'The offer closes and nobody moves. Your wage bill stays the same. To change the deal instead, use Counter.',
      'Reject offer', `data-of="reject" data-id="${o.id}"`);
  }
  return `<li class="of-offer of-k${asked ? ' asking' : ''}"${kStyle(other)}>
    <div class="of-offer-h">${crestOf(other, 24)}<b>${esc(clubRow(other)?.name || clubName(other))}</b><small>${o.reply_to ? 'Counter-offer · ' : ''}${esc(when(o.created_at))}</small></div>
    <div class="of-deal"><p><span>You get</span><span class="of-names">${names(youGet)}</span><em>${money(sum(youGet))}</em></p>
    <p><span>You give</span><span class="of-names">${names(youGive)}</span><em>${money(sum(youGive))}</em></p></div>
    <div class="of-k"${kStyle(S.my)}>${confirm || `${errAt(key)}<div class="of-acts">${acts}</div>`}</div></li>`;   // the buttons are yours: your colour
}

function offersCard() {
  const ins = S.st?.offers_in || [], outs = S.st?.offers_out || [];
  return `<section class="lg-card of-offers-card"><div class="lg-card-head"><h2>Offers</h2><span class="of-meta">${ins.length} to you · ${outs.length} from you</span></div>
      ${noteAt('offers')}
      <h3 class="of-sh">To you</h3><ul class="of-offers">${ins.map(o => offerRow(o, 'in')).join('') || '<li class="of-none">No offers to you right now.</li>'}</ul>
      <h3 class="of-sh">From you</h3><ul class="of-offers">${outs.map(o => offerRow(o, 'out')).join('') || '<li class="of-none">You have no offers waiting. Build one above.</li>'}</ul></section>`;
}

function tradeTab() {
  if (!S.my) return `<section class="lg-card"><p class="of-empty">${esc(S.readOnly || 'Only a club manager can trade.')}</p></section>`;
  const t = ui.trade, others = S.clubs.filter(c => c.code !== S.my);
  const picker = `<div class="of-clubpick" role="group" aria-label="Trade with">${others.map(c => `<button type="button" class="of-clubbtn of-k" data-of="trade-with" data-v="${esc(c.code)}" aria-pressed="${t.other === c.code}"${kStyle(c.code)}>${crestOf(c.code, 20)}<span>${esc(c.short_name || c.code)}</span></button>`).join('')}</div>`;
  if (!t.other) return `<section class="lg-card"><div class="lg-card-head"><h2>New trade</h2><span class="of-meta">Players only, no cash</span></div><p class="of-lead">Pick a club to trade with.</p>${picker}</section>${offersCard()}`;
  const mine = squadOf(S.my), theirs = squadOf(t.other);
  const tv = tradeView({ mine, theirs, give: t.give, get: t.get, cap: cap(), limit: limit(), rules: rules(), them: clubName(t.other) });
  const w = null, plain = w || (tv.empty ? 'Put at least one player in the deal.' : ''), off = plain || tv.me.why || tv.them.why;
  const counterOf = t.counter ? (S.st.offers_in || []).find(o => o.id === t.counter) : null;
  if (t.counter && !counterOf) t.counter = null;   // the offer it answered has closed: this is a new trade now
  const panel = (code, side, list, chosen, total, label) => `<div class="of-panel of-k"${kStyle(code)}>
      <h3 class="of-panel-h">${crestOf(code, 24)}<span><b>${code === S.my ? 'Your players' : `${esc(clubRow(code)?.name || clubName(code))}`}</b><small>${label}</small></span><em>${chosen.length ? money(total) : ''}</em></h3>
      ${pickList(list, side, chosen)}</div>`;
  return `<section class="lg-card of-trade">
      <div class="lg-card-head"><h2>${counterOf ? 'Counter-offer' : 'New trade'}</h2>${counterOf ? `<button type="button" class="of-link" data-of="trade-reset">Cancel counter</button>` : `<span class="of-meta">Players only, no cash</span>`}</div>
      ${counterOf ? `<p class="of-lead">Change the deal ${esc(clubName(t.other))} sent you, then send it back. Their offer closes when you do.</p>` : picker}
      <div class="of-builder">
        ${panel(S.my, 'give', mine, t.give, tv.giveTotal, `You give ${tv.give.length || 'nobody'}${tv.give.length ? ` player${tv.give.length === 1 ? '' : 's'}` : ''}`)}
        <div class="of-mid">${meter(tv, t.other)}
          ${errAt('trade')}${noteAt('trade')}
          <div class="of-send">${btn(counterOf ? 'Send counter-offer' : 'Send offer', 'data-of="send"', { primary: !off, off, icon: 'send' })}</div>
          ${plain ? `<p class="of-why">${esc(plain)}</p>` : off ? '<p class="of-why">Change the deal until both clubs meet the rules.</p>' : ''}
        </div>
        ${panel(t.other, 'get', theirs, t.get, tv.getTotal, `You get ${tv.get.length || 'nobody'}${tv.get.length ? ` player${tv.get.length === 1 ? '' : 's'}` : ''}`)}
      </div>
    </section>${offersCard()}`;
}

// ---------------------------------------------------------------- Clubs
function clubsTab() {
  const sub = here().sub, sel = (clubRow(sub) ? sub : null) || S.my || S.clubs[0]?.code;
  const c = cap();
  const list = S.clubs.map(r => { const sq = squadOf(r.code); return { r, b: bill(sq), n: sq.length }; }).sort((a, b) => a.b - b.b);
  const top = Math.max(c + limit(), ...list.map(x => x.b)) * 1.02;
  const rows = list.map(({ r, b, n }) => `<li><a class="of-clubrow of-k${r.code === sel ? ' on' : ''}${r.code === S.my ? ' mine' : ''}${b > c ? ' over' : ''}" href="#clubs/${esc(r.code)}"${kStyle(r.code)}${r.code === sel ? ' aria-current="true"' : ''}>
      ${crestOf(r.code, 28)}<span class="of-who"><b>${esc(r.name)}</b><span class="of-minibar"><i style="width:${(b / top * 100).toFixed(1)}%"></i><s style="left:${(c / top * 100).toFixed(1)}%"></s></span></span>
      <span class="of-cb"><b>${money(b)}</b><small class="${b > c ? 'over' : ''}">${b > c ? `${money(b - c)} over · ${pts(penaltyPoints(b - c))}` : `${money(c - b)} room · ${n}`}</small></span></a></li>`).join('');
  const sq = squadOf(sel), b = bill(sq);
  const detail = sel ? `<section class="lg-card of-list-card of-club of-k"${kStyle(sel)}>
      <div class="of-clubhead">${crestOf(sel, 44)}<div><h2>${esc(clubRow(sel)?.name || sel)}</h2><p>${b > c ? `<b class="of-over">${money(b - c)} over the cap · ${pts(penaltyPoints(b - c))}</b>` : `<b>${money(c - b)}</b> room`} · wage bill <b>${money(b)}</b> · ${sq.length} players</p></div>
        ${S.my && sel !== S.my ? `<a class="of-btn primary of-k" href="#trade/${esc(sel)}"${kStyle(S.my)}>${icon('arrow-left-right')}<span>Make an offer</span></a>` : ''}</div>
      ${budgetBar(b)}
      ${rosterChips(rosterOf(sq, rules()))}
      ${sortChips('club')}
      ${playerTable('club', sortRows(sq, levelsFor('club'), colsFor('club')).map(p => ({ p })), 'No players at this club.', false)}
    </section>` : '';
  return `<div class="of-cols of-cols-l"><section class="lg-card of-clubs-card"><div class="lg-card-head"><h2>Clubs</h2><span class="of-meta">Lowest wage bill first</span></div><ul class="of-clubs">${rows}</ul></section>${detail}</div>`;
}

// ---------------------------------------------------------------- History
function moveRow(m) {
  const names = ids => (ids || []).map(id => `<b>${esc(playerById(id)?.name || id)}</b>`).join(', ');
  const kind = { release: ['user-minus', 'Released'], sign: ['user-plus', 'Signed'], trade: ['arrow-left-right', 'Trade'] }[m.kind] || ['arrow-left-right', m.kind];
  const club = code => `<span class="of-mclub">${esc(clubName(code))}</span>`;
  const text = m.kind === 'release' ? `${club(m.club)} released ${names(m.players_out)}`
    : m.kind === 'sign' ? `${club(m.club)} signed ${names(m.players_in)}`
    : `${club(m.club)} sent ${names(m.players_out) || 'nobody'} to ${club(m.other_club)} for ${names(m.players_in) || 'nobody'}`;
  const up = Number(m.bill_after) > Number(m.bill_before);
  return `<li class="of-move${m.undone_at ? ' undone' : ''}"><span class="of-mk ${esc(m.kind)}" title="${esc(kind[1])}">${icon(kind[0])}</span>${crestOf(m.club, 24)}
    <span class="of-who"><span>${text}</span><small>${kind[1]} · ${esc(when(m.made_at))}${m.undone_at ? ' · undone by the office' : ''}</small></span>
    <span class="of-cb"><small>${esc(clubName(m.club))} bill</small><b class="${up ? 'up' : 'down'}">${money(m.bill_after)}</b></span></li>`;
}
// Moves under day strips, newest first ("Today", "Yesterday", "Fri 13 Nov").
function dayLabel(iso, now = new Date()) {
  const d = new Date(iso), a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate()), days = Math.round((b - a) / 86400000);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}
function historyTab() {
  let last = '';
  const items = S.moves.map(m => { const l = dayLabel(m.made_at), head = l !== last ? `<li class="of-strip of-day"><h4>${esc(l)}</h4></li>` : ''; last = l; return head + moveRow(m); }).join('');
  return `<section class="lg-card of-list-card"><div class="lg-card-head"><h2>Moves</h2><span class="of-meta">${S.moves.length} · newest first</span></div>
    <ul class="of-hist">${items || '<li class="of-none">No moves yet. Releases, signings and trades show here as they happen.</li>'}</ul></section>`;
}

// ---------------------------------------------------------------- page
function here() {
  const [tab, ...rest] = location.hash.slice(1).split('/');
  return { tab: TABS.some(t => t[0] === tab) ? tab : 'squad', sub: rest.join('/') };
}
// Every redraw keeps keyboard focus: the focused control is found again by what it is (its data-of, data-id, data-v, data-side, tab or link).
// A confirm step that has just opened takes focus on its main button; one that closes gives it back to the button that opened it.
const FOCUS_KEYS = ['of', 'id', 'v', 'side', 'tab', 'f', 't', 'sort', 'sflip', 'sdel', 'sreset', 'sadd'];
function focusKey() {
  const a = document.activeElement;
  if (!a || !main.contains(a) || a === main) return null;
  const parts = FOCUS_KEYS.filter(k => a.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(a.dataset[k])}"]`);
  if (a.matches('a[href]') && !a.dataset.tab) parts.push(`[href="${CSS.escape(a.getAttribute('href'))}"]`);
  return parts.length ? `${a.tagName.toLowerCase()}${parts.join('')}` : null;
}
function render() {
  const { tab } = here();
  const body = { squad: squadTab, market: marketTab, trade: tradeTab, clubs: clubsTab, history: historyTab }[tab]();
  const f = focusKey();
  paint(main, `<div class="of of-k"${kStyle(S.my)}>${headCard()}${body}</div>`);
  const want = ui.focus || f;
  ui.focus = null;
  const el = want && (want === 'confirm' ? main.querySelector('[data-confirm]') : main.querySelector(want));
  if (el && document.activeElement !== el) {
    el.focus({ preventScroll: want !== 'confirm' });
    if (el.matches('input[type="search"]')) el.setSelectionRange(el.value.length, el.value.length);   // typing in the search box: the caret stays at the end
  }
}

async function act(key, fn, okText, noteKey) {
  if (ui.busy) return;
  ui.busy = true; ui.err = null; main.classList.add('of-busy');
  let done = false;
  try { await fn(); done = true; } catch (e) { ui.err = { key, text: explain(e) }; }
  if (done) {
    ui.confirm = null;
    let fresh = true;
    try { await load(); } catch { fresh = false; }   // the move went through either way: a failed reload is not an error with the move
    ui.note = { key: noteKey, text: okText() + (fresh ? '' : ' The page didn’t refresh: reload it to see the change.') };   // built after the reload, so it reads the new numbers
  }
  ui.busy = false; main.classList.remove('of-busy');
  render();
}

function onHash() {
  const { tab, sub } = here();
  // An address with a club that isn't one (#clubs/XYZ, #trade/XYZ, or your own club to trade with) falls back to the list.
  if (sub && (tab === 'clubs' || tab === 'trade') && (!clubRow(sub) || (tab === 'trade' && sub === S.my))) history.replaceState(null, '', `#${tab}`);
  else if (tab === 'trade' && sub && sub !== ui.trade.other) ui.trade = { other: sub, give: [], get: [], counter: null };
  ui.confirm = null; ui.err = null; ui.note = null;
  render();
}

main.addEventListener('click', e => {
  // the sortable tables (js/sort-table.js): a heading sorts (shift adds a level), the chips flip or drop a level, Reset goes back to the default
  const sb = e.target.closest('[data-sort], [data-sflip], [data-sdel], [data-sreset]');
  if (sb) {
    const t = sb.dataset.t, d = sb.dataset, lv = levelsFor(t);
    if (d.sort) ui.sort[t] = clickSort(lv, d.sort, e.shiftKey, colsFor(t));
    else if (d.sflip != null) ui.sort[t] = lv.map((x, i) => (i === +d.sflip ? { ...x, dir: -x.dir } : x));
    else if (d.sdel != null) ui.sort[t] = lv.filter((_, i) => i !== +d.sdel);
    else ui.sort[t] = null;
    if (ui.sort[t] === null) delete ui.sort[t];
    if (d.sdel != null || d.sreset != null) ui.focus = `[data-t="${t}"][data-sflip="0"]`;   // the pressed chip or Reset is gone: focus the first chip
    return render();
  }
  const b = e.target.closest('[data-of]');
  if (!b || b.disabled) return;
  const k = b.dataset.of, id = b.dataset.id, v = b.dataset.v;
  const nameOf = pid => playerById(pid)?.name || 'The player';
  if (['ask-release', 'ask-sign', 'ask-accept', 'ask-reject'].includes(k)) { ui.confirm = { kind: k.slice(4), id }; ui.err = null; ui.note = null; ui.focus = 'confirm'; return render(); }
  if (k === 'cancel') { closeConfirm(); return render(); }
  const q = waiting();   // 0093: decided before the move, since the reload may open the window
  if (k === 'release') return act(`rel-${id}`, () => api.release(id), () => (q ? `${nameOf(id)}’s release is waiting for the window. It goes through when it opens.` : `${nameOf(id)} released. He is a free agent now.`), 'squad');
  if (k === 'sign') return act(`sign-${id}`, () => api.sign(id), () => (q ? `Signing ${nameOf(id)} is waiting for the window. It goes through when it opens, if he is still a free agent.` : `${nameOf(id)} signed. Your wage bill is ${money(bill(squadOf(S.my)))}.`), 'market');
  if (k === 'qcancel') return act(`q-${id}`, () => api.queueCancel(Number(id)), () => 'Taken back. Nothing will happen when the window opens.', 'squad');
  if (k === 'mpos') { ui.mkt.pos = v; return render(); }
  if (k === 'trade-with') { history.replaceState(null, '', `#trade/${v}`); ui.trade = { other: v, give: [], get: [], counter: null }; ui.err = null; return render(); }
  if (k === 'trade-reset') { ui.trade = { other: null, give: [], get: [], counter: null }; history.replaceState(null, '', '#trade'); return render(); }
  if (k === 'pick') {
    const list = ui.trade[b.dataset.side];
    ui.trade[b.dataset.side] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    ui.err = null; ui.note = null;
    return render();
  }
  if (k === 'send') {
    const t = { ...ui.trade };
    return act('trade', () => (t.counter ? api.counter(t.counter, t.give, t.get) : api.offer(t.other, t.give, t.get)),
      () => { ui.trade = { other: t.other, give: [], get: [], counter: null }; return `${t.counter ? 'Counter-offer' : 'Offer'} sent to ${clubName(t.other)}. It shows under Offers until they answer.`; }, 'trade');
  }
  if (k === 'accept') return act(`offer-${id}`, () => api.respond(Number(id), true), () => (q ? 'Trade agreed. It waits for the window and goes through when it opens.' : 'Trade done. The players have moved.'), 'offers');
  if (k === 'reject') return act(`offer-${id}`, () => api.respond(Number(id), false), () => 'Offer rejected.', 'offers');
  if (k === 'withdraw') return act(`offer-${id}`, () => api.withdraw(Number(id)), () => 'Offer withdrawn.', 'offers');
  if (k === 'counter') {
    const o = (S.st.offers_in || []).find(x => String(x.id) === id);
    if (!o) return;
    ui.trade = { other: o.from_club, give: o.get.map(p => p.id), get: o.give.map(p => p.id), counter: o.id };   // the other way round: what they asked of you is now what you give
    history.replaceState(null, '', `#trade/${o.from_club}`);
    ui.err = null; ui.note = null;
    render();
    main.querySelector('.of-trade')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});
main.addEventListener('input', e => {
  const f = e.target.dataset?.f;
  if (f === 'q' || f === 'max') { ui.mkt[f] = e.target.value; render(); }
});
main.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f === 'fit') { ui.mkt.fit = t.checked; render(); }
  else if (t.dataset.sadd && t.value) { const k = t.dataset.sadd, c = colsFor(k).find(x => x.key === t.value); ui.sort[k] = [...levelsFor(k), { key: c.key, dir: c.first }]; render(); }
});
addEventListener('hashchange', onHash);
// Closing a confirm puts focus back on the button that opened it.
function closeConfirm() {
  const c = ui.confirm;
  if (c) ui.focus = `button[data-of="ask-${c.kind}"][data-id="${CSS.escape(c.id)}"]`;
  ui.confirm = null; ui.err = null;
}
addEventListener('keydown', e => { if (e.key === 'Escape' && ui.confirm) { closeConfirm(); render(); } });

try {
  // The same entry check as the other signed-in pages: no session -> sign in (WR-02); an account still in set-up -> set-up.
  const me = preview ? { user: { id: 'preview' } } : await enter('office.html');
  if (!me) await new Promise(() => {});   // on its way to another page
  if (preview && q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  let prof = me.profile;
  if (preview) {
    const demo = previewOffice({ mine: q.get('mine') || 'TUR', office: q.has('office'), window: q.get('window') || 'open', short: q.get('short') || 'DEF', over: q.get('over'), applied: q.has('applied') });
    S.clubs = demo.clubs; api = demo.api; prof = { role: q.has('office') ? 'office' : 'manager', club: q.has('office') ? null : (q.get('mine') || 'TUR') };
  } else {
    S.clubs = await loadClubs().catch(() => []);
    api = liveApi();
  }
  useClubs(S.clubs);
  const mineRow = S.clubs.find(c => c.code === prof?.club) || null;
  paintClub(mineRow);
  startSilk();
  document.body.classList.toggle('has-club', Boolean(mineRow));
  mountSubFrame(document.getElementById('frame'), { office: prof?.role === 'office', crest: mineRow?.crest_path ? crestUrl(mineRow.crest_path) : '', here: 'office', title: 'Office' });
  await load();
  onHash();
  if (preview) {   // localhost only, for screenshots: &ask=release:p3 opens a confirm step, &give=p9&get=p40,p41 fills the trade builder
    const [kind, pid] = (q.get('ask') || '').split(':');
    if (pid) ui.confirm = { kind, id: pid };
    if (q.get('give') || q.get('get')) Object.assign(ui.trade, { give: (q.get('give') || '').split(',').filter(Boolean), get: (q.get('get') || '').split(',').filter(Boolean) });
    render();
  }
} catch (e) {
  main.innerHTML = `<section class="lg-card"><p class="of-empty">The Office didn’t load. ${esc(e.message || '')} <a href="office.html">Try again</a></p></section>`;
}
main.setAttribute('aria-busy', 'false');
