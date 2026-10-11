// The league page (website revamp): one FotMob-style page with a header and tabs (js/frame.js). WR-03 builds the frame;
// each tab's content comes in its own card (the table WR-11 to 14 lives on Overview, Fixtures WR-15 to 17, Overview WR-18 to 21, Stats WR-22/23 (players and teams in one tab),
// Seasons WR-24, News WR-25, Draft WR-27). Until then a tab shows where its content will go.
// Local preview (screenshots only, never on the live site): http://localhost:8767/league.html?preview&club=%23c8102e&theme=light&office
// Made-up results to look at the stats pages before a match is played: add `&demo` (six rounds) or `&demo=3` (three; 0 for none).
// Works on localhost and for the office only; it is never real data and the pages say so.
import { enterPlace, paintClub } from './shell.js';
import { mountFrame } from './frame.js';
import { esc, crestUrl } from './member.js';
import { finished, logoUrl } from './dashboard-data.js';
import { crest as crestHtml } from './places.js';
import { countedFixtures, totals, rank, PLAYER_CARDS, TEAM_CARDS } from './season-stats.js';
import { statCard, statList, initialsCrest } from './stat-card.js';
import { demoSeason } from './demo-season.js';
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

  // ---- Stats (WR-08 to WR-10) ----
  const demo = params.has('demo') && (preview || office) ? Number(params.get('demo') || 6) : null;
  const season = demo != null ? demoSeason({ rounds: demo }) : ctx.season;
  const teamOf = code => season?.teams.find(t => t.code === code) || { code, name: code, colour: '#64748b' };
  // A club's logo when it has one, else its colour (the page's crest() would draw a blank image for a club without a logo).
  const sctx = { club: teamOf, crest: (code, px) => (logoUrl(code).startsWith('data:') ? initialsCrest(teamOf(code), code, px) : crestHtml(teamOf(code), px)) };
  const played = () => (!season ? [] : demo != null ? countedFixtures(season.fixtures) : countedFixtures(finished(season)));
  const KINDS = { player: PLAYER_CARDS, team: TEAM_CARDS };
  let moved = 0;   // in-page address changes so far, so "Back" can go back to the tab you came from
  addEventListener('hashchange', () => { moved++; });

  const grid = (kind, data) => {
    const groups = [...new Set(KINDS[kind].map(c => c.group))];
    return groups.map(g => `<div class="sc-group"><h3>${esc(g)}</h3><div class="sc-grid">${KINDS[kind].filter(c => c.group === g)
      .map(c => statCard(c, rank(data[kind === 'team' ? 'teams' : 'players'], c, 3), sctx, { kind })).join('')}</div></div>`).join('');
  };
  const stats = sub => {
    const data = totals(played());
    const found = ['player', 'team'].map(kind => [kind, KINDS[kind].find(c => c.id === sub)]).find(x => x[1]);
    if (found) {
      const [kind, c] = found;
      return statList(c, rank(data[kind === 'team' ? 'teams' : 'players'], c), sctx, { kind, back: '#stats' });
    }
    const note = demo != null ? `<p class="sc-demo"><b>Demo data</b> Made-up results, ${demo} ${demo === 1 ? 'round' : 'rounds'} (try <code>demo=0</code> to <code>demo=6</code>). Not real.</p>` : '';
    if (!data.players.length && demo == null) {
      return `<section class="lg-card sc-none"><div class="sc-empty"><b>No matches played yet</b><span>Player and team stats appear here as the season is played.</span></div></section>`;
    }
    return `${note}<div class="sc-section"><h2 class="sc-title">Player stats</h2>${grid('player', data)}</div>
      <div class="sc-section"><h2 class="sc-title">Team stats</h2>${grid('team', data)}</div>`;
  };

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
    stats,
    seasons: () => card('Seasons'),
    news: () => card('News'),
    draft: () => card('Draft'),
  };

  mountFrame(document.getElementById('frame'), {
    office,
    crest: preview ? params.get('crest') || '' : ctx.club?.crest_path ? crestUrl(ctx.club.crest_path) : '',
    // Each view gets the season picked in the header (WR-05); they all show the current one until a past season exists.
    onTab: (id, picked, sub) => {
      main.innerHTML = VIEWS[id](sub, picked);
      // "Back" on a full list returns to the tab it was opened from (Overview or Stats), else to the Stats tab.
      main.querySelector('.sc-back')?.addEventListener('click', e => { if (moved) { e.preventDefault(); history.back(); } });
    },
  });
}
