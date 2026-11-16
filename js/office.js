// The Office (S-35 GM Update): a manager runs his club's wages and squad. office.html#squad | #market | #trade(/CODE) | #clubs(/CODE) | #history.
// The league header card, then the Office card (the club, the budget bar: wage bill against the cap, room left, the window, releases left) with the tabs.
//   Squad    your players by position, each with his wage and a Release button (a confirm step shows the new bill and room first)
//   Market   free agents, filter by position, sort; Sign (the same confirm step)
//   Trade    the builder: your players | the value meter | their players; Send offer. Offers to you (Accept, Reject, Counter) and yours (Withdraw)
//   Clubs    any club's squad, wage bill and room; Make an offer
//   History  every move in the league, newest first
// The database (supabase/migrations/0091_office.sql) checks every move; js/office-model.js does the same sums first so a button can say why it is off.
// Localhost only, to look at it without signing in: office.html?preview&mine=TUR&theme=light#trade (made-up players, no database; moves work in memory).
import { chrome, esc, clubs as loadClubs, crestUrl } from './member.js';
import { currentUser, myProfile, db } from './auth.js';
import { paintClub, startSilk } from './shell.js';
import { mountSubFrame } from './frame.js';
import { crest, useClubs } from './places.js';
import { paint } from './paint.js';
import { icon } from './icons.js';
import { portrait } from './portrait.js';
import { plink } from './player-link.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { POSITIONS, POS_NAME, money, bill, rulesFrom, rosterOf, check, after, windowText, windowReason, tradeView, balance, fairness, when } from './office-model.js';
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
const ui = { confirm: null, err: null, note: null, busy: false, mkt: { pos: 'ALL', sort: 'wage' }, trade: { other: null, give: [], get: [], counter: null } };

const clubRow = code => S.clubs.find(c => c.code === code);
const team = code => { const r = clubRow(code); return { code, name: r?.name || code, colour: r?.colour }; };
// A club's crest; a club with no crest uploaded shows its coloured initials (places.js would show an empty space).
const crestOf = (code, px) => { const h = crest(team(code), px); return clubRow(code)?.crest_path ? h : h.replace('class="crest"', 'class="crest none"').replace(/<img[^>]*>/, ''); };
const clubName = code => clubRow(code)?.short_name || clubRow(code)?.name || code;
const squadOf = code => S.players.filter(p => p.team === code);
const playerById = id => S.players.find(p => p.id === id);
const cap = () => Number(S.st?.cap ?? 125000);
const rules = () => rulesFrom(S.st?.roster);
const win = () => S.st?.window || { status: 'closed' };

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
  };
}

async function load() {
  const [st, players, moves] = await Promise.all([api.state().catch(e => ({ error: explain(e) })), api.players(), api.moves().catch(() => [])]);
  S.players = players; S.moves = moves || [];
  if (st?.error) {
    S.readOnly = st.error;
    const set = await api.settings?.().catch(() => null);
    S.st = { cap: set?.cap ?? 125000, window: { status: set?.window_open ? 'open' : 'closed', closes_at: set?.closes_at, opens_at: set?.opens_at }, roster: null, offers_in: [], offers_out: [] };
  } else { S.st = st; S.my = st.club; S.readOnly = ''; }
}

// ---------------------------------------------------------------- pieces
const face = (p, size = 36) => `<span class="of-face">${portrait(p, p.team ? clubRow(p.team) : null, size, true)}</span>`;
const pos = p => `<span class="of-pos pos-${esc(p.position)}">${POS_SHORT[p.position] || esc(p.position)}</span>`;
const rate = (label, v) => `<span class="of-rt" title="${label}"><small>${label}</small>${Number(v) || 0}</span>`;
const btn = (label, data, o = {}) => `<button type="button" class="of-btn${o.primary ? ' primary' : ''}${o.quiet ? ' quiet' : ''}" ${data}${o.off ? ` disabled title="${esc(o.off)}"` : ''}>${o.icon ? icon(o.icon) : ''}<span>${label}</span></button>`;
const errAt = key => (ui.err?.key === key ? `<p class="of-err" role="alert">${icon('triangle-alert')}${esc(ui.err.text)}</p>` : '');
const noteAt = key => (ui.note?.key === key ? `<p class="of-ok" role="status">${icon('check')}${esc(ui.note.text)}</p>` : '');
const roomText = (b, c = cap()) => (b > c ? `<b class="of-over">Over the cap by ${money(b - c)}</b>` : `<b>${money(c - b)}</b> room`);

