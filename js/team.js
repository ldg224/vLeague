// Team pages (S-04; WR-43 redone 13 Oct 2026 the FotMob way, from the league page's own pieces): one page per club (team.html?c=CODE),
// signed-in only since WR-02. A header card (crest, the name in the display type with the name huge and hollow behind it, as on the
// Fixtures rows; manager, ground, form, table place), then the site toggle for Overview / Squad / Fixtures (kept in the address).
//   Overview: next match and last result as Fixtures rows, the table with this club marked in its own colour, the club's top rated,
//             scorers and assists (the Stats tab's cards) and a Club card (facts, the weekly cap, honours as rows).
//   Squad:    a list grouped by position under grey strips: number, name, attack and defence, value.
//   Fixtures: every match the club plays, by day, as the Fixtures tab draws them.
import { chrome, esc, clubs, safeColour, crestUrl } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub, styleCards, startSilk } from './shell.js';
import { mountSubFrame } from './frame.js';
import { rowHtml, dayLabel } from './league-fixtures.js';
import { loadSeason, finished, matchUrl, status, byKickoff, kickoff } from './dashboard-data.js';
import { crest, teamOf, useClubs } from './places.js';
import { prefs, spoilerHidden, fmtTime } from './prefs.js';
import { clubSummary } from './match-model.js';
import { loadHistory, cabinet } from './history-data.js';
import { accentFor, onColour } from './club-colour.js';
import { POS_ORDER } from './pitch.js';
import { tableRows, tableCard } from './league-table.js';
import { countedFixtures, totals, rank, PLAYER_CARDS } from './season-stats.js';
import { hasPreseason, scopeNow, pickScope, scopePills } from './preseason.js';
import { suspensions } from './simulate.js';
import { statCard } from './stat-card.js';
import { plink } from './player-link.js';import { portrait } from './portrait.js';


