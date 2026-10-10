// A manager's Home (0.5): your club, right now. The match card (countdown, when the line-up locks, live score), a
// notice while club changes are with the office, your season in numbers and your next matches. Everything
// league-wide is on League; news is in Inbox (its unread count is on the Inbox tab).
// League data comes from Supabase (dashboard-data.js loadSeason, since 0.12); only a local ?src= test copy reads a season.json file.
import { enterPlace, badge } from './shell.js';
import { paint, quietly } from './paint.js';
import { renderPitch } from './pitch.js';
import { spoilerHidden, revealScore, fmtTime, fmtDay } from './prefs.js';
import { clubs, esc, crestUrl } from './member.js';
import { db } from './auth.js';
import { whatsNew } from './whats-new.js';
import {
  kickoff, status, shownScore, liveMinute, ladder, finished, byKickoff, matchUrl, logoUrl, sameDay,
} from './dashboard-data.js';

const ctx = await enterPlace('home');
let all = [];          // every club row, for crests and names
let request = null;    // this club's latest setup/change request
let sbNews = [];       // Supabase news rows (for the unread count)
let deadlines = [];    // line-up deadline per week (0.6)
let revealed = [];     // locked team sheets (week_sheets) for the week on the match card
let sheet = null;      // this club's current team sheet
let unread = 0;
let news = '';          // the latest update's summary (whats-new.js)

// ---------------------------------------------------------------- small helpers
const teamOf = code => all.find(c => c.code === code) || ctx.season?.teams.find(t => t.code === code) || { code, name: code };
const nameOf = code => { const t = teamOf(code); return t.short_name || t.name || code; };
const crestOf = code => { const c = all.find(x => x.code === code); return c?.crest_path ? crestUrl(c.crest_path) : logoUrl(code); };
const crest = (code, cls = '') => `<img class="${cls}" src="${esc(crestOf(code))}" alt="" onerror="this.style.visibility='hidden'">`;

function until(ms) {
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 2) return `${d} days`;
  if (h >= 1) return `${d ? `${d}d ` : ''}${h % 24}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m} min`;
}
const day = (d, now) => sameDay(d, now) ? 'Today' : sameDay(d, new Date(+now + 864e5)) ? 'Tomorrow' : fmtDay(d);
const time = d => fmtTime(d);

const mine = (s, code) => s.fixtures.filter(f => !f.test && (f.home === code || f.away === code)).sort(byKickoff);

// The match the card shows: ours live now, else our next, else null.
function current(s, code, now) {
  const list = mine(s, code);
  return list.find(f => status(f, s, now) === 'live') || list.find(f => ['upcoming', 'awaiting'].includes(status(f, s, now))) || null;
}

// ---------------------------------------------------------------- spoiler-free results (Settings, 0.7)
// Hidden matches: scores shown as "Show score". Everything worked out from results (place, points, form, last match)
// uses the season as this account has seen it, without the hidden results.
const hiddenIds = (s, now) => s.fixtures.filter(f => f.result && spoilerHidden(f, s, now)).map(f => f.id);
function seenSeason(s, now) {
  const hide = new Set(hiddenIds(s, now));
  return hide.size ? { ...s, fixtures: s.fixtures.map(f => (hide.has(f.id) ? { ...f, result: null } : f)) } : s;
}