// The budget bar: the wage bill against the cap, and a second shade for where a move would take it.
function budgetBar(b, nextBill = null) {
  const c = cap(), top = Math.max(c, b, nextBill ?? 0) * 1.04, pct = v => `${Math.min(100, v / top * 100).toFixed(2)}%`;
  const capAt = pct(c), nb = nextBill ?? b;
  const cls = b > c ? ' over' : '';
  return `<div class="of-bar${cls}${nextBill != null ? ' has-next' : ''}" role="img" aria-label="Wage bill ${money(b)} of the ${money(c)} cap${nextBill != null ? `, ${money(nextBill)} after this move` : ''}">
    <i class="of-bar-fill" style="width:${pct(Math.min(b, nb))}"></i>
    ${nextBill != null && nb !== b ? `<i class="of-bar-delta ${nb > b ? 'up' : 'down'}" style="left:${pct(Math.min(b, nb))};width:${pct(Math.abs(nb - b))}"></i>` : ''}
    <i class="of-bar-cap" style="left:${capAt}"><span>Cap ${money(c)}</span></i>
  </div>`;
}

// What a pending confirm would do to the bill (for the header bar).
function pendingBill() {
  const c = ui.confirm, mine = squadOf(S.my);
  if (!c) return null;
  if (c.kind === 'release') return bill(mine.filter(p => p.id !== c.id));
  if (c.kind === 'sign') { const p = playerById(c.id); return p ? bill(mine) + p.value : null; }
  return null;
}

function headCard() {
  const tab = here().tab;
  const tabs = `<nav class="of-tabs" aria-label="Office">${TABS.map(([id, label]) => `<a href="#${id}" data-tab="${id}"${tab === id ? ' aria-current="page"' : ''}>${label}${id === 'trade' && S.st?.offers_in?.length ? `<i class="of-count" aria-label="${S.st.offers_in.length} offers to you">${S.st.offers_in.length}</i>` : ''}</a>`).join('')}</nav>`;
  const w = win(), wOpen = w.status === 'open';
  const winPill = `<span class="of-win ${wOpen ? 'open' : 'shut'}"><i></i>${esc(windowText(w))}</span>`;
  if (!S.my) {
    return `<section class="lg-card of-head"><div class="of-id"><span class="of-id-ic">${icon('briefcase')}</span><div><h1>Office</h1><p class="of-sub">${esc(S.readOnly || 'Every club’s squad and wages, and the league’s moves.')}</p></div>${winPill}</div>${tabs}</section>`;
  }
  const mine = squadOf(S.my), b = bill(mine), c = cap(), nb = pendingBill(), r = S.st.releases || { left: 0, limit: 0 };
  const ro = rosterOf(mine, rules());
  const shortAt = POSITIONS.filter(p => ro.positions[p].count < ro.positions[p].min);
  return `<section class="lg-card of-head">
    <div class="of-id">${crestOf(S.my, 44)}<div><h1>${esc(clubName(S.my))} Office</h1><p class="of-sub">Wages, signings and trades</p></div>${winPill}</div>
    <div class="of-budget">
      <div class="of-figs">
        <p><span>Wage bill</span><b>${money(b)}</b>${nb != null && nb !== b ? `<em class="${nb > b ? 'up' : 'down'}">${icon('arrow-right')}${money(nb)}</em>` : ''}</p>
        <p class="of-room${b > c ? ' over' : ''}"><span>${b > c ? 'Over the cap by' : 'Room left'}</span><b>${money(Math.abs(c - b))}</b>${nb != null && nb !== b ? `<em class="${nb > c ? 'up' : 'down'}">${icon('arrow-right')}${nb > c ? `${money(nb - c)} over` : money(c - nb)}</em>` : ''}</p>
        <p><span>Releases left</span><b>${r.left} of ${r.limit}</b></p>
        <p><span>Squad</span><b>${mine.length}</b>${shortAt.length ? `<em class="up">${shortAt.join(', ')} short</em>` : ''}</p>
      </div>
      ${budgetBar(b, nb)}
      ${b > c && nb == null ? `<p class="of-hint">${icon('triangle-alert')}You are over the cap: until you are under it, you can only make moves that lower your wage bill.</p>` : ''}
    </div>
    ${tabs}
  </section>`;
}

