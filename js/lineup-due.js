// WR-44: a small pulsing dot on the header's Club button while the manager's line-up is due (a deadline is still open and no XI is saved).
//   watchLineupDue(clubCode) -> checks now and once a minute; the dot is added to / removed from the button in place (no redraw)
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
  setInterval(() => { if (!document.hidden) paint(); }, 60000);
}
