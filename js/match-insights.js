// The match page's Insights card (WR-35): a few one-line facts about the two clubs, generated from real data only. From this season's results (streaks, goals, clean
// sheets, home or away record, the clubs' meetings, the top scorer) and, needing no match at all, from the squads (attack and defence ratings, team value, the league's
// strongest and weakest, the most valuable player), the table, and the league's history (reigning champions, titles, runners-up). Pure functions, no page code.
//   insights(season, fx, { club(code) -> clubs row | undefined, hide(f) -> true when the viewer hasn't opened that result, now }) -> [{ code, text, w }]
// Each fact has a weight (how striking it is); the best seven are kept (at most four about one club), grouped home club, away club, then ordered best
// first inside each group. Only played league matches before this one count (no Test matches, exhibitions or finals), and a result the viewer has not
// opened (spoiler-free) is left out. Nothing here is made up: no history gives an empty list.
import { finished, byKickoff, kickoff, ladder } from './dashboard-data.js';
import { squadRatings, startingXI } from './match-model.js';
import { cabinet } from './history-data.js';
import { money } from './match-lineup.js';
import { esc } from './member.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const gf = (f, code) => (f.home === code ? f.result.home : f.result.away);
const ga = (f, code) => (f.home === code ? f.result.away : f.result.home);
const won = (f, code) => gf(f, code) > ga(f, code), lost = (f, code) => gf(f, code) < ga(f, code);
const run = (list, test) => { let n = 0; for (const f of list) { if (!test(f)) break; n++; } return n; };   // how many in a row from the newest

export function insights(season, fx, { club, hide = () => false, now = new Date(), sheets = [], history = null } = {}) {
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


  // ---- facts that need no match at all: the squads' ratings and values, the table, and the league's history ----
  const players = season.players || [];
  const sheetFor = c => (sheets || []).find(s => s.club === c) || null;
  const teamsIn = season.teams.filter(t => !t.withdrawn);
  const ord = k => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th'}`;
  const rate = c => squadRatings(c, players, sheetFor(c));
  const worth = c => startingXI(c, players, sheetFor(c)).xi.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const rh = rate(fx.home), ra = rate(fx.away);
  if (Number.isFinite(rh.att) && Number.isFinite(ra.att)) {
    const one = (label, a, b) => {   // the better side of a head-to-head comparison, if the gap is worth saying
      if (Math.abs(a - b) < 0.3) return;
      const [win, lose, wv, lv] = a > b ? [fx.home, fx.away, a, b] : [fx.away, fx.home, b, a];
      add(win, `${name(win)}'s ${label} has the edge: ${wv.toFixed(1)} against ${name(lose)}'s ${lv.toFixed(1)}`, Math.min(8, 5 + Math.abs(a - b)));
    };
    one('attack', rh.att, ra.att);
    one('defence', rh.def, ra.def);
    const vh = worth(fx.home), va = worth(fx.away);
    if (vh && va && Math.abs(vh - va) / Math.min(vh, va) >= 0.1) {
      const [win, lose, wv, lv] = vh > va ? [fx.home, fx.away, vh, va] : [fx.away, fx.home, va, vh];
      add(win, `${name(win)}'s starting XI is worth ${money(wv)}, ${money(wv - lv)} more than ${name(lose)}'s`, 6);
    }
    const star = [fx.home, fx.away].flatMap(c => startingXI(c, players, sheetFor(c)).xi.map(p => ({ p, c }))).sort((x, y) => (Number(y.p.value) || 0) - (Number(x.p.value) || 0))[0];
    if (star) add(star.c, `${star.p.name} is the most valuable player on the pitch, at ${money(star.p.value)}`, 5);
  }
  // where each club stands in the league's squads (best XI each, so it doesn't depend on who has locked a team)
  const field = teamsIn.map(t => ({ code: t.code, ...squadRatings(t.code, players, null), value: worth0(t.code) })).filter(r => Number.isFinite(r.att) && Number.isFinite(r.def));
  function worth0(c) { return startingXI(c, players, null).xi.reduce((s, p) => s + (Number(p.value) || 0), 0); }
  if (field.length >= 4) {
    for (const code of [fx.home, fx.away]) {
      const me = field.find(r => r.code === code); if (!me) continue;
      // first or last only when nobody is level with it (a tie says nothing)
      const n = name(code), spot = key => (field.every(r => r.code === code || r[key] < me[key] - 0.05) ? 'top' : field.every(r => r.code === code || r[key] > me[key] + 0.05) ? 'bottom' : '');
      const att = spot('att'), def = spot('def'), val = spot('value');
      if (att === 'top') add(code, `${n} have the strongest attack in the league (${me.att.toFixed(1)})`, 7);
      else if (att === 'bottom') add(code, `${n} have the weakest attack in the league (${me.att.toFixed(1)})`, 6);
      if (def === 'top') add(code, `${n} have the strongest defence in the league (${me.def.toFixed(1)})`, 7);
      else if (def === 'bottom') add(code, `${n} have the weakest defence in the league (${me.def.toFixed(1)})`, 6);
      if (val === 'top') add(code, `${n} have the most valuable squad in the league, worth ${money(me.value)} for the starting XI`, 7);
      else if (val === 'bottom') add(code, `${n} have the least valuable squad in the league, worth ${money(me.value)} for the starting XI`, 5);
    }
  }
  // the table
  const rows = ladder(season, now), rowH = rows.find(r => r.team.code === fx.home), rowA = rows.find(r => r.team.code === fx.away);
  if (rowH && rowA && (rowH.p || rowA.p)) add(rowH.p >= rowA.p ? fx.home : fx.away, `${name(fx.home)} (${ord(rowH.rank)}, ${plural(rowH.pts, 'point')}) face ${name(fx.away)} (${ord(rowA.rank)}, ${plural(rowA.pts, 'point')})`, 4);
  // the league's history: titles, runners-up, the reigning champions
  if (history?.seasons?.length) {
    const seasonName = s => { const lg = (history.leagues || []).find(l => l.id === s.league); return lg ? `${s.name}, ${lg.name}` : s.name; };
    const newest = history.seasons[0];
    const champ = history.awards.find(a => a.season === newest.id && a.place === 'winner' && a.club);
    for (const code of [fx.home, fx.away]) {
      const n = name(code), cab = cabinet(history, code);
      const titles = cab.filter(e => e.place === 'winner').flatMap(e => e.seasons), seconds = cab.filter(e => e.place === 'runner_up').flatMap(e => e.seasons);
      if (champ?.club === code) add(code, `${n} are the reigning champions (${seasonName(newest)})`, 9);
      else if (titles.length === 1) add(code, `${n} won the title in ${seasonName(titles[0])}`, 7);
      if (titles.length >= 2) add(code, `${n} have won the title ${titles.length} times`, 8);
      if (!titles.length && seconds.length) add(code, `${n} finished runners-up in ${seasonName(seconds[0])}${seconds.length > 1 ? ` and ${seconds.length - 1} more time${seconds.length === 2 ? '' : 's'}` : ''}, but have never won the title`, 7);
      if (!titles.length && !seconds.length && history.seasons.length >= 2) add(code, `${n} are still chasing their first title`, 4);
    }
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