// One player row. `act` is the html for the right-hand end.
const playerRow = (p, act = '', o = {}) => `<li class="of-row${o.on ? ' on' : ''}${o.cls ? ` ${o.cls}` : ''}"${o.attrs || ''}>
    ${face(p)}
    <span class="of-who">${plink(p.id, `<b>${esc(p.name)}</b>`)}<small>${pos(p)}${o.club ? `<span class="of-club">${esc(clubName(p.team))}</span>` : ''}${p.number != null ? `<span>#${esc(p.number)}</span>` : ''}</small></span>
    <span class="of-rts">${rate('ATT', p.offense)}${rate('DEF', p.defense)}</span>
    <span class="of-wage">${money(p.value)}</span>
    ${act}
  </li>`;

const confirmBox = (key, title, lines, yes, data) => `<li class="of-confirm" data-key="${key}">
    <div><p><b>${title}</b></p><p>${lines}</p>${errAt(key)}</div>
    <div class="of-acts">${btn('Cancel', 'data-of="cancel"', { quiet: true })}${btn(yes, data, { primary: true })}</div>
  </li>`;

// ---------------------------------------------------------------- Squad
function squadTab() {
  if (!S.my) return `<section class="lg-card"><p class="of-empty">${esc(S.readOnly || 'Only a club manager has a squad here.')} Look at any club in <a href="#clubs">Clubs</a>.</p></section>`;
  const mine = squadOf(S.my), ro = rosterOf(mine, rules()), w = windowReason(win()), r = S.st.releases || { left: 0 };
  const why = p => w || (r.left <= 0 ? `You have used all ${r.limit} releases for this window.` : check({ squad: mine, cap: cap(), rules: rules(), out: [p] }));
  const groups = POSITIONS.map(ps => {
    const list = mine.filter(p => p.position === ps).sort((a, b) => b.value - a.value), g = ro.positions[ps];
    const short = g.count < g.min, rows = list.map(p => {
      if (ui.confirm?.kind === 'release' && ui.confirm.id === p.id) {
        const a = after({ squad: mine, cap: cap(), out: [p] });
        return playerRow(p, '<span class="of-act"></span>', { on: true }) + confirmBox(`rel-${p.id}`, `Release ${esc(p.name)}?`,
          `He becomes a free agent. Your wage bill goes to <b>${money(a.bill)}</b>, ${a.over ? `<b class="of-over">${money(a.bill - cap())} over the cap</b>` : `<b>${money(a.room)}</b> room`}. ${r.left - 1} release${r.left - 1 === 1 ? '' : 's'} left after this.`,
          'Release player', `data-of="release" data-id="${esc(p.id)}"`);
      }
      const off = why(p);
      return playerRow(p, `<span class="of-act">${btn('Release', `data-of="ask-release" data-id="${esc(p.id)}"`, { off })}</span>`) + (ui.err?.key === `rel-${p.id}` ? `<li class="of-errrow">${errAt(`rel-${p.id}`)}</li>` : '');
    }).join('');
    return `<li class="of-strip pos-${ps}"><h3>${POS_NAME[ps]}</h3><span class="${short ? 'of-short' : ''}">${g.count} of ${g.min === g.max ? g.min : `${g.min} to ${g.max}`}${short ? ` · ${g.min - g.count} short` : ''}</span></li>${rows || '<li class="of-none">Nobody here. Sign one in the Market.</li>'}`;
  }).join('');
  const off = windowReason(win());
  return `<div class="of-cols"><section class="lg-card of-list-card">
      <div class="lg-card-head"><h2>Squad</h2><span class="of-meta">${mine.length} players · ${money(bill(mine))}</span></div>
      ${noteAt('squad')}${off ? `<p class="of-hint">${icon('lock')}${esc(off)} You can look, but not release.</p>` : (S.st.releases?.left ?? 0) <= 0 ? `<p class="of-hint">${icon('triangle-alert')}You have used all your releases for this window. You can still sign and trade.</p>` : ro.short ? `<p class="of-hint">${icon('triangle-alert')}You are a player short. Sign or trade for one before you release another.</p>` : ''}
      <ul class="of-rows">${groups}</ul>
    </section>${sideCard()}</div>`;
}

function sideCard() {
  const ins = S.st?.offers_in || [], outs = S.st?.offers_out || [];
  const recent = S.moves.filter(m => m.club === S.my || m.other_club === S.my).slice(0, 4);
  return `<aside class="of-side">
    <section class="lg-card"><div class="lg-card-head"><h2>Offers</h2><a href="#trade">Trade</a></div>
      <ul class="of-mini">
        <li><span>${icon('inbox')}Offers to you</span><b>${ins.length}</b></li>
        <li><span>${icon('send')}Your offers waiting</span><b>${outs.length}</b></li>
      </ul></section>
    <section class="lg-card"><div class="lg-card-head"><h2>How it works</h2></div>
      <ul class="of-how">
        <li>A player’s wage is his value. Your wage bill is your squad’s wages, and it must stay under the ${money(cap())} cap.</li>
        <li>Over the cap, you can only make moves that bring your bill down.</li>
        <li>Moves happen while the office has the transfer window open, never during a round.</li>
        <li>You may be one player short at most: release one, then sign or trade for one before the next.</li>
      </ul></section>
    ${recent.length ? `<section class="lg-card"><div class="lg-card-head"><h2>Your moves</h2><a href="#history">History</a></div><ul class="of-hist">${recent.map(moveRow).join('')}</ul></section>` : ''}
  </aside>`;
}

// ---------------------------------------------------------------- Market
const SORTS = [['wage', 'Wage: high'], ['cheap', 'Wage: low'], ['att', 'Attack'], ['def', 'Defence']];
function marketTab() {
  const { pos: fp, sort } = ui.mkt;
  const sorter = { wage: (a, b) => b.value - a.value, cheap: (a, b) => a.value - b.value, att: (a, b) => b.offense - a.offense, def: (a, b) => b.defense - a.defense }[sort];
  const all = S.players.filter(p => !p.team), list = all.filter(p => fp === 'ALL' || p.position === fp).sort(sorter);
  const mine = S.my ? squadOf(S.my) : null, w = windowReason(win());
  const why = p => !S.my ? 'Only a club manager can sign players.' : w || check({ squad: mine, cap: cap(), rules: rules(), inn: [p] });
  const pill = (k, v, label, on) => `<button type="button" class="of-pill" data-of="${k}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
  const rows = list.map(p => {
    if (ui.confirm?.kind === 'sign' && ui.confirm.id === p.id) {
      const a = after({ squad: mine, cap: cap(), inn: [p] });
      return playerRow(p, '<span class="of-act"></span>', { on: true }) + confirmBox(`sign-${p.id}`, `Sign ${esc(p.name)}?`,
        `His wage is ${money(p.value)}. Your wage bill goes to <b>${money(a.bill)}</b>, ${a.over ? `<b class="of-over">${money(a.bill - cap())} over the cap</b>` : `<b>${money(a.room)}</b> room left`}.`,
        'Sign player', `data-of="sign" data-id="${esc(p.id)}"`);
    }
    const off = why(p), fx = S.my ? after({ squad: mine, cap: cap(), inn: [p] }) : null;
    return playerRow(p, `<span class="of-act">${fx ? `<small class="of-fx${fx.over ? ' over' : ''}">${fx.over ? `${money(fx.bill - cap())} over` : `${money(fx.room)} room after`}</small>` : ''}${btn('Sign', `data-of="ask-sign" data-id="${esc(p.id)}"`, { off, primary: !off })}</span>`)
      + (ui.err?.key === `sign-${p.id}` ? `<li class="of-errrow">${errAt(`sign-${p.id}`)}</li>` : '');
  }).join('');
  return `<section class="lg-card of-list-card">
    <div class="lg-card-head"><h2>Free agents</h2><span class="of-meta">${all.length} available</span></div>
    ${noteAt('market')}
    <div class="of-filters">
      <div class="of-pills" role="group" aria-label="Position">${['ALL', ...POSITIONS].map(p => pill('mpos', p, p === 'ALL' ? 'All' : p, fp === p)).join('')}</div>
      <div class="of-pills" role="group" aria-label="Sort by">${SORTS.map(([k, l]) => pill('msort', k, l, sort === k)).join('')}</div>
    </div>
    ${w && S.my ? `<p class="of-hint">${icon('lock')}${esc(w)} You can look, but not sign.</p>` : S.my ? marketHint(mine) : ''}
    <ul class="of-rows">${rows || '<li class="of-none">No free agents in that position.</li>'}</ul>
  </section>`;
}

