// The Stakes tab (MU-1): a fake-money over/under game on key players' match stats. Logged-in managers only; Coins have no value outside the league.
// The database does the money (supabase/migrations/0061_stakes.sql: wallet, lines, picks, settling); this file draws the tab and handles its clicks.
//
//   mountStakes(root, { crest(code, px) -> html, name(code) -> text, onFirstLoad? }) -> { unmount() }
//   stakesView(state, o) / helpers below are plain string builders so the tests can run them without a browser.
// One state object, one click handler on the root (data-st="side|stake|place|cancel|take|help"). The tab draws itself (it is not redrawn by the league page).
import { icon } from './icons.js';
import { startTour, tourSeen } from './tour.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const MULT = 1.9;
export const CHIPS = [10, 50, 100];
const STAT = { sv: ['Saves', 'saves'], pas: ['Passes', 'passes'], sot: ['Shots on target', 'shots on target'], tk: ['Tackles won', 'tackles won'] };
const POS = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' };
export const payout = stake => Math.floor(stake * MULT);
export const statName = s => (STAT[s] || [s])[0];

const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const kick = iso => `${dayFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso)).replace(/\s/g, ' ').toLowerCase()}`;
export function closesIn(iso, now = Date.now()) {
  const m = Math.floor((new Date(iso) - now) / 60000);
  if (m < 1) return 'Closing';
  if (m < 60) return `Closes in ${m} min`;
  if (m < 48 * 60) return `Closes in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `Closes in ${Math.floor(m / 1440)} days`;
}
const coins = n => Number(n).toLocaleString('en-AU');

// ---------- html ----------
const sideBtn = (l, side, mine, picked) => {
  const on = mine ? mine === side : picked?.line === l.line_id && picked.side === side;
  return `<button type="button" class="st-side ${side}${on ? ' on' : ''}" data-st="side" data-line="${l.line_id}" data-side="${side}" aria-pressed="${on}"${mine ? ' disabled' : ''}>${icon(side === 'over' ? 'chevron-up' : 'chevron-down')}<span>${side === 'over' ? 'Over' : 'Under'}</span></button>`;
};

function lineRow(l, st, o) {
  const mine = l.my_side, open = st.picked?.line === l.line_id;
  return `<div class="st-line${mine ? ' has-pick' : ''}${open ? ' is-open' : ''}" data-line-row="${l.line_id}">
    <div class="st-who"><b>${esc(l.player_name)}</b><span>${o.crest(l.team, 14)}<i>${POS[l.pos] || ''}</i> ${esc(o.name(l.team))}</span></div>
    <div class="st-num"><b>${l.line}</b><span>${esc(statName(l.stat))}</span></div>
    <div class="st-sides" role="group" aria-label="${esc(l.player_name)} ${esc(statName(l.stat))}, line ${l.line}">${sideBtn(l, 'under', mine, st.picked)}${sideBtn(l, 'over', mine, st.picked)}</div>
    ${mine ? `<div class="st-mine"><span>${mine === 'over' ? 'Over' : 'Under'} ${l.line} · <b>${coins(l.my_stake)}</b> Coins · pays <b>${coins(payout(l.my_stake))}</b></span><button type="button" class="st-link" data-st="take" data-line="${l.line_id}">Take back</button></div>` : ''}
    ${open ? stakePanel(l, st) : ''}
  </div>`;
}

function stakePanel(l, st) {
  const bal = st.wallet?.coins ?? 0, p = st.picked, chips = [...CHIPS.filter(c => c <= bal)];
  if (bal >= 10 && !chips.includes(bal)) chips.push(bal);
  return `<div class="st-stake">
    <div class="st-chips" role="group" aria-label="Stake">${chips.map(c => `<button type="button" class="st-chip${p.stake === c ? ' on' : ''}" data-st="stake" data-n="${c}" aria-pressed="${p.stake === c}">${c === bal && !CHIPS.includes(c) ? 'All in · ' : ''}${coins(c)}</button>`).join('')}</div>
    <p class="st-pays">${p.side === 'over' ? 'Over' : 'Under'} ${l.line} ${esc(STAT[l.stat]?.[1] || l.stat)} wins <b>${coins(payout(p.stake))}</b> Coins back</p>
    <div class="st-go"><button type="button" class="st-btn primary" data-st="place"${st.busy || p.stake < 10 || p.stake > bal ? ' disabled' : ''}>${st.busy ? 'Placing…' : `Stake ${coins(p.stake)}`}</button><button type="button" class="st-btn" data-st="cancel">Cancel</button></div>
  </div>`;
}

function matchCard(rows, st, o) {
  const f = rows[0];
  return `<section class="lg-card st-match" data-fixture="${esc(f.fixture)}">
    <div class="st-mhead">
      <div class="st-teams">${o.crest(f.home, 20)}<b>${esc(o.name(f.home))}</b><i>v</i>${o.crest(f.away, 20)}<b>${esc(o.name(f.away))}</b></div>
      <div class="st-when"><span>${esc(kick(f.starts_at))}</span><em class="st-close" data-closes="${esc(f.starts_at)}">${closesIn(f.starts_at)}</em></div>
    </div>
    ${rows.map(l => lineRow(l, st, o)).join('')}
  </section>`;
}

const RESULT = { won: 'Won', lost: 'Lost', void: 'Refunded', open: 'Open' };
function historyCard(h) {
  if (!h.length) return '';
  return `<section class="lg-card st-card" data-tour="history"><div class="lg-card-head"><h2>Your picks</h2></div>
    <ul class="st-list">${h.slice(0, 10).map(p => {
      const net = p.status === 'won' ? p.payout - p.stake : p.status === 'lost' ? -p.stake : 0;
      return `<li><div class="st-hl"><b>${esc(p.player_name)}</b><span>${p.side === 'over' ? 'Over' : 'Under'} ${p.line} ${esc(STAT[p.stat]?.[1] || p.stat)}${p.actual != null ? ` · got ${Number(p.actual)}` : ''}</span></div>
        <div class="st-hr ${p.status}"><b>${RESULT[p.status]}</b><span>${p.status === 'open' ? `${coins(p.stake)} riding` : p.status === 'void' ? 'Stake back' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${coins(Math.abs(net))}`}</span></div></li>`;
    }).join('')}</ul></section>`;
}

function boardCard(b, o) {
  const top = b.filter(r => r.rank <= 10 || r.mine);
  return `<section class="lg-card st-card" data-tour="board"><div class="lg-card-head"><h2>Leaderboard</h2></div>
    ${top.length ? `<ol class="st-board">${top.map(r => `<li class="${r.mine ? 'me' : ''}"><i class="st-rank">${r.rank}</i>${r.club ? o.crest(r.club, 18) : ''}<span class="st-bn"><b>${esc(r.name)}</b><em>${r.settled ? `${r.won} of ${r.settled} right` : 'No picks settled yet'}</em></span><b class="st-bc">${coins(r.coins)}</b></li>`).join('')}</ol>`
      : '<p class="st-empty">Nobody is on the board yet.</p>'}</section>`;
}

export function stakesView(st, o) {
  if (st.error && !st.wallet) return `<section class="lg-card st-card"><div class="lg-card-head"><h2>Stakes</h2></div><p class="st-empty">${esc(st.error)}</p></section>`;
  if (!st.wallet) return '<section class="lg-card st-card"><div class="lg-card-head"><h2>Stakes</h2></div><p class="st-empty">Opening your wallet…</p></section>';
  const open = st.slate.filter(l => l.my_status === 'open'), riding = open.reduce((s, l) => s + l.my_stake, 0);
  const groups = [...st.slate.reduce((m, l) => m.set(l.fixture, [...(m.get(l.fixture) || []), l]), new Map()).values()];
  const note = st.msg ? `<p class="st-note${st.msg.bad ? ' bad' : ''}" role="status">${esc(st.msg.text)}</p>` : '';
  return `<div class="st">
    <section class="lg-card st-wallet" data-tour="wallet">
      <div class="st-wl"><span class="st-eyebrow">${icon('coins')} Your Coins</span><b class="st-coins">${coins(st.wallet.coins)}</b>
        <span class="st-sub">${open.length ? `${open.length} pick${open.length === 1 ? '' : 's'} riding · ${coins(riding)} Coins` : 'Nothing riding'} · Coins are for fun and bragging rights only</span></div>
      <button type="button" class="st-btn" data-st="help">${icon('circle-help')}<span>How it works</span></button>
    </section>
    ${note}
    <div class="lg-cols"><div class="lg-main">
      ${groups.length ? groups.map(g => matchCard(g, st, o)).join('')
        : `<section class="lg-card st-card"><div class="lg-card-head"><h2>Lines</h2></div><p class="st-empty">${st.loading ? 'Loading the lines…' : 'No lines open yet. Lines appear for a match once a club has submitted its team sheet, up to a week before kick-off.'}</p></section>`}
    </div><aside class="lg-side">${boardCard(st.board, o)}${historyCard(st.history)}</aside></div>
  </div>`;
}

// ---------- the tour ----------
export const STEPS = [
  { target: '[data-tour="wallet"]', title: 'Your Coins', text: 'Stakes is a game of calls on real players. You start with 1,000 Coins and get 200 more each day. They are for fun only: nothing to buy, nothing to lose.' },
  { target: '.st-line', title: 'A line', text: 'Each match has lines on its key players: the number is what the league has set as that player’s stat for the match. For example a keeper’s saves, or a midfielder’s passes.' },
  { target: '.st-line .st-sides', title: 'Over or under', text: 'Think the player will do more than the line? Pick Over. Fewer? Pick Under. Lines end in .5, so there is always a winner.', pick: true },
  { target: '.st-stake', title: 'Stake some Coins', text: 'Choose how many Coins to put on it. Get it right and you get 1.9 times your stake back; get it wrong and the stake is gone. You can take a pick back until kick-off.' },
  { target: '[data-tour="board"]', title: 'The leaderboard', text: 'Picks settle by themselves once the match is played. The richest managers sit at the top.' },
];

// ---------- the page ----------
export function mountStakes(root, o) {
  const st = { wallet: null, slate: [], board: [], history: [], picked: null, busy: false, msg: null, loading: true, error: '' };
  let gone = false, timer = 0, tick = 0, toured = false;
  const draw = () => {
    if (gone) return;
    const y = scrollY, a = document.activeElement, was = a?.closest?.('.st') ? a.dataset : null;
    root.innerHTML = stakesView(st, o);
    if (was?.st) root.querySelector(`[data-st="${was.st}"]${was.line ? `[data-line="${was.line}"]` : ''}${was.side ? `[data-side="${was.side}"]` : ''}${was.n ? `[data-n="${was.n}"]` : ''}`)?.focus({ preventScroll: true });
    scrollTo(0, y);
  };
  const rpc = async (name, args) => { const { db } = await import('./auth.js');   // loaded when first used, so the pure builders above run in node
    const { data, error } = await (await db()).rpc(name, args); if (error) throw error; return data; };
  const say = (text, bad = false) => { st.msg = { text, bad }; };
  const load = async (first = false) => {
    try {
      const w = (await rpc('stakes_wallet'))?.[0];
      const [slate, board, history] = await Promise.all([rpc('stakes_slate'), rpc('stakes_board'), rpc('stakes_history', { p_limit: 20 })]);
      st.wallet = w; st.slate = slate || []; st.board = board || []; st.history = history || []; st.error = '';
      if (first && w?.bonus > 0) say(w.bonus >= 200 ? `Daily top-up: +${w.bonus} Coins.` : `Topped up to ${coins(st.wallet.coins)} Coins so you can keep playing.`);
    } catch (e) { st.error = 'Stakes could not load. Check your connection and refresh.'; }
    st.loading = false; draw();
    if (first && !toured && st.wallet && !tourSeen('stakes')) { toured = true; setTimeout(() => !gone && tour(), 600); }
  };
  const tour = () => startTour(STEPS, {
    key: 'stakes',
    before: step => { if (step.pick) { const l = st.slate.find(x => !x.my_side); if (l) { st.picked = { line: l.line_id, side: 'over', stake: Math.min(50, st.wallet.coins) }; draw(); } } else if (!step.target.includes('st-stake') && !step.target.includes('sides')) { if (st.picked) { st.picked = null; draw(); } } },
  });

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-st]');
    if (!b || b.disabled) return;
    const act = b.dataset.st, line = Number(b.dataset.line);
    st.msg = null;
    if (act === 'help') { st.picked = null; draw(); tour(); return; }
    if (act === 'side') {
      const same = st.picked?.line === line && st.picked.side === b.dataset.side;
      st.picked = same ? null : { line, side: b.dataset.side, stake: Math.min(50, st.wallet.coins) };
      draw(); return;
    }
    if (act === 'stake') { st.picked.stake = Number(b.dataset.n); draw(); return; }
    if (act === 'cancel') { st.picked = null; draw(); return; }
    if (act === 'place' && st.picked) {
      st.busy = true; draw();
      try {
        const { line: id, side, stake } = st.picked;
        await rpc('stakes_place', { p_line: id, p_side: side, p_stake: stake });
        st.picked = null; say(`Staked ${coins(stake)} Coins.`);
      } catch (err) { say(err.message || 'That stake did not go through.', true); }
      st.busy = false; await load(); return;
    }
    if (act === 'take') {
      try { await rpc('stakes_cancel', { p_line: line }); say('Pick taken back. Your Coins are returned.'); } catch (err) { say(err.message || 'That pick could not be taken back.', true); }
      await load();
    }
  });

  const refresh = () => { if (!document.hidden && !st.picked && !st.busy) load(); };
  timer = setInterval(refresh, 60000);
  tick = setInterval(() => root.querySelectorAll('[data-closes]').forEach(el => { el.textContent = closesIn(el.dataset.closes); }), 30000);
  draw(); load(true);
  return { unmount() { gone = true; clearInterval(timer); clearInterval(tick); document.querySelector('.tour')?.remove(); root.innerHTML = ''; } };
}
