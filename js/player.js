// Player pages: one page per player (player.html?id=ID), signed-in only. Opened from any player name on the site (js/player-link.js).
// A header card (portrait in his club's kit, name, club, position, shirt number), then two columns: the detailed season stats as a list
// (totals and per 90, grouped), his match log (each match opens the match), his places in the league's lists, and his profile.
// player.html?id=RED9&preview&demo=6 shows a player of the made-up demo season (localhost, or the office), to see the classes before real matches exist.
// The numbers come from js/player-stats.js, which reads the season's saved results; results the viewer has not opened stay out (spoiler-free).
import { chrome, esc, clubs, safeColour, crestUrl } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub, startSilk, styleCards } from './shell.js';
import { mountSubFrame } from './frame.js';
import { loadSeason, matchUrl, kickoff } from './dashboard-data.js';
import { crest, teamOf, useClubs, rating } from './places.js';
import { prefs, spoilerHidden } from './prefs.js';
import { accentFor, onColour } from './club-colour.js';
import { loadPlayers } from './players-data.js';
import { portrait } from './portrait.js';
import { hasPreseason, scopeNow } from './preseason.js';
import { playerView, averageRating, CLASSES, MIN_PEERS, MIN_MATCHES } from './player-stats.js';
import { icon } from './icons.js';
import { extractMaps, mergeMaps, shotMap, heatMap } from './player-maps.js';
import { loadMatchFile } from './match-file.js';
import { demoSeason } from './demo-season.js';
import { lineOf } from './season-stats.js';

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
  let [rows, season, list] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null), loadPlayers().catch(() => [])]);
  useClubs(rows);
  if (!preview) await prefs().catch(() => null);
  const prof = preview ? { role: q.has('office') ? 'office' : 'manager', club: q.get('mine') } : await myProfile().catch(() => null);
  const mine = rows.find(c => c.code === prof?.club) || null;
  paintClub(mine);
  startSilk();
  document.body.classList.toggle('has-club', Boolean(mine));
  mountSubFrame(document.getElementById('frame'), { office: prof?.role === 'office', crest: mine?.crest_path ? crestUrl(mine.crest_path) : '', here: '', title: '' });
  const demo = q.has('demo') && (preview || prof?.role === 'office');
  if (demo) {
    season = demoSeason({ rounds: Number(q.get('demo') || 6) });
    // The demo season has no player list, only the players inside its results.
    const seen = new Map();
    for (const f of season.fixtures) for (const [pid, pl] of Object.entries(f.result?.players || {})) if (!seen.has(pid)) seen.set(pid, { id: pid, name: pl.name, team: pl.team, position: lineOf(pl.slot), number: seen.size % 11 + 1, offense: 6, defense: 5, value: 3000 });
    season.players = [...seen.values()];
  }
  else if (season && !season.players?.length) season.players = list;
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
  const { player: p, row, log, groups } = v;
  const clubFor = c => { const t = season ? teamOf(season, c) : { code: c, name: c }, r = byCode.get(c); return { ...t, ...(r ? { name: r.name, short_name: r.short_name, colour: r.colour, crest_path: r.crest_path } : {}) }; };
  const club = p.team ? clubFor(p.team) : null, c1 = safeColour(club?.colour);
  document.title = `${p.name} | vLeague`;
  const avg = averageRating(row);

  const sur = p.name.trim().split(/\s+/).slice(-1)[0];
  const head = `<header class="lg-card pp-head">
    <span class="pp-ghost" aria-hidden="true">${esc(sur)}</span>
    <div class="pp-id">
      <div class="pp-pic">${portrait(p, club, 112, true)}</div>
      <div class="pp-titles">
        <h1 class="pp-name" tabindex="-1">${esc(p.name)}</h1>
        <p class="pp-sub">${club ? `<a class="pp-club" href="team.html?c=${esc(club.code)}">${crest(club, 20)}<span>${esc(club.name)}</span></a>` : '<span>Free agent</span>'}</p>
        <p class="pp-facts"><span>${POS_WORD[p.position] || esc(p.position)}</span>${p.number != null && p.number !== '' ? `<span>No. ${esc(p.number)}</span>` : ''}${p.offense != null ? `<span>Attack ${esc(p.offense)}</span><span>Defence ${esc(p.defense)}</span>` : ''}${p.value != null ? `<span>${money(p.value)}</span>` : ''}</p>
      </div>
      <div class="pp-now">
        ${avg != null ? `<p class="pp-avg"><span>Average rating</span>${rating(avg)}</p>` : ''}
      </div>
    </div>
  </header>`;

  const CLS = Object.fromEntries(CLASSES.map(([k, label]) => [k, label]));
  const pill = k => `<span class="pp-cls is-${k}">${k === 'elite' ? icon('star') : ''}${CLS[k]}</span>`;
  const { compare } = v;
  const key = `<div class="pp-key" aria-label="Classes">${CLASSES.map(([k]) => pill(k)).join('')}</div>`;
  const why = row && row.apps < MIN_MATCHES ? `${esc(p.name)} needs ${MIN_MATCHES} matches (has ${row.apps})`
    : `${MIN_PEERS} ${esc(compare.word)} need ${MIN_MATCHES}+ matches (${compare.seasoned} so far)`;
  const how = !compare.eligible
    ? `<p class="pp-note">The bars show the league average for ${esc(compare.word)} (${compare.n} with ${v.minMinutes}+ minutes). Classes appear once ${why}, because one match is too little to judge.</p>`
    : `<p class="pp-note">Compared with ${compare.seasoned} ${esc(compare.word)} who have played ${MIN_MATCHES}+ matches, per 90. Elite is the top 10%, Great the next 20%, Average the middle 40%, Below average the next 20%, Poor the last 10%. Where less is better (conceded, fouls, cards) it is turned round.</p>`;
  const statRow = r => {
    const bar = r.fill != null ? `<span class="pp-bar${r.low ? ' is-low' : ''}" role="img" aria-label="${esc(r.label)}: ${esc(r.per90 ?? r.total)}, league average ${esc(r.avg)}"><i style="width:${r.fill}%"></i><u style="left:${r.tick}%"></u></span>` : '<span class="pp-bar none"></span>';
    return `<li class="pp-stat${r.cls ? ` has-cls is-${r.cls}` : ''}"><span class="pp-sl">${esc(r.label)}</span>
      <b class="pp-v">${esc(r.per90 ?? r.total)}</b><span class="pp-t">${r.per90 != null ? esc(r.total) : ''}</span><span class="pp-a">${r.avg != null ? esc(r.avg) : ''}</span>${bar}
      <span class="pp-c">${r.cls ? pill(r.cls) : ''}</span>
      <span class="pp-mx">${r.per90 != null ? `<b>${esc(r.per90)}</b> per 90 · ${esc(r.total)} total${r.avg != null ? ` · league avg ${esc(r.avg)}` : ''}` : `<b>${esc(r.total)}</b>`}</span></li>`;
  };
  const statsCard = !row
    ? `<section class="lg-card"><div class="lg-card-head"><h2>Season stats</h2></div><p class="empty">${esc(p.name)} hasn’t played a match yet.</p></section>`
    : `<section class="lg-card pp-stats"><div class="lg-card-head"><h2>${v.scope === 'preseason' ? 'Preseason stats' : 'Season stats'}</h2></div>
        ${compare.eligible ? key : ''}${how}
        <div class="pp-hd"><span></span><span>Per 90</span><span>Total</span><span>League avg</span><span></span><span>Class</span></div>
        ${groups.map(g => `<h3 class="pp-strip">${esc(g.title)}</h3><ul class="pp-statlist">${g.rows.map(statRow).join('')}</ul>`).join('')}
      </section>`;

  const logCard = log.length ? `<section class="lg-card pp-log"><div class="lg-card-head"><h2>Matches</h2></div>
    <ul class="pp-matches">${[...log].reverse().map(l => {
      const k = kickoff(l.fx), s = l.s, opp = clubFor(l.opp);
      const bits = [s.g ? plural(s.g, 'goal') : '', s.a ? plural(s.a, 'assist') : '', p.position === 'GK' ? plural(s.sv || 0, 'save') : '', s.rc ? 'sent off' : s.yc ? 'booked' : ''].filter(Boolean);
      return `<li><a class="pp-m" href="${esc(matchUrl(l.fx))}">
        <span class="pp-when">${k ? dayFmt.format(k) : ''}<small>${esc(l.fx.round || '')}</small></span>
        <span class="pp-opp">${crest(opp, 20)}<b>${esc(l.home ? '' : 'at ')}${esc(opp.short_name || opp.name)}</b><small>${bits.join(' · ') || `${s.min || 0} min`}</small></span>
        <span class="pp-res"><b class="pp-chip ${l.res}">${l.res}</b><i>${l.gf}–${l.ga}</i></span>
        ${l.rating != null ? rating(l.rating) : '<span></span>'}</a></li>`;
    }).join('')}</ul></section>` : '';

  // ---- charts (js/player-charts.js): tabs for the profile, match by match, and the league; one panel is drawn at a time ----
  const MAPS = [['heat', 'Where he plays', heatMap], ['shots', 'Shots', shotMap]];
  const mp = { status: 'idle', done: 0, total: 0, data: null, pick: MAPS.some(x => x[0] === q.get('map')) ? q.get('map') : 'heat' };
  const mapsHtml = () => {
    if (mp.status === 'loading') return `<p class="pp-note" role="status">Reading match files… ${mp.done} of ${mp.total}. Each is about 2 MB, so this takes a moment the first time.</p>`;
    if (mp.status === 'none') return '<p class="pp-note">Maps are drawn from the saved match files, and none are available for these matches.</p>';
    if (mp.status === 'error') return '<p class="pp-note">The match files could not be read. Check your connection and open this tab again.</p>';
    if (!mp.data) return '<p class="pp-note">The maps load as you scroll to them.</p>';
    const pills = `<nav class="sc-toggle pc-pills" aria-label="Map">${MAPS.map(([k, label]) => `<button type="button" class="pc-pill" data-pcmap="${k}" aria-pressed="${k === mp.pick}">${label}</button>`).join('')}</nav>`;
    return `${pills}${MAPS.find(x => x[0] === mp.pick)[2](mp.data)}<p class="pp-note">${mp.data.matches === 1 ? 'One match' : `All ${mp.data.matches} matches`} added up, in a shared direction of play.</p>`;
  };
  // The newest 12 matches with a saved file, read one at a time (the files are big) the first time the tab opens.
  const loadMaps = async () => {
    if (mp.status !== 'idle') return;
    const todo = log.filter(l => l.fx.result?.file || l.fx.demoFile).slice(-12);
    if (!todo.length) { mp.status = 'none'; drawPanel(); return; }
    mp.status = 'loading'; mp.total = todo.length; drawPanel();
    try {
      const parts = [];
      for (const l of todo) { parts.push(extractMaps(await loadMatchFile(l.fx), p.id)); mp.done++; drawPanel(); }
      mp.data = mergeMaps(parts); mp.status = 'ready';
    } catch { mp.status = 'error'; }
    drawPanel();
  };
  // The maps load when their card comes into view (the match files are big), not on every visit.
  const mapsCard = row ? `<section class="lg-card pp-maps"><div class="lg-card-head"><h2>Maps</h2></div><div class="pc-panel" id="pc-panel">${mapsHtml()}</div></section>` : '';

  main.innerHTML = `<article class="pp" style="--club:${c1};--club-accent-dark:${accentFor(c1, 'dark')};--club-accent-light:${accentFor(c1, 'light')};--on-club:${onColour(c1)}">
    ${head}
    <div class="lg-cols"><div class="lg-main">${mapsCard}${statsCard}</div><aside class="lg-side">${logCard}</aside></div>
  </article>`;

  const drawPanel = () => { const el = main.querySelector('#pc-panel'); if (el) el.innerHTML = mapsHtml(); };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-pcmap]');
    if (!t) return;
    mp.pick = t.dataset.pcmap;
    drawPanel();
    main.querySelector(`[data-pcmap="${mp.pick}"][aria-pressed="true"]`)?.focus({ preventScroll: true });
  });
  const box = main.querySelector('#pc-panel');
  if (box && 'IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); loadMaps(); } }); io.observe(box); } else if (box) loadMaps();
  wireTips(main);
  styleCards();
}

// One tooltip for every chart mark with a data-tip: follows the mouse, shows on keyboard focus, and a tap on a phone shows it until the next tap.
function wireTips(root) {
  let tip = document.querySelector('.pc-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'pc-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.append(tip); }
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2))}px`;
    tip.style.top = `${y - r.height - 12 < 8 ? y + 18 : y - r.height - 12}px`;
  };
  const at = el => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top]; };
  root.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const el = e.target.closest?.('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true; });
  root.addEventListener('pointerleave', () => { tip.hidden = true; });
  root.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const el = e.target.closest?.('[data-tip]'); if (el) show(el, ...at(el)); else tip.hidden = true; });
  root.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el) show(el, ...at(el)); });
  root.addEventListener('focusout', () => { tip.hidden = true; });
  addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  addEventListener('keydown', e => { if (e.key === 'Escape') tip.hidden = true; });
}