chrome();
const main = document.getElementById('main');
const code = String(new URLSearchParams(location.search).get('c') || '').toUpperCase();
const CAP = 125000;   // the weekly cap per team (js/draft.js)
const POS_NAME = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const RESULT = { W: 'Won', D: 'Drew', L: 'Lost' };
const TABS = [['overview', 'Overview'], ['squad', 'Squad'], ['fixtures', 'Fixtures']];
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Localhost only, for screenshots without signing in: team.html?c=SKS&preview&mine=TUR&theme=light
const q = new URLSearchParams(location.search), preview = ['localhost', '127.0.0.1'].includes(location.hostname) && q.has('preview');
let mine = null;
try {
  const user = preview ? { id: 'preview' } : await currentUser().catch(() => null);
  // Signed-out visitors see nothing but sign-in (WR-02).
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }
  if (preview && q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  const [rows, season, hist] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null), loadHistory()]);
  useClubs(rows);
  if (!preview) await prefs().catch(() => null);
  const prof = preview ? { role: q.has('office') ? 'office' : 'manager', club: q.get('mine') } : await myProfile().catch(() => null);
  mine = rows.find(c => c.code === prof?.club) || null;
  // The league page's header card for the viewer (their club's panel and buttons), with the way back to the league.
  paintClub(mine);
  startSilk();   // the contour lines and the silk in the cards, as on the league page
  document.body.classList.toggle('has-club', Boolean(mine));
  mountSubFrame(document.getElementById('frame'), { office: prof?.role === 'office', crest: mine?.crest_path ? crestUrl(mine.crest_path) : '', here: '', title: '' });
  const club = rows.find(c => c.code === code), team = season?.teams.some(t => t.code === code) ? teamOf(season, code) : null;   // teamOf makes up a team for any code
  if (!club && !team) {
    main.innerHTML = `<div class="tm"><section class="lg-card"><h1 class="tm-name" tabindex="-1">Club not found</h1><p class="empty">There’s no club with the code “${esc(code)}”. <a href="league.html">See the league</a></p></section></div>`;
  } else {
    render(club || { code, name: team.name, colour: team.colour }, team, season, cabinet(hist, code), rows);
  }
} catch (e) {
  main.innerHTML = `<p class="empty">This team page didn’t load. ${esc(e.message || '')} <a href="team.html?c=${esc(code)}">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function render(club, team, season, won, rows) {
  document.title = `${club.name} | vLeague`;
  const c1 = safeColour(club.colour), now = new Date(), byCode = new Map(rows.map(r => [r.code, r]));
  const squad = (season?.players || []).filter(p => p.team === club.code)
    .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name));

  // Results this account hasn't revealed stay hidden (spoiler-free), as on the league page.
  const fixtures = season ? season.fixtures.filter(f => (f.home === club.code || f.away === club.code) && !f.test).sort(byKickoff) : [];   // preseason (exhibition) matches stay in the list
  const games = season ? finished(season, now).filter(f => fixtures.includes(f) && !f.exhibition) : [];   // but not in the form strip
  const shown = games.filter(f => !spoilerHidden(f, season, now));
  const hidden = new Set(fixtures.filter(f => spoilerHidden(f, season, now)).map(f => f.id));
  const sum = season && team ? clubSummary({ ...season, fixtures: season.fixtures.filter(f => !spoilerHidden(f, season, now)) }, club.code, now) : null;

  // What the league page's pieces need: clubs (with their saved names and colours), crests, times, spoilers.
  const clubFor = c => { const t = season ? teamOf(season, c) : { code: c, name: c }, r = byCode.get(c); return { ...t, ...(r ? { name: r.name, short_name: r.short_name, colour: r.colour, crest_path: r.crest_path } : {}) }; };
  const playerById = new Map((season?.players || []).map(p => [String(p.id), p]));
  const ctx = { now, mine: club.code, club: clubFor, crest: (c, px) => crest(clubFor(c), px), time: fmtTime, hidden, avatar: () => '',
    face: (id, code, px) => { const p = playerById.get(String(id)); return p ? portrait(p, byCode.get(code) || clubFor(code), undefined, true) : ''; } };

  const about = [club.manager_name && `Managed by ${esc(club.manager_name)}`, club.stadium && `${club.manager_name ? 'at' : 'Plays at'} ${esc(club.stadium)}`].filter(Boolean).join(' ');
  let tab = TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';

  // The club's own colour marks it on its own page (its table row, its leader pills), in the shade that reads in each theme.
  main.innerHTML = `<article class="tm" style="--club:${c1};--club-accent-dark:${accentFor(c1, 'dark')};--club-accent-light:${accentFor(c1, 'light')};--on-club:${onColour(c1)}">
    <header class="lg-card tm-head">
      <span class="tm-ghost" aria-hidden="true">${esc(club.short_name || club.name)}</span>
      <div class="tm-id">
        <div class="tm-crest">${crest(clubFor(club.code), 72)}</div>
        <div class="tm-titles">
          <h1 class="tm-name" tabindex="-1">${esc(club.name)}</h1>
          ${about ? `<p class="tm-about">${about}</p>` : ''}
          ${club.motto ? `<p class="tm-motto">${esc(club.motto)}</p>` : ''}
        </div>
        <div class="tm-now">${formHtml(shown.slice(-5), club.code, games.length - shown.length)}
          ${sum?.rank ? `<p class="tm-rank"><b>${ordinal(sum.rank)}</b> in the table, <b>${sum.pts}</b> point${sum.pts === 1 ? '' : 's'}</p>` : ''}</div>
      </div>
      <nav class="sc-toggle tm-tabs" aria-label="${esc(club.name)}">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>
    </header>
    <div id="tm-panel"></div>
  </article>`;

  const panels = {
    overview: () => overviewHtml(club, season, ctx, fixtures, squad, won, sum),
    squad: () => squadHtml(squad, club),
    fixtures: () => fixturesHtml(club, season, ctx, fixtures),
  };
  const draw = () => {
    main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
    main.querySelector('#tm-panel').innerHTML = panels[tab]();
    // The stat cards and the table link to the league page's own lists.
    main.querySelectorAll('#tm-panel a[href^="#stats"]').forEach(a => a.setAttribute('href', `league.html${a.getAttribute('href')}`));
    styleCards();
  };
  main.querySelector('.tm-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab; history.replaceState(null, '', `#${tab}`); draw();
  });
  main.querySelector('.tm-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = [...main.querySelectorAll('[data-tab]')], i = all.findIndex(b => b.dataset.tab === tab);
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    n.focus(); n.click(); e.preventDefault();
  });
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (panels[h] && h !== tab) { tab = h; draw(); } });
  draw();
  // The Preseason | Season switch on the table.
  main.addEventListener('click', e => {
    const sw = e.target.closest('[data-scope]');
    if (!sw) return;
    pickScope(season, sw.dataset.scope, new Date()); draw();
    main.querySelector(`[data-scope="${sw.dataset.scope}"]`)?.focus({ preventScroll: true });
  });
}

// ---------- header ----------

function formHtml(list, code, hidden) {
  if (!list.length) return `<p class="tm-form-none">${hidden ? 'Results hidden' : 'No results yet'}</p>`;
  return `<ol class="tm-form" aria-label="Last ${list.length} results, oldest first">${list.map(f => {
    const home = f.home === code, gf = home ? f.result.home : f.result.away, ga = home ? f.result.away : f.result.home;
    const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp = home ? f.away : f.home;
    return `<li><a class="tm-res res-${o}" href="${esc(matchUrl(f))}" title="${RESULT[o]} ${gf}–${ga} ${home ? 'against' : 'at'} ${esc(opp)}" aria-label="${RESULT[o]} ${gf}–${ga} ${home ? 'against' : 'at'} ${esc(opp)}">${o}</a></li>`;
  }).join('')}</ol>`;
}