// ---------------------------------------------------------------- the match card
function matchCard(s, code, now) {
  const fx = current(s, code, now);
  if (!fx) {
    const anyLeft = s.fixtures.some(f => ['upcoming', 'tba'].includes(status(f, s, now)));
    return `<section class="hm-card hm-match empty"><p class="hm-label">Next match</p>
      <p class="hm-none">${s.fixtures.length && !anyLeft ? 'Season finished' : 'No fixtures yet'}</p></section>`;
  }
  const st = status(fx, s, now), ko = kickoff(fx), sc = shownScore(fx, s, now);
  const home = fx.home === code;
  const side = c => `<div class="hm-side${c === code ? ' us' : ''}">${crest(c, 'hm-crest')}<b>${esc(nameOf(c))}</b></div>`;
  let mid, foot = '';
  if (st === 'live') {
    mid = `<span class="hm-live">LIVE ${liveMinute(fx, s, now) ?? ''}′</span>${spoilerHidden(fx, s, now)
      ? `<button class="hm-show" type="button" data-reveal="${esc(fx.id)}">Show score</button>`
      : `<strong class="hm-score">${sc.home}<i>–</i>${sc.away}</strong>`}`;
    foot = `<a class="btn" href="${esc(matchUrl(fx))}" data-opens="${esc(fx.id)}">Watch live</a>`;
  } else {
    mid = `<span class="hm-when">${day(ko, now)}</span><strong class="hm-ko">${time(ko)}</strong>`;
    const d = deadlines.find(x => x.week === fx.week), lock = d && new Date(d.locks_at);
    const kick = `Kick-off in <b data-until="${+ko}">${until(ko - now)}</b>`;
    if (st === 'awaiting') foot = '<p class="hm-lock">Kicking off</p>';
    else if (lock && now >= lock) foot = `<p class="hm-lock">${kick} · team sheets locked</p>`;
    else {
      const saved = sheet && Object.keys(sheet.lineup || {}).length;
      foot = `<p class="hm-lock">${kick}${lock ? ` · line-up locks in <b data-until="${+lock}">${until(lock - now)}</b>` : ''}</p>
        <a class="btn${saved ? ' ghost' : ''}" href="club.html">${saved ? 'Change your XI' : 'Pick your XI'}</a>
        <a class="btn ghost" href="${esc(matchUrl(fx))}">Match preview</a>`;
    }
  }
  return `<section class="hm-card hm-match">
      <p class="hm-label">${st === 'live' ? 'Now' : 'Next match'} · ${esc(fx.round || `Week ${fx.week}`)} · ${home ? 'Home' : 'Away'}</p>
      <div class="hm-teams">${side(fx.home)}<div class="hm-mid">${mid}</div>${side(fx.away)}</div>
      ${foot ? `<div class="hm-foot">${foot}</div>` : ''}
    </section>`;
}

// ---------------------------------------------------------------- team sheets, revealed at the week's deadline
// A club's locked sheet, if it picked an XI (an empty one means the engine picks).
const sheetOf = c => revealed.find(r => r.club === c && Object.keys(r.lineup || {}).length) || null;

function reveal(s, code, now) {
  const fx = current(s, code, now);
  const d = fx && deadlines.find(x => x.week === fx.week);
  if (!d?.locked_at) return '';
  const side = c => {
    const row = sheetOf(c);
    return `<figure class="hm-xi${c === code ? ' us' : ''}" data-club="${esc(c)}"><figcaption>${crest(c, 'hm-mini')}<b>${esc(nameOf(c))}</b></figcaption>
      ${row ? '<div class="hm-pitch"></div>' : '<p class="hm-sub">No team sheet. The engine picks the team.</p>'}</figure>`;
  };
  return `<section class="hm-card hm-reveal"><h2>Team sheets <span>${esc(fx.round || `Week ${fx.week}`)}</span></h2>
      <div class="hm-xis">${side(fx.home)}${side(fx.away)}</div></section>`;
}

function drawPitches(s) {
  document.querySelectorAll('.hm-xi').forEach(fig => {
    const row = sheetOf(fig.dataset.club), el = fig.querySelector('.hm-pitch');
    if (!row || !el) return;
    // Exactly as locked: an empty slot stays empty (the engine fills it on the day).
    try { renderPitch(el, { formation: row.formation, lineup: row.lineup || {}, captain: row.captain, players: s.players }); } catch { el.remove(); }
  });
}

// ---------------------------------------------------------------- club changes with the league office
function notice() {
  if (request?.status === 'returned') return `<div class="hm-notice back"><span><b>Club changes sent back.</b>
      ${request.office_note ? esc(request.office_note) : ''}</span><a href="setup.html?edit">Fix and resend</a></div>`;
  if (request?.status === 'pending') return '<div class="hm-notice"><span><b>Club changes sent.</b> Waiting for the league office.</span></div>';
  return '';
}

