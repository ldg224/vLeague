// The league page (website revamp): one FotMob-style page with a header and tabs (js/frame.js). WR-03 builds the frame;
// each tab's content comes in its own card (the table WR-11 to 14 lives on Overview, Fixtures WR-15 to 17, Overview WR-18 to 21, Stats WR-22/23 (players and teams in one tab),
// Seasons WR-24, News WR-25, Draft WR-27). Until then a tab shows where its content will go.
// Local preview (screenshots only, never on the live site): http://localhost:8767/league.html?preview&club=%23c8102e&theme=light&office
import { enterPlace, paintClub } from './shell.js';
import { mountFrame } from './frame.js';
import { esc, crestUrl } from './member.js';
import { VERSION } from './version.js';

const params = new URLSearchParams(location.search);
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('preview');

let ctx;
if (preview) {
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
  if (params.get('font') === 'old') document.body.classList.add('font-old');
  const colour = params.get('club');
  if (colour) paintClub({ colour });
  ctx = { me: { profile: { role: params.has('office') ? 'office' : 'manager' } }, club: colour ? { colour } : null, main: document.getElementById('main') };
} else {
  ctx = await enterPlace('league');
}

document.getElementById('version').textContent = `v${VERSION}`;

if (ctx) {
  const office = ctx.me?.profile?.role === 'office';
  document.body.classList.toggle('has-club', Boolean(ctx.club));
  const main = ctx.main;
  main.removeAttribute('aria-busy');

  // A card waiting for its content: just its title for now.
  const card = title => `<section class="lg-card lg-empty"><div class="lg-card-head"><h2>${esc(title)}</h2></div></section>`;

  const VIEWS = {
    overview: () => `<div class="lg-cols">
        <div class="lg-main">
          ${card('Table')}
          <div class="lg-trio">
            ${card('Top rated')}
            ${card('Top scorers')}
            ${card('Top assists')}
          </div>
        </div>
        <aside class="lg-side">
          ${card('Team of the week')}
          ${card('This round')}
        </aside>
      </div>`,
    fixtures: () => card('Fixtures'),
    stats: () => `${card('Player stats')}${card('Team stats')}`,
    seasons: () => card('Seasons'),
    news: () => card('News'),
    draft: () => card('Draft'),
  };

  mountFrame(document.getElementById('frame'), {
    office,
    crest: preview ? params.get('crest') || '' : ctx.club?.crest_path ? crestUrl(ctx.club.crest_path) : '',
    onTab: id => {
      main.innerHTML = VIEWS[id]();
    },
  });
}
