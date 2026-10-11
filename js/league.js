// The league page (website revamp): one FotMob-style page with a header and tabs (js/frame.js). WR-03 builds the frame;
// each tab's content comes in its own card (the table WR-11 to 14 lives on Overview, Fixtures WR-15 to 17, Overview WR-18 to 21, Stats WR-22/23 (players and teams in one tab),
// Seasons WR-24, News WR-25, Draft WR-27). Until then a tab shows where its content will go.
// Local preview (screenshots only, never on the live site): http://localhost:8767/league.html?preview&club=%23c8102e&theme=light&office
// Made-up results to look at the stats pages before a match is played: add `&demo` (six rounds) or `&demo=3` (three; 0 for none).
// Works on localhost and for the office only; it is never real data and the pages say so.
import { enterPlace, paintClub } from './shell.js';
import { mountFrame } from './frame.js';
import { esc, crestUrl, clubs } from './member.js';
import { finished, logoUrl } from './dashboard-data.js';
import { crest as crestHtml, useClubs } from './places.js';
import { loadKits } from './kits-data.js';
import { kitSprite, startDesign } from './kit.js';
import { countedFixtures, totals, rank, PLAYER_CARDS, TEAM_CARDS } from './season-stats.js';
import { statCard, statPage, wireStatPage, initialsCrest } from './stat-card.js';
import { demoSeason } from './demo-season.js';
import { tableRows, tableCard } from './league-table.js';
import { spoilerHidden, revealScore } from './prefs.js';
import { VERSION } from './version.js';

const params = new URLSearchParams(location.search);
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('preview');

