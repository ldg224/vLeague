// The match page's Team form card (WR-34): each club's last five played matches this season, newest at the top, home club's column on the left and
// the away club's on the right. Each row is "home name, score chip, away name"; the chip is green for a win, grey for a draw and red for a loss from
// THAT club's point of view, and the newest is underlined. A row opens that match.
//   formCard(season, fx, ctx, now) -> { html, hidden: [fixture ids] }
//   ctx = { club(code) -> clubs row | undefined, team(code) -> team, crest(team, px) -> html, hide(f) -> true when the viewer hasn't opened that result
//           (spoiler-free), url(f) -> the match's address }
// Only played matches of this season (not Test matches or exhibitions); fewer than five shows what exists; none says "No matches played yet."
// A result the viewer has not opened shows a plain dash chip (no colour, nothing given away); the card then offers "Show" for all of them.
import { finished, byKickoff, kickoff } from './dashboard-data.js';
import { esc } from './member.js';

const outcome = (f, code) => {
  const mine = f.home === code ? f.result.home : f.result.away, theirs = f.home === code ? f.result.away : f.result.home;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
};
const WORD = { W: 'Won', D: 'Drew', L: 'Lost' };

export function formCard(season, fx, ctx, now = new Date()) {
  const hidden = [];
  const nameOf = code => ctx.club(code)?.short_name || ctx.club(code)?.name || ctx.team(code).name;
  const last = code => finished(season, now)
    .filter(f => (f.home === code || f.away === code) && !f.test && !f.exhibition && f.id !== fx.id && (!kickoff(fx) || kickoff(f) < kickoff(fx)))
    .sort((a, b) => byKickoff(b, a)).slice(0, 5);
  const col = (code, side) => {
    const games = last(code);
    const rows = games.map((f, i) => {
      const hid = ctx.hide(f);
      if (hid) hidden.push(f.id);
      const o = outcome(f, code), label = hid ? `${nameOf(f.home)} against ${nameOf(f.away)}, result hidden` : `${WORD[o]} ${f.result.home} to ${f.result.away}, ${nameOf(f.home)} against ${nameOf(f.away)}`;
      const chip = hid ? '<b class="mf-s is-hidden">–</b>' : `<b class="mf-s res-${o}${i === 0 ? ' is-new' : ''}">${f.result.home} – ${f.result.away}</b>`;
      const nm = c => `<span class="mf-n${c === code ? ' is-me' : ''}">${esc(nameOf(c))}</span>`;
      return `<li><a class="mf-row" href="${esc(ctx.url(f))}" aria-label="${esc(label)}">${nm(f.home)}${chip}${nm(f.away)}</a></li>`;
    }).join('');
    const team = ctx.team(code);
    return `<div class="mf-col is-${side}"><h3 class="mf-club">${ctx.crest(team, 28)}<span>${esc(nameOf(code))}</span></h3>`
      + (games.length ? `<ol class="mf-list" aria-label="${esc(nameOf(code))}, last ${games.length} results, newest first">${rows}</ol>` : '<p class="mf-none">No matches played yet.</p>') + '</div>';
  };
  const html = `<section class="lg-card mf" aria-labelledby="mf-h"><div class="mf-head"><h2 id="mf-h">Team form</h2></div>
    <div class="mf-cols">${col(fx.home, 'home')}${col(fx.away, 'away')}</div>
    ${hidden.length ? `<p class="mf-hide">${hidden.length} result${hidden.length === 1 ? '' : 's'} hidden · <button type="button" data-reveal-form>Show</button></p>` : ''}
  </section>`;
  return { html, hidden };
}
