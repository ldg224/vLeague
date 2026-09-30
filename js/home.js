// A manager's Home. For now (0.3) it shows which club the account belongs to; the real Home (next match,
// line-up countdown, what needs doing) arrives in 0.5 (docs/PLAN.md).
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';

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
    main.innerHTML = `<div class="club-card">
      ${club.crest_path ? `<img class="club-crest" src="${esc(crestUrl(club.crest_path))}" alt="">` : ''}
      <h1>${esc(club.name)}</h1>
      <p class="quiet">${esc(club.manager_name || me.profile.display_name || me.user.email)}</p>
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
