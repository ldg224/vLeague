// WR-44: a small pulsing dot on the header's Club button while the manager's line-up is due (the next round it plays has not locked and no team sheet is submitted for it).
//   watchLineupDue(clubCode) -> checks now and once a minute; the dot is added to / removed from the button in place (no redraw)
// With less than 24 hours to the lock and no team sheet submitted, one visit also gets a centred pop-up over a darkened page
// (red and orange silk, the display type): "Line-ups due shortly". Once per browser session, so it is every visit, not every page.
import { db } from './auth.js';

const DOT = '<i class="lg-due" title="Line-up due" role="img" aria-label="Line-up due"></i>';

// The club's next round that has not locked and that it plays in, and whether the club has submitted a team sheet for it.
async function nextRound(code) {
  const c = await db(), now = new Date().toISOString();
  const [dl, fx, subs] = await Promise.all([
    c.from('deadlines').select('week, locks_at').is('locked_at', null).gt('locks_at', now).neq('week', 99).order('locks_at'),
    c.from('fixtures').select('week, home, away, postponed').or(`home.eq.${code},away.eq.${code}`),
    c.from('submitted_sheets').select('week').eq('club', code),
  ]);
  if (dl.error || fx.error || subs.error) return null;
  const plays = new Set((fx.data || []).filter(f => !f.postponed).map(f => f.week));
  const next = (dl.data || []).find(d => plays.has(d.week));
  return next ? { lock: new Date(next.locks_at), submitted: (subs.data || []).some(s => s.week === next.week) } : null;
}

async function isDue(code) {
  const r = await nextRound(code);
  return !!r && !r.submitted;
}

// The next round's lock time, if it is under 24 hours away and this club has not submitted a team sheet for it.
async function urgent(code) {
  const r = await nextRound(code);
  return r && !r.submitted && r.lock - Date.now() < 864e5 ? r.lock : null;
}

const left = ms => { const m = Math.max(1, Math.round(ms / 6e4)), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };

async function pop(code) {
  try { if (sessionStorage.getItem('lu-seen')) return; } catch { /* shown again if storage is blocked */ }
  const lock = await urgent(code);
  if (!lock || document.querySelector('.lu-pop')) return;
  try { sessionStorage.setItem('lu-seen', '1'); } catch { /* ignore */ }
  const d = document.createElement('dialog');
  d.className = 'lu-pop'; d.setAttribute('aria-labelledby', 'lu-t');
  d.innerHTML = `<div class="lu-silk" aria-hidden="true"></div>
    <h2 id="lu-t">Line-ups due shortly</h2>
    <p class="lu-time">Locks in <b>${left(lock - Date.now())}</b></p>
    <p class="lu-note">Pick your XI before the deadline, or the engine picks for you.</p>
    <div class="lu-acts"><a class="lu-go" href="club.html">Pick your XI</a><button type="button" class="lu-later">Later</button></div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('.lu-later').addEventListener('click', () => d.close());
  d.showModal();
  d.querySelector('.lu-go').focus();
}

export function watchLineupDue(code) {
  if (!code) return;
  const paint = async () => {
    const btn = document.querySelector('.lg-tool.is-club');
    if (!btn) return;
    let due = false;
    try { due = await isDue(code); } catch { /* no dot if the check fails */ }
    const has = btn.querySelector('.lg-due');
    if (due && !has) btn.insertAdjacentHTML('beforeend', DOT);
    else if (!due && has) has.remove();
  };
  paint();
  pop(code).catch(() => {});
  setInterval(() => { if (!document.hidden) paint(); }, 60000);
}
