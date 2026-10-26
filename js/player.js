// Player pages: one page per player (player.html?id=ID), signed-in only. Opened from any player name on the site (js/player-link.js).
// A header card (portrait in his club's kit, name, club, position, shirt number), then two columns: the detailed season stats as a list
// (totals and per 90, grouped), his match log (each match opens the match), his places in the league's lists, and his profile.
// The numbers come from js/player-stats.js, which reads the season's saved results; results the viewer has not opened stay out (spoiler-free).
import { chrome, esc, clubs, safeColour, crestUrl } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub, startSilk } from './shell.js';
import { mountSubFrame } from './frame.js';
import { loadSeason, matchUrl, kickoff } from './dashboard-data.js';
import { crest, teamOf, useClubs, rating } from './places.js';
import { prefs, spoilerHidden } from './prefs.js';
import { accentFor, onColour } from './club-colour.js';
import { loadPlayers } from './players-data.js';
import { portrait } from './portrait.js';
import { hasPreseason, scopeNow } from './preseason.js';
import { playerView, averageRating } from './player-stats.js';

chrome();
const main = document.getElementById('main');
const q = new URLSearchParams(location.search), id = q.get('id') || '';
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && q.has('preview');   // screenshots only: player.html?id=0428&preview&mine=TUR&theme=light
const POS_WORD = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const dayFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

