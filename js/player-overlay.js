// The player popup: click any player's name on the site and a nearly full-screen card opens over the page with his stats, maps and matches (the user, 26 Oct 2026,
// FotMob's player page as an overlay). One <dialog> for the whole site, an X in the top right, Esc or a tap outside closes it, and the browser's Back button closes it too.
//   openPlayer(id)            opens the popup for a player id (loads the league's data the first time)
//   closePlayer()             closes it
//   registerPlayerHost(fn)    a page that already holds the season says so: fn() -> { season, rows, demo }, so the popup does not load it twice (the league page sets
//                             globalThis.vlPlayerHost instead, so this module is only loaded when a name is first clicked)
//   openFromUrl()             opens the player named in the address (?player=ID), for a shared link and for screenshots
//   getData()                 the league's data the popup draws from
//   renderPlayerInto(el, { season, rows }, id) -> { ok }   the card itself, used by the popup and by the all-players check
// The numbers come from js/player-stats.js (the season's saved results; results the viewer has not opened stay out, spoiler-free), the maps from js/player-maps.js
// and the match page's shot map (js/match-shotmap.js).
import { esc, clubs, safeColour } from './member.js';
import { loadSeason, matchUrl, kickoff } from './dashboard-data.js';
import { crest, teamOf, useClubs, rating } from './places.js';
import { prefs, spoilerHidden } from './prefs.js';
import { accentFor, onColour } from './club-colour.js';
import { loadPlayers } from './players-data.js';
import { portrait } from './portrait.js';
import { hasPreseason, scopeNow } from './preseason.js';
import { playerView, averageRating, CLASSES, MIN_PEERS, MIN_MATCHES } from './player-stats.js';
import { icon } from './icons.js';
import { extractMaps, mergeMaps, heatMap } from './player-maps.js';
import { shotsOf, playerShotMap, shotMapClick } from './match-shotmap.js';
import { loadMatchFile } from './match-file.js';
import { lineOf } from './season-stats.js';
import { sheen } from './silk.js';

const POS_WORD = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const dayFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- the data: the league page hands over what it has; any other page loads it once and keeps it for a few minutes ----
let host = null, memo = null;
export const registerPlayerHost = fn => { host = fn; };
// The demo season has no player list, only the players inside its results.
const playersFromResults = season => {
  const seen = new Map();
  for (const f of season.fixtures) for (const [pid, pl] of Object.entries(f.result?.players || {})) if (!seen.has(pid)) seen.set(pid, { id: pid, name: pl.name, team: pl.team, position: lineOf(pl.slot), number: seen.size % 11 + 1, offense: 6, defense: 5, value: 3000 });
  return [...seen.values()];
};
export async function getData() {
  const h = (host || globalThis.vlPlayerHost)?.();
  if (h?.season) {
    if (!h.season.players?.length) h.season.players = h.demo ? playersFromResults(h.season) : await loadPlayers().catch(() => []);
    return { season: h.season, rows: h.rows || [] };
  }
  if (memo && Date.now() - memo.at < 5 * 60 * 1000) return memo.data;
  const [rows, season, list] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null), loadPlayers().catch(() => [])]);
  useClubs(rows);
  await prefs().catch(() => null);
  if (season && !season.players?.length) season.players = list;
  memo = { at: Date.now(), data: { season, rows } };
  return memo.data;
}

