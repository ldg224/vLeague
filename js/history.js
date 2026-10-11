// History (0.66): every season's winners and runners-up, newest first, then the roll of honour (titles by club).
// Signed-in only (WR-02). The office writes it in Editor -> History (history-data.js). A club that has left the league is shown by
// the name, code and manager the office kept for it.
import { chrome, esc, clubs } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub } from './shell.js';
import { crest, useClubs, markdown } from './places.js';
import { prefs } from './prefs.js';
import { icon } from './icons.js';
import { loadHistory, artOf, trophyUrl } from './history-data.js';

chrome();
const main = document.getElementById('main');

try {
  const user = await currentUser().catch(() => null);
  // Signed-out visitors see nothing but sign-in (WR-02): stop here while the page changes.
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }
  const [rows, h] = await Promise.all([clubs().catch(() => []), loadHistory()]);
  useClubs(rows);
  if (user) {
    const back = document.getElementById('back');
    back.href = 'league.html'; back.innerHTML = `${icon('arrow-left')} League`;
    await prefs().catch(() => null);
    const prof = await myProfile().catch(() => null);
    paintClub(rows.find(c => c.code === prof?.club) || null);
  }
  render(rows, h);
} catch (e) {
  main.innerHTML = `<p class="empty">History didn’t load. ${esc(e.message || '')} <a href="history.html">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join(''); }

function render(rows, h) {
  if (!h) { main.innerHTML = '<div class="hs"><h1 class="hs-title" tabindex="-1">History</h1><p class="empty">History didn’t load. <a href="history.html">Try again</a></p></div>'; return; }
  const seasonOf = id => h.seasons.find(s => s.id === id);
  const at = (s, c, place) => h.awards.find(a => a.season === s && a.competition === c && a.place === place);

  // Who an award went to: a current club (crest, linked to its page) or a past team (its code on a plain badge).
  const team = (a, size = 28) => {
    if (a.club) {
      const c = rows.find(x => x.code === a.club) || { code: a.club, name: a.club };
      return { key: `c:${c.code}`, name: c.name, html: `<a class="hs-team" href="team.html?c=${esc(c.code)}">${crest(c, size)}<span class="hs-nm">${esc(c.name)}</span></a>` };
    }
    const p = h.past.find(x => x.id === a.past_team) || { name: 'Unknown team' };
    const note = `Former club${p.manager_name ? `, managed by ${esc(p.manager_name)}` : ''}`;
    return { key: `p:${p.id}`, name: p.name, html: `<span class="hs-team past"><span class="hs-badge" style="--s:${size}px" aria-hidden="true">${esc(p.code || initials(p.name))}</span><span class="hs-nm">${esc(p.name)}<small>${note}</small></span></span>` };
  };
  const cup = (path, cls) => (path ? `<img class="${cls}" src="${esc(trophyUrl(path))}" alt="" loading="lazy">` : `<span class="${cls} none" aria-hidden="true"></span>`);

  const boards = h.comps.map(c => ({ c, rows: h.seasons.map(s => ({ s, w: at(s.id, c.id, 'winner'), r: at(s.id, c.id, 'runner_up') })).filter(x => x.w || x.r) })).filter(b => b.rows.length);
  if (!boards.length) {
    main.innerHTML = '<div class="hs"><h1 class="hs-title" tabindex="-1">History</h1><p class="empty">No seasons recorded yet. The league office adds them in Editor → History.</p></div>';
    return;
  }

  // The latest champions: the newest season's winner of the first competition that has one (the office orders competitions).
  let top = null;
  for (const s of h.seasons) { for (const c of h.comps) { const w = at(s.id, c.id, 'winner'); if (w) { top = { s, c, w }; break; } } if (top) break; }
  const heroHtml = top ? `<section class="hs-hero" aria-labelledby="hs-hero-h">
      ${cup(artOf(top.w, h.comps), 'hs-hero-cup')}
      <div class="hs-hero-t"><p class="hs-hero-k">${esc(top.s.name)} ${esc(top.c.name)} winners</p>
        <h2 id="hs-hero-h" class="hs-hero-name">${team(top.w, 44).html}</h2></div>
    </section>` : '';

  const boardHtml = ({ c, rows: list }) => `<section class="hs-board" aria-labelledby="hs-b${c.id}">
    <header class="hs-board-head">${cup(c.winner_art || artOf(list[0].w || list[0].r, h.comps), 'hs-board-cup')}<h2 id="hs-b${c.id}">${esc(c.name)}</h2></header>
    <table><thead><tr><th scope="col">Season</th><th scope="col">Winner</th><th scope="col">Runner-up</th></tr></thead>
    <tbody>${list.map(({ s, w, r }) => `<tr>
      <th scope="row" class="hs-season">${esc(s.name)}</th>
      <td class="hs-w">${w ? `<span class="hs-cell">${team(w).html}${w.art_path ? cup(w.art_path, 'hs-own') : ''}</span>` : '<span class="quiet">Not recorded</span>'}</td>
      <td class="hs-r">${r ? `<span class="hs-cell">${team(r, 22).html}${r.art_path ? cup(r.art_path, 'hs-own') : ''}</span>` : '<span class="quiet">Not recorded</span>'}</td></tr>`).join('')}</tbody></table>
  </section>`;

  const notes = h.seasons.filter(s => s.notes);
  const notesHtml = notes.length ? `<section class="hs-notes" aria-labelledby="hs-notes-h"><h2 id="hs-notes-h">Season notes</h2>
    <dl>${notes.map(s => `<div><dt>${esc(s.name)}</dt><dd>${markdown(s.notes)}</dd></div>`).join('')}</dl></section>` : '';

  // Roll of honour: titles per club and competition, most titles first (runners-up break ties).
  const roll = new Map();
  for (const a of h.awards) {
    const t = team(a);
    if (!roll.has(t.key)) roll.set(t.key, { t, by: {}, total: 0, runs: 0 });
    const r = roll.get(t.key);
    if (a.place === 'winner') { r.by[a.competition] = (r.by[a.competition] || 0) + 1; r.total++; } else r.runs++;
  }
  const ranked = [...roll.values()].filter(r => r.total).sort((a, b) => b.total - a.total || b.runs - a.runs || a.t.name.localeCompare(b.t.name));
  const comps = h.comps.filter(c => h.awards.some(a => a.competition === c.id && a.place === 'winner'));
  const rollHtml = ranked.length ? `<section class="hs-roll" aria-labelledby="hs-roll-h"><h2 id="hs-roll-h">Roll of honour</h2>
    <div class="hs-scroll"><table><thead><tr><th scope="col">Club</th>${comps.map(c => `<th scope="col" class="hs-by">${esc(c.name)}</th>`).join('')}<th scope="col">Titles</th></tr></thead>
    <tbody>${ranked.map(r => `<tr><th scope="row">${r.t.html}</th>${comps.map(c => `<td class="hs-by">${r.by[c.id] || '<span class="quiet">0</span>'}</td>`).join('')}<td class="hs-total">${r.total}</td></tr>`).join('')}</tbody></table></div></section>` : '';

  main.innerHTML = `<div class="hs">
    <h1 class="hs-title" tabindex="-1">History</h1>
    ${heroHtml}
    <div class="hs-boards">${boards.map(boardHtml).join('')}</div>
    ${notesHtml}${rollHtml}
  </div>`;
}
