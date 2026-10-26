// The Stakes tab (MU-1): a fake-money over/under game on key players' match stats. Logged-in managers only; Coins have no value outside the league.
// The database does the money (supabase/migrations/0061_stakes.sql: wallet, lines, picks, settling); this file draws the tab and handles its clicks.
//
//   mountStakes(root, { crest(code, px) -> html, name(code) -> text, club(code) -> { colour, colour2 } }) -> { unmount() }   (the portraits are loaded here)
//   stakesView(state, o) / helpers below are plain string builders so the tests can run them without a browser.
// One state object, one click handler on the root (data-st="side|stake|place|cancel|take|help"). The tab draws itself (it is not redrawn by the league page).
import { icon } from './icons.js';
import { portrait } from './portrait.js';
import { startTour, tourSeen } from './tour.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

// The game's numbers come from the office's settings (stakes_settings, Editor > Stakes). These are what a page shows until they have loaded.
export const DEFAULTS = { score_exact_mult: 8, score_result_mult: 2, multiplier: 1.9, min_stake: 10, max_stake: 0, betting_open: true, show_board: true, start_coins: 1000, daily_topup: 200, lock_minutes: 0 };
const STAT = { sv: ['Saves', 'saves'], pas: ['Passes', 'passes'], sot: ['Shots on target', 'shots on target'], tk: ['Tackles won', 'tackles won'] };
const POS = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' };
export const payout = (stake, mult = DEFAULTS.multiplier) => Math.floor(stake * Number(mult));
// The stake buttons: the smallest stake, five times and ten times that (10, 50, 100 by default), within the biggest stake and what you hold, then everything you may stake.
export function stakeChips(cfg, bal) {
  const lo = cfg.min_stake, cap = cfg.max_stake > 0 ? Math.min(cfg.max_stake, bal) : bal, chips = [lo, lo * 5, lo * 10].filter(c => c <= cap);
  if (cap >= lo && !chips.includes(cap)) chips.push(cap);
  return chips;
}
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
// One card per stake, in the way Stadium Live does it. Every card in a round is the same height and the same shape, so a row always lines up: the card never grows
// (the stake chooser slides over its lower part instead), and the grid picks a number of columns that fills every row (bestCols), so there is never one card left
// alone underneath.
const SIDE_ICON = { under: 'chevron-down', over: 'chevron-up' };
const sideBtn = (l, side, mine, picked, closed) => {
  const on = mine ? mine === side : picked?.line === l.line_id && picked.side === side;
  return `<button type="button" class="st-side ${side}${on ? ' on' : ''}${mine && !on ? ' off' : ''}" data-st="side" data-line="${l.line_id}" data-side="${side}" aria-pressed="${on}"${mine || closed ? ' disabled' : ''}>${icon(SIDE_ICON[side])}<span>${side === 'over' ? 'Over' : 'Under'}</span></button>`;
};
// The starting stake on a card: five times the smallest if you can, else the first button.
export function defaultStakeFor(cfg, bal) { const c = stakeChips(cfg, bal); return c.includes(cfg.min_stake * 5) ? cfg.min_stake * 5 : c[0] ?? cfg.min_stake; }
// A goal count one step up or down, held between 0 and 9.
export const stepGoals = (n, d) => Math.max(0, Math.min(9, n + d));
// How many columns fill every row for n cards, at most `max` across: an exact fit if there is one (8 in 4s, 9 in 3s, 10 in 5s), else the one whose last row is fullest
// (7 in 4+3); nearer to 4 wins a tie. Never one card alone on the last row unless there is only one row.
export function bestCols(n, max = 4) {
  if (n <= 1) return 1;
  let best = 1, bestScore = -1;
  for (let c = Math.min(max, n); c >= 2; c--) {
    const rem = n % c, score = (rem === 0 ? 100 : rem === 1 ? 0 : rem) * 10 - Math.abs(c - 4);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}
const colourOf = (o, code) => { const c = o.club?.(code)?.colour; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4a6fa5'; };

function stakeCard(l, st, o) {
  if (l.kind === 'score') return scoreCard(l, st, o);
  const mine = l.my_side, open = st.picked?.line === l.line_id, closed = st.cfg ? !st.cfg.betting_open : false;
  const face = o.face?.(l.player_id, l.team, 132) || o.crest(l.team, 96);
  const opp = l.team === l.home ? l.away : l.home;
  const foot = mine
    ? `<p class="st-pickline"><b class="is-${mine}">${mine === 'over' ? 'Over' : 'Under'} ${l.line}</b> · ${coins(l.my_stake)} Coins · pays <b>${coins(payout(l.my_stake, l.my_mult))}</b> <button type="button" class="st-link" data-st="take" data-line="${l.line_id}">Take back</button></p>`
    : l.usual != null ? `<p class="st-avg">Averages ${Number(l.usual).toFixed(1)} a match</p>` : '';
  return `<article class="lg-card st-stake${mine ? ' has-pick' : ''}${open ? ' is-open' : ''}" data-line-card="${l.line_id}" style="--cc:${colourOf(o, l.team)}">
    <div class="st-top"><span class="st-pos">${POS[l.pos] || ''}</span><div class="st-photo">${face}</div>
      <em class="st-close" data-closes="${esc(l.locks_at || l.starts_at)}">${closesIn(l.locks_at || l.starts_at)}</em></div>
    <div class="st-info">
      <h3 class="st-pname">${esc(l.player_name)}</h3>
      <p class="st-vs">${o.crest(l.team, 18)}<b>${esc(o.name(l.team))}</b><i>v</i><span>${esc(o.name(opp))}</span></p>
      <p class="st-when">${esc(kick(l.starts_at))}</p>
      <div class="st-lineblock"><b class="st-linenum">${l.line}</b><span class="st-statname">${esc(statName(l.stat))}</span></div>
      ${foot}
    </div>
    <div class="st-sides" role="group" aria-label="${esc(l.player_name)} ${esc(statName(l.stat))}, line ${l.line}">${sideBtn(l, 'under', mine, st.picked, closed)}${sideBtn(l, 'over', mine, st.picked, closed)}</div>
    ${open ? stakePanel(l, st) : ''}
  </article>`;
}

// A score prediction: both clubs, the two scores with a + and a - under each (hold to run), and one bar to stake. The chooser slides over the card.
function scoreCard(l, st, o) {
  const cfg = st.cfg || DEFAULTS, bal = st.wallet?.coins ?? 0, mine = l.my_status != null && l.my_home != null;
  const sc = st.sc?.[l.line_id] || { h: 1, a: 1, stake: defaultStakeFor(cfg, bal) };
  const closed = st.cfg ? !st.cfg.betting_open : false;
  const h = mine ? l.my_home : sc.h, a = mine ? l.my_away : sc.a;
  const exact = Number(mine ? l.my_mult : cfg.score_exact_mult ?? DEFAULTS.score_exact_mult), res = Number(mine ? l.my_mult2 : cfg.score_result_mult ?? DEFAULTS.score_result_mult);
  const col = (code, side) => `<div class="st-sc-col"><span class="st-sc-club">${o.crest(code, 40)}<b>${esc(o.name(code))}</b></span>
      <b class="st-sc-num" data-score="${side}" aria-live="polite">${side === 'h' ? h : a}</b>
      ${mine ? '<div class="st-stepper is-locked"><span>Your guess</span></div>' : `<div class="st-stepper" role="group" aria-label="${esc(o.name(code))} goals"><button type="button" class="st-step" data-st="step" data-line="${l.line_id}" data-which="${side}" data-d="-1" aria-label="One fewer goal for ${esc(o.name(code))}"${(side === 'h' ? h : a) <= 0 || closed ? ' disabled' : ''}>${icon('minus')}</button><button type="button" class="st-step" data-st="step" data-line="${l.line_id}" data-which="${side}" data-d="1" aria-label="One more goal for ${esc(o.name(code))}"${(side === 'h' ? h : a) >= 9 || closed ? ' disabled' : ''}>${icon('plus')}</button></div>`}</div>`;
  const foot = mine
    ? `<div class="st-scorefoot is-mine"><p class="st-pickline"><b class="is-over">${h}–${a}</b> · ${coins(l.my_stake)} Coins<br>exact pays <b>${coins(payout(l.my_stake, exact))}</b>, result <b>${coins(payout(l.my_stake, res))}</b> <button type="button" class="st-link" data-st="take" data-line="${l.line_id}">Take back</button></p></div>`
    : `<div class="st-scorefoot"><button type="button" class="st-stakebtn" data-st="sopen" data-line="${l.line_id}"${closed ? ' disabled' : ''}>${icon('coins')}<span>Stake on ${h}–${a}</span></button></div>`;
  return `<article class="lg-card st-stake st-scorecard${mine ? ' has-pick' : ''}${sc.open && !mine ? ' is-open' : ''}" data-line-card="${l.line_id}" style="--cc:${colourOf(o, l.home)};--ca:${colourOf(o, l.away)}">
    <div class="st-top st-scoretop"><span class="st-pos">SCORE</span><em class="st-close" data-closes="${esc(l.locks_at || l.starts_at)}">${closesIn(l.locks_at || l.starts_at)}</em>
      <p class="st-scoreask">Guess the score</p></div>
    <div class="st-scorebox">${col(l.home, 'h')}<i class="st-dash">–</i>${col(l.away, 'a')}</div>
    <p class="st-when st-scorewhen">${esc(kick(l.starts_at))}</p>
    ${foot}
    ${sc.open && !mine ? scoreSheet(l, st, o, sc, exact, res) : ''}
  </article>`;
}

const chipHtml = (chips, cfg, bal, on, attrs) => chips.map(c => `<button type="button" class="st-chip${on === c ? ' on' : ''}" ${attrs} data-n="${c}" aria-pressed="${on === c}">${c === chips.at(-1) && c !== cfg.min_stake && c !== cfg.min_stake * 5 && c !== cfg.min_stake * 10 ? (c === bal ? 'All in · ' : 'Biggest · ') : ''}${coins(c)}</button>`).join('');
const canStake = (cfg, bal, stake) => stake >= cfg.min_stake && (cfg.max_stake <= 0 || stake <= cfg.max_stake) && stake <= bal;

function stakePanel(l, st) {
  const cfg = st.cfg || DEFAULTS, bal = st.wallet?.coins ?? 0, p = st.picked, chips = stakeChips(cfg, bal);
  return `<div class="st-sheet is-${p.side}">
    <p class="st-sheet-title"><b>${p.side === 'over' ? 'Over' : 'Under'} ${l.line}</b> ${esc(STAT[l.stat]?.[1] || l.stat)}</p>
    <div class="st-chips" role="group" aria-label="Stake">${chipHtml(chips, cfg, bal, p.stake, 'data-st="stake"')}</div>
    <p class="st-pays">Wins <b>${coins(payout(p.stake, cfg.multiplier))}</b> Coins back</p>
    <div class="st-go"><button type="button" class="st-btn primary is-${p.side}" data-st="place"${st.busy || !canStake(cfg, bal, p.stake) ? ' disabled' : ''}>${st.busy ? 'Placing…' : `Stake ${coins(p.stake)}`}</button><button type="button" class="st-btn" data-st="cancel">Cancel</button></div>
  </div>`;
}

function scoreSheet(l, st, o, sc, exact, res) {
  const cfg = st.cfg || DEFAULTS, bal = st.wallet?.coins ?? 0, chips = stakeChips(cfg, bal);
  return `<div class="st-sheet st-sheet-score is-over">
    <p class="st-sheet-title"><b>${esc(o.name(l.home))} ${sc.h}–${sc.a} ${esc(o.name(l.away))}</b></p>
    <div class="st-chips" role="group" aria-label="Stake">${chipHtml(chips, cfg, bal, sc.stake, `data-st="sstake" data-line="${l.line_id}"`)}</div>
    <p class="st-pays">Exact score pays <b>${coins(payout(sc.stake, exact))}</b>, the right result <b>${coins(payout(sc.stake, res))}</b> (home win, draw or away win)</p>
    <div class="st-go"><button type="button" class="st-btn primary is-over" data-st="placescore" data-line="${l.line_id}"${st.busy || !canStake(cfg, bal, sc.stake) ? ' disabled' : ''}>${st.busy ? 'Placing…' : `Stake ${coins(sc.stake)} on ${sc.h}–${sc.a}`}</button><button type="button" class="st-btn" data-st="sclose" data-line="${l.line_id}">Back</button></div>
  </div>`;
}

// A round's stakes: a heading, then the cards in a grid whose columns fill every row.
function roundSection(rows, st, o) {
  const n = rows.length, vars = `--c-lg:${bestCols(n, 5)};--c-md:${bestCols(n, 3)};--c-sm:${bestCols(n, 2)}`;
  return `<section class="st-round"><div class="st-roundhead"><h2>Round ${rows[0].week} stakes</h2><span>${n} stake${n === 1 ? '' : 's'}</span></div>
    <div class="st-grid" style="${vars}">${rows.map(l => stakeCard(l, st, o)).join('')}</div></section>`;
}

const RESULT = { won: 'Won', lost: 'Lost', void: 'Refunded', open: 'Open' };
function historyCard(h) {
  if (!h.length) return '';
  return `<section class="lg-card st-card" data-tour="history"><div class="lg-card-head"><h2>Your picks</h2></div>
    <ul class="st-list">${h.slice(0, 10).map(p => {
      const net = p.status === 'won' ? p.payout - p.stake : p.status === 'lost' ? -p.stake : 0;
      const title = p.kind === 'score' ? 'Score prediction' : p.player_name, what = p.kind === 'score' ? `${p.pred_home}–${p.pred_away}${p.act_home != null ? ` · it finished ${p.act_home}–${p.act_away}` : ''}` : `${p.side === 'over' ? 'Over' : 'Under'} ${p.line} ${STAT[p.stat]?.[1] || p.stat}${p.actual != null ? ` · got ${Number(p.actual)}` : ''}`;
      return `<li><div class="st-hl"><b>${esc(title)}</b><span>${esc(what)}</span></div>
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
  const rounds = [...st.slate.reduce((m, l) => m.set(l.week, [...(m.get(l.week) || []), l]), new Map()).values()];
  const closedNote = st.cfg && !st.cfg.betting_open ? '<p class="st-note" role="status">Stakes is closed for now. You can look, but picks are paused until the league opens it again.</p>' : '';
  const note = closedNote + (st.msg ? `<p class="st-note${st.msg.bad ? ' bad' : ''}" role="status">${esc(st.msg.text)}</p>` : '');
  return `<div class="st">
    <section class="lg-card st-wallet" data-tour="wallet">
      <div class="st-wl"><span class="st-eyebrow">${icon('coins')} Your Coins</span><b class="st-coins">${coins(st.wallet.coins)}</b>
        <span class="st-sub">${open.length ? `${open.length} pick${open.length === 1 ? '' : 's'} riding · ${coins(riding)} Coins` : 'Nothing riding'} · Coins are for fun and bragging rights only</span></div>
      <button type="button" class="st-btn" data-st="help">${icon('circle-help')}<span>How it works</span></button>
    </section>
    ${note}
    ${rounds.length ? rounds.map(g => roundSection(g, st, o)).join('')
      : `<section class="lg-card st-card"><div class="lg-card-head"><h2>Stakes</h2></div><p class="st-empty">${st.loading ? 'Loading the stakes…' : 'No stakes open yet. A round’s stakes appear once clubs have submitted their team sheets.'}</p></section>`}
    <div class="st-bottom">${st.cfg && !st.cfg.show_board ? '' : boardCard(st.board, o)}${historyCard(st.history)}</div>
  </div>`;
}

// ---------- the tour ----------
export const stepsFor = (cfg, hasScore = false) => [
  { target: '[data-tour="wallet"]', title: 'Your Coins', text: `Stakes is a game of calls on real players. You start with ${Number(cfg.start_coins).toLocaleString('en-AU')} Coins${cfg.daily_topup > 0 ? ` and get ${Number(cfg.daily_topup).toLocaleString('en-AU')} more each day` : ''}. They are for fun only: nothing to buy, nothing to lose.` },
  { target: '.st-stake', title: 'A stake', text: 'Each card is one player in one match, and the big number is the league’s line for his stat: a keeper’s saves, a midfielder’s passes, a forward’s shots on target. There are only a few each round.' },
  { target: '.st-stake .st-sides', title: 'Over or under', text: 'Think he’ll do more than the line? Tap blue OVER. Fewer? Tap red UNDER. Lines end in .5, so there is always a winner.', pick: true },
  ...(hasScore ? [{ target: '.st-scorecard', title: 'Guess the score', text: `Some stakes ask for the final score of a match. Use + and − under each team (hold to run), then stake. The exact score pays ${Number(cfg.score_exact_mult)} times your stake; the right result with the wrong score pays ${Number(cfg.score_result_mult)} times.` }] : []),
  { target: '.st-sheet', title: 'Stake some Coins', text: `Choose how many Coins to put on it. Get it right and you get ${Number(cfg.multiplier)} times your stake back; get it wrong and the stake is gone. You can take a pick back until picks close${cfg.lock_minutes > 0 ? ` (${cfg.lock_minutes} minutes before kick-off)` : ' (kick-off)'}.` },
  { target: '[data-tour="board"]', title: 'The leaderboard', text: 'Picks settle by themselves once the match is played. The richest managers sit at the top.' },
];
export const STEPS = stepsFor(DEFAULTS);

// ---------- the intro ----------
// A short moment when the tab opens: a coin drops in and spins, STAKES rises letter by letter, then the page's cards slide up. It fills the visible
// screen (not the whole page, which may be taller) while the numbers load behind it, so it never delays them. A tap, a key or Escape skips it; nothing plays for
// anyone who asked for reduced motion.
export const WORD = 'STAKES';
export const introHtml = () => `<div class="st-intro" aria-hidden="true"><div class="st-introin">
  <svg class="st-coin" viewBox="0 0 64 64"><defs><linearGradient id="st-cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--blue-300)"/><stop offset="1" stop-color="var(--blue-700)"/></linearGradient></defs>
    <circle cx="32" cy="32" r="29" fill="url(#st-cg)"/><circle cx="32" cy="32" r="22.5" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="3 3"/><text x="32" y="42" text-anchor="middle" class="st-coinmark">S</text><path class="st-glint" d="M10 52L52 8" /></svg>
  <div class="st-word">${[...WORD].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</div></div></div>`;
const reducedMotion = () => document.documentElement.classList.contains('reduce-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
// Plays the intro over `root`; resolves when it is gone. `app` then gets the staggered rise of its cards for a moment.
function playIntro(root, app) {
  if (reducedMotion()) return Promise.resolve();
  return new Promise(done => {
    document.documentElement.classList.add('st-intro-open');   // the page waits behind, un-scrollable, for the two seconds
    root.insertAdjacentHTML('beforeend', introHtml());
    const el = root.querySelector('.st-intro');
    let over = false;
    const end = () => {
      if (over) return; over = true;
      removeEventListener('keydown', end, true);
      el.classList.add('is-out');
      app.querySelectorAll('.lg-card').forEach((c, i) => c.style.setProperty('--k', Math.min(i, 8)));
      app.classList.add('st-reveal');
      setTimeout(() => { el.remove(); document.documentElement.classList.remove('st-intro-open'); done(); }, 420);
      setTimeout(() => app.classList.remove('st-reveal'), 1700);
    };
    el.addEventListener('pointerdown', end);
    addEventListener('keydown', end, true);
    setTimeout(end, 2100);
  });
}

// ---------- the page ----------
export function mountStakes(root, o0) {
  const o = { ...o0 }, faces = new Map();
  // The players' portraits (js/portrait.js), read once; the cards show the club's crest until they are in.
  o.face = (id, code, px) => { const p = faces.get(String(id)); return p ? portrait(p, { code, ...(o0.club?.(code) || {}) }, px, true) : ''; };
  const st = { cfg: null, sc: {}, wallet: null, slate: [], board: [], history: [], picked: null, busy: false, msg: null, loading: true, error: '' };
  let gone = false, timer = 0, tick = 0, toured = false;
  root.innerHTML = '<div class="st-app"></div>';
  const app = root.querySelector('.st-app');
  const intro = playIntro(root, app);
  const draw = () => {
    if (gone) return;
    const y = scrollY, a = document.activeElement, was = a?.closest?.('.st') ? a.dataset : null;
    app.innerHTML = stakesView(st, o);
    if (was?.st) app.querySelector(`[data-st="${was.st}"]${was.line ? `[data-line="${was.line}"]` : ''}${was.side ? `[data-side="${was.side}"]` : ''}${was.n ? `[data-n="${was.n}"]` : ''}`)?.focus({ preventScroll: true });
    scrollTo(0, y);
  };
  const defaultStake = () => defaultStakeFor(st.cfg || DEFAULTS, st.wallet?.coins ?? 0);
  const scoreOf = id => (st.sc[id] ||= { h: 1, a: 1, stake: defaultStake() });
  const rpc = async (name, args) => { const { db } = await import('./auth.js');   // loaded when first used, so the pure builders above run in node
    const { data, error } = await (await db()).rpc(name, args); if (error) throw error; return data; };
  const say = (text, bad = false) => { st.msg = { text, bad }; };
  const load = async (first = false) => {
    try {
      st.cfg = await rpc('stakes_config');   // the office's settings (Editor > Stakes)
      const w = (await rpc('stakes_wallet'))?.[0];
      const [slate, board, history] = await Promise.all([rpc('stakes_slate'), rpc('stakes_board'), rpc('stakes_history', { p_limit: 20 })]);
      st.wallet = w; st.slate = slate || []; st.board = board || []; st.history = history || []; st.error = '';
      if (first && w?.bonus > 0) say(st.cfg && w.bonus === st.cfg.daily_topup ? `Daily top-up: +${w.bonus} Coins.` : `Topped up to ${coins(st.wallet.coins)} Coins so you can keep playing.`);
    } catch (e) { st.error = /not open yet/.test(e?.message || '') ? 'Stakes isn’t open yet. The league will switch it on soon.' : 'Stakes could not load. Check your connection and refresh.'; }
    st.loading = false; draw();
    if (first && !faces.size) import('./players-data.js').then(m => m.loadPlayers()).then(list => { list.forEach(p => faces.set(String(p.id), p)); draw(); }).catch(() => {});
    if (first && !toured && st.wallet && !tourSeen('stakes')) { toured = true; intro.then(() => setTimeout(() => !gone && tour(), 600)); }
  };
  const tour = () => startTour(stepsFor(st.cfg || DEFAULTS, st.slate.some(x => x.kind === 'score')), {
    key: 'stakes',
    before: step => { if (step.pick) { const l = st.slate.find(x => !x.my_side); if (l) { st.picked = { line: l.line_id, side: 'over', stake: defaultStake() }; draw(); } } else if (!step.target.includes('st-sheet') && !step.target.includes('sides')) { if (st.picked) { st.picked = null; draw(); } } },
  });

  // The + and - under a score: a press steps once, holding runs on (the page redraws each step, so the repeat belongs to the page, not the button).
  let hold = 0, holdAfter = 0;
  const stepNow = b => { const sc = scoreOf(Number(b.dataset.line)); sc[b.dataset.which] = stepGoals(sc[b.dataset.which], Number(b.dataset.d)); st.msg = null; draw(); };
  const stopHold = () => { clearTimeout(holdAfter); clearInterval(hold); };
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-st="step"]');
    if (!b || b.disabled || e.button > 0) return;
    stepNow(b);
    const d = b.dataset.d, line = b.dataset.line, which = b.dataset.which;
    holdAfter = setTimeout(() => { hold = setInterval(() => { const nb = root.querySelector(`[data-st="step"][data-line="${line}"][data-which="${which}"][data-d="${d}"]`); if (!nb || nb.disabled) stopHold(); else stepNow(nb); }, 120); }, 420);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) root.addEventListener(t, stopHold);
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-st]');
    if (!b || b.disabled) return;
    const act = b.dataset.st, line = Number(b.dataset.line);
    if (act === 'step') { if (e.detail === 0) stepNow(b); return; }   // a mouse or finger already stepped on pointerdown; Enter or Space come here
    st.msg = null;
    if (act === 'sopen') { st.picked = null; for (const k of Object.keys(st.sc)) st.sc[k].open = false; scoreOf(line).open = true; draw(); return; }
    if (act === 'sclose') { scoreOf(line).open = false; draw(); return; }
    if (act === 'sstake') { scoreOf(line).stake = Number(b.dataset.n); draw(); return; }
    if (act === 'placescore') {
      const sc = scoreOf(line); st.busy = true; draw();
      try { await rpc('stakes_place_score', { p_line: line, p_home: sc.h, p_away: sc.a, p_stake: sc.stake }); delete st.sc[line]; say(`Staked ${coins(sc.stake)} Coins on ${sc.h}–${sc.a}.`); }
      catch (err) { say(err.message || 'That stake did not go through.', true); }
      st.busy = false; await load(); return;
    }
    if (act === 'help') { st.picked = null; draw(); tour(); return; }
    if (act === 'side') {
      const same = st.picked?.line === line && st.picked.side === b.dataset.side;
      st.picked = same ? null : { line, side: b.dataset.side, stake: defaultStake() };
      for (const k of Object.keys(st.sc)) st.sc[k].open = false;
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
  return { unmount() { gone = true; clearInterval(timer); clearInterval(tick); document.querySelector('.tour')?.remove(); document.documentElement.classList.remove('st-intro-open'); root.innerHTML = ''; } };
}
