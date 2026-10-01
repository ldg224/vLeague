// A manager's Home (0.5): everything for the next match on one screen. The match card (countdown, when the line-up
// locks, live score), what needs doing, the last result, the club's place in the table and a league activity feed.
// League data still comes from the s3 site's season.json (dashboard-data.js) until fixtures move to Supabase (0.8).
import { enterPlace, badge } from './shell.js';
import { clubs, esc, crestUrl } from './member.js';
import { db } from './auth.js';
import {
  kickoff, status, shownScore, liveMinute, lineupsOutAt, ladder, finished, byKickoff, matchUrl, logoUrl,
  audienceOf, parseStamp, sameDay,
} from './dashboard-data.js';

const ctx = await enterPlace('home');
let all = [];          // every club row, for crests and names
let sheet = null;      // this club's team sheet, if it has one
let request = null;    // this club's latest setup/change request
let sbNews = [];       // Supabase news rows
let unread = 0;

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
const ago = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const day = (d, now) => sameDay(d, now) ? 'Today' : sameDay(d, new Date(+now + 864e5)) ? 'Tomorrow'
  : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const time = d => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const mine = (s, code) => s.fixtures.filter(f => f.home === code || f.away === code).sort(byKickoff);
const lineupSet = () => Boolean(sheet && Object.keys(sheet.lineup || {}).length);

// The match the card shows: ours live now, else our next, else null.
function current(s, code, now) {
  const list = mine(s, code);
  return list.find(f => status(f, s, now) === 'live') || list.find(f => ['upcoming', 'awaiting'].includes(status(f, s, now))) || null;
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
    mid = `<span class="hm-live">LIVE ${liveMinute(fx, s, now) ?? ''}′</span><strong class="hm-score">${sc.home}<i>–</i>${sc.away}</strong>`;
    foot = `<a class="btn" href="${esc(matchUrl(fx))}" target="_blank" rel="noopener">Watch live</a>`;
  } else {
    mid = `<span class="hm-when">${day(ko, now)}</span><strong class="hm-ko">${time(ko)}</strong>`;
    const lock = lineupsOutAt(fx);
    if (st === 'awaiting') foot = '<p class="hm-lock">Kicking off</p>';
    else if (now < lock) {
      foot = `<p class="hm-lock">Kick-off in <b data-until="${+ko}">${until(ko - now)}</b> · line-up locks in <b data-until="${+lock}">${until(lock - now)}</b></p>
        <a class="btn${lineupSet() ? ' ghost' : ''}" href="club.html">${lineupSet() ? 'Change your XI' : 'Pick your XI'}</a>`;
    } else foot = `<p class="hm-lock">Line-ups are out · kick-off in <b data-until="${+ko}">${until(ko - now)}</b></p>
        <a class="btn ghost" href="${esc(matchUrl(fx))}" target="_blank" rel="noopener">Match centre</a>`;
  }
  return `<section class="hm-card hm-match">
      <p class="hm-label">${st === 'live' ? 'Now' : 'Next match'} · Week ${esc(fx.week)} · ${home ? 'Home' : 'Away'}</p>
      <div class="hm-teams">${side(fx.home)}<div class="hm-mid">${mid}</div>${side(fx.away)}</div>
      ${foot ? `<div class="hm-foot">${foot}</div>` : ''}
    </section>`;
}

// ---------------------------------------------------------------- what needs doing
function todo(s, code, now) {
  const items = [];
  if (request?.status === 'returned') items.push(['urgent', `The league office sent your club changes back${request.office_note ? `: “${esc(request.office_note)}”` : ''}`, 'setup.html?edit', 'Fix']);
  else if (request?.status === 'pending') items.push(['wait', 'Club changes waiting for the league office', '', '']);
  const fx = s && current(s, code, now);
  if (fx && status(fx, s, now) === 'upcoming' && now < lineupsOutAt(fx)) {
    const soon = lineupsOutAt(fx) - now < 864e5;
    if (!lineupSet()) items.push([soon ? 'urgent' : '', `Pick your XI for ${esc(nameOf(fx.home === code ? fx.away : fx.home))}`, 'club.html', 'Pick']);
  }
  if (unread) items.push(['', `${unread} unread in your inbox`, 'inbox.html', 'Read']);
  const body = items.length
    ? `<ul class="hm-todo">${items.map(([k, t, href, act]) => `<li class="${k}"><span>${t}</span>${href ? `<a href="${href}">${act}</a>` : ''}</li>`).join('')}</ul>`
    : '<p class="hm-clear">All done</p>';
  return `<section class="hm-card hm-todo-card"><h2>To do</h2>${body}</section>`;
}

// ---------------------------------------------------------------- last result
function lastResult(s, code, now) {
  const fx = finished(s, now).filter(f => f.home === code || f.away === code).pop();
  if (!fx) return '';
  const us = fx.home === code ? fx.result.home : fx.result.away, them = fx.home === code ? fx.result.away : fx.result.home;
  const o = us > them ? 'W' : us < them ? 'L' : 'D';
  const motm = fx.result.motm && fx.result.players?.[fx.result.motm];
  return `<section class="hm-card hm-last"><h2>Last result</h2>
      <a class="hm-result" href="${esc(matchUrl(fx))}" target="_blank" rel="noopener">
        <span class="hm-out ${o}">${o}</span>
        ${crest(fx.home, 'hm-mini')}<b>${esc(nameOf(fx.home))}</b>
        <strong>${fx.result.home}–${fx.result.away}</strong>
        <b>${esc(nameOf(fx.away))}</b>${crest(fx.away, 'hm-mini')}
      </a>
      ${motm ? `<p class="hm-sub">Player of the match: ${esc(motm.name)}</p>` : ''}
    </section>`;
}