// ---------------------------------------------------------------- your season (League has the full table)
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const outcome = (fx, code) => {
  const us = fx.home === code ? fx.result.home : fx.result.away, them = fx.home === code ? fx.result.away : fx.result.home;
  return us > them ? 'W' : us < them ? 'L' : 'D';
};

function season(all, code, now) {
  const s = seenSeason(all, now), hidden = hiddenIds(all, now).length;
  const rows = ladder(s, now), r = rows.find(x => x.team.code === code);
  if (!r) return '';
  const mineDone = finished(s, now).filter(f => !f.test && (f.home === code || f.away === code));   // test matches aren't part of the season
  const form = mineDone.filter(f => !f.stage).slice(-5).map(f => outcome(f, code));
  const last = mineDone[mineDone.length - 1];
  let lastHtml = '';
  if (last) {
    const opp = last.home === code ? last.away : last.home, o = outcome(last, code);
    const score = last.home === code ? `${last.result.home}–${last.result.away}` : `${last.result.away}–${last.result.home}`;
    lastHtml = `<a class="hm-lastline" href="${esc(matchUrl(last))}" data-opens="${esc(last.id)}">
        <span class="hm-k">Last match</span><span class="hm-out ${o}">${o}</span><strong>${score}</strong>
        <span class="hm-vs">${last.home === code ? 'v' : 'at'}</span>${crest(opp, 'hm-mini')}<b>${esc(nameOf(opp))}</b></a>`;
  }
  return `<section class="hm-card hm-season-card"><h2>Your season <a href="league.html">Table</a></h2>
      <div class="hm-season">
        <div class="hm-stat big"><strong>${r.p ? ordinal(r.rank) : '–'}</strong><span>of ${rows.length}</span></div>
        <div class="hm-stat"><strong>${r.pts}</strong><span>pts</span></div>
        <div class="hm-stat"><strong>${r.w}-${r.d}-${r.l}</strong><span>W-D-L</span></div>
        <div class="hm-stat"><strong>${r.gd > 0 ? '+' : ''}${r.gd}</strong><span>GD</span></div>
      </div>
      ${form.length ? `<p class="hm-form"><span class="hm-k">Form</span>${form.map(o => `<abbr class="hm-out ${o}" title="${{ W: 'Win', D: 'Draw', L: 'Loss' }[o]}">${o}</abbr>`).join('')}</p>` : ''}
      ${lastHtml}
      ${hidden ? `<p class="hm-hidden">${hidden} result${hidden === 1 ? '' : 's'} hidden <button type="button" data-reveal-all>Show all</button></p>` : ''}
    </section>`;
}

function comingUp(s, code, now) {
  const hero = current(s, code, now);
  const next = mine(s, code).filter(f => f !== hero && ['upcoming', 'tba'].includes(status(f, s, now))).slice(0, 4);
  if (!next.length) return '';
  return `<section class="hm-card hm-fix-card"><h2>Coming up <a href="league.html">All matches</a></h2>
      <ol class="hm-fix">${next.map(f => {
        const ko = kickoff(f), opp = f.home === code ? f.away : f.home;
        return `<li><a class="hm-fixlink" href="${esc(matchUrl(f))}" aria-label="Preview ${esc(nameOf(f.home))} against ${esc(nameOf(f.away))}"><span class="hm-wk">${ko ? esc(day(ko, now)) : 'TBA'}</span>${crest(opp, 'hm-mini')}<b>${esc(nameOf(opp))}</b>
          <small>${f.home === code ? 'H' : 'A'}</small><span class="hm-time">${ko ? time(ko) : ''}</span></a></li>`;
      }).join('')}</ol>
    </section>`;
}

