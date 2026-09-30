// A manager's Home. For now (0.3–0.4) it shows the club, any setup request waiting for the office, and an
// "Edit club" link; the real Home (next match,
// line-up countdown, what needs doing) arrives in 0.5 (docs/PLAN.md).
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';
import { db } from './auth.js';

// The club's latest setup/change request (0.4): pending -> "Waiting for the league office"; returned -> the office's
// note and a button to fix and resend. Nothing if it was approved, or if requests can't be read.
async function requestBanner(code) {
  try {
    const { data, error } = await (await db()).from('club_requests').select('status, kind, office_note, created_at')
      .eq('club', code).order('created_at', { ascending: false }).limit(1);
    const r = !error && data?.[0];
    if (r?.status === 'pending') return `<div class="club-notice"><b>Waiting for the league office</b>
      <span>${r.kind === 'setup' ? 'They’re checking your club’s name, code and crest.' : 'They’re checking your name, code or crest change.'} Your colours and details are already live.</span></div>`;
    if (r?.status === 'returned') return `<div class="club-notice back"><b>The league office sent this back</b>
      <span>${esc(r.office_note || 'They’d like a change before approving it.')}</span>
      <a class="btn" href="setup.html?edit">Fix and resend</a></div>`;
  } catch { /* no banner */ }
  return '';
}

chrome();
const me = await enter('home.html');
if (me) {
  const main = document.getElementById('main');
  const code = me.profile?.club;
  const club = code ? (await clubs().catch(() => [])).find(c => c.code === code) : null;
  if (club) {
    const colour = safeColour(club.accent || club.colour);
    document.body.style.setProperty('--club', colour);
    document.getElementById('band').classList.add('on');
    document.title = `${club.name} | vLeague`;
    const banner = await requestBanner(club.code);
    main.innerHTML = `${banner}<div class="club-card">
      ${club.crest_path ? `<img class="club-crest" src="${esc(crestUrl(club.crest_path))}" alt="">` : ''}
      <h1>${esc(club.name)}</h1>
      ${club.motto ? `<p class="club-motto">${esc(club.motto)}</p>` : ''}
      <p class="quiet">${esc(club.manager_name || me.profile.display_name || me.user.email)}${club.stadium ? ` · ${esc(club.stadium)}` : ''}</p>
      <a class="edit-club" href="setup.html?edit">Edit club</a>
      <p class="soon">Your club's home opens in the next update.</p>
    </div>`;
  } else {
    main.innerHTML = `<div class="club-card">
      <img class="club-crest" src="assets/brand/crest.svg" alt="">
      <h1>Welcome</h1>
      <p class="quiet">${esc(me.user.email)}</p>
      <p class="soon">Your account isn’t linked to a club yet. The league office will link it.</p>
    </div>`;
  }
  main.setAttribute('aria-busy', 'false');
}