// Why most Sign buttons are off, said once above the list.
function marketHint(mine) {
  const ro = rosterOf(mine, rules()), full = POSITIONS.filter(p => ro.positions[p].count >= ro.positions[p].max);
  if (bill(mine) > cap()) return `<p class="of-hint">${icon('triangle-alert')}You are over the cap, so you can’t sign anyone until your wage bill is under ${money(cap())}.</p>`;
  if (full.length === POSITIONS.length) return `<p class="of-hint">${icon('triangle-alert')}Your squad is full. Release a player in the Squad tab first, then sign one in his position.</p>`;
  if (full.length) return `<p class="of-hint">${icon('triangle-alert')}You can sign a ${POSITIONS.filter(p => !full.includes(p)).join(' or ')} now; the other positions are full.</p>`;
  return '';
}

// ---------------------------------------------------------------- Trade
const pickRow = (p, side, on) => `<li><button type="button" class="of-pick${on ? ' on' : ''}" data-of="pick" data-side="${side}" data-id="${esc(p.id)}" aria-pressed="${on}">
    <span class="of-tick">${icon('check')}</span>${face(p, 32)}
    <span class="of-who"><b>${esc(p.name)}</b><small>${pos(p)}<span>ATT ${p.offense} · DEF ${p.defense}</span></small></span>
    <span class="of-wage">${money(p.value)}</span></button></li>`;