// ---------------------------------------------------------------- page
function render() {
  const { club, season: s, main } = ctx, now = new Date(), code = club.code;
  const top = `<header class="hm-club">${crest(code, 'hm-club-crest')}
      <div><h1>${esc(club.name)}</h1>${club.motto ? `<p>${esc(club.motto)}</p>` : ''}</div></header>`;
  if (!s) {
    paint(main, `${top}${notice()}<p class="quiet">The league data didn’t load. <a href="home.html">Try again</a></p>`);
    return;
  }
  const painted = paint(main, `${top}${news}${notice()}${matchCard(s, code, now)}${reveal(s, code, now)}
    <div class="hm-grid">${season(s, code, now)}${comingUp(s, code, now)}</div>`);
  if (painted) drawPitches(s);
}

// The locked sheets for the week on the match card (public once the week is locked).
async function loadReveal() {
  const fx = ctx.season && current(ctx.season, ctx.club.code, new Date());
  const d = fx && deadlines.find(x => x.week === fx.week);
  if (!d?.locked_at) { revealed = []; return; }
  if (revealed.length && revealed[0].week === fx.week) return;
  const { data } = await (await db()).from('week_sheets').select('*').eq('week', fx.week).in('club', [fx.home, fx.away]);
  revealed = data || [];
}

// A deadline that has passed but isn't marked locked yet is re-read (the lock job runs every minute).
async function refreshDeadlines() {
  const now = new Date();
  if (!deadlines.some(d => !d.locked_at && new Date(d.locks_at) <= now)) return;
  const { data } = await (await db()).from('deadlines').select('*').order('week');
  if (data) deadlines = data;
  await loadReveal();
}

function onClick(e) {
  const one = e.target.closest('[data-reveal]'), all = e.target.closest('[data-reveal-all]'), open = e.target.closest('[data-opens]');
  if (one) revealScore(one.dataset.reveal).then(render);
  else if (all) revealScore(hiddenIds(ctx.season, new Date())).then(render);
  else if (open && spoilerHidden(ctx.season.fixtures.find(f => f.id === open.dataset.opens), ctx.season)) {
    // Opening a match counts as seeing it: save that before leaving the page.
    e.preventDefault();
    revealScore(open.dataset.opens).then(() => { location.href = open.href; });
  }
}

// Countdowns tick every 20 s; the whole page redraws each minute so live scores and states move on.
function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = until(Number(el.dataset.until) - now); });
}

if (ctx) {
  const { club, main } = ctx;
  if (!club) {
    main.innerHTML = `<div class="club-card"><img class="club-crest" src="assets/brand/crest.svg" alt="">
      <h1>Welcome</h1><p class="quiet">${esc(ctx.me.user.email)}</p>
      <p class="soon">Your account isn’t linked to a club yet.</p></div>`;
  } else {
    document.title = `${club.name} | vLeague`;
    const c = await db();
    const [clubRows, reqRes, newsRes, dlRes, sheetRes] = await Promise.all([
      clubs().catch(() => []),
      c.from('club_requests').select('status, office_note, created_at').eq('club', club.code).order('created_at', { ascending: false }).limit(1),
      c.from('news').select('*').order('created_at', { ascending: false }).limit(20),
      c.from('deadlines').select('*').order('week'),
      c.from('team_sheets').select('lineup, updated_at').eq('club', club.code).maybeSingle(),
    ].map(p => Promise.resolve(p).catch(() => ({}))));
    all = Array.isArray(clubRows) ? clubRows : [];
    request = reqRes?.data?.[0] || null;
    sbNews = newsRes?.data || [];
    deadlines = dlRes?.data || [];
    sheet = sheetRes?.data || null;
    await loadReveal();
    try {
      const { unreadCount } = await import('./inbox-data.js');
      unread = ctx.season ? unreadCount(ctx.season, sbNews, club.code) : 0;
    } catch { unread = 0; }
    badge('inbox', unread);
    news = await whatsNew(esc);
    render();
    ctx.main.addEventListener('click', onClick);
    setInterval(tick, 20000);
    // Each minute: redraw, and fetch the locked sheets once the week's deadline passes.
    setInterval(async () => { await refreshDeadlines(); quietly(render); }, 60000);
  }
  main.setAttribute('aria-busy', 'false');
}