// ---------- overview ----------

function dayOf(f, now) { const k = kickoff(f); return k ? dayLabel(ymd(new Date(k)), ymd(now)) : 'Date to be confirmed'; }

function overviewHtml(club, season, ctx, fixtures, squad, won, sum) {
  const { now } = ctx;
  const last = [...fixtures].reverse().find(f => ['ft', 'live'].includes(status(f, season, now)));
  const next = fixtures.find(f => status(f, season, now) === 'upcoming');
  const games = [[next, 'Next match'], [last, 'Last result']].filter(([f]) => f);
  const matches = `<section class="lg-card fx-card tm-games" aria-labelledby="tm-games-h">
      <div class="lg-card-head"><h2 id="tm-games-h">Matches</h2><a class="tm-all" href="#fixtures" data-go="fixtures">All fixtures</a></div>
      ${games.length ? `<ul class="fx-list">${games.map(([f, what]) => `<li class="fx-day"><h3>${what}</h3><span>${esc(dayOf(f, now))}</span></li>${rowHtml(f, season, ctx, { forTeam: club.code })}`).join('')}</ul>`
        : '<p class="empty">No fixtures yet.</p>'}</section>`;

  const scope = season ? scopeNow(season, now) : 'season', pre = scope === 'preseason';   // preseason games make a preseason table until the real season starts (js/preseason.js)
  const table = season ? tableCard(tableRows(season, { now, hidden: ctx.hidden, scope }), ctx, { filters: false, title: pre ? 'Preseason table' : 'Table', pre, scopeBar: hasPreseason(season) ? scopePills(scope) : '' }) : '';

  // The club's own leaders, from the same numbers as the Stats tab.
  const played = season ? countedFixtures(finished(season, now), scope).filter(f => !ctx.hidden.has(f.id)) : [];
  const players = played.length ? totals(played).players.filter(r => r.team === club.code) : [];
  const leaders = players.length
    ? ['rating', 'scorers', 'assists'].map(id => { const c = PLAYER_CARDS.find(x => x.id === id); return statCard(c, rank(players, c, 3), ctx, { kind: 'player' }); }).join('')
    : '<section class="lg-card sc is-empty" aria-label="Top players"><div class="lg-card-head"><h2>Top players</h2></div><div class="sc-empty"><b>No matches played yet</b><span>The club’s top rated, scorers and assists fill in as the season is played.</span></div></section>';

  const used = squad.reduce((t, p) => t + (Number(p.value) || 0), 0), pct = Math.min(100, used / CAP * 100);
  const sw = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? `<i class="tm-sw" style="background:${c}" title="${c}"></i>` : '');
  const facts = [
    ['Manager', esc(club.manager_name || '')], ['Ground', esc(club.stadium || '')],
    ['Position', sum?.rank ? `${ordinal(sum.rank)}` : ''], ['Played', sum ? String(sum.p) : ''],
    ['Code', esc(club.code)], ['Colours', `${sw(club.colour)}${sw(club.colour2)}`],
  ].filter(([, v]) => v);
  const cap = `<li class="tm-capline${used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : ''}"><span>Weekly cap</span><b>${money(used)} <small>of ${money(CAP)}</small></b>
      <i class="tm-bar" role="progressbar" aria-label="Weekly cap used" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></i></li>`;
  const honours = won.length ? `<li class="fx-day"><h3>Honours</h3></li>${won.map(w => `<li class="tm-fact"><span>${esc(w.comp.name)}, ${w.place === 'winner' ? 'winners' : 'runners-up'}</span><b>${w.seasons.map(x => esc(x.name)).join(', ')}</b></li>`).join('')}` : '';
  const clubCard = `<section class="lg-card tm-club" aria-labelledby="tm-club-h"><div class="lg-card-head"><h2 id="tm-club-h">Club</h2></div>
      <ul class="tm-facts">${facts.map(([k, v]) => `<li class="tm-fact"><span>${k}</span><b>${v}</b></li>`).join('')}${squad.length ? cap : ''}${honours}</ul></section>`;

  return `<div class="tm-cols">
      <div class="tm-main">${matches}${table}${suspendedCard(club, season, ctx, squad)}</div>
      <div class="tm-side">${leaders}${clubCard}</div>
    </div>`;
}