const pickList = (list, side, chosen) => `<ul class="of-rows of-picks">${POSITIONS.map(ps => {
  const l = list.filter(p => p.position === ps).sort((a, b) => b.value - a.value);
  return l.length ? `<li class="of-strip pos-${ps}"><h3>${POS_NAME[ps]}</h3><span>${l.length}</span></li>${l.map(p => pickRow(p, side, chosen.includes(p.id))).join('')}` : '';
}).join('')}</ul>`;

function meter(tv, other) {
  const bal = balance(tv.giveTotal, tv.getTotal), needle = 50 + bal * 50;
  const fx = (label, x, c) => `<div class="of-fxrow"><span>${label}</span><b>${money(x.before)} ${icon('arrow-right')} ${money(x.bill)}</b><small class="${x.over ? 'over' : ''}">${x.over ? `${money(x.bill - c)} over the cap` : `${money(x.room)} room`}</small></div>`;
  const status = (x, who) => (tv.empty ? '' : x.why ? `<p class="of-chk bad">${icon('x')}${esc(x.why)}</p>` : `<p class="of-chk ok">${icon('check')}${who}: cap and squad rules met</p>`);
  return `<div class="of-meter">
    <div class="of-sides"><div><span>You give</span><b>${money(tv.giveTotal)}</b><small>${tv.give.length} player${tv.give.length === 1 ? '' : 's'}</small></div>
      <div><span>You get</span><b>${money(tv.getTotal)}</b><small>${tv.get.length} player${tv.get.length === 1 ? '' : 's'}</small></div></div>
    <div class="of-scale" aria-hidden="true"><i style="left:${needle.toFixed(1)}%"></i></div>
    <p class="of-fair">${tv.empty ? 'Pick players on both sides to see the deal.' : `${esc(fairness(tv.giveTotal, tv.getTotal))}${tv.diff ? `, ${money(Math.abs(tv.diff))} ${tv.diff > 0 ? 'to you' : `to ${esc(clubName(other))}`}` : ''}`}</p>
    ${fx('Your bill', tv.me, cap())}${fx(`${esc(clubName(other))} bill`, tv.them, cap())}
    ${status(tv.me, 'You')}${status(tv.them, esc(clubName(other)))}
  </div>`;
}

