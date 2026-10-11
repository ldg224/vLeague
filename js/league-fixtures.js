// The Fixtures tab (WR-15 to WR-17): every match of the season in one list, three ways to look at it.
// String builders and date sums only (no page code), so the tests can run them without a browser:
//
//   fixturesView(season, ctx, { mode, arg })    the whole tab: the three mode pills, the header and the rows
//     mode 'round' arg = a round (week) number (default view; default: the current round)
//     mode 'date'  arg = a YYYY-MM-DD inside the week to show (default: this week, else the nearest week with matches)
//     mode 'team'  arg = a club code (default: your own club, else the first)
//   fixturesAddress(mode, arg)                  '#fixtures/round/8' ('#fixtures' for the current round)
//   parseSub(sub)                               'date/2026-10-12' -> { mode: 'date', arg: '2026-10-12' }; '' -> By round
//
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html, mine?: code, hidden: Set of fixture ids whose score
//         the viewer hasn't opened (spoiler-free), now: Date, time(date) -> '7:30 pm',
//         chance?(fx) -> { h, d, a } win chance in whole percents, venue?(code) -> the club's ground }
// Look (user, 11 Oct 2026, after the first version read as bland and left the wide screen empty): a row is a little match ticket. Each side
// has its club colour as a slim edge, the score sits in a plate with the winner in full strength, a match still to play carries a slim
// win-chance bar, and a wide screen also gets the ground. A row is a link to the match page. Test matches never show. A hidden score shows a dash and nothing is given away
// (no red cards, no result letters, no winner); opening the match reveals it.
import { status, kickoff, shownScore, liveMinute, liveState, byKickoff, matchUrl, activeWeek } from './dashboard-data.js';
import { addDays, mondayOf } from './roster.js';
import { accentFor, isHex } from './club-colour.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const PREV = svg('m15 6-6 6 6 6'), NEXT = svg('m9 6 6 6-6 6');

// By round is the default view, so its bare address is just #fixtures.
export const fixturesAddress = (mode, arg) => `#fixtures${mode === 'round' && (arg == null || arg === '') ? '' : `/${mode || 'round'}${arg != null && arg !== '' ? `/${arg}` : ''}`}`;
export function parseSub(sub = '') {
  const [mode, ...rest] = String(sub).split('/');
  return { mode: ['date', 'team'].includes(mode) ? mode : 'round', arg: rest.join('/') || null };
}

