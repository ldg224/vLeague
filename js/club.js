// My club (0.5): the club's card (crest, name, motto, manager, stadium, Edit club) and its squad with season totals.
import { enterPlace } from './shell.js';
import { esc, crestUrl } from './member.js';
import { finished, logoUrl } from './dashboard-data.js';
import { rating } from './places.js';

const POS = ['GK', 'DEF', 'MID', 'FWD'];
const POS_NAME = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

// Apps, goals, assists and average rating per player from the finished results (the same totals as leaders()).
function totals(season, now = new Date()) {
  const tot = {};
  for (const f of finished(season, now)) {
    for (const [id, p] of Object.entries(f.result.players || {})) {
      const t = tot[id] ??= { apps: 0, g: 0, a: 0, rsum: 0 };
      t.apps++; t.g += p.g || 0; t.a += p.a || 0; t.rsum += p.r || 0;
    }
  }
  return tot;
}

function squadHtml(season, code) {
  const tot = totals(season);
  const players = (season.players || []).filter(p => p.team === code)
    .sort((a, b) => (POS.indexOf(a.position) + 1 || 9) - (POS.indexOf(b.position) + 1 || 9) || a.name.localeCompare(b.name));
  if (!players.length) return '<p class="empty">No players yet.</p>';
  return `<table class="squad">
    <thead><tr><th scope="col" class="pos"><abbr title="Position">Pos</abbr></th><th scope="col" class="who">Player</th><th scope="col"><abbr title="Appearances">Apps</abbr></th><th scope="col"><abbr title="Goals">G</abbr></th><th scope="col"><abbr title="Assists">A</abbr></th><th scope="col"><abbr title="Average rating">Avg</abbr></th></tr></thead>
    <tbody>${players.map(p => {
      const t = tot[String(p.id)] || { apps: 0, g: 0, a: 0 };
      return `<tr><td class="pos"><abbr title="${esc(POS_NAME[p.position] || p.position || '')}">${esc(p.position || '')}</abbr></td>
        <th scope="row" class="who">${esc(p.name)}</th><td>${t.apps}</td><td>${t.g}</td><td>${t.a}</td>
        <td class="avg">${t.apps ? rating(t.rsum / t.apps) : '–'}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

const ctx = await enterPlace('club');
if (ctx) {
  const { main, club, season, me } = ctx;
  if (!club) {
    main.innerHTML = '<h1 class="page-title">My club</h1><p class="empty">Your account isn’t linked to a club yet.</p>';
  } else {
    document.title = `${club.name} | vLeague`;
    const crest = club.crest_path ? crestUrl(club.crest_path) : logoUrl(club.code);
    const manager = club.manager_name || me.profile?.display_name || '';
    main.classList.add('club-main');
    main.innerHTML = `<div class="club">
      <section class="sect club-id">
        <img class="club-crest" src="${esc(crest)}" alt="" onerror="this.remove()">
        <h1>${esc(club.name)}</h1>
        ${club.motto ? `<p class="club-motto">${esc(club.motto)}</p>` : ''}
        <dl class="club-facts">
          ${manager ? `<div><dt>Manager</dt><dd>${esc(manager)}</dd></div>` : ''}
          ${club.stadium ? `<div><dt>Stadium</dt><dd>${esc(club.stadium)}</dd></div>` : ''}
          <div><dt>Code</dt><dd>${esc(club.code)}</dd></div>
        </dl>
        <a class="edit-club" href="setup.html?edit">Edit club</a>
      </section>
      <section class="sect squad-sect">
        <div class="sect-head"><h2>Squad</h2></div>
        ${season ? squadHtml(season, club.code) : '<p class="empty">The squad didn’t load. <a href="club.html">Try again</a></p>'}
      </section>
    </div>`;
  }
  main.setAttribute('aria-busy', 'false');
}
