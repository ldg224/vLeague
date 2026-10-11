// Team of the Week (WR-21, S-09), on Overview: the best XI of one round, in a fixed 4-3-3 (3 forwards, 3 midfielders, 4 defenders, a goalkeeper),
// picked by match rating. String builders and sums only (no page code), so the tests can run them without a browser:
//
//   teamOfWeek(fixtures, week)               { lines: { FWD, MID, DEF, GK: [player] }, star: id | null, matches }  (player: { id, name, team, pos, rating, g, a, min })
//   weekSummaries(fixtures, labelOf)         [{ week, label, star: { name, rating } | null }] for every round with a played match, oldest first
//   teamOfWeekCard(fixtures, ctx, opts)      the card: round picker, then the pitch
//
// `fixtures` are the counted, finished league matches the viewer may see (the page leaves out the ones hidden by spoiler-free mode, so the team
// never gives a score away). A player's rating for the round is his average over that round's matches; a line short of players (a round only part
// played) shows the ones it has. The best rating in the XI gets the star (Player of the week); ties go to goals + assists, minutes, then name.
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html, avatar?(code) -> html (the club's kit pill), mine?: club code }
// opts = { week (default: the latest round with a match), labelOf(week) -> 'Round 7', hiddenCount (results left out, with a "Show all" line) }
import { lineOf } from './season-stats.js';
import { onColour, isHex } from './club-colour.js';

export const SHAPE = [['FWD', 3], ['MID', 3], ['DEF', 4], ['GK', 1]];   // top of the pitch first

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const round1 = n => Math.round(n * 10) / 10;

// Best first: rating, then goals + assists, then minutes, then name.
const better = (a, b) => b.rating - a.rating || (b.g + b.a) - (a.g + a.a) || b.min - a.min || String(a.name).localeCompare(String(b.name));

export function teamOfWeek(fixtures, week) {
  const here = fixtures.filter(f => f.week === week && f.result?.players), byId = new Map();
  for (const f of here) {
    for (const [id, s] of Object.entries(f.result.players)) {
      if (!((s.min ?? 1) > 0) || !(s.r > 0)) continue;   // didn't play, or has no rating
      const p = byId.get(id) || byId.set(id, { id, name: s.name, team: s.team, pos: lineOf(s.slot), sum: 0, n: 0, g: 0, a: 0, min: 0 }).get(id);
      p.sum += s.r; p.n++; p.g += s.g || 0; p.a += s.a || 0; p.min += s.min ?? 0;
      p.team = s.team; p.pos = lineOf(s.slot);
    }
  }
  const all = [...byId.values()].map(p => ({ id: p.id, name: p.name, team: p.team, pos: p.pos, rating: round1(p.sum / p.n), g: p.g, a: p.a, min: p.min }));
  const lines = {};
  for (const [pos, n] of SHAPE) lines[pos] = all.filter(p => p.pos === pos).sort(better).slice(0, n);
  const xi = SHAPE.flatMap(([pos]) => lines[pos]).sort(better);
  return { lines, star: xi[0]?.id ?? null, matches: here.length };
}

export function weekSummaries(fixtures, labelOf = w => `Round ${w}`) {
  const weeks = [...new Set(fixtures.filter(f => f.result?.players && f.week != null).map(f => f.week))].sort((a, b) => a - b);
  return weeks.map(week => {
    const t = teamOfWeek(fixtures, week), star = SHAPE.flatMap(([pos]) => t.lines[pos]).find(p => p.id === t.star);
    return { week, label: labelOf(week), star: star ? { name: star.name, rating: star.rating } : null };
  });
}

// ---------- the card ----------
const svg = d => `<svg class="tw-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const PREV = svg('m15 6-6 6 6 6'), NEXT = svg('m9 6 6 6-6 6'), CARET = svg('m6 9 6 6 6-6'), TICK = svg('m5 12.5 4.5 4.5L19 7.5');
const STAR = '<svg class="tw-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2.8 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.6l-5.6 3.2 1.3-6.2L3 9.3l6.3-.7z"/></svg>';

const tone = r => (r >= 7 ? 'hi' : 'lo');   // green from 7.0, orange below (as FotMob)

function player(p, isStar, ctx) {
  const club = ctx.club(p.team), c = isHex(club?.colour) ? club.colour : '#64748b', kit = ctx.avatar?.(p.team);
  const body = kit ? `<span class="tw-kit">${kit}</span>` : '<span class="tw-pill"></span>';
  return `<li class="tw-p${ctx.mine === p.team ? ' is-mine' : ''}" style="--c:${c};--on:${onColour(c)}">`
    + `<span class="tw-av">${body}<b class="tw-r is-${isStar ? 'star' : tone(p.rating)}" aria-label="Rating ${p.rating.toFixed(1)}${isStar ? ', player of the week' : ''}">${p.rating.toFixed(1)}${isStar ? STAR : ''}</b><span class="tw-crest">${ctx.crest(p.team, 18)}</span></span>`
    + `<span class="tw-n">${esc(p.name)}</span></li>`;
}

const PITCH = '<svg class="tw-lines" viewBox="0 0 300 360" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
  + '<path d="M96 0a54 54 0 0 0 108 0" vector-effect="non-scaling-stroke"/><path d="M60 360V290h180v70M110 360v-30h80v30" vector-effect="non-scaling-stroke"/></svg>';

export function teamOfWeekCard(fixtures, ctx, { week = null, labelOf = w => `Round ${w}`, hiddenCount = 0 } = {}) {
  const head = '<div class="lg-card-head"><h2>Team of the week</h2></div>';
  const hid = hiddenCount ? `<p class="tb-hidden">${hiddenCount} result${hiddenCount === 1 ? '' : 's'} hidden, so the team leaves ${hiddenCount === 1 ? 'it' : 'them'} out. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const list = weekSummaries(fixtures, labelOf);
  if (!list.length) {
    return `<section class="lg-card tw" aria-label="Team of the week">${head}${hid}<div class="sc-empty"><b>No matches played yet</b><span>The best XI of each round appears here once it has been played.</span></div></section>`;
  }
  const i = Math.max(0, list.findIndex(r => r.week === (list.some(r => r.week === week) ? week : list[list.length - 1].week))), cur = list[i];
  const t = teamOfWeek(fixtures, cur.week);
  const step = (to, icon, what, dir) => (to
    ? `<button type="button" class="tw-arrow" data-tw="${to.week}" data-dir="${dir}" aria-label="${what} round">${icon}</button>`
    : `<span class="tw-arrow" aria-disabled="true" aria-label="${what} round">${icon}</span>`);
  const items = [...list].reverse().map(r => `<button type="button" role="menuitemradio" aria-checked="${r.week === cur.week}" data-tw="${r.week}"><span><b>${esc(r.label)}</b>`
    + `${r.star ? `<i>${esc(r.star.name)} · ${r.star.rating.toFixed(1)}</i>` : ''}</span>${TICK}</button>`).join('');
  const nav = `<div class="tw-nav">${step(list[i - 1], PREV, 'Previous', 'prev')}`
    + `<div class="tw-pick"><button type="button" class="tw-pillbtn" data-twmenu aria-haspopup="menu" aria-expanded="false"><b>${esc(cur.label)}</b>${CARET}</button><div class="tw-menu" role="menu" hidden>${items}</div></div>`
    + `${step(list[i + 1], NEXT, 'Next', 'next')}</div>`;
  const rows = SHAPE.map(([pos]) => `<ol class="tw-line" data-line="${pos}">${t.lines[pos].map(p => player(p, p.id === t.star, ctx)).join('')}</ol>`).join('');
  const none = SHAPE.every(([pos]) => !t.lines[pos].length);
  return `<section class="lg-card tw" aria-label="Team of the week">${head}${nav}${hid}`
    + (none ? '<div class="sc-empty"><b>Nothing to show</b><span>This round\'s results are hidden.</span></div>' : `<div class="tw-pitch">${PITCH}${rows}</div>`) + '</section>';
}