function offerRow(o, dir) {
  const other = dir === 'in' ? o.from_club : o.to_club;
  const names = list => list.length ? list.map(p => `${esc(p.name)} <small>${money(p.wage)}</small>`).join(', ') : '<small>nobody</small>';
  const sum = list => list.reduce((t, p) => t + Number(p.wage || 0), 0);
  const youGet = dir === 'in' ? o.give : o.get, youGive = dir === 'in' ? o.get : o.give;
  const w = windowReason(win()), key = `offer-${o.id}`;
  const acts = dir === 'in'
    ? `${btn('Reject', `data-of="reject" data-id="${o.id}"`, { quiet: true })}${btn('Counter', `data-of="counter" data-id="${o.id}"`, { off: w })}${btn('Accept', `data-of="accept" data-id="${o.id}"`, { primary: !w, off: w })}`
    : btn('Withdraw', `data-of="withdraw" data-id="${o.id}"`, { quiet: true });
  return `<li class="of-offer">
    <div class="of-offer-h">${crestOf(other, 24)}<b>${esc(clubName(other))}</b><small>${o.reply_to ? 'Counter-offer · ' : ''}${esc(when(o.created_at))}</small></div>
    <p><span>You get</span>${names(youGet)}<em>${money(sum(youGet))}</em></p>
    <p><span>You give</span>${names(youGive)}<em>${money(sum(youGive))}</em></p>
    ${errAt(key)}<div class="of-acts">${acts}</div></li>`;
}

function tradeTab() {
  const ins = S.st?.offers_in || [], outs = S.st?.offers_out || [];
  const offers = `<section class="lg-card"><div class="lg-card-head"><h2>Offers</h2><span class="of-meta">${ins.length} to you · ${outs.length} from you</span></div>
      ${noteAt('offers')}
      <h3 class="of-sh">To you</h3><ul class="of-offers">${ins.map(o => offerRow(o, 'in')).join('') || '<li class="of-none">No offers to you right now.</li>'}</ul>
      <h3 class="of-sh">From you</h3><ul class="of-offers">${outs.map(o => offerRow(o, 'out')).join('') || '<li class="of-none">You have no offers waiting. Build one above.</li>'}</ul></section>`;
  if (!S.my) return `<section class="lg-card"><p class="of-empty">${esc(S.readOnly || 'Only a club manager can trade.')}</p></section>`;
  const t = ui.trade, others = S.clubs.filter(c => c.code !== S.my);
  const picker = `<div class="of-clubpick" role="group" aria-label="Trade with">${others.map(c => `<button type="button" class="of-clubbtn" data-of="trade-with" data-v="${esc(c.code)}" aria-pressed="${t.other === c.code}">${crestOf(c.code, 20)}<span>${esc(c.short_name || c.code)}</span></button>`).join('')}</div>`;
  if (!t.other) return `<section class="lg-card"><div class="lg-card-head"><h2>New trade</h2></div><p class="of-lead">Pick a club to trade with.</p>${picker}</section>${offers}`;
  const mine = squadOf(S.my), theirs = squadOf(t.other);
  const tv = tradeView({ mine, theirs, give: t.give, get: t.get, cap: cap(), rules: rules(), them: clubName(t.other) });
  const w = windowReason(win()), plain = w || (tv.empty ? 'Put at least one player in the deal.' : ''), off = plain || tv.me.why || tv.them.why;
  const counterOf = t.counter ? (S.st.offers_in || []).find(o => o.id === t.counter) : null;
  return `<section class="lg-card of-trade">
      <div class="lg-card-head"><h2>${counterOf ? 'Counter-offer' : 'New trade'}</h2>${counterOf ? `<button type="button" class="of-link" data-of="trade-reset">Cancel counter</button>` : `<span class="of-meta">Players only, no cash</span>`}</div>
      ${counterOf ? `<p class="of-lead">Change the deal ${esc(clubName(t.other))} sent you, then send it back. Their offer closes when you do.</p>` : picker}
      <div class="of-builder">
        <div class="of-panel"><h3>${crestOf(S.my, 20)}Your players</h3>${pickList(mine, 'give', t.give)}</div>
        <div class="of-mid">${meter(tv, t.other)}
          ${errAt('trade')}${noteAt('trade')}
          <div class="of-send">${btn(counterOf ? 'Send counter-offer' : 'Send offer', 'data-of="send"', { primary: !off, off, icon: 'send' })}</div>
          ${plain ? `<p class="of-why">${esc(plain)}</p>` : off ? '<p class="of-why">Change the deal until both clubs meet the rules.</p>' : ''}
        </div>
        <div class="of-panel"><h3>${crestOf(t.other, 20)}${esc(clubName(t.other))}’s players</h3>${pickList(theirs, 'get', t.get)}</div>
      </div>
    </section>${offers}`;
}

