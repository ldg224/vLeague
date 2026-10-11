// Team pages (S-04, redesigned 0.67): one page per club (team.html?c=CODE), signed-in only since WR-02.
// The top is a band of the club's own home-kit fabric with the crest on its edge; the name, motto and last five results sit
// below it on the page, so they read the same whatever the club's colours. The squad hangs in a dressing room: one shirt per
// player in the club's home kit with their number on it. Then the trophy cabinet (from Editor -> History, history-data.js),
// the kits, squad value against the weekly cap and club details. A club's history is its trophy cabinet (B-19).
import { chrome, esc, clubs, safeColour } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub } from './shell.js';
import { loadSeason, finished, matchUrl } from './dashboard-data.js';
import { crest, teamOf, useClubs } from './places.js';
import { prefs, spoilerHidden } from './prefs.js';
import { clubSummary } from './match-model.js';
import { loadKits } from './kits-data.js';
import { loadHistory, cabinet, trophyUrl } from './history-data.js';
import { kitSprite, kitName, drawKit, cleanDesign } from './kit.js';
import { onColour } from './club-colour.js';
import { POS_ORDER } from './pitch.js';
import { icon } from './icons.js';

chrome();
const main = document.getElementById('main');
const code = String(new URLSearchParams(location.search).get('c') || '').toUpperCase();
const CAP = 125000;   // the weekly cap per team (js/draft.js)
const POS_NAME = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const RESULT = { W: 'Won', D: 'Drew', L: 'Lost' };
const KIT_ORDER = ['home', 'away', 'special', 'gk'];
function money(n) { return `$${Number(n || 0).toLocaleString('en-AU')}`; }
function ordinal(n) { return `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; }

try {
  const user = await currentUser().catch(() => null);
  // Signed-out visitors see nothing but sign-in (WR-02): stop here while the page changes.
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }
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
    main.innerHTML = `<div class="tm"><h1 class="tm-name" tabindex="-1">Club not found</h1><p class="empty">There’s no club with the code “${esc(code)}”. <a href="league.html">See the league</a></p></div>`;
  } else {
    await document.fonts?.ready;   // the shirt numbers are drawn in Oswald
    render(club || { code, name: team.name, colour: team.colour }, team, season, kits[code] || {}, cabinet(hist, code));
  }
} catch (e) {
  main.innerHTML = `<p class="empty">This team page didn’t load. ${esc(e.message || '')} <a href="team.html?c=${esc(code)}">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function render(club, team, season, kits, won) {
  document.title = `${club.name} | vLeague`;
  const c1 = safeColour(club.colour), c2 = /^#[0-9a-f]{6}$/i.test(club.colour2 || '') ? club.colour2 : onColour(c1);
  // The shirt the club plays in: its home kit, or a plain shirt in its colours until it designs one.
  const home = kits.home?.design || cleanDesign({ pattern: 'plain', colours: [c1, c2] });
  const squad = (season?.players || []).filter(p => p.team === club.code)
    .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || (Number(a.number) || 99) - (Number(b.number) || 99) || a.name.localeCompare(b.name));

  // Results this account hasn't revealed stay hidden (spoiler-free), as on League.
  const now = new Date();
  const games = season ? finished(season, now).filter(f => (f.home === club.code || f.away === club.code) && !f.exhibition && !f.test) : [];
  const shown = games.filter(f => !spoilerHidden(f, season, now));
  const sum = season && team ? clubSummary({ ...season, fixtures: season.fixtures.filter(f => !spoilerHidden(f, season, now)) }, club.code, now) : null;

  const about = [club.manager_name && `Managed by ${esc(club.manager_name)}`, club.stadium && `${club.manager_name ? 'at' : 'Plays at'} ${esc(club.stadium)}`].filter(Boolean).join(' ');

  main.innerHTML = `<article class="tm" style="--c1:${c1};--c2:${c2};--on1:${onColour(c1)}">
    <header class="tm-head">
      <div class="tm-fabric" aria-hidden="true"><canvas></canvas></div>
      <div class="tm-id">
        <div class="tm-crest">${crest(team || club, 132)}</div>
        <div class="tm-titles">
          <h1 class="tm-name" tabindex="-1">${esc(club.name)}</h1>
          ${club.motto ? `<p class="tm-motto">${esc(club.motto)}</p>` : ''}
          ${about ? `<p class="tm-about">${about}.</p>` : ''}
        </div>
        <div class="tm-now">${formHtml(shown.slice(-5), club.code, games.length - shown.length)}
          ${sum?.rank ? `<p class="tm-rank"><b>${ordinal(sum.rank)}</b> on the ladder with ${sum.pts} point${sum.pts === 1 ? '' : 's'} from ${sum.p} game${sum.p === 1 ? '' : 's'}</p>` : ''}</div>
      </div>
    </header>

    <section class="tm-room" aria-labelledby="tm-room-h">
      <h2 id="tm-room-h">Squad</h2>
      ${squadHtml(squad)}
    </section>

    ${cabinetHtml(won)}

    <div class="tm-more">
      ${kitsHtml(kits)}
      ${capHtml(squad)}
      ${factsHtml(club)}
    </div>
  </article>`;

  // Draw straight away in the kit's colours; a custom (uploaded) home design then replaces them once its picture has loaded,
  // so the band and the shirts show the club's real kit, not its average colour (B-17).
  drawFabric(home);
  drawShirts(home);
  drawKits(kits);
  if (kits.home?.artUrl) {
    const art = new Image(); art.crossOrigin = 'anonymous';
    art.onload = () => { drawFabric(home, art); drawShirts(home, art); };
    art.src = kits.home.artUrl;
  }
}

