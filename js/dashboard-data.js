// League data for the guest dashboard.
// Until the league moves to Supabase (docs/PLAN.md, step 2) this reads the s3 site's public files:
// data/season.json and assets/teams/<code>.png. Line-ups come from Supabase (week_sheets, 0.6).
// The rules below (kick-off, status, ladder, player totals) are ports of hcl-s3/js/data.js; keep them in step.

import { db, ready } from './auth.js';
import { loadPlayers } from './players-data.js';

const LIVE_SITE = 'https://ldg224.github.io/s3/';

// Local testing only: ?src=<base url> reads another copy of the data (e.g. a demo season).
function sourceBase() {
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const src = local && new URLSearchParams(location.search).get('src');
  return src ? new URL(src, location.href).href.replace(/\/?$/, '/') : LIVE_SITE;
}
export const SOURCE = sourceBase();
export const logoUrl = code => `${SOURCE}assets/teams/${String(code).toLowerCase()}.png`;
export const matchUrl = fx => `${LIVE_SITE}match.html?id=${encodeURIComponent(fx.id)}`;

export async function loadSeason() {
  const res = await fetch(`${SOURCE}data/season.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The league data didn't load (error ${res.status}).`);
  const season = await res.json();
  await addNewClubs(season);
  await addPlayers(season);
  return season;
}

// The clubs in Supabase (the Editor's Clubs tab) are the league's clubs; season.json only supplies fixtures and results
// until the league moves over (0.11). Teams there that aren't clubs here (old placeholders) or are withdrawn are marked
// withdrawn, so the table and club lists leave them out, and clubs only here are added with no matches yet.
async function addNewClubs(season) {
  if (!ready || SOURCE !== LIVE_SITE) return;
  try {
    const { data, error } = await (await db()).from('clubs').select('code, name, colour, status');
    if (error || !data?.length) return;
    season.teams ||= [];
    const clubs = new Map(data.map(c => [c.code, c]));
    for (const t of season.teams) {
      const c = clubs.get(t.code);
      if (!c || c.status === 'withdrawn') t.withdrawn = true;
    }
    const known = new Set(season.teams.map(t => t.code));
    for (const c of data) {
      if (!known.has(c.code)) season.teams.push({ code: c.code, name: c.name, colour: c.colour || '#475569', manager: '', ...(c.status === 'withdrawn' ? { withdrawn: true } : {}) });
    }
  } catch { /* the table still shows the clubs it already had */ }
}

// The players are vLeague's own (Supabase, 0.11), not the s3 test site's. Only a local ?src= test copy keeps its own.
async function addPlayers(season) {
  if (!ready || SOURCE !== LIVE_SITE) return;
  try { season.players = await loadPlayers(); } catch { season.players = []; }
}

// ---------- Time and status ----------