// The contour lines fade in once the picture is loaded, instead of popping in half way through the page loading.
(() => { const i = new Image(); i.src = 'assets/img/topo.png'; return i.decode().catch(() => {}); })()
  .then(() => requestAnimationFrame(() => document.body.classList.add('topo-ready')));

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
  let season = ctx.season, kitPics = {}, realClubs = false;
  if (demo != null) {
    // The league's real clubs (names, colours, crests) and their real home kits, with made-up players and results.
    // Kits and clubs are readable by anyone with the public key. If they don't load, the demo uses invented clubs.
    const image = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    const [rows, kits] = await Promise.all([clubs().catch(() => []), loadKits()]);
    const active = rows.filter(r => r.status === 'active' && r.colour);
    season = demoSeason({ rounds: demo, clubs: active.length >= 4 ? active : undefined });
    if (active.length >= 4) {
      realClubs = true;
      useClubs(active);
      for (const t of season.teams) t.crest_path = active.find(r => r.code === t.code)?.crest_path;
      await Promise.all(season.teams.map(async t => {
        const k = kits[t.code]?.home;   // a club with no kit yet wears the default one, made from its colours
        try {
          const [art, logo] = await Promise.all([image(k?.artUrl), image(k?.logoUrl)]);
          kitPics[t.code] = kitSprite({ ...(k?.design || startDesign(t)), text: { name: '', number: '', colour: '' } }, { art, logo }, 128).toDataURL();
        } catch { /* a kit that won't draw falls back to the plain capsule */ }
      }));
    }
  }
  const teamOf = code => season?.teams.find(t => t.code === code) || { code, name: code, colour: '#64748b' };
  // A club's logo when it has one, else its colour (the page's crest() would draw a blank image for a club without a logo).
  const sctx = {
    club: teamOf,
    crest: (code, px) => (teamOf(code).crest_path || !logoUrl(code).startsWith('data:') ? crestHtml(teamOf(code), px) : initialsCrest(teamOf(code), code, px)),
    avatar: code => (kitPics[code] ? `<img src="${kitPics[code]}" alt="">` : ''),
  };
  const played = () => (!season ? [] : demo != null ? countedFixtures(season.fixtures) : countedFixtures(finished(season)));
  const KINDS = { player: PLAYER_CARDS, team: TEAM_CARDS };
  // Address changes made by the page itself replace the entry (a stat switched, a position picked), so "Back" still goes to where the
  // full page was opened from: `moved` counts the changes that added an entry.
  let moved = 0, replacing = false;
  addEventListener('hashchange', () => { if (!replacing) moved++; replacing = false; });
  const go = href => { replacing = true; location.replace(href); };

  const grid = (kind, data) => {
    const groups = [...new Set(KINDS[kind].map(c => c.group))];
    return groups.map(g => `<div class="sc-group${g === 'Pinned' ? ' is-pinned' : ''}"><h3>${esc(g)}</h3><div class="sc-grid">${KINDS[kind].filter(c => c.group === g)
      .map(c => statCard(c, rank(data[kind === 'team' ? 'teams' : 'players'], c, 3), sctx, { kind })).join('')}</div></div>`).join('');
  };
  const stats = (sub, picked) => {
    const data = totals(played());
    const [cardId, position = 'all'] = sub.split('/');
    const found = ['player', 'team'].map(kind => [kind, KINDS[kind].find(c => c.id === cardId)]).find(x => x[1]);
    if (found) {
      const [kind, c] = found, rows = kind === 'team' ? data.teams : data.players;
      return statPage(c, rank(kind === 'team' || position === 'all' ? rows : rows.filter(r => r.pos === position), c), sctx, {
        kind, title: kind === 'team' ? 'Team stats' : 'Player stats', back: '#stats', cards: KINDS[kind], position,
        seasonLine: `vLeague · ${picked?.label || 'Season 1'} · ${played().length} ${played().length === 1 ? 'match' : 'matches'} played`,
      });
    }
    const note = demo != null ? `<p class="sc-demo"><b>Demo data</b> ${realClubs ? 'Real clubs and kits, made-up players and results' : 'Made-up clubs, players and results'}, ${demo} ${demo === 1 ? 'round' : 'rounds'} (try <code>demo=0</code> to <code>demo=6</code>). Not real.</p>` : '';
    if (!data.players.length && demo == null) {
      return `<section class="lg-card sc-none"><div class="sc-empty"><b>No matches played yet</b><span>Player and team stats appear here as the season is played.</span></div></section>`;
    }
    const team = sub === 'team', kind = team ? 'team' : 'player';
    const toggle = `<nav class="sc-toggle" aria-label="Stats of"><a href="#stats"${team ? '' : ' aria-current="true"'}>Player</a><a href="#stats/team"${team ? ' aria-current="true"' : ''}>Team</a></nav>`;
    return `${note}<div class="sc-section"><div class="sc-head"><h2 class="sc-title">${team ? 'Team stats' : 'Player stats'}</h2>${toggle}</div>${grid(kind, data)}</div>`;
  };

  // ---- The table (WR-11 to WR-14) ----
  let tableFilter = 'all';
  const tableNow = () => (demo != null ? new Date('2027-01-01T00:00:00') : new Date());   // demo matches are dated in the coming days: treat them as played
  const tableHtml = () => {
    if (!season) return tableCard([], sctx, { filter: tableFilter });
    const now = tableNow(), counted = season.fixtures.filter(f => f.result && !f.test && !f.exhibition && !f.stage);
    const hiddenIds = counted.filter(f => spoilerHidden(f, season, now)).map(f => f.id);
    return tableCard(tableRows(season, { filter: tableFilter, now, hidden: new Set(hiddenIds) }), { ...sctx, mine: ctx.club?.code }, { filter: tableFilter, hiddenCount: hiddenIds.length });
  };
  main.addEventListener('click', async e => {
    const pill = e.target.closest('[data-tfilter]'), all = e.target.closest('[data-reveal-all]');
    if (!pill && !all) return;
    if (pill) tableFilter = pill.dataset.tfilter;
    if (all) await revealScore(season.fixtures.filter(f => f.result && spoilerHidden(f, season, tableNow())).map(f => f.id)).catch(() => {});
    const el = main.querySelector('.lg-table');
    if (el) { el.outerHTML = tableHtml(); main.querySelector(`.lg-table [data-tfilter="${tableFilter}"]`)?.focus(); }
  });

  const VIEWS = {
    overview: () => `<div class="lg-cols">
        <div class="lg-main">
          ${tableHtml()}
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

  wireStatPage(main, { go });
  mountFrame(document.getElementById('frame'), {
    office,
    crest: preview ? params.get('crest') || '' : ctx.club?.crest_path ? crestUrl(ctx.club.crest_path) : '',
    // Each view gets the season picked in the header (WR-05); they all show the current one until a past season exists.
    onTab: (id, picked, sub) => {
      main.innerHTML = VIEWS[id](sub, picked);
      // "Back" on a full list returns to the tab it was opened from (Overview or Stats), else to the Stats tab.
      main.querySelector('.sp-back')?.addEventListener('click', e => { if (moved) { e.preventDefault(); history.back(); } });
    },
  });
}
