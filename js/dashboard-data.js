// League data for the guest dashboard.
// Since 0.12 the league's clubs, players, fixtures and results all come from Supabase (loadSeason builds the same shape
// the pages always used). The s3 site is only read by a local ?src= test copy. Line-ups: week_sheets (0.6).
// The rules below (kick-off, status, ladder, player totals) are ports of hcl-s3/js/data.js; keep them in step.

import { db, ready } from './auth.js';
import { loadPlayers } from './players-data.js';
import { SUPABASE_URL } from './config.js';
import { roundLabels, weekNumbers } from './roster.js';

const LIVE_SITE = 'https://ldg224.github.io/s3/';

// Local testing only: ?src=<base url> reads another copy of the data (e.g. a demo season).
function sourceBase() {
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const src = local && new URLSearchParams(location.search).get('src');
  return src ? new URL(src, location.href).href.replace(/\/?$/, '/') : LIVE_SITE;
}
export const SOURCE = sourceBase();
const FROM_FILE = SOURCE !== LIVE_SITE;   // a local ?src= test copy only; the live league never reads the s3 site any more (0.12)
const NO_LOGO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
let crests = {};
export const logoUrl = code => (FROM_FILE ? `${SOURCE}assets/teams/${String(code).toLowerCase()}.png`
  : crests[code] ? `${SUPABASE_URL}/storage/v1/object/public/crests/${crests[code]}` : NO_LOGO);
// A match opens in the Game centre (game.html, 0.34). A local ?src= test copy still points at the s3 site's match page.
export const matchUrl = fx => (FROM_FILE ? `${LIVE_SITE}match.html?id=${encodeURIComponent(fx.id)}` : `game.html?id=${encodeURIComponent(fx.id)}`);