// ---------- header ----------

// The band is the club's home-kit fabric (its pattern and colours, no crest or print), stretched across the page.
function drawFabric(design, art = null) {
  const cv = main.querySelector('.tm-fabric canvas'), d = cleanDesign({ ...design, text: { ...cleanDesign(design).text, name: '', number: '' } });
  cv.width = 1200; cv.height = 240;
  const ctx = cv.getContext('2d');
  // a slice of the unrolled shirt, drawn wide; patterns repeat so a slice reads as fabric
  const tmp = document.createElement('canvas'); tmp.width = 600; tmp.height = 408;
  drawKit(tmp.getContext('2d'), art ? d : { ...d, pattern: d.pattern === 'custom' ? 'plain' : d.pattern }, 600, 408, art ? { art } : {});
  ctx.drawImage(tmp, 150, 120, 300, 120, 0, 0, 1200, 240);
}

function formHtml(list, code, hidden) {
  if (!list.length) return `<p class="tm-form-none">${hidden ? 'Results hidden (spoiler-free).' : 'No results yet this season.'}</p>`;
  return `<ol class="tm-form" aria-label="Last ${list.length} results, oldest first">${list.map(f => {
    const home = f.home === code, gf = home ? f.result.home : f.result.away, ga = home ? f.result.away : f.result.home;
    const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D', opp = home ? f.away : f.home;
    return `<li><a class="tm-res res-${o}" href="${esc(matchUrl(f))}" title="${RESULT[o]} ${gf}–${ga} ${home ? 'against' : 'at'} ${esc(opp)}" aria-label="${RESULT[o]} ${gf}–${ga} ${home ? 'against' : 'at'} ${esc(opp)}">${o}</a></li>`;
  }).join('')}</ol>`;
}

// ---------- the dressing room ----------

function squadHtml(squad) {
  if (!squad.length) return '<p class="empty">No players yet. The squad appears here after the draft.</p>';
  return POS_ORDER.filter(pos => squad.some(p => p.position === pos)).map(pos => `<div class="tm-rail">
    <h3>${POS_NAME[pos] || esc(pos)}</h3>
    <ul>${squad.filter(p => p.position === pos).map(p => `<li class="tm-pl">
      <span class="tm-shirt" data-no="${esc(p.number ?? '')}"></span>
      <b>${esc(p.name)}</b>
      <span class="tm-rt"><span title="Attack">Att <span class="rt rt-${Number(p.offense) || 5}">${esc(p.offense)}</span></span> <span title="Defence">Def <span class="rt rt-${Number(p.defense) || 5}">${esc(p.defense)}</span></span></span>
      ${p.value != null ? `<small>${money(p.value)}</small>` : ''}</li>`).join('')}</ul></div>`).join('');
}