// ---------------------------------------------------------------- table
function table(s, code, now) {
  const rows = ladder(s, now);
  const at = rows.findIndex(r => r.team.code === code);
  if (at < 0) return '';
  const from = Math.max(0, Math.min(at - 2, rows.length - 5));
  const played = rows[at].p > 0;
  return `<section class="hm-card hm-table-card"><h2>Table <a href="league.html">Full table</a></h2>
      <ol class="hm-table"><li class="head" aria-hidden="true"><span></span><span></span><span></span><span class="p">P</span><span class="gd">GD</span><span class="pts">Pts</span></li>${rows.slice(from, from + 5).map(r => `<li class="${r.team.code === code ? 'us' : ''}">
        <span class="pos">${r.rank}</span>${crest(r.team.code, 'hm-mini')}<b>${esc(nameOf(r.team.code))}</b>
        <span class="p">${r.p}</span><span class="gd">${r.gd > 0 ? '+' : ''}${r.gd}</span><strong>${r.pts}</strong></li>`).join('')}</ol>
      ${played ? '' : '<p class="hm-sub">No games played yet</p>'}
    </section>`;
}

// ---------------------------------------------------------------- league activity
function feed(s, code, now) {
  const items = [];
  if (s) {
    for (const f of s.fixtures) {
      const st = status(f, s, now);
      if (st === 'live') {
        const sc = shownScore(f, s, now);
        items.push({ at: +now, html: `<span class="hm-live sm">LIVE</span> ${esc(nameOf(f.home))} ${sc.home}–${sc.away} ${esc(nameOf(f.away))}`, href: matchUrl(f) });
      } else if (st === 'ft') {
        items.push({ at: +kickoff(f), html: `${esc(nameOf(f.home))} <b>${f.result.home}–${f.result.away}</b> ${esc(nameOf(f.away))}`, href: matchUrl(f) });
      }
    }
    for (const p of s.news || []) {
      const aud = audienceOf(p);
      if (!['live', 'closed'].includes(p.status) || !(aud === 'all' || aud === 'teams' || (Array.isArray(aud) && aud.includes(code)))) continue;
      const title = p.blocks?.find(b => b.title)?.title;
      if (title) items.push({ at: parseStamp(p.sent)?.getTime() || 0, html: `News: ${esc(title)}`, href: 'inbox.html' });
    }
  }
  for (const n of sbNews) items.push({ at: Date.parse(n.created_at), html: esc(n.title), href: n.kind === 'post' ? 'inbox.html' : '', crest: n.club });
  const list = items.filter(i => i.at <= +now).sort((a, b) => b.at - a.at).slice(0, 6);
  if (!list.length) return '';
  return `<section class="hm-card hm-feed-card"><h2>Around the league</h2><ul class="hm-feed">${list.map(i => {
    const inner = `${i.crest ? crest(i.crest, 'hm-mini') : ''}<span>${i.html}</span><time>${ago(now - i.at)}</time>`;
    return `<li>${i.href ? `<a href="${esc(i.href)}"${/^https?:/.test(i.href) ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>` : `<div>${inner}</div>`}</li>`;
  }).join('')}</ul></section>`;
}

// ---------------------------------------------------------------- page
function render() {
  const { club, season: s, main } = ctx, now = new Date(), code = club.code;
  const top = `<header class="hm-club">${crest(code, 'hm-club-crest')}
      <div><h1>${esc(club.name)}</h1>${club.motto ? `<p>${esc(club.motto)}</p>` : ''}</div></header>`;
  if (!s) {
    main.innerHTML = `${top}${todo(null, code, now)}<p class="quiet">The league data didn’t load. <a href="home.html">Try again</a></p>`;
    return;
  }
  main.innerHTML = `${top}<div class="hm-grid">
      <div class="hm-col">${matchCard(s, code, now)}${lastResult(s, code, now)}</div>
      <div class="hm-col">${todo(s, code, now)}${table(s, code, now)}${feed(s, code, now)}</div>
    </div>`;
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
    const [clubRows, sheetRes, reqRes, newsRes] = await Promise.all([
      clubs().catch(() => []),
      c.from('team_sheets').select('lineup, updated_at').eq('club', club.code).maybeSingle(),
      c.from('club_requests').select('status, office_note, created_at').eq('club', club.code).order('created_at', { ascending: false }).limit(1),
      c.from('news').select('*').order('created_at', { ascending: false }).limit(20),
    ].map(p => Promise.resolve(p).catch(() => ({}))));
    all = Array.isArray(clubRows) ? clubRows : [];
    sheet = sheetRes?.data || null;
    request = reqRes?.data?.[0] || null;
    sbNews = newsRes?.data || [];
    try {
      const { unreadCount } = await import('./inbox-data.js');
      unread = ctx.season ? unreadCount(ctx.season, sbNews, club.code) : 0;
    } catch { unread = 0; }
    badge('inbox', unread);
    render();
    setInterval(tick, 20000);
    setInterval(render, 60000);
  }
  main.setAttribute('aria-busy', 'false');
}
