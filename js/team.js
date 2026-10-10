// Team pages (S-04, 0.65): one page per club (team.html?c=CODE), open to guests like the Game centre.
// The top is cut like the club's shirt (its two colours, a sash, the crest and the name across it) with the last five results;
// below it the squad by position, squad value against the weekly cap, the club's kits, its details, and the history and
// story the league office writes in Editor → Clubs (clubs.history, migration 0049). Trophies won (0.66) sit in a cabinet under
// the shirt, worked out from Editor → History (history-data.js).
import { chrome, esc, clubs, safeColour } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub } from './shell.js';
import { loadSeason, finished, matchUrl } from './dashboard-data.js';
import { crest, teamOf, useClubs, markdown } from './places.js';
import { prefs, spoilerHidden } from './prefs.js';
import { clubSummary } from './match-model.js';
import { loadKits } from './kits-data.js';
import { loadHistory, cabinet, trophyUrl } from './history-data.js';
import { kitSprite, kitName } from './kit.js';
import { onColour } from './club-colour.js';
import { POS_ORDER } from './pitch.js';
import { icon } from './icons.js';

chrome();
const main = document.getElementById('main');
const code = String(new URLSearchParams(location.search).get('c') || '').toUpperCase();
const CAP = 125000;   // the weekly cap per team (js/draft.js)
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const POS_NAME = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const RESULT = { W: 'Won', D: 'Drew', L: 'Lost' };
const KIT_ORDER = ['home', 'away', 'special', 'gk'];

