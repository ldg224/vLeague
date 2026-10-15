// The Goal of the week card on the league page's Overview (S-05). Shows the latest round the office has put to a vote:
//   while voting is open: the five goals, a screen that plays each as a 5-second clip, and one vote per manager (changeable until it ends; never for your own club's goal);
//   once it has ended: the tally, the winner first. The tally is hidden until then (the database refuses to give it out).
//   const gw = createGotw({ db, season, crest, mine, now, hiddenFx, esc, rounds });   gw.attach(slotEl)   gw.draw()
// The card owns its slot: it is drawn here, not by the Overview's paint(), so the playing clip is never replaced by a redraw. The screen (canvas) is one element
// kept for good and moved into each new draw.
import { ClipStage } from './goal-clip.js';
import { icon } from './icons.js';
import { gotwHtml } from './gotw-html.js';

export function createGotw({ db, season, crest, mine, now = () => new Date(), hiddenFx = () => new Set(), esc, rounds = [] }) {
  let slot = null, state = null, stage = null, screen = null, key = null, ready = false;
  const name = code => season.teams.find(t => t.code === code)?.name || code;
  const labelOf = w => rounds.find(r => r.week === w)?.label || `Round ${w}`;

  async function load() {
    const c = await db();
    const { data: row } = await c.from('gotw_rounds').select('*').in('status', ['voting', 'closed']).order('week', { ascending: false }).limit(1).maybeSingle();
    if (!row?.finalists?.length) { state = null; return; }
    const mineVote = mine ? (await c.from('gotw_votes').select('pick').eq('week', row.week).maybeSingle()).data?.pick || null : null;
    const ended = row.status === 'closed' || (row.closes_at && new Date(row.closes_at) <= now());
    const tally = ended ? ((await c.rpc('gotw_tally', { p_week: row.week })).data || []).map(r => ({ pick: r.pick, votes: Number(r.votes) })) : null;
    state = { row, myVote: mineVote, tally };
  }

  function screenEl() {
    if (screen) return screen;
    screen = document.createElement('div');
    screen.className = 'gwc-stagebox';
    screen.innerHTML = `<canvas width="1280" height="720" aria-label="Goal clip"></canvas><button type="button" class="gwc-play" aria-label="Play">${icon('play')}</button><div class="gwc-msg">Tap a goal to watch its 5 seconds.</div>`;
    stage = new ClipStage(screen.querySelector('canvas'), season);
    const btn = screen.querySelector('.gwc-play'), msg = screen.querySelector('.gwc-msg');
    stage.onState = on => { btn.innerHTML = icon(on ? 'pause' : 'play'); btn.setAttribute('aria-label', on ? 'Pause' : 'Play'); screen.classList.toggle('playing', on); };
    btn.addEventListener('click', () => (stage.ready ? stage.toggle() : null));
    screen.msg = msg;
    return screen;
  }

  function draw() {
    if (!slot) return;
    if (!state) { slot.innerHTML = ''; return; }
    const { row, myVote, tally } = state;
    slot.innerHTML = gotwHtml({ row, mine, myVote, tally, now: now(), hidden: hiddenFx(), label: labelOf(row.week), name, crest, esc });
    const box = slot.querySelector('.gwc-screen');
    if (box) box.append(screenEl());
    slot.querySelectorAll('.gwc-row').forEach(li => li.classList.toggle('now', li.querySelector('[data-gw-watch]')?.dataset.gwWatch === key));
  }

  async function watch(k) {
    const m = state.row.candidates.find(c => c.key === k); if (!m) return;
    key = k; screenEl(); screen.msg.hidden = false; screen.msg.textContent = 'Loading the clip…';
    slot.querySelectorAll('.gwc-row').forEach(li => li.classList.toggle('now', li.querySelector('[data-gw-watch]')?.dataset.gwWatch === k));
    try { await stage.show(m, { autoplay: true }); if (key === k) screen.msg.hidden = true; }
    catch (e) { if (key === k) screen.msg.textContent = e.message || 'The clip wouldn’t load.'; }
  }

  async function vote(k, btn) {
    btn.disabled = true;
    const { error } = await (await db()).rpc('gotw_vote', { p_week: state.row.week, p_pick: k });
    btn.disabled = false;
    if (error) { const n = slot.querySelector('.gwc-note'); if (n) n.textContent = error.message || 'Your vote didn’t go through. Try again.'; return; }
    state.myVote = k; draw();
  }

  const onClick = e => {
    const w = e.target.closest('[data-gw-watch]'), v = e.target.closest('[data-gw-vote]');
    if (v) vote(v.dataset.gwVote, v); else if (w && !w.disabled) watch(w.dataset.gwWatch);
  };
  return {
    // Give the card its slot (the Overview makes a new one each time it is drawn). The first call also reads the round.
    async attach(el) {
      slot = el;
      if (el && !el._gw) { el._gw = true; el.addEventListener('click', onClick); }
      if (!ready) { ready = true; try { await load(); } catch { state = null; } }
      draw();
    },
    draw,
  };
}