// Players banned for the club's next game (red card or two yellows). Only finished matches count, and results hidden by spoiler-free mode stay out.
function suspendedCard(club, season, ctx, squad) {
  if (!season) return '';
  const { now } = ctx, seen = { ...season, fixtures: season.fixtures.map(f => (status(f, season, now) === 'ft' && !ctx.hidden.has(f.id) ? f : { ...f, result: null })) };
  const next = season.fixtures.filter(f => f.date && !f.postponed && !f.test && (f.home === club.code || f.away === club.code) && status(f, season, now) !== 'ft').sort(byKickoff)[0];
  const bans = next ? suspensions(seen).get(next.id) || [] : [];
  const who = b => squad.find(p => String(p.id) === String(b.player));
  const row = b => { const p = who(b); return `<li class="sus-row"><span class="sus-pic">${p ? portrait(p, club, undefined, true) : ''}</span>`
    + `<span class="sus-who"><b>${plink(b.player, esc(b.name))}</b>${p ? `<small>${p.number != null ? `${esc(p.number)} · ` : ''}${esc(p.position || '')}</small>` : ''}</span>`
    + `<span class="sus-why"><i class="sus-card" aria-hidden="true"></i>${esc(b.reason)}</span></li>`; };
  return `<section class="lg-card tm-sus${bans.length ? ' has-bans' : ''}" aria-labelledby="tm-sus-h"><div class="lg-card-head"><h2 id="tm-sus-h">Suspended</h2>${bans.length ? `<span class="sus-count">${bans.length}</span>` : ''}</div>
      ${bans.length ? `<ul class="sus-list"><li class="sus-head" aria-hidden="true"><span>Player</span><span>Reason</span></li>${bans.map(row).join('')}</ul>` : '<p class="empty">Nobody is suspended.</p>'}</section>`;
}

// ---------- squad ----------

function squadHtml(squad, club) {
  if (!squad.length) return '<section class="lg-card tm-squad"><p class="empty">No players yet. The squad appears here after the draft.</p></section>';
  const used = squad.reduce((t, p) => t + (Number(p.value) || 0), 0);
  return `<section class="lg-card tm-squad" aria-labelledby="tm-squad-h">
    <div class="lg-card-head"><h2 id="tm-squad-h">Squad</h2><span class="tm-cnote">${squad.length} players, ${money(used)}</span></div>
    <ul class="tm-list"><li class="tm-cols-head" aria-hidden="true"><span></span><span>Name</span><span>Att</span><span>Def</span><span>Value</span></li>${POS_ORDER.filter(pos => squad.some(p => p.position === pos)).map(pos => {
      const list = squad.filter(p => p.position === pos);
      return `<li class="tm-strip pos-${esc(pos)}"><h3>${POS_NAME[pos] || esc(pos)}</h3><span>${list.length}</span></li>
        ${list.map(p => `<li class="tm-pl pos-${esc(p.position)}"><span class="tm-no">${esc(p.number ?? '')}</span><span class="tm-who"><span class="tm-pic">${portrait(p, club, undefined, true)}</span><b>${plink(p.id, esc(p.name))}</b></span>
          <span class="rt rt-${Number(p.offense) || 5}" title="Attack">${esc(p.offense)}</span><span class="rt rt-${Number(p.defense) || 5}" title="Defence">${esc(p.defense)}</span>
          <span class="tm-val">${p.value != null ? money(p.value) : '–'}</span></li>`).join('')}`;
    }).join('')}</ul></section>`;
}

// ---------- fixtures ----------

function fixturesHtml(club, season, ctx, fixtures) {
  if (!fixtures.length) return '<section class="lg-card"><p class="empty">No fixtures yet.</p></section>';
  const days = [...new Set(fixtures.map(f => f.date || ''))];
  return `<section class="lg-card fx-card tm-games" aria-labelledby="tm-fx-h"><div class="lg-card-head"><h2 id="tm-fx-h">Fixtures</h2><span class="tm-cnote">${fixtures.length} match${fixtures.length === 1 ? '' : 'es'}</span></div>
    <ul class="fx-list">${days.map(d => {
      const list = fixtures.filter(f => (f.date || '') === d);
      return `<li class="fx-day"><h3>${d ? esc(dayLabel(d, ymd(ctx.now))) : 'Date to be confirmed'}</h3><span>Round ${esc(list[0].week ?? '')}</span></li>${list.map(f => rowHtml(f, season, ctx, { forTeam: club.code })).join('')}`;
    }).join('')}</ul></section>`;
}

// "All fixtures" on the Overview opens the Fixtures tab.
main.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  e.preventDefault();
  main.querySelector(`.tm-tabs [data-tab="${go.dataset.go}"]`)?.click();
  main.querySelector('.tm-tabs')?.scrollIntoView({ block: 'nearest' });
});
