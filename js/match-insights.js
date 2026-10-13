// The match page's Insights card (WR-35): a few one-line facts about the two clubs, generated from this season's real results only (streaks, goals,
// clean sheets, home or away record, the clubs' meetings and their top scorer). Pure functions, no page code.
//   insights(season, fx, { club(code) -> clubs row | undefined, hide(f) -> true when the viewer hasn't opened that result, now }) -> [{ code, text, w }]
// Each fact has a weight (how striking it is); the best seven are kept (at most four about one club), grouped home club, away club, then ordered best
// first inside each group. Only played league matches before this one count (no Test matches, exhibitions or finals), and a result the viewer has not
// opened (spoiler-free) is left out. Nothing here is made up: no history gives an empty list.
import { finished, byKickoff, kickoff } from './dashboard-data.js';
import { esc } from './member.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const gf = (f, code) => (f.home === code ? f.result.home : f.result.away);
const ga = (f, code) => (f.home === code ? f.result.away : f.result.home);
const won = (f, code) => gf(f, code) > ga(f, code), lost = (f, code) => gf(f, code) < ga(f, code);
const run = (list, test) => { let n = 0; for (const f of list) { if (!test(f)) break; n++; } return n; };   // how many in a row from the newest

export function insights(season, fx, { club, hide = () => false, now = new Date() } = {}) {
  const cutoff = kickoff(fx);
  const played = finished(season, now)
    .filter(f => !f.test && !f.exhibition && !f.stage && f.id !== fx.id && (!cutoff || kickoff(f) < cutoff) && !hide(f))
    .sort((a, b) => byKickoff(b, a));   // newest first
  const name = code => club(code)?.short_name || club(code)?.name || code;
  const out = [];
  const add = (code, text, w) => out.push({ code, text, w });

  for (const [code, role] of [[fx.home, 'home'], [fx.away, 'away']]) {
    const mine = played.filter(f => f.home === code || f.away === code), n = name(code);
    if (mine.length < 2) continue;

    // home or away record, the side it plays today
    const here = mine.filter(f => f[role] === code);
    if (here.length >= 2) {
      const goalsFor = here.reduce((s, f) => s + gf(f, code), 0), goalsAgainst = here.reduce((s, f) => s + ga(f, code), 0), word = role === 'home' ? 'home' : 'away';
      const all = here.length === 2 ? 'both' : `all ${here.length}`;
      if (here.every(f => lost(f, code))) add(code, `${n} lost ${all} ${word} matches, conceding ${plural(goalsAgainst, 'goal')}`, 9);
      else if (here.every(f => won(f, code))) add(code, `${n} won ${all} ${word} matches, scoring ${plural(goalsFor, 'goal')}`, 9);
      else if (here.length >= 3 && here.every(f => !lost(f, code))) add(code, `${n} are unbeaten in ${here.length} ${word} matches`, 6);
      else if (here.length >= 3 && here.every(f => !won(f, code))) add(code, `${n} haven't won in ${here.length} ${word} matches`, 6);
    }

    // the last five
    const five = mine.slice(0, 5), goalsIn = five.reduce((s, f) => s + gf(f, code), 0), goalsOut = five.reduce((s, f) => s + ga(f, code), 0), wins = five.filter(f => won(f, code)).length;
    if (five.length >= 3) {
      if (goalsIn >= 2 * five.length && wins <= 1 && five.length >= 4) add(code, `${n} scored ${plural(goalsIn, 'goal')} in their last ${five.length} matches despite winning ${wins === 0 ? 'none' : 'just once'}`, 8);
      else if (goalsIn >= 2 * five.length) add(code, `${n} scored ${plural(goalsIn, 'goal')} in their last ${five.length} matches`, 5);
      if (goalsOut >= 2 * five.length) add(code, `${n} conceded ${plural(goalsOut, 'goal')} in their last ${five.length} matches`, 6);
    }

    // runs
    const dry = run(mine, f => ga(f, code) > 0), clean = run(mine, f => ga(f, code) === 0);
    if (dry >= 3) add(code, `${n} haven't kept a clean sheet in ${dry} matches`, 7);
    if (clean >= 2) add(code, `${n} have kept a clean sheet in each of their last ${clean} matches`, 7);
    const winRun = run(mine, f => won(f, code)), loseRun = run(mine, f => lost(f, code)), noLoss = run(mine, f => !lost(f, code)), noWin = run(mine, f => !won(f, code));
    if (winRun >= 2) add(code, `${n} have won their last ${winRun} matches`, 7);
    else if (noLoss >= 4) add(code, `${n} are unbeaten in their last ${noLoss} matches`, 6);
    if (loseRun >= 2) add(code, `${n} have lost their last ${loseRun} matches`, 7);
    else if (noWin >= 4) add(code, `${n} haven't won in their last ${noWin} matches`, 6);
    const blank = run(mine, f => gf(f, code) === 0), scoring = run(mine, f => gf(f, code) > 0);
    if (blank >= 2) add(code, `${n} have failed to score in their last ${blank} matches`, 7);
    else if (scoring >= 4) add(code, `${n} have scored in each of their last ${scoring} matches`, 5);

    // the biggest win
    const big = mine.filter(f => won(f, code)).sort((a, b) => (gf(b, code) - ga(b, code)) - (gf(a, code) - ga(a, code)))[0];
    if (big && gf(big, code) - ga(big, code) >= 3) add(code, `${n}'s biggest win this season was ${gf(big, code)}–${ga(big, code)} against ${name(big.home === code ? big.away : big.home)}`, 6);

    // the top scorer
    const scorers = new Map();
    for (const f of mine) for (const [pid, p] of Object.entries(f.result.players || {})) if (p.team === code && p.g) { const s = scorers.get(pid) || { name: p.name, g: 0 }; s.g += p.g; scorers.set(pid, s); }
    const top = [...scorers.values()].sort((a, b) => b.g - a.g)[0], total = mine.reduce((s, f) => s + gf(f, code), 0);
    if (top && top.g >= 3 && total && top.g / total >= 0.4) add(code, `${top.name} has scored ${top.g} of ${n}'s ${total} goals this season`, 5);
  }

  // the two clubs' meetings
  const meet = played.filter(f => (f.home === fx.home && f.away === fx.away) || (f.home === fx.away && f.away === fx.home));
  if (meet.length >= 2) {
    const winsH = meet.filter(f => won(f, fx.home)).length, winsA = meet.filter(f => won(f, fx.away)).length, draws = meet.length - winsH - winsA;
    const lead = winsH >= winsA ? fx.home : fx.away, lw = Math.max(winsH, winsA);
    if (lw >= 2 && lw / meet.length >= 0.6) add(lead, `${name(lead)} have won ${lw} of their last ${meet.length} league meetings with ${name(lead === fx.home ? fx.away : fx.home)}`, 8);
    else if (draws >= 2) add(fx.home, `These sides have drawn ${draws} of their last ${meet.length} meetings`, 6);
  } else if (meet.length === 1) {
    const f = meet[0], w = won(f, fx.home) ? fx.home : won(f, fx.away) ? fx.away : null;
    add(w || fx.home, w ? `${name(w)} won the last meeting between these sides ${gf(f, w)}–${ga(f, w)}` : 'The last meeting between these sides was a draw', 5);
  }

  // the best seven, at most four about one club
  const kept = [], count = {};
  for (const i of [...out].sort((a, b) => b.w - a.w)) {
    if ((count[i.code] || 0) >= 4 || kept.length >= 7) continue;
    count[i.code] = (count[i.code] || 0) + 1;
    kept.push(i);
  }
  const order = { [fx.home]: 0, [fx.away]: 1 };
  return kept.sort((a, b) => order[a.code] - order[b.code] || b.w - a.w);
}

// The card: groups of consecutive facts about one club, the club's crest in the gutter and its colour on each row's edge.
//   insightsCard(list, ctx) -> html. ctx = { team(code) -> team, crest(team, px) -> html, accent(code) -> '#rrggbb' | '' }
export function insightsCard(list, ctx) {
  const groups = [];
  for (const i of list) { const g = groups[groups.length - 1]; if (g && g.code === i.code) g.rows.push(i); else groups.push({ code: i.code, rows: [i] }); }
  const body = groups.length
    ? `<ul class="mi-list">${groups.map(g => `<li class="mi-group" style="--tag:${esc(ctx.accent(g.code) || 'var(--line)')}"><span class="mi-crest">${ctx.crest(ctx.team(g.code), 32)}</span>`
      + `<ul class="mi-rows">${g.rows.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul></li>`).join('')}</ul>`
    : '<p class="empty">Insights appear after a few matches.</p>';
  return `<section class="lg-card mi" aria-labelledby="mi-h"><div class="mi-head"><h2 id="mi-h">Insights</h2></div>${body}</section>`;
}
