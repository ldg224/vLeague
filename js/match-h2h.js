// The match page's Head-to-Head tab (WR-37), for upcoming and played matches alike:
//   h2hCard(season, fx, ctx, opts) -> { html, hidden: [fixture ids] }
//   ctx  = { club(code) -> clubs row | undefined, team(code) -> team, crest(team, px) -> html, accent(code) -> '#rrggbb' | '', hide(f) -> true when the viewer
//            hasn't opened that result (spoiler-free), url(f) -> the match's address, time(date) -> '7:00 pm', now: Date }
//   opts = { home: bool, season: bool } the two filter pills
// The top: each club's crest with a pill of its wins (in its club colour for the theme) and a grey pill of draws between. Under it the filter pills
// ("Home": only meetings where this match's home club was at home; "This season": league matches only, no pre-season or exhibition matches), then every
// meeting newest first in rows split by hairlines: the date and the round at the top, then home name and crest, the score (or the kick-off time for a
// meeting still to come) and the away crest and name. A result the viewer has not opened is a dash and is left out of the wins; "Show" opens them.
import { status, kickoff, byKickoff } from './dashboard-data.js';
import { onColour } from './club-colour.js';
import { esc } from './member.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = d => (d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Date to be confirmed');

export function h2hCard(season, fx, ctx, opts = {}) {
  const pair = f => (f.home === fx.home && f.away === fx.away) || (f.home === fx.away && f.away === fx.home);
  let list = season.fixtures.filter(f => !f.test && pair(f));
  if (opts.home) list = list.filter(f => f.home === fx.home);
  if (opts.season) list = list.filter(f => !f.exhibition);
  list.sort((a, b) => byKickoff(b, a));   // newest first, the match still to come on top

  const hidden = [];
  let wh = 0, wa = 0, dr = 0;
  const name = code => ctx.club(code)?.short_name || ctx.club(code)?.name || ctx.team(code).name;
  const rows = list.map(f => {
    const st = status(f, season, ctx.now), played = st === 'ft' && f.result, hid = played && ctx.hide(f), k = kickoff(f);
    if (hid) hidden.push(f.id);
    if (played && !hid) { const h = f.result.home, a = f.result.away; if (h === a) dr++; else if ((h > a) === (f.home === fx.home)) wh++; else wa++; }
    const mid = played && !hid ? `<b class="hh-s">${f.result.home} – ${f.result.away}</b>` : hid ? '<b class="hh-s is-hidden">–</b>' : `<b class="hh-s is-ko">${k ? esc(ctx.time(k)) : 'TBA'}</b>`;
    const label = played && !hid ? `${name(f.home)} ${f.result.home}, ${name(f.away)} ${f.result.away}` : `${name(f.home)} against ${name(f.away)}`;
    return `<li><a class="hh-row${f.id === fx.id ? ' is-now' : ''}" href="${esc(ctx.url(f))}" aria-label="${esc(`${day(k)}, ${label}`)}"${f.id === fx.id ? ' aria-current="true"' : ''}>`
      + `<span class="hh-meta"><span>${esc(day(k))}</span><span>${esc(f.round || `Round ${f.week}`)}</span></span>`
      + `<span class="hh-teams"><span class="hh-n is-home">${esc(name(f.home))}</span>${ctx.crest(ctx.team(f.home), 28)}${mid}${ctx.crest(ctx.team(f.away), 28)}<span class="hh-n">${esc(name(f.away))}</span></span></a></li>`;
  });

  const pill = (code, n) => {
    const c = ctx.accent(code);
    return `<span class="hh-pill" style="${c ? `--k:${esc(c)};--on:${esc(onColour(c))}` : ''}">${n}</span>`;
  };
  const top = `<div class="hh-top"><div class="hh-side">${ctx.crest(ctx.team(fx.home), 48)}<div class="hh-num">${pill(fx.home, wh)}<span>Wins</span></div></div>`
    + `<div class="hh-num is-draw"><span class="hh-pill">${dr}</span><span>Draws</span></div>`
    + `<div class="hh-side"><div class="hh-num">${pill(fx.away, wa)}<span>Wins</span></div>${ctx.crest(ctx.team(fx.away), 48)}</div></div>`;
  const pills = `<nav class="hh-pills sc-toggle" aria-label="Meetings filter"><button type="button" data-h2h="home" aria-pressed="${Boolean(opts.home)}">Home</button>`
    + `<button type="button" data-h2h="season" aria-pressed="${Boolean(opts.season)}">This season</button></nav>`;
  const body = rows.length ? `<ol class="hh-list" aria-label="Meetings, newest first">${rows.join('')}</ol>` : '<p class="hh-none">These clubs haven’t met yet.</p>';
  const hide = hidden.length ? `<p class="hh-hide">${hidden.length} result${hidden.length === 1 ? '' : 's'} hidden · <button type="button" data-reveal-h2h>Show</button></p>` : '';
  return { html: `<section class="lg-card hh" aria-labelledby="hh-h"><h2 id="hh-h" class="sr-only">Head-to-head</h2>${top}${pills}${body}${hide}</section>`, hidden };
}