// A shirt outline (collar, sleeves, body) filled with a kit's front. Returns the path for clipping.
function shirtPath(w, h) {
  const p = new Path2D(), u = w / 100, v = h / 100;
  p.moveTo(36 * u, 4 * v); p.quadraticCurveTo(50 * u, 13 * v, 64 * u, 4 * v);
  p.lineTo(86 * u, 12 * v); p.lineTo(100 * u, 36 * v); p.lineTo(82 * u, 44 * v); p.lineTo(79 * u, 37 * v);
  p.lineTo(79 * u, 98 * v); p.lineTo(21 * u, 98 * v); p.lineTo(21 * u, 37 * v);
  p.lineTo(18 * u, 44 * v); p.lineTo(0, 36 * v); p.lineTo(14 * u, 12 * v); p.closePath();
  return p;
}
function shirt(design, w, { art = null, number = '' } = {}) {
  const d = cleanDesign(design), h = Math.round(w * 1.02), cv = document.createElement('canvas'), x = cv.getContext('2d');
  cv.width = w * 2; cv.height = h * 2; x.scale(2, 2);
  const p = shirtPath(w, h), front = kitSprite({ ...d, text: { ...d.text, name: '', number: '' } }, art ? { art } : {}, 200);
  x.save(); x.clip(p);
  // the body takes the middle of the kit's front; the sleeves take its sides, so stripes and hoops line up as on a real shirt
  x.drawImage(front, 0, 0, front.width, front.height, -w * 0.06, 0, w * 1.12, h);
  x.restore();
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1; x.stroke(p);
  if (number !== '') {
    x.fillStyle = d.text.colour || onColour(d.colours[0]); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `700 ${Math.round(w * 0.36)}px Oswald, 'Arial Narrow', sans-serif`;
    x.lineJoin = 'round'; x.lineWidth = Math.max(3, w * 0.07); x.strokeStyle = 'rgba(0,0,0,.55)'; x.strokeText(String(number), w / 2, h * 0.6);   // an outline, as real shirt numbers have, so it reads over any stripe
    x.fillText(String(number), w / 2, h * 0.6);
  }
  cv.style.width = `${w}px`; cv.setAttribute('aria-hidden', 'true');
  return cv;
}
function drawShirts(home, art = null) {
  for (const el of main.querySelectorAll('.tm-shirt')) el.replaceChildren(shirt(home, 64, { art, number: el.dataset.no }));
}

// ---------- cabinet, kits, cap, details ----------

function cabinetHtml(won) {
  if (!won.length) return '';
  return `<section class="tm-cabinet" aria-labelledby="tm-cab-h"><div class="tm-sect-head"><h2 id="tm-cab-h">Trophy cabinet</h2><a href="history.html">League history</a></div>
    <ul>${won.map(w => `<li class="${w.place === 'winner' ? 'won' : 'runner'}">
      <span class="tm-cup">${w.art ? `<img src="${esc(trophyUrl(w.art))}" alt="" loading="lazy">` : '<i aria-hidden="true"></i>'}${w.seasons.length > 1 ? `<b class="tm-times" aria-hidden="true">${w.seasons.length}</b>` : ''}</span>
      <span class="tm-cup-t"><b>${esc(w.comp.name)}</b>${w.place === 'winner' ? 'Winners' : 'Runners-up'}${w.seasons.length > 1 ? `, ${w.seasons.length} times` : ''}</span>
      <small>${w.seasons.map(x => esc(x.name)).join(', ')}</small></li>`).join('')}</ul></section>`;
}

function kitsHtml(kits) {
  const slots = KIT_ORDER.filter(s => kits[s]);
  return `<section class="tm-kits" aria-labelledby="tm-kits-h"><h2 id="tm-kits-h">Kits</h2>
    ${slots.length ? `<ul>${slots.map(s => `<li><span class="tm-kit" data-kit="${s}"></span><span>${esc(kitName(s, kits[s].design))}</span></li>`).join('')}</ul>` : '<p class="quiet">No kits designed yet. The team plays in its club colours.</p>'}</section>`;
}
function drawKits(kits) {
  for (const el of main.querySelectorAll('[data-kit]')) {
    const k = kits[el.dataset.kit], put = art => el.replaceChildren(shirt(k.design, 76, { art }));
    put(null);
    if (k.artUrl) { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => put(i); i.src = k.artUrl; }
  }
}

function capHtml(squad) {
  const used = squad.reduce((t, p) => t + (Number(p.value) || 0), 0), pct = Math.min(100, used / CAP * 100);
  const state = used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : '';
  return `<section class="tm-cap${state}" aria-labelledby="tm-cap-h"><h2 id="tm-cap-h">Weekly cap</h2>
    <p class="tm-cap-n"><b>${money(used)}</b> of ${money(CAP)}</p>
    <div class="tm-bar" role="progressbar" aria-label="Weekly cap used" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <p class="tm-cap-left">${used > CAP ? `${money(used - CAP)} over the cap` : `${money(CAP - used)} left`}</p></section>`;
}

function factsHtml(club) {
  const sw = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? `<i class="tm-sw" style="background:${c}" title="${c}"></i>` : '');
  const rows = [
    ['Short name', club.short_name && club.short_name !== club.name ? esc(club.short_name) : ''],
    ['Code', esc(club.code)],
    ['Colours', `${sw(club.colour)}${sw(club.colour2)}`],
  ].filter(([, v]) => v);
  return `<section class="tm-facts" aria-labelledby="tm-facts-h"><h2 id="tm-facts-h">Club</h2>
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
}
