// The league page (website revamp): one FotMob-style page with a header and tabs (js/frame.js). WR-03 builds the frame;
// each tab's content comes in its own card (Table WR-11 to 14, Fixtures WR-15 to 17, Overview WR-18 to 21, stats WR-22/23,
// Seasons WR-24, News WR-25, Draft WR-27). Until then a tab shows where its content will go.
// Local preview (screenshots only, never on the live site): http://localhost:8767/league.html?preview&club=%23c8102e&theme=light&office
import { enterPlace, paintClub } from './shell.js';
import { mountFrame } from './frame.js';
import { esc } from './member.js';
import { VERSION } from './version.js';

const params = new URLSearchParams(location.search);
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('preview');

let ctx;
if (preview) {
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
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

  // A card waiting for its content: the title it will have, and what will go in it.
  const card = (title, note, extra = '') => `<section class="lg-card${extra}">
      <div class="lg-card-head"><h2>${esc(title)}</h2></div>
      <p class="lg-soon">${esc(note)}</p>
    </section>`;

  const VIEWS = {
    overview: () => `<div class="lg-cols">
        <div class="lg-main">
          ${card('Table', 'The table, with your club marked.')}
          <div class="lg-trio">
            ${card('Top rated', 'Best average match rating.')}
            ${card('Top scorers', 'Most goals.')}
            ${card('Top assists', 'Most assists.')}
          </div>
        </div>
        <aside class="lg-side">
          ${card('Team of the week', 'The best XI of the round, by match rating.')}
          ${card('This round', 'The round’s matches, day by day.')}
        </aside>
      </div>`,
    table: () => card('Table', 'The full table with form and each club’s next opponent.'),
    fixtures: () => card('Fixtures', 'Every match by date, by round or by club.'),
    'player-stats': () => card('Player stats', 'Top scorers, assists, ratings and more, in cards you can open for the full list.'),
    'team-stats': () => card('Team stats', 'The same for clubs: goals, possession, clean sheets and more.'),
    seasons: () => card('Seasons', 'Each season’s winner and runner-up.'),
    news: () => card('News', 'League news and messages for your club.'),
    draft: () => card('Draft', 'The draft board while a draft is on.'),
  };

  mountFrame(document.getElementById('frame'), {
    office,
    onTab: id => {
      main.innerHTML = VIEWS[id]();
    },
  });
}