try {
  const user = preview ? { id: 'preview' } : await currentUser().catch(() => null);
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }
  if (preview && q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  const [rows, season, list] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null), loadPlayers().catch(() => [])]);
  useClubs(rows);
  if (!preview) await prefs().catch(() => null);
  const prof = preview ? { role: q.has('office') ? 'office' : 'manager', club: q.get('mine') } : await myProfile().catch(() => null);
  const mine = rows.find(c => c.code === prof?.club) || null;
  paintClub(mine);
  startSilk();
  document.body.classList.toggle('has-club', Boolean(mine));
  mountSubFrame(document.getElementById('frame'), { office: prof?.role === 'office', crest: mine?.crest_path ? crestUrl(mine.crest_path) : '', here: '', title: '' });
  if (season && !season.players?.length) season.players = list;
  render(season, rows, mine);
} catch (e) {
  main.innerHTML = `<p class="empty">This player page didn’t load. ${esc(e.message || '')} <a href="player.html?id=${esc(id)}">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function render(season, rows, mine) {
  const now = new Date(), byCode = new Map(rows.map(r => [r.code, r]));
  const hidden = new Set(season ? season.fixtures.filter(f => f.result && !f.test && spoilerHidden(f, season, now)).map(f => f.id) : []);
  const scope = season && hasPreseason(season) ? scopeNow(season, now) : 'season';
  const v = season ? playerView(season, id, { hidden, scope }) : null;
  if (!v) {
    main.innerHTML = '<div class="pp"><section class="lg-card"><h1 class="pp-name" tabindex="-1">Player not found</h1><p class="empty">There’s no player with that number. <a href="league.html#stats">See the stats</a></p></section></div>';
    return;
  }
  const { player: p, row, log, groups, ranks } = v;
  const clubFor = c => { const t = season ? teamOf(season, c) : { code: c, name: c }, r = byCode.get(c); return { ...t, ...(r ? { name: r.name, short_name: r.short_name, colour: r.colour, crest_path: r.crest_path } : {}) }; };
  const club = p.team ? clubFor(p.team) : null, c1 = safeColour(club?.colour);
  document.title = `${p.name} | vLeague`;
  const avg = averageRating(row);

  const head = `<header class="lg-card pp-head">
    <div class="pp-pic">${portrait(p, club, 112, true)}</div>
    <div class="pp-id">
      <h1 class="pp-name" tabindex="-1">${esc(p.name)}</h1>
      <p class="pp-sub">${club ? `<a class="pp-club" href="team.html?c=${esc(club.code)}">${crest(club, 20)}<span>${esc(club.name)}</span></a>` : '<span>Free agent</span>'}
        <span class="pp-dot">·</span><span>${POS_WORD[p.position] || esc(p.position)}</span>${p.number != null && p.number !== '' ? `<span class="pp-dot">·</span><span>No. ${esc(p.number)}</span>` : ''}</p>
    </div>
    ${avg != null ? `<div class="pp-avg"><span>Average rating</span>${rating(avg)}</div>` : ''}
  </header>`;

  const statsCard = !row
    ? `<section class="lg-card"><div class="lg-card-head"><h2>Season stats</h2></div><p class="empty">${esc(p.name)} hasn’t played a match yet.</p></section>`
    : `<section class="lg-card pp-stats"><div class="lg-card-head"><h2>Season stats</h2></div>
        <div class="pp-cols"><span></span><span>Total</span><span>Per 90</span></div>
        ${groups.map(g => `<h3 class="pp-strip">${esc(g.title)}</h3><ul class="pp-rows">${g.rows.map(r => `<li><span>${esc(r.label)}</span><b>${esc(r.total)}</b><i>${r.per90 != null ? esc(r.per90) : ''}</i></li>`).join('')}</ul>`).join('')}
      </section>`;

  const logCard = log.length ? `<section class="lg-card pp-log"><div class="lg-card-head"><h2>Matches</h2></div>
    <ul class="pp-matches">${[...log].reverse().map(l => {
      const k = kickoff(l.fx), s = l.s, opp = clubFor(l.opp);
      const bits = [s.g ? plural(s.g, 'goal') : '', s.a ? plural(s.a, 'assist') : '', p.position === 'GK' ? plural(s.sv || 0, 'save') : '', s.rc ? 'sent off' : s.yc ? 'booked' : ''].filter(Boolean);
      return `<li><a class="pp-m" href="${esc(matchUrl(l.fx))}">
        <span class="pp-when">${k ? dayFmt.format(k) : ''}<small>${esc(l.fx.round || '')}</small></span>
        <span class="pp-opp">${crest(opp, 20)}<b>${esc(l.home ? '' : 'at ')}${esc(opp.short_name || opp.name)}</b><small>${bits.join(' · ') || `${s.min || 0} min`}</small></span>
        <span class="pp-res ${l.res}"><b>${l.res}</b> ${l.gf}–${l.ga}</span>
        ${l.rating != null ? rating(l.rating) : '<span></span>'}</a></li>`;
    }).join('')}</ul></section>` : '';

  const ranksCard = ranks.length ? `<section class="lg-card"><div class="lg-card-head"><h2>In the league</h2></div>
    <ul class="pp-rows pp-ranks">${ranks.map(r => `<li><span>${esc(r.title)}</span><b>${esc(r.text)}</b><i>${ordinal(r.rank)}</i></li>`).join('')}</ul>
    <p class="pp-note">Places among players with at least 90 minutes where a list needs it. Top 10 only.</p></section>` : '';

  const profile = `<section class="lg-card"><div class="lg-card-head"><h2>Profile</h2></div><ul class="pp-rows pp-two">
    <li><span>Position</span><b>${POS_WORD[p.position] || esc(p.position)}</b></li>
    ${p.offense != null ? `<li><span>Attack</span><b>${esc(p.offense)} / 10</b></li><li><span>Defence</span><b>${esc(p.defense)} / 10</b></li>` : ''}
    ${p.value != null ? `<li><span>Value</span><b>${money(p.value)}</b></li>` : ''}
    ${club ? `<li><span>Club</span><b>${esc(club.name)}</b></li>` : ''}</ul></section>`;

  main.innerHTML = `<article class="pp" style="--club:${c1};--club-accent-dark:${accentFor(c1, 'dark')};--club-accent-light:${accentFor(c1, 'light')};--on-club:${onColour(c1)}">
    ${head}
    <div class="lg-cols"><div class="lg-main">${statsCard}${logCard}</div><aside class="lg-side">${ranksCard}${profile}</aside></div>
  </article>`;
}