export function kickoff(fx) {
  if (!fx.date) return null;
  const [y, m, d] = fx.date.split('-').map(Number);
  const [hh, mm] = (fx.time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

const liveMs = s => (s.live_minutes || 10) * 60000;

// upcoming | live | ft | awaiting (kicked off, no result yet) | tba | postponed
export function status(fx, s, now = new Date()) {
  if (fx.postponed) return 'postponed';
  const k = kickoff(fx);
  if (!k) return 'tba';
  if (now < k) return 'upcoming';
  if (!fx.result) return 'awaiting';
  if (now - k < liveMs(s)) return 'live';
  return 'ft';
}

function liveSimTime(fx, s, now) {
  const frac = Math.min(1, Math.max(0, (now - kickoff(fx)) / liveMs(s)));
  const periods = fx.result.periods || [];
  const t0 = periods.length ? periods[0].start_t : 0;
  return t0 + frac * (fx.result.duration_t - t0);
}

// The score as a viewer should see it right now (goals appear as the live broadcast reaches them).
export function shownScore(fx, s, now = new Date()) {
  const st = status(fx, s, now);
  if (st === 'ft') return { home: fx.result.home, away: fx.result.away };
  if (st !== 'live') return null;
  const t = liveSimTime(fx, s, now);
  const sc = { home: 0, away: 0 };
  for (const g of fx.result.goals || []) if (g.t <= t) sc[g.team === fx.home ? 'home' : 'away']++;
  return sc;
}

// Goals the viewer has seen so far, for the scorer lines.
export function shownGoals(fx, s, now = new Date()) {
  const st = status(fx, s, now);
  if (st !== 'live' && st !== 'ft') return [];
  const t = st === 'live' ? liveSimTime(fx, s, now) : Infinity;
  return (fx.result.goals || []).filter(g => g.t <= t);
}

// Match minute while live, e.g. 67.
export function liveMinute(fx, s, now = new Date()) {
  const t = liveSimTime(fx, s, now), periods = fx.result.periods || [];
  const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
  if (!p) return null;
  return Math.floor(Math.max(0, t - p.start_t) / 60) + (p.period === 2 ? 45 : 0) + 1;
}

export const byKickoff = (a, b) => (kickoff(a) ?? Infinity) - (kickoff(b) ?? Infinity);
export const finished = (s, now = new Date()) => s.fixtures.filter(f => status(f, s, now) === 'ft').sort(byKickoff);

export const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

// The week to open on: a week with a match today, else the next to play, else the latest.
export function activeWeek(s, now = new Date()) {
  const dated = s.fixtures.filter(f => kickoff(f)).sort(byKickoff);
  const today = dated.find(f => sameDay(kickoff(f), now));
  if (today) return today.week;
  const next = dated.find(f => ['upcoming', 'live', 'awaiting'].includes(status(f, s, now)));
  if (next) return next.week;
  return dated.length ? dated[dated.length - 1].week : (s.fixtures[0]?.week ?? 1);
}

// The match the dashboard leads with: live now, else the next to kick off, else the latest result.
export function featured(s, now = new Date()) {
  const list = [...s.fixtures].sort(byKickoff);
  const live = list.filter(f => status(f, s, now) === 'live');
  if (live.length) return { fx: live[0], why: 'live', others: live.length - 1 };
  const next = list.find(f => ['upcoming', 'awaiting'].includes(status(f, s, now)));
  if (next) return { fx: next, why: status(next, s, now) };
  const done = finished(s, now);
  return done.length ? { fx: done[done.length - 1], why: 'ft' } : null;
}

// ---------- Table ----------

export function ladder(s, now = new Date()) {
  const pts = s.points || { win: 3, draw: 1, loss: 0 };
  const rows = Object.fromEntries(s.teams.filter(t => !t.withdrawn).map(t => [t.code, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]));
  for (const a of s.adjustments || []) if (rows[a.team]) rows[a.team].pts += a.points;
  for (const f of finished(s, now)) {
    if (f.stage) continue;
    const h = rows[f.home], a = rows[f.away];
    if (!h || !a) continue;
    for (const [r, gf, ga] of [[h, f.result.home, f.result.away], [a, f.result.away, f.result.home]]) {
      r.p++; r.gf += gf; r.ga += ga;
      const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      r[o.toLowerCase()]++;
      r.pts += o === 'W' ? pts.win : o === 'D' ? pts.draw : pts.loss;
      r.form.push(o);
    }
  }
  const list = Object.values(rows).map(r => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }));
  list.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.name.localeCompare(b.team.name));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// ---------- Players ----------

export function leaders(s, now = new Date()) {
  const tot = {};
  for (const f of finished(s, now)) {
    for (const [id, p] of Object.entries(f.result.players || {})) {
      const t = tot[id] ??= { id, name: p.name, team: p.team, apps: 0, g: 0, a: 0, rsum: 0 };
      t.apps++; t.g += p.g || 0; t.a += p.a || 0; t.rsum += p.r || 0;
    }
  }
  const all = Object.values(tot).map(t => ({ ...t, avg: t.apps ? t.rsum / t.apps : 0 }));
  return {
    goals: all.filter(p => p.g > 0).sort((a, b) => b.g - a.g || b.a - a.a || a.apps - b.apps).slice(0, 5),
    assists: all.filter(p => p.a > 0).sort((a, b) => b.a - a.a || b.g - a.g || a.apps - b.apps).slice(0, 5),
    rating: all.filter(p => p.apps >= 2).sort((a, b) => b.avg - a.avg).slice(0, 5),
  };
}

// ---------- News ----------

// Who a post is for: an array of team codes, 'teams', 'guests' or 'all' (docs/PLAN.md, "News audiences").
// Posts from the s3 editor carry visibility + audience instead: public -> everyone, managers -> teams.
export function audienceOf(post) {
  const a = post.audience;
  if (a === 'guests' || a === 'teams') return a;
  if (post.visibility === 'managers') return Array.isArray(a) ? a : 'teams';
  if (post.visibility === 'public') return 'all';
  return Array.isArray(a) ? a : a === 'all' ? 'all' : 'teams';
}

export const parseStamp = s => (s ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);

// Posts a guest may read, pinned first, then newest.
export function guestNews(s) {
  const at = p => parseStamp(p.sent)?.getTime() || 0;
  return (s.news || [])
    .filter(p => (p.status === 'live' || p.status === 'closed') && ['all', 'guests'].includes(audienceOf(p)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || at(b) - at(a));
}