// ---------------------------------------------------------------- Clubs
function clubsTab() {
  const sel = here().sub || S.my || S.clubs[0]?.code;
  const c = cap();
  const list = S.clubs.map(r => { const sq = squadOf(r.code); return { r, b: bill(sq), n: sq.length }; }).sort((a, b) => a.b - b.b);
  const rows = list.map(({ r, b, n }) => `<li><a class="of-clubrow${r.code === sel ? ' on' : ''}${r.code === S.my ? ' mine' : ''}" href="#clubs/${esc(r.code)}">
      ${crestOf(r.code, 24)}<span class="of-who"><b>${esc(r.name)}</b><small>${n} players</small></span>
      <span class="of-cb"><b>${money(b)}</b><small class="${b > c ? 'over' : ''}">${b > c ? `${money(b - c)} over` : `${money(c - b)} room`}</small></span></a></li>`).join('');
  const sq = squadOf(sel), b = bill(sq);
  const detail = sel ? `<section class="lg-card of-list-card">
      <div class="of-clubhead">${crestOf(sel, 40)}<div><h2>${esc(clubRow(sel)?.name || sel)}</h2><p>${roomText(b)} · wage bill ${money(b)}</p></div>
        ${S.my && sel !== S.my ? `<a class="of-btn primary" href="#trade/${esc(sel)}">${icon('arrow-left-right')}<span>Make an offer</span></a>` : ''}</div>
      ${budgetBar(b)}
      <ul class="of-rows">${POSITIONS.map(ps => { const l = sq.filter(p => p.position === ps).sort((a, b2) => b2.value - a.value); return `<li class="of-strip pos-${ps}"><h3>${POS_NAME[ps]}</h3><span>${l.length}</span></li>${l.map(p => playerRow(p)).join('')}`; }).join('')}</ul>
    </section>` : '';
  return `<div class="of-cols of-cols-l"><section class="lg-card"><div class="lg-card-head"><h2>Clubs</h2><span class="of-meta">Lowest wage bill first</span></div><ul class="of-clubs">${rows}</ul></section>${detail}</div>`;
}

