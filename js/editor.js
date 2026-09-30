// The league office's Editor. For now (0.3) it lists the clubs and whether each has a manager account linked;
// fixtures, results, Simulate, news and approvals move in over the next versions (docs/PLAN.md).
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';
import { db } from './auth.js';

chrome();
const me = await enter('editor.html');
if (me) {
  document.getElementById('to-home').hidden = !me.profile?.club;
  const main = document.getElementById('main');
  try {
    const [list, { data: profiles }] = await Promise.all([clubs(), (await db()).from('profiles').select('club, role')]);
    const linked = new Set((profiles || []).filter(p => p.club).map(p => p.club));
    const status = { active: 'Active', pending: 'Waiting for a manager', withdrawn: 'Withdrawn' };
    main.innerHTML = `<h1>Clubs</h1>
      <ul class="club-rows">${list.map(c => `<li style="--club:${esc(safeColour(c.colour))}">
        ${c.crest_path ? `<img src="${esc(crestUrl(c.crest_path))}" alt="">` : `<span class="no-crest">${esc(c.code)}</span>`}
        <span class="who"><b>${esc(c.name)}</b><small>${esc(c.code)}${c.manager_name ? `, ${esc(c.manager_name)}` : ''}</small></span>
        <span class="state status">${esc(status[c.status] || c.status)}</span>
        <span class="state ${linked.has(c.code) ? 'ok' : ''}">${linked.has(c.code) ? 'Account linked' : 'No account'}</span>
      </li>`).join('')}</ul>`;
  } catch (e) {
    main.innerHTML = `<p class="quiet">${esc(e.message)} <a href="editor.html">Try again</a></p>`;
  }
  main.setAttribute('aria-busy', 'false');
}
