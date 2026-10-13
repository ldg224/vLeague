// WR-44: a small pulsing dot on the header's Club button while the manager's line-up is due (a deadline is still open and no XI is saved).
//   watchLineupDue(clubCode) -> checks now and once a minute; the dot is added to / removed from the button in place (no redraw)
// With less than 24 hours to the lock and the XI not (re)saved in that time, one visit also gets a centred pop-up over a darkened page
// (red and orange silk, the display type): "Line-ups due shortly". Once per browser session, so it is every visit, not every page.
import { db } from './auth.js';

const DOT = '<i class="lg-due" title="Line-up due" role="img" aria-label="Line-up due"></i>';

async function isDue(code) {
  const c = await db(), now = new Date().toISOString();
  const [dl, sheet] = await Promise.all([
    c.from('deadlines').select('week').is('locked_at', null).gt('locks_at', now).limit(1),
    c.from('team_sheets').select('lineup').eq('club', code).maybeSingle(),
  ]);
  if (dl.error || sheet.error || !dl.data?.length) return false;
  return !Object.keys(sheet.data?.lineup || {}).length;
}

// The nearest open deadline, if it is under 24 hours away and this club has not saved its XI since that window began.
async function urgent(code) {
  const c = await db(), now = Date.now(), soon = new Date(now + 864e5).toISOString();
  const [dl, sheet] = await Promise.all([
    c.from('deadlines').select('locks_at').is('locked_at', null).gt('locks_at', new Date(now).toISOString()).lt('locks_at', soon).order('locks_at').limit(1),
    c.from('team_sheets').select('updated_at').eq('club', code).maybeSingle(),
  ]);
  const lock = dl.data?.[0] && new Date(dl.data[0].locks_at);
  if (dl.error || !lock) return null;
  const saved = sheet.data?.updated_at && new Date(sheet.data.updated_at) > new Date(+lock - 864e5);
  return saved ? null : lock;
}

const left = ms => { const m = Math.max(1, Math.round(ms / 6e4)), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };

const FORCE_TEST = true;   // TEMP: shows the pop-up on every load with a pretend lock 5 h away, to judge the look. Remove after the user confirms.

async function pop(code) {
  try { if (!FORCE_TEST && sessionStorage.getItem('lu-seen')) return; } catch { /* shown again if storage is blocked */ }
  const lock = FORCE_TEST ? new Date(Date.now() + 5 * 36e5 + 12 * 6e4) : await urgent(code);
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
