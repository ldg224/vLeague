// The match page's side cards (WR-36), in place of FotMob's betting cards (no odds, no bookmaker):
//   chanceCard(season, fx, ctx) -> "Who will win?": each club's crest, the draw, and vLeague's own win chance (js/match-model.js) under each, the
//                                  favourite lit in its club colour and a thin split bar. Live, it moves with the score, minute and red cards. A played match
//                                  shows the same chances as they stood before kick-off ("Before kick-off") with the real result lit and a line on how it compared
//                                  (as expected, against the form, a big upset); hidden by spoiler-free it keeps the result out and offers "Show".
//   venueCard(fx, ctx)          -> "Venue": the ground's name and whose it is. Only facts we really hold: nothing else is shown, and no card without a ground.
// ctx = { club(code) -> clubs row | undefined, team(code) -> team, crest(team, px) -> html, accent(code) -> '#rrggbb' | '', hide(f) -> true when the viewer
//         hasn't opened this result, now: Date, sheets: locked team sheets [{ week, club, formation, lineup }] for the line-up basis }
import { winChance, percents } from './match-model.js';
import { status, liveState, liveMinute } from './dashboard-data.js';
import { esc } from './member.js';
import { icon } from './icons.js';

const BASIS = { 'line-ups': 'From the locked line-ups', squads: 'From the squads', results: 'From the season’s results' };

export function chanceCard(season, fx, ctx) {
  const st = ctx.st ?? status(fx, season, ctx.now), name = code => ctx.club(code)?.short_name || ctx.club(code)?.name || ctx.team(code).name;
  const tone = code => (ctx.accent(code) ? `style="--k:${esc(ctx.accent(code))}"` : '');
  const crest = code => ctx.crest(ctx.team(code), 48);

  // A played match: what the model said before kick-off, and how the real result compared (the score itself is in the header already).
  if (st === 'ft' && !(ctx.live ?? false)) {
    let p;
    try { p = winChance(season, fx, { sheets: ctx.sheets || [], now: ctx.now }); } catch { return ''; }
    const [h, d, a] = percents(p), hid = ctx.hide(fx), r = fx.result;
    const outcome = r.home > r.away ? 'home' : r.home < r.away ? 'away' : 'draw', pct = { home: h, draw: d, away: a }, rank = 1 + Object.values(pct).filter(v => v > pct[outcome]).length;
    const winner = outcome === 'home' ? fx.home : outcome === 'away' ? fx.away : null, wn = winner ? name(winner) : '';
    const verdict = hid ? '' : outcome === 'draw'
      ? (rank === 1 ? 'A draw, as the model expected' : `A draw, the ${rank === 2 ? 'second' : 'least'} likely result (${pct.draw}%)`)
      : (rank === 1 ? `${wn} won, as the model expected` : rank === 2 ? `${wn} won against the form (${pct[outcome]}% before kick-off)` : `A big upset: ${wn} won with only ${pct[outcome]}% before kick-off`);
    const lit = side => (!hid && outcome === side ? ' is-fav' : '');
    return `<section class="lg-card mw" aria-labelledby="mw-h"><div class="mw-head"><h2 id="mw-h">Before kick-off</h2></div>
      <div class="mw-trio" role="group" aria-label="Win chance before kick-off: ${esc(name(fx.home))} ${h} percent, draw ${d} percent, ${esc(name(fx.away))} ${a} percent">
        <div class="mw-cell${lit('home')}" ${tone(fx.home)}>${crest(fx.home)}<b>${h}%</b></div>
        <div class="mw-cell mw-draw${lit('draw')}"><i>X</i><b>${d}%</b></div>
        <div class="mw-cell${lit('away')}" ${tone(fx.away)}>${crest(fx.away)}<b>${a}%</b></div></div>
      <span class="mw-bar" aria-hidden="true"><i style="width:${h}%;background:${esc(ctx.accent(fx.home) || 'var(--blue-500)')}"></i><i class="is-d" style="width:${d}%"></i><i style="width:${a}%;background:${esc(ctx.accent(fx.away) || 'var(--blue-500)')}"></i></span>
      <p class="mw-note">${hid ? 'Result hidden · <button type="button" data-reveal>Show</button>' : esc(verdict)}</p></section>`;
  }
  if (st === 'postponed' || st === 'tba') return '';

  const live = st === 'live' ? liveState(fx, season, ctx.now) : null;
  let p;
  try { p = winChance(season, fx, { sheets: ctx.sheets || [], now: ctx.now, live }); } catch { return ''; }
  const [h, d, a] = percents(p), fav = Math.max(h, d, a) === h && h > a ? 'home' : Math.max(h, d, a) === a && a > h ? 'away' : '';
  const tag = live ? `<span class="mw-live">LIVE ${liveMinute(fx, season, ctx.now) ?? ''}′</span>` : '';
  return `<section class="lg-card mw" aria-labelledby="mw-h"><div class="mw-head"><h2 id="mw-h">Who will win?</h2>${tag}</div>
    <div class="mw-trio" role="group" aria-label="Win chance: ${esc(name(fx.home))} ${h} percent, draw ${d} percent, ${esc(name(fx.away))} ${a} percent">
      <div class="mw-cell${fav === 'home' ? ' is-fav' : ''}" ${tone(fx.home)}>${crest(fx.home)}<b>${h}%</b></div>
      <div class="mw-cell mw-draw${!fav ? ' is-fav' : ''}"><i>X</i><b>${d}%</b></div>
      <div class="mw-cell${fav === 'away' ? ' is-fav' : ''}" ${tone(fx.away)}>${crest(fx.away)}<b>${a}%</b></div>
    </div>
    <span class="mw-bar" aria-hidden="true"><i style="width:${h}%;background:${esc(ctx.accent(fx.home) || 'var(--blue-500)')}"></i><i class="is-d" style="width:${d}%"></i><i style="width:${a}%;background:${esc(ctx.accent(fx.away) || 'var(--blue-500)')}"></i></span>
    <p class="mw-note">${esc(BASIS[p.basis] || BASIS.results)}${live ? ', moving with the score' : ''}</p></section>`;
}

export function venueCard(fx, ctx) {
  const ground = ctx.club(fx.home)?.stadium;
  if (!ground) return '';
  const owner = ctx.club(fx.home)?.name || ctx.team(fx.home).name;
  return `<section class="lg-card mv" aria-labelledby="mv-h"><div class="mw-head"><h2 id="mv-h">Venue</h2></div>
    <div class="mv-row">${icon('map-pin')}<div><b>${esc(ground)}</b><span>Home ground of ${esc(owner)}</span></div></div></section>`;
}