// ---------- dates ----------
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const noon = s => new Date(`${s}T12:00:00`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(date, today) {
  const n = Math.round((noon(date) - noon(today)) / 86400000);
  return { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }[n] || noon(date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function rangeLabel(from, to) {
  const a = noon(from), b = noon(to);
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}
export const weekOfDate = date => { const from = mondayOf(date); return { from, to: addDays(from, 6) }; };

const shown = season => season.fixtures.filter(f => !f.test).sort(byKickoff);
const dated = list => list.filter(f => f.date);

// The week to open on: this week if it has matches, else the next week with matches, else the last one.
export function defaultDate(season, now) {
  const today = ymd(now), list = dated(shown(season));
  if (!list.length) return today;
  const { from, to } = weekOfDate(today);
  if (list.some(f => f.date >= from && f.date <= to)) return today;
  return (list.find(f => f.date > to) || list[list.length - 1]).date;
}

// ---------- colours ----------
// Each side's club colour in both themes (lifted or deepened so it reads, like the stat cards); the page picks the one for its theme.
const hues = (ctx, fx) => ['home', 'away'].map(side => {
  const c = ctx.club(fx[side])?.colour, ok = isHex(c), k = side === 'home' ? 'h' : 'a';
  return `--${k}l:${ok ? accentFor(c, 'light') : '#8a8a8a'};--${k}d:${ok ? accentFor(c, 'dark') : '#8a8a8a'}`;
}).join(';');

const bar = p => `<i class="ch" style="flex:${Math.max(p.h, 1)}"></i><i class="cd" style="flex:${Math.max(p.d, 1)}"></i><i class="ca" style="flex:${Math.max(p.a, 1)}"></i>`;
const chanceBar = p => (p
  ? `<span class="fx-chance" role="img" aria-label="Win chance: home ${p.h} percent, draw ${p.d} percent, away ${p.a} percent" title="Win chance: ${p.h}% · ${p.d}% · ${p.a}%">${bar(p)}</span><span class="fx-pcts" aria-hidden="true"><b>${p.h}%</b><b>${p.a}%</b></span>`
  : '');

// ---------- one match row ----------
const redCount = (fx, code) => (fx.result?.cards || []).filter(c => c.team === code && (c.card === 'red' || c.card === 'second_yellow')).length;
const outcome = (fx, code) => {
  const mine = fx.home === code ? fx.result.home : fx.result.away, theirs = fx.home === code ? fx.result.away : fx.result.home;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
};

function team(fx, side, ctx, live, hid, edge) {
  const code = fx[side], club = ctx.club(code);
  const reds = hid ? 0 : live ? live.reds[side] : redCount(fx, code);
  const marks = reds ? `<span class="fx-reds" aria-label="${reds === 1 ? 'Sent off' : `${reds} sent off`}">${'<i></i>'.repeat(Math.min(reds, 3))}</span>` : '';
  const name = `<span class="fx-name${ctx.mine === code ? ' is-mine' : ''}"><b class="fx-full">${esc(club?.name || code)}</b><b class="fx-short">${esc(club?.short_name || club?.name || code)}</b></span>`;
  const crest = ctx.crest(code, 28);
  return side === 'home' ? `<span class="fx-team is-home${edge}">${name}${marks}${crest}</span>` : `<span class="fx-team is-away${edge}">${crest}${marks}${name}</span>`;
}

// opts.forTeam: a club code, to show that club's result letter (W, D, L) at the row's end.
export function rowHtml(fx, season, ctx, opts = {}) {
  const { now } = ctx, st = status(fx, season, now), k = kickoff(fx), hid = ctx.hidden?.has(fx.id) && (st === 'live' || st === 'ft');
  const live = st === 'live' && !hid ? liveState(fx, season, now) : null;
  const tag = st === 'live' ? `<span class="fx-tag is-live">${hid ? 'LIVE' : `LIVE ${liveMinute(fx, season, now) ?? ''}′`}</span>`
    : st === 'ft' ? '<span class="fx-tag">FT</span>'
      : st === 'postponed' ? '<span class="fx-tag is-off">Postponed</span>'
        : st === 'awaiting' ? '<span class="fx-tag">Soon</span>' : '<span class="fx-tag"></span>';
  let mid = '', edge = ['', ''];
  if (st === 'live' || st === 'ft') {
    const sc = hid ? null : shownScore(fx, season, now);
    if (sc) {
      const lead = sc.home > sc.away ? 'home' : sc.home < sc.away ? 'away' : '';
      mid = `<strong class="fx-score${st === 'live' ? ' is-live' : ''}"><b${lead === 'home' ? ' class="is-lead"' : ''}>${sc.home}</b><i>–</i><b${lead === 'away' ? ' class="is-lead"' : ''}>${sc.away}</b></strong>`;
      if (st === 'ft' && lead) edge = lead === 'home' ? [' is-win', ' is-loss'] : [' is-loss', ' is-win'];   // the winner's name stands out, the loser's steps back
    } else {
      mid = '<strong class="fx-score is-hidden" aria-label="Score hidden"><b>–</b><i>·</i><b>–</b></strong>';
    }
  } else {
    mid = `<strong class="fx-ko">${k ? esc(ctx.time(k)) : st === 'postponed' ? '–' : 'TBA'}</strong>${st !== 'postponed' ? chanceBar(ctx.chance?.(fx)) : ''}`;
  }
  let res = '';
  if (opts.forTeam) {
    res = st === 'ft' && !hid ? `<abbr class="fx-res res-${outcome(fx, opts.forTeam)}" title="${{ W: 'Won', D: 'Drew', L: 'Lost' }[outcome(fx, opts.forTeam)]}">${outcome(fx, opts.forTeam)}</abbr>` : '<span class="fx-res"></span>';
  }
  const home = ctx.club(fx.home)?.name || fx.home, away = ctx.club(fx.away)?.name || fx.away;
  const label = `${home} against ${away}`;
  const mine = ctx.mine && (fx.home === ctx.mine || fx.away === ctx.mine);
  const ground = ctx.venue?.(fx.home);
  return `<li class="fx-row is-${st}${mine ? ' has-mine' : ''}${opts.forTeam ? ' with-res' : ''}" style="${hues(ctx, fx)}"><a href="${esc(matchUrl(fx))}" aria-label="${esc(label)}">${tag}${team(fx, 'home', ctx, live, hid, edge[0])}<span class="fx-mid">${mid}</span>${team(fx, 'away', ctx, live, hid, edge[1])}<span class="fx-venue">${ground ? esc(ground) : ''}</span>${res}</a></li>`;
}

// ---------- groups ----------
const count = n => `${n} ${n === 1 ? 'match' : 'matches'}`;

function dayGroups(list, season, ctx, opts) {
  const today = ymd(ctx.now), out = [];
  for (const date of [...new Set(list.map(f => f.date || ''))]) {
    const rows = list.filter(f => (f.date || '') === date);
    out.push(`<li class="fx-day"><h3>${date ? esc(dayLabel(date, today)) : 'Date to be confirmed'}</h3><span>${count(rows.length)}</span></li>${rows.map(f => rowHtml(f, season, ctx, opts)).join('')}`);
  }
  return out.join('');
}

const arrows = (title, prevHref, nextHref, what) => `<div class="fx-head"><${prevHref ? `a href="${esc(prevHref)}" data-fxgo` : 'span aria-disabled="true"'} class="fx-arrow" aria-label="Previous ${what}">${PREV}</${prevHref ? 'a' : 'span'}>`
  + `<b class="fx-title">${title}</b><${nextHref ? `a href="${esc(nextHref)}" data-fxgo` : 'span aria-disabled="true"'} class="fx-arrow" aria-label="Next ${what}">${NEXT}</${nextHref ? 'a' : 'span'}></div>`;

const none = (head, line) => `<div class="sc-empty"><b>${esc(head)}</b><span>${esc(line)}</span></div>`;

// ---------- the three views ----------
export function byDate(season, ctx, arg) {
  const list = dated(shown(season)), date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : defaultDate(season, ctx.now), { from, to } = weekOfDate(date);
  const here = list.filter(f => f.date >= from && f.date <= to), undated = shown(season).filter(f => !f.date);
  const prev = list.some(f => f.date < from) ? fixturesAddress('date', addDays(from, -7)) : '', next = list.some(f => f.date > to) ? fixturesAddress('date', addDays(from, 7)) : '';
  const lastWeek = list.length ? weekOfDate(list[list.length - 1].date).from : from;
  const rows = [...here, ...(from === lastWeek ? undated : [])];   // matches with no date yet wait at the end of the last week
  const rest = !rows.length ? none('No matches this week', prev || next ? 'Use the arrows to find the nearest week with matches.' : 'Fixtures appear here once the office has set them.') : '';
  const body = dayGroups(rows, season, ctx, {});
  return `${arrows(esc(rangeLabel(from, to)), prev, next, 'week')}${rest}<ul class="fx-list">${body}</ul>`;
}

export function rounds(season) {
  const weeks = [...new Set(season.fixtures.filter(f => !f.test && f.week != null).map(f => f.week))].sort((a, b) => a - b);
  return weeks.map(w => ({ week: w, label: season.fixtures.find(f => f.week === w && f.round)?.round || `Round ${w}` }));
}

export function byRound(season, ctx, arg) {
  const list = rounds(season);
  if (!list.length) return none('No fixtures yet', 'Rounds appear here once the office has set the fixtures.');
  const want = Number(arg), current = activeWeek(season, ctx.now);
  const i = Math.max(0, list.findIndex(r => r.week === (list.some(r => r.week === want) ? want : current)));
  const r = list[i], fixtures = season.fixtures.filter(f => f.week === r.week && !f.test).sort(byKickoff);
  return `${arrows(esc(r.label), i > 0 ? fixturesAddress('round', list[i - 1].week) : '', i < list.length - 1 ? fixturesAddress('round', list[i + 1].week) : '', 'round')}<ul class="fx-list">${dayGroups(fixtures, season, ctx, {})}</ul>`;
}

export function byTeam(season, ctx, arg) {
  const teams = season.teams.filter(t => !t.withdrawn), code = teams.some(t => t.code === arg) ? arg : teams.some(t => t.code === ctx.mine) ? ctx.mine : teams[0]?.code;
  if (!code) return none('No clubs yet', 'Clubs appear here once they have joined.');
  const strip = `<nav class="fx-clubs" aria-label="Club">${teams.map(t => `<a href="${fixturesAddress('team', t.code)}" data-fxgo${t.code === code ? ' aria-current="true"' : ''} title="${esc(t.name)}" aria-label="${esc(t.name)}">${ctx.crest(t.code, 36)}</a>`).join('')}</nav>`;
  const fixtures = shown(season).filter(f => f.home === code || f.away === code);
  const groups = [];
  for (const label of [...new Set(fixtures.map(f => f.round || `Round ${f.week}`))]) {
    const rows = fixtures.filter(f => (f.round || `Round ${f.week}`) === label);
    groups.push(`<li class="fx-day"><h3>${esc(label)}</h3><span>${count(rows.length)}</span></li>${rows.map(f => rowHtml(f, season, ctx, { forTeam: code })).join('')}`);
  }
  const club = ctx.club(code);
  return `${strip}<div class="fx-head is-team"><b class="fx-title">${esc(club?.name || code)}</b></div>${fixtures.length ? `<ul class="fx-list">${groups.join('')}</ul>` : none('No matches yet', 'This club has no fixtures so far.')}`;
}

// ---------- the tab ----------
export const MODES = [['round', 'By round'], ['date', 'By date'], ['team', 'By team']];

export function fixturesView(season, ctx, { mode = 'round', arg = null } = {}) {
  if (!season || !season.fixtures.some(f => !f.test)) {
    return `<section class="lg-card fx-card"><div class="lg-card-head"><h2>Fixtures</h2></div>${none('No fixtures yet', 'Matches appear here once the office has set the fixtures.')}</section>`;
  }
  const hiddenCount = [...(ctx.hidden || [])].length;
  const pills = `<nav class="fx-modes sc-toggle" aria-label="Fixtures view">${MODES.map(([key, label]) => `<a href="${fixturesAddress(key)}" data-fxgo${key === mode ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>`;
  const hid = hiddenCount ? `<p class="tb-hidden">${hiddenCount} result${hiddenCount === 1 ? '' : 's'} hidden. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const body = (mode === 'round' ? byRound : mode === 'team' ? byTeam : byDate)(season, ctx, arg);
  return `<section class="lg-card fx-card" aria-label="Fixtures"><div class="lg-card-head"><h2>Fixtures</h2></div>${pills}${hid}${body}</section>`;
}