// Melbourne wall-clock date and time from an instant (kickoff() reads them back as the viewer's local time, as before).
const melb = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function melbParts(iso) {
  const p = Object.fromEntries(melb.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export async function loadSeason() {
  if (FROM_FILE) {
    const res = await fetch(`${SOURCE}data/season.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`The league data didn't load (error ${res.status}).`);
    return res.json();
  }
  const c = await db();
  const [cl, fx, rs, players, rd, lk, wn] = await Promise.all([
    c.from('clubs').select('code, name, short_name, colour, crest_path, manager_name, status').order('name'),
    c.from('fixtures').select('id, week, home, away, starts_at, stage, postponed, window_id').order('week').order('starts_at').range(0, 1999),
    c.from('results').select('fixture, summary, file').range(0, 1999),
    loadPlayers().catch(() => []),
    c.from('rounds').select('*'), c.from('looks').select('key, name, settings'), c.from('match_windows').select('id, look').range(0, 1999),
  ]);
  if (cl.error || fx.error) throw new Error('The league data didn’t load.');
  crests = Object.fromEntries(cl.data.filter(x => x.crest_path).map(x => [x.code, x.crest_path]));
  const result = new Map((rs.data || []).map(r => [r.fixture, { ...r.summary, ...(r.file ? { file: r.file } : {}) }]));
  const rounds = new Map((rd.data || []).map(r => [r.week, r])), windowLook = new Map((wn.data || []).map(w => [w.id, w.look]));
  const looks = Object.fromEntries((lk.data || []).map(l => [l.key, l]));
  // Round names and numbers (0.20): a week can be named, numbered automatically or by hand, or have no number.
  const labels = roundLabels(weekNumbers(fx.data, rd.data || []), rd.data || []);
  const lookOf = f => windowLook.get(f.window_id) || rounds.get(f.week)?.look || 'classic';
  return {
    looks, rounds: Object.fromEntries([...labels].map(([w, l]) => [w, { label: l.label, short: l.short, numbered: l.numbered, no: l.no, name: l.name }])),
    season: 1, league: 'vLeague', live_minutes: 45, points: { win: 3, draw: 1, loss: 0 }, news: [], players,
    teams: cl.data.map(x => ({ code: x.code, name: x.name, short_name: x.short_name, colour: x.colour || '#475569', manager: x.manager_name || '',
      ...(x.status === 'withdrawn' || x.status === 'pending' ? { withdrawn: true } : {}) })),
    fixtures: fx.data.map(f => ({ id: f.id, week: f.week, ...(f.week === 99 ? { test: true } : {}), look: lookOf(f), round: labels.get(f.week).label, ...(rounds.get(f.week)?.counts_for_ladder === false ? { exhibition: true } : {}), ...(labels.get(f.week).name ? { round_name: labels.get(f.week).name } : {}), home: f.home, away: f.away, ...(f.starts_at ? melbParts(f.starts_at) : {}),
      ...(f.stage ? { stage: f.stage } : {}), ...(f.postponed ? { postponed: true } : {}), ...(result.has(f.id) ? { result: result.get(f.id) } : {}) })),
  };
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

// While live, the match plays out over live_minutes. The moments that matter (the build-up to and aftermath of goals and cards)
// play at true 1x; the quiet stretches between them are wound through quickly (ported from the s3 broadcast, 0.36). If the window
// is as long as the match, it is one steady rate. Cached per fixture and window.
const LEAD = 18, TAIL = 8;
function warp(fx, s) {
  const key = (s.live_minutes || 10) + ':' + fx.result.duration_t;
  if (fx._warp?.key === key) return fx._warp;
  const periods = fx.result.periods || [], t0 = periods.length ? periods[0].start_t : 0, t1 = fx.result.duration_t, B = (s.live_minutes || 10) * 60, D = t1 - t0;
  const win = [...(fx.result.goals || []), ...(fx.result.cards || [])].map(e => [Math.max(t0, e.t - LEAD), Math.min(t1, e.t + TAIL)]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const w of win) { const l = merged[merged.length - 1]; if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]); else merged.push([...w]); }
  const A = merged.reduce((n, w) => n + w[1] - w[0], 0);
  if (B >= D || A > 0.6 * B || !merged.length) return fx._warp = { key, B, segs: [{ s0: t0, s1: t1, w0: 0, w1: B, r: D / B }] };
  const rest = (D - A) / (B - A), segs = []; let cur = t0, w = 0;
  const add = (s0, s1, r) => { if (s1 - s0 > 1e-6) { segs.push({ s0, s1, w0: w, w1: w + (s1 - s0) / r, r }); w += (s1 - s0) / r; } };
  for (const m of merged) { add(cur, m[0], rest); add(m[0], m[1], 1); cur = m[1]; }
  add(cur, t1, rest);
  return fx._warp = { key, B, segs };
}
// Seconds into the live window -> match-file time.
export function liveSimTime(fx, s, now = new Date()) {
  const W = warp(fx, s), w = Math.min(W.B, Math.max(0, (now - kickoff(fx)) / 1000));
  const g = W.segs.find(g => w <= g.w1) || W.segs[W.segs.length - 1];
  return g.s0 + (w - g.w0) * g.r;
}
// How fast the picture must run at match-file time t to stay on the live clock (1 in the key moments).
export function liveSpeed(fx, s, t) {
  const W = warp(fx, s);
  if (t == null) t = liveSimTime(fx, s);
  return (W.segs.find(g => t <= g.s1) || W.segs[W.segs.length - 1]).r;
}
// The match clock at match-file time t ("37:12"), and the added time announced once the 45 minutes are up (else 0).
export function clockAt(periods, t) {
  const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
  const el = Math.max(0, t - p.start_t) + (p.period === 2 ? 2700 : 0);
  return `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(Math.floor(el % 60)).padStart(2, '0')}`;
}
export function addedAt(periods, t) {
  const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
  return p && t - p.start_t >= 2700 && p.added_minutes ? p.added_minutes : 0;
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

// The week to open on: a week with a match today, else the next to play, else the latest. Test matches (week 99) never count.
export function activeWeek(s, now = new Date()) {
  const dated = s.fixtures.filter(f => kickoff(f) && !f.test).sort(byKickoff);
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
    if (f.stage || f.exhibition) continue;   // finals and showcase / pre-season weeks don't count for the ladder
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
    if (f.test) continue;   // a test match (week 99) has made-up players
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