// ---- the card ----
export function renderPlayerInto(root, { season, rows }, id) {
  const now = new Date(), byCode = new Map((rows || []).map(r => [r.code, r]));
  const hidden = new Set(season ? season.fixtures.filter(f => f.result && !f.test && spoilerHidden(f, season, now)).map(f => f.id) : []);
  const scope = season && hasPreseason(season) ? scopeNow(season, now) : 'season';
  const v = season ? playerView(season, id, { hidden, scope }) : null;
  if (!v) {
    root.innerHTML = '<div class="pp"><section class="lg-card"><h1 class="pp-name" tabindex="-1">Player not found</h1><p class="empty">There’s no player with that number.</p></section></div>';
    return { ok: false };
  }
  const { player: p, row, log, groups, compare } = v;
  const clubFor = c => { const t = season ? teamOf(season, c) : { code: c, name: c }, r = byCode.get(c); return { ...t, ...(r ? { name: r.name, short_name: r.short_name, colour: r.colour, crest_path: r.crest_path } : {}) }; };
  const cname = c => { const t = clubFor(c); return t.short_name || t.name || c; };
  const club = p.team ? clubFor(p.team) : null, c1 = safeColour(club?.colour);
  const avg = averageRating(row);

  const sur = p.name.trim().split(/\s+/).slice(-1)[0];
  const head = `<header class="lg-card pp-head">
    <span class="pp-ghost" aria-hidden="true">${esc(sur)}</span>
    <div class="pp-id">
      <div class="pp-pic">${portrait(p, club, 112, true)}</div>
      <div class="pp-titles">
        <h1 class="pp-name" id="po-title" tabindex="-1">${esc(p.name)}</h1>
        <p class="pp-sub">${club ? `<a class="pp-club" href="team.html?c=${esc(club.code)}">${crest(club, 20)}<span>${esc(club.name)}</span></a>` : '<span>Free agent</span>'}</p>
        <p class="pp-facts"><span>${POS_WORD[p.position] || esc(p.position)}</span>${p.number != null && p.number !== '' ? `<span>No. ${esc(p.number)}</span>` : ''}${p.offense != null ? `<span>Attack ${esc(p.offense)}</span><span>Defence ${esc(p.defense)}</span>` : ''}${p.value != null ? `<span>${money(p.value)}</span>` : ''}</p>
      </div>
      <div class="pp-now">${avg != null ? `<p class="pp-avg"><span>Average rating</span>${rating(avg)}</p>` : ''}</div>
    </div>
  </header>`;

  const CLS = Object.fromEntries(CLASSES.map(([k, label]) => [k, label]));
  const pill = (k, prov) => `<span class="pp-cls is-${k}${prov ? ' is-prov' : ''}"${prov ? ' title="Provisional: settles after 3 matches"' : ''}>${k === 'elite' ? icon('star') : ''}${CLS[k]}</span>`;
  const key = `<div class="pp-key" aria-label="Classes">${CLASSES.map(([k]) => pill(k)).join('')}</div>`;
  const why = row && row.apps < MIN_MATCHES ? `${esc(p.name)} needs ${MIN_MATCHES} matches (has ${row.apps})` : `${MIN_PEERS} ${esc(compare.word)} need ${MIN_MATCHES}+ matches (${compare.seasoned} so far)`;
  const how = !compare.eligible
    ? `<p class="pp-note">${compare.provisional ? `<b>Provisional.</b> Classes (dashed) are a first guess from ${row.apps} match${row.apps === 1 ? '' : 'es'}, against ${compare.n} ${esc(compare.word)} with ${v.minMinutes}+ minutes. They settle once ${why}.` : `The bars show the league average for ${esc(compare.word)} (${compare.n} with ${v.minMinutes}+ minutes). Classes appear once ${why}.`}</p>`
    : `<p class="pp-note">Compared with ${compare.seasoned} ${esc(compare.word)} who have played ${MIN_MATCHES}+ matches, per 90. Elite is the top 10%, Great the next 20%, Average the middle 40%, Below average the next 20%, Poor the last 10%. Where less is better (conceded, fouls, cards) it is turned round.</p>`;
  const statRow = r => {
    const bar = r.fill != null ? `<span class="pp-bar${r.low ? ' is-low' : ''}" role="img" aria-label="${esc(r.label)}: ${esc(r.per90 ?? r.total)}, league average ${esc(r.avg)}"><i style="width:${r.fill}%"></i><u style="left:${r.tick}%"></u></span>` : '<span class="pp-bar none"></span>';
    return `<li class="pp-stat${r.cls ? ` has-cls is-${r.cls}` : ''}"><span class="pp-sl">${esc(r.label)}</span>
      <b class="pp-v">${esc(r.per90 ?? r.total)}</b><span class="pp-t">${r.per90 != null ? esc(r.total) : ''}</span><span class="pp-a">${r.avg != null ? esc(r.avg) : ''}</span>${bar}
      <span class="pp-c">${r.cls ? pill(r.cls, r.prov) : ''}</span>
      <span class="pp-mx">${r.per90 != null ? `<b>${esc(r.per90)}</b> per 90 · ${esc(r.total)} total${r.avg != null ? ` · league avg ${esc(r.avg)}` : ''}` : `<b>${esc(r.total)}</b>`}</span></li>`;
  };
  const statsCard = !row
    ? `<section class="lg-card"><div class="lg-card-head"><h2>Season stats</h2></div><p class="empty">${esc(p.name)} hasn’t played a match yet.</p></section>`
    : `<section class="lg-card pp-stats"><div class="lg-card-head"><h2>${v.scope === 'preseason' ? 'Preseason stats' : 'Season stats'}</h2></div>
        ${compare.eligible || compare.provisional ? key : ''}${how}
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

  // ---- the maps: the match files are big, so they load when the card scrolls into view ----
  const shotLabel = sh => `${club ? crest(club, 28) : ''}<b>${esc(sh.label)}</b>`;
  const MAPS = [['heat', 'Heatmap', heatMap], ['shots', 'Shots', m => playerShotMap(m.shots, mp.shot, { colour: c1, label: shotLabel })]];
  const mp = { status: 'idle', done: 0, total: 0, data: null, shot: { sel: null, ids: [] }, pick: 'heat' };
  const mapsHtml = () => {
    if (mp.status === 'loading') return `<p class="pp-note" role="status">Reading match files… ${mp.done} of ${mp.total}. Each is about 2 MB, so this takes a moment the first time.</p>`;
    if (mp.status === 'none') return '<p class="pp-note">Maps are drawn from the saved match files, and none are available for these matches.</p>';
    if (mp.status === 'error') return '<p class="pp-note">The match files could not be read. Check your connection and scroll away and back to try again.</p>';
    if (!mp.data) return '<p class="pp-note">The maps load as you scroll to them.</p>';
    const pills = `<nav class="sc-toggle pc-pills" aria-label="Map">${MAPS.map(([k, label]) => `<button type="button" class="pc-pill" data-pcmap="${k}" aria-pressed="${k === mp.pick}">${label}</button>`).join('')}</nav>`;
    return `${pills}${MAPS.find(x => x[0] === mp.pick)[2](mp.data)}<p class="pp-note">${mp.data.matches === 1 ? 'One match' : `All ${mp.data.matches} matches`} added up, in a shared direction of play.</p>`;
  };
  const drawPanel = () => { const el = root.querySelector('#pc-panel'); if (el) el.innerHTML = mapsHtml(); };
  const loadMaps = async () => {
    if (mp.status !== 'idle') return;
    const todo = log.filter(l => l.fx.result?.file || l.fx.demoFile).slice(-12);   // the newest 12 matches, one at a time
    if (!todo.length) { mp.status = 'none'; drawPanel(); return; }
    mp.status = 'loading'; mp.total = todo.length; drawPanel();
    try {
      const parts = [], shots = [];
      for (const l of todo) {
        const file = await loadMatchFile(l.fx);
        parts.push(extractMaps(file, p.id));
        // His shots, each turned so it attacks the right-hand goal (shotsOf has the home club attacking left), with the match named.
        for (const sh of shotsOf(file, l.fx).filter(x => String(x.e.player) === String(p.id))) {
          shots.push({ ...sh, id: `${l.fx.id}:${sh.id}`, home: false, X: sh.home ? 105 - sh.X : sh.X, Y: sh.home ? 68 - sh.Y : sh.Y, endY: sh.endY == null ? null : sh.home ? 68 - sh.endY : sh.endY,
            label: `${l.home ? '' : 'at '}${cname(l.opp)} · ${dayFmt.format(kickoff(l.fx) || new Date())}` });
        }
        mp.done++; drawPanel();
      }
      mp.data = { ...mergeMaps(parts), shots }; mp.status = 'ready';
    } catch { mp.status = 'error'; }
    drawPanel();
  };
  const mapsCard = row ? `<section class="lg-card pp-maps"><div class="lg-card-head"><h2>Maps</h2></div><div class="pc-panel" id="pc-panel">${mapsHtml()}</div></section>` : '';

  root.innerHTML = `<article class="pp" style="--club:${c1};--club-accent-dark:${accentFor(c1, 'dark')};--club-accent-light:${accentFor(c1, 'light')};--on-club:${onColour(c1)}">
    ${head}
    <div class="lg-cols"><div class="lg-main">${mapsCard}${statsCard}</div><aside class="lg-side">${logCard}</aside></div>
  </article>`;

  root.addEventListener('click', e => {
    const pick = e.target.closest('[data-pcmap]');
    if (pick) { mp.pick = pick.dataset.pcmap; drawPanel(); root.querySelector(`[data-pcmap="${mp.pick}"][aria-pressed="true"]`)?.focus({ preventScroll: true }); return; }
    if (e.target.closest('.pp-maps') && mp.status === 'ready' && shotMapClick(e.target, mp.shot)) {
      const top = scroller(root)?.scrollTop; drawPanel(); if (top != null) scroller(root).scrollTop = top;
      root.querySelector('.sm-dot.is-sel')?.focus({ preventScroll: true });
    }
  });
  const box = root.querySelector('#pc-panel');
  if (box && 'IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); loadMaps(); } }); io.observe(box); } else if (box) loadMaps();
  wireTips(root);
  sheen(root);
  return { ok: true, name: p.name };
}
const scroller = el => el.closest('.po-body') || el;

// One tooltip for every chart mark with a data-tip: follows the mouse, shows on keyboard focus, and a tap on a phone shows it until the next tap.
let tipWired = false;
function wireTips(root) {
  // Inside the dialog when there is one: only things inside it are above the page (the top layer).
  const hostEl = root.closest('dialog') || document.body;
  let tip = hostEl.querySelector(':scope > .pc-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'pc-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; hostEl.append(tip); }
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
  root.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  if (!tipWired) { tipWired = true; addEventListener('keydown', e => { if (e.key === 'Escape') tip.hidden = true; }); }
}

// ---- the popup ----
const STYLES = ['css/league-page.css', 'css/stat-card.css', 'css/match-shotmap.css', 'css/player.css', 'css/player-maps.css', 'css/player-overlay.css'];
const ensureStyles = () => {
  for (const href of STYLES) {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith(href))) continue;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l);
  }
};
let dlg = null, opener = null, open = false, token = 0, openHref = '';
function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'po';
  dlg.setAttribute('aria-labelledby', 'po-title');
  dlg.innerHTML = `<button type="button" class="po-x" aria-label="Close">${icon('x')}</button><div class="po-body" tabindex="-1"></div>`;
  dlg.querySelector('.po-x').addEventListener('click', () => closePlayer());
  dlg.addEventListener('cancel', e => { e.preventDefault(); closePlayer(); });   // Esc
  dlg.addEventListener('click', e => { if (e.target === dlg) closePlayer(); });   // a tap on the dimmed page outside the card
  document.body.append(dlg);
  return dlg;
}
function shut() {
  if (!open) return;
  open = false; token++;
  dlg.close();
  document.documentElement.classList.remove('po-open');
  dlg.querySelector('.po-body').replaceChildren();
  dlg.querySelector(':scope > .pc-tip')?.setAttribute('hidden', '');
  opener?.isConnected && opener.focus?.({ preventScroll: true });
}
export function closePlayer() {
  if (!open) return;
  if (history.state?.po) history.back();   // our own history entry: popstate then shuts it
  else shut();
}
// Back (to the page's own entry) closes the popup; a change of the page's address by the page itself (the league page setting its tab) does not.
addEventListener('popstate', () => { if (open && location.href === openHref) shut(); });

export async function openPlayer(id) {
  ensureStyles();
  const d = dialog(), body = d.querySelector('.po-body'), mine = ++token;
  opener = document.activeElement;
  body.replaceChildren();
  const fresh = body.cloneNode(false); body.replaceWith(fresh);   // a new element each time, so the last card's listeners go with it
  fresh.innerHTML = '<p class="pp-loading" role="status">Loading player…</p>';
  if (!open) {
    open = true;
    openHref = location.href;
    history.pushState({ ...(history.state || {}), po: String(id) }, '');
    document.documentElement.classList.add('po-open');
    d.showModal();
  }
  try {
    const data = await getData();
    if (mine !== token || !open) return;
    renderPlayerInto(fresh, data, id);
    fresh.scrollTop = 0; fresh.focus({ preventScroll: true });
  } catch (e) {
    if (mine === token) fresh.innerHTML = `<p class="pp-loading">This player didn’t load. ${esc(e.message || '')}</p>`;
  }
}

export function openFromUrl() {
  const id = new URLSearchParams(location.search).get('player');
  if (id) openPlayer(id);
}