// ---------------------------------------------------------------- History
function moveRow(m) {
  const names = ids => (ids || []).map(id => esc(playerById(id)?.name || id)).join(', ');
  const kind = { release: ['user-minus', 'Released'], sign: ['user-plus', 'Signed'], trade: ['arrow-left-right', 'Trade'] }[m.kind] || ['arrow-left-right', m.kind];
  const text = m.kind === 'release' ? `<b>${esc(clubName(m.club))}</b> released ${names(m.players_out)}`
    : m.kind === 'sign' ? `<b>${esc(clubName(m.club))}</b> signed ${names(m.players_in)}`
    : `<b>${esc(clubName(m.club))}</b> sent ${names(m.players_out) || 'nobody'} to <b>${esc(clubName(m.other_club))}</b> for ${names(m.players_in) || 'nobody'}`;
  return `<li class="of-move${m.undone_at ? ' undone' : ''}"><span class="of-mk ${m.kind}">${icon(kind[0])}</span>${crestOf(m.club, 22)}
    <span class="of-who"><span>${text}</span><small>${kind[1]} · ${esc(when(m.made_at))}${m.undone_at ? ' · undone by the office' : ''}</small></span>
    <span class="of-cb"><small>${esc(clubName(m.club))} bill</small><b>${money(m.bill_after)}</b></span></li>`;
}
function historyTab() {
  return `<section class="lg-card of-list-card"><div class="lg-card-head"><h2>Moves</h2><span class="of-meta">Newest first</span></div>
    <ul class="of-hist">${S.moves.map(moveRow).join('') || '<li class="of-none">No moves yet. Releases, signings and trades show here as they happen.</li>'}</ul></section>`;
}

// ---------------------------------------------------------------- page
function here() {
  const [tab, ...rest] = location.hash.slice(1).split('/');
  return { tab: TABS.some(t => t[0] === tab) ? tab : 'squad', sub: rest.join('/') };
}
function render() {
  const { tab } = here();
  const body = { squad: squadTab, market: marketTab, trade: tradeTab, clubs: clubsTab, history: historyTab }[tab]();
  paint(main, `<div class="of">${headCard()}${body}</div>`);
}

async function act(key, fn, okText, noteKey) {
  if (ui.busy) return;
  ui.busy = true; ui.err = null; main.classList.add('of-busy');
  try {
    await fn();
    ui.confirm = null; ui.note = { key: noteKey, text: okText() };
    await load();
  } catch (e) { ui.err = { key, text: explain(e) }; }
  ui.busy = false; main.classList.remove('of-busy');
  render();
}

function onHash() {
  const { tab, sub } = here();
  if (tab === 'trade' && sub && sub !== ui.trade.other && clubRow(sub) && sub !== S.my) ui.trade = { other: sub, give: [], get: [], counter: null };
  ui.confirm = null; ui.err = null; ui.note = null;
  render();
}

main.addEventListener('click', e => {
  const b = e.target.closest('[data-of]');
  if (!b || b.disabled) return;
  const k = b.dataset.of, id = b.dataset.id, v = b.dataset.v;
  const nameOf = pid => playerById(pid)?.name || 'The player';
  if (k === 'ask-release' || k === 'ask-sign') { ui.confirm = { kind: k.slice(4), id }; ui.err = null; ui.note = null; return render(); }
  if (k === 'cancel') { ui.confirm = null; ui.err = null; return render(); }
  if (k === 'release') return act(`rel-${id}`, () => api.release(id), () => `${nameOf(id)} released. He is a free agent now.`, 'squad');
  if (k === 'sign') return act(`sign-${id}`, () => api.sign(id), () => `${nameOf(id)} signed. Your wage bill is ${money(bill(squadOf(S.my)))}.`, 'market');
  if (k === 'mpos') { ui.mkt.pos = v; return render(); }
  if (k === 'msort') { ui.mkt.sort = v; return render(); }
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
  if (k === 'accept') return act(`offer-${id}`, () => api.respond(Number(id), true), () => 'Trade done. The players have moved.', 'offers');
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
addEventListener('hashchange', onHash);
addEventListener('keydown', e => { if (e.key === 'Escape' && ui.confirm) { ui.confirm = null; render(); } });

try {
  const user = preview ? { id: 'preview' } : await currentUser().catch(() => null);
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }   // signed-out visitors only see sign-in (WR-02)
  if (preview && q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  let prof;
  if (preview) {
    const demo = previewOffice({ mine: q.get('mine') || 'TUR', office: q.has('office'), window: q.get('window') });
    S.clubs = demo.clubs; api = demo.api; prof = { role: q.has('office') ? 'office' : 'manager', club: q.has('office') ? null : (q.get('mine') || 'TUR') };
  } else {
    [S.clubs, prof] = await Promise.all([loadClubs().catch(() => []), myProfile().catch(() => null)]);
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