try {
  const user = await currentUser().catch(() => null);
  const [rows, season, kits, hist] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null), loadKits(), loadHistory()]);
  useClubs(rows);
  if (user) {
    const back = document.getElementById('back');
    back.href = 'league.html'; back.innerHTML = `${icon('arrow-left')} League`;
    await prefs().catch(() => null);
    const prof = await myProfile().catch(() => null);
    paintClub(rows.find(c => c.code === prof?.club) || null);
  }
  const club = rows.find(c => c.code === code), team = season?.teams.some(t => t.code === code) ? teamOf(season, code) : null;   // teamOf makes up a team for any code
  if (!club && !team) {
    main.innerHTML = `<h1 class="page-title" tabindex="-1">Team</h1><p class="empty">That club couldn’t be found. <a href="${user ? 'league.html' : 'dashboard.html'}">See the league</a></p>`;
  } else {
    render(club || { code, name: team.name, colour: team.colour }, team, season, kits[code] || {}, cabinet(hist, code));
  }
} catch (e) {
  main.innerHTML = `<p class="empty">This team page didn’t load. ${esc(e.message || '')} <a href="team.html?c=${esc(code)}">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function render(club, team, season, kits, won) {
  document.title = `${club.name} | vLeague`;
  const c1 = safeColour(club.colour), c2 = /^#[0-9a-f]{6}$/i.test(club.colour2 || '') ? club.colour2 : onColour(c1);
  const squad = (season?.players || []).filter(p => p.team === club.code)
    .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name));

  // Results this account hasn't revealed stay hidden (spoiler-free), as on League.
  const now = new Date();
  const games = season ? finished(season, now).filter(f => (f.home === club.code || f.away === club.code) && !f.exhibition && !f.test) : [];
  const shown = games.filter(f => !spoilerHidden(f, season, now));
  const last5 = shown.slice(-5);
  const sum = season && team ? clubSummary({ ...season, fixtures: season.fixtures.filter(f => !spoilerHidden(f, season, now)) }, club.code, now) : null;

  main.innerHTML = `<article class="tm" style="--c1:${c1};--c2:${c2};--on1:${onColour(c1)};--on2:${onColour(c2)}">
    <header class="tm-hero">
      <div class="tm-sash" aria-hidden="true"></div>
      <div class="tm-hero-in">
        <div class="tm-crest">${crest(team || club, 112)}</div>
        <h1 class="tm-name" tabindex="-1">${esc(club.name)}</h1>
        ${club.motto ? `<p class="tm-motto">${esc(club.motto)}</p>` : ''}
        ${formHtml(last5, club.code, games.length - shown.length)}
      </div>
    </header>
    ${cabinetHtml(won)}
    <div class="tm-grid">
      <section class="tm-squad" aria-labelledby="tm-squad-h">
        <h2 id="tm-squad-h">Squad</h2>
        ${sum ? `<p class="tm-record">${sum.rank ? `${ordinal(sum.rank)} on the ladder · ` : ''}${sum.pts} point${sum.pts === 1 ? '' : 's'} from ${sum.p} game${sum.p === 1 ? '' : 's'}</p>` : ''}
        ${squadHtml(squad)}
      </section>
      <div class="tm-side">
        ${capHtml(squad)}
        ${kitsHtml(kits)}
        ${factsHtml(club)}
        ${historyHtml(club)}
      </div>
    </div>
  </article>`;
  drawKits(kits);
}

function ordinal(n) { return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; }

function formHtml(list, code, hidden) {
  if (!list.length) return `<p class="tm-form-none">${hidden ? 'Results hidden (spoiler-free).' : 'No results yet this season.'}</p>`;
  return `<ol class="tm-form" aria-label="Last ${list.length} results, oldest first">${list.map(f => {
    const home = f.home === code, gf = home ? f.result.home : f.result.away, ga = home ? f.result.away : f.result.home;
    const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp = home ? f.away : f.home;
    return `<li><a class="tm-res res-${o}" href="${esc(matchUrl(f))}" aria-label="${RESULT[o]} ${gf}–${ga} ${home ? 'against' : 'at'} ${esc(opp)}">
      <b>${o}</b><span>${gf}–${ga}</span><small>${home ? 'v' : '@'} ${esc(opp)}</small></a></li>`;
  }).join('')}</ol>`;
}

function squadHtml(squad) {
  if (!squad.length) return '<p class="empty">No players yet. The squad appears after the draft.</p>';
  return POS_ORDER.filter(pos => squad.some(p => p.position === pos)).map(pos => `<h3>${POS_NAME[pos] || esc(pos)}</h3>
    <ul class="tm-players">${squad.filter(p => p.position === pos).map(p => `<li>
      <span class="tm-no">${esc(p.number ?? '')}</span>
      <span class="tm-pl">${esc(p.name)}</span>
      <span class="tm-rt"><abbr title="Attack">Att</abbr> <span class="rt rt-${Number(p.offense) || 5}">${esc(p.offense)}</span> <abbr title="Defence">Def</abbr> <span class="rt rt-${Number(p.defense) || 5}">${esc(p.defense)}</span></span>
      <span class="tm-val">${p.value != null ? money(p.value) : ''}</span></li>`).join('')}</ul>`).join('');
}

function capHtml(squad) {
  if (!squad.length) return '';
  const used = squad.reduce((t, p) => t + (Number(p.value) || 0), 0), pct = Math.min(100, used / CAP * 100);
  const state = used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : '';
  return `<section class="tm-box tm-cap${state}" aria-labelledby="tm-cap-h"><h2 id="tm-cap-h">Weekly cap</h2>
    <p><b>${money(used)}</b> of ${money(CAP)} · ${used > CAP ? `${money(used - CAP)} over` : `${money(CAP - used)} left`}</p>
    <div class="tm-bar" role="progressbar" aria-label="Weekly cap used" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></div></section>`;
}

function kitsHtml(kits) {
  const slots = KIT_ORDER.filter(s => kits[s]);
  if (!slots.length) return '';
  return `<section class="tm-box" aria-labelledby="tm-kits-h"><h2 id="tm-kits-h">Kits</h2>
    <ul class="tm-kits">${slots.map(s => `<li><span class="tm-kit" data-kit="${s}"></span><span>${esc(kitName(s, kits[s].design))}</span></li>`).join('')}</ul></section>`;
}

// Each kit on a shirt outline: the match sprite (the shirt's front, unrolled) clipped to a T-shirt with sleeves.
function shirt(sprite, w = 96) {
  const h = Math.round(w * 1.05), cv = document.createElement('canvas'), x = cv.getContext('2d');
  cv.width = w * 2; cv.height = h * 2; x.scale(2, 2);
  const p = new Path2D(), u = w / 100;
  p.moveTo(36 * u, 4 * u); p.quadraticCurveTo(50 * u, 14 * u, 64 * u, 4 * u);   // collar
  p.lineTo(86 * u, 12 * u); p.lineTo(100 * u, 38 * u); p.lineTo(82 * u, 46 * u); p.lineTo(80 * u, 38 * u);   // right sleeve
  p.lineTo(80 * u, 104 * u); p.lineTo(20 * u, 104 * u); p.lineTo(20 * u, 38 * u);   // body
  p.lineTo(18 * u, 46 * u); p.lineTo(0, 38 * u); p.lineTo(14 * u, 12 * u); p.closePath();   // left sleeve
  x.save(); x.clip(p); x.drawImage(sprite, 0, 0, w, h); x.restore();
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1; x.stroke(p);
  cv.style.width = `${w}px`; cv.setAttribute('aria-hidden', 'true');
  return cv;
}

function drawKits(kits) {
  for (const el of main.querySelectorAll('[data-kit]')) {
    const k = kits[el.dataset.kit], put = art => el.replaceChildren(shirt(kitSprite({ ...k.design, text: { ...k.design.text, name: '', number: '' } }, art ? { art } : {}, 160)));
    put(null);
    if (k.artUrl) { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => put(i); i.src = k.artUrl; }
  }
}

function factsHtml(club) {
  const sw = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? `<i class="tm-sw" style="background:${c}"></i>` : '');
  const rows = [
    ['Code', esc(club.code)],
    ['Short name', esc(club.short_name || '')],
    ['Colours', `${sw(club.colour)}${sw(club.colour2)}`],
    ['Stadium', esc(club.stadium || '')],
    ['Manager', esc(club.manager_name || '')],
  ].filter(([, v]) => v);
  return `<section class="tm-box" aria-labelledby="tm-facts-h"><h2 id="tm-facts-h">Club</h2>
    <dl class="tm-facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
}

function historyHtml(club) {
  if (!club.history) return '';
  return `<section class="tm-box tm-history" aria-labelledby="tm-hist-h"><h2 id="tm-hist-h">History</h2>
    <div class="tm-story">${markdown(club.history)}</div></section>`;
}

// The trophy cabinet: each trophy won once per competition and place, with how many times and which seasons. Winners first.
function cabinetHtml(won) {
  if (!won.length) return '';
  return `<section class="tm-cabinet" aria-labelledby="tm-cab-h"><h2 id="tm-cab-h">Trophy cabinet</h2>
    <ul>${won.map(w => `<li class="${w.place === 'winner' ? 'won' : 'runner'}">
      <span class="tm-cup">${w.art ? `<img src="${esc(trophyUrl(w.art))}" alt="" loading="lazy">` : '<i aria-hidden="true"></i>'}${w.seasons.length > 1 ? `<b class="tm-times" aria-hidden="true">×${w.seasons.length}</b>` : ''}</span>
      <span class="tm-cup-t"><b>${esc(w.comp.name)}</b> ${w.place === 'winner' ? 'winners' : 'runners-up'}${w.seasons.length > 1 ? ` (${w.seasons.length})` : ''}</span>
      <small>${w.seasons.map(x => esc(x.name)).join(', ')}</small></li>`).join('')}</ul>
    <a class="tm-cab-link" href="history.html">League history</a></section>`;
}
