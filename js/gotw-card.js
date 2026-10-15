// Goal of the week on the league page (S-05): one store for the latest round the office has put to a vote, shown in two places.
//   const gw = createGotw({ db, season, crest, accent, mine, now, hiddenFx, esc, rounds, onChange, afterDraw });
//   gw.refresh()            read the round, this manager's vote and (once voting has ended) the tally; calls onChange(gw.info()) when anything the page shows changed
//   gw.info()               { open, due }: voting is open; this manager has not voted yet (drives the Vote tab and its flashing dot)
//   gw.overview()           the Overview card's html ('' when no round has been put to a vote): a teaser while open, the result once ended
//   gw.mountVote(root)      draws the Vote tab into root and returns { unmount, draw }; the clip screen, the vote buttons and the countdown live there
//   gw.redraw()             draws the Vote tab again (a hidden result was shown)
// The screen is one element for the life of the tab: a vote or a refresh redraws the page around it, so the clip is never cut off.
import { ClipStage } from './goal-clip.js';
import { icon } from './icons.js';
import { overviewHtml, voteHtml, isOpen, ballot, left, nowLine } from './gotw-html.js';

export function createGotw({ db, season, crest, accent = () => '', mine, now = () => new Date(), hiddenFx = () => new Set(), esc, rounds = [], onChange, afterDraw }) {
  let state = null, page = null;
  const name = code => season.teams.find(t => t.code === code)?.name || code;
  const labelOf = w => rounds.find(r => r.week === w)?.label || `Round ${w}`;
  const info = () => ({ open: Boolean(state && isOpen(state.row, now())), due: Boolean(mine && state && isOpen(state.row, now()) && !state.myVote) });
  const sig = () => JSON.stringify([state?.row?.week, state?.row?.status, state?.row?.closes_at, state?.myVote, state?.tally]);

  async function load() {
    const c = await db();
    const { data: row } = await c.from('gotw_rounds').select('*').in('status', ['voting', 'closed']).order('week', { ascending: false }).limit(1).maybeSingle();
    if (!row?.finalists?.length) return null;
    const myVote = mine ? (await c.from('gotw_votes').select('pick').eq('week', row.week).maybeSingle()).data?.pick || null : null;
    const ended = !isOpen(row, now());
    const tally = ended ? ((await c.rpc('gotw_tally', { p_week: row.week })).data || []).map(r => ({ pick: r.pick, votes: Number(r.votes) })) : null;
    return { row, myVote, tally };
  }

  async function refresh() {
    const before = sig();
    try { state = await load(); } catch { return; }   // a read that fails changes nothing
    if (sig() !== before) { onChange?.(info()); page?.draw(); }
  }

  const data = extra => ({ row: state.row, mine, myVote: state.myVote, tally: state.tally, now: now(), hidden: hiddenFx(), label: labelOf(state.row.week), name, crest, esc, ...extra });
  const overview = () => (state ? overviewHtml(data()) : '');

  function mountVote(root) {
    let key = null, stage = null, screen = null, timer = null;
    const first = () => ballot(state.row, mine).find(m => !hiddenFx().has(m.fixture));
    const ensureScreen = () => {
      if (screen) return screen;
      screen = document.createElement('div');
      screen.className = 'gv-box';
      screen.innerHTML = `<canvas width="1280" height="720" aria-label="Goal clip"></canvas><button type="button" class="gv-play" aria-label="Pause">${icon('pause')}</button><div class="gv-msg">Loading the clip…</div>`;
      stage = new ClipStage(screen.querySelector('canvas'), season);
      const btn = screen.querySelector('.gv-play');
      stage.onState = on => { btn.innerHTML = icon(on ? 'pause' : 'play'); btn.setAttribute('aria-label', on ? 'Pause' : 'Play'); };
      btn.addEventListener('click', () => { if (stage.ready) stage.toggle(); });
      return screen;
    };
    function draw() {
      if (!state || !isOpen(state.row, now())) { root.innerHTML = ''; return; }
      root.innerHTML = voteHtml(data({ playing: key }));
      root.querySelector('.gv-screen').append(ensureScreen());
      const m = state.row.candidates.find(c => c.key === key);
      if (m) {
        root.querySelector('.gv-now').innerHTML = nowLine(m, esc, name);
        const card = root.querySelector('.gv-stage');
        card.style.setProperty('--gd', accent(m.team, 'dark')); card.style.setProperty('--gl', accent(m.team, 'light'));
      }
      afterDraw?.();
    }
    async function watch(k) {
      const m = state?.row.candidates.find(c => c.key === k); if (!m) return;
      key = k; draw(); ensureScreen(); const msg = screen.querySelector('.gv-msg'); msg.hidden = false; msg.textContent = 'Loading the clip…';
      try { await stage.show(m, { autoplay: true }); if (key === k) msg.hidden = true; }
      catch (e) { if (key === k) msg.textContent = e.message || 'The clip wouldn’t load.'; }
    }
    async function vote(k, btn) {
      btn.disabled = true;
      const { error } = await (await db()).rpc('gotw_vote', { p_week: state.row.week, p_pick: k });
      btn.disabled = false;
      if (error) { const n = root.querySelector('.gv-note'); if (n) n.textContent = error.message || 'Your vote didn’t go through. Try again.'; return; }
      state.myVote = k; onChange?.(info()); draw();
    }
    const onClick = e => {
      const w = e.target.closest('[data-gw-watch]'), v = e.target.closest('[data-gw-vote]');
      if (v) vote(v.dataset.gwVote, v); else if (w && !w.disabled) watch(w.dataset.gwWatch);
    };
    root.addEventListener('click', onClick);
    // The countdown is the one thing that moves by itself: its words change in place, nothing is redrawn.
    timer = setInterval(() => root.querySelectorAll('[data-until]').forEach(el => { const ms = Number(el.dataset.until) - Date.now(); el.textContent = ms > 0 ? `${left(ms)} left` : 'closing'; }), 20000);
    page = { draw, unmount() { clearInterval(timer); root.removeEventListener('click', onClick); stage?.destroy(); page = null; root.innerHTML = ''; } };
    if (state && isOpen(state.row, now())) { const m = first(); if (m) watch(m.key); else draw(); }
    return page;
  }

  return { refresh, info, overview, mountVote, redraw: () => page?.draw() };
}
