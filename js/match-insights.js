// The match page's Insights card (WR-35): a few one-line facts about the two clubs, generated from real data only. From this season's results (streaks, goals, clean
// sheets, home or away record, the clubs' meetings, the top scorer) and, needing no match at all, from the squads (attack and defence ratings, team value, the league's
// strongest and weakest, the most valuable player), the table, and the league's history (reigning champions, titles, runners-up). Pure functions, no page code.
//   insights(season, fx, { club(code) -> clubs row | undefined, hide(f) -> true when the viewer hasn't opened that result, now }) -> [{ code, text, w }]
// Each fact has a weight (how striking it is); the best nine are kept (at most five about one club), grouped home club, away club, then ordered best
// first inside each group. Only played league matches before this one count (no Test matches, exhibitions or finals), and a result the viewer has not
// opened (spoiler-free) is left out. Nothing here is made up: no history gives an empty list.
import { finished, byKickoff, kickoff, ladder } from './dashboard-data.js';
import { squadRatings, startingXI } from './match-model.js';
import { FORMATIONS, DEFAULT_FORMATION } from './pitch.js';
import { lineOfSlot } from './lineup-pitch.js';
import { countedFixtures, totals } from './season-stats.js';
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
      else if (titles.length === 1) {
        const ru = history.awards.find(a => a.season === titles[0].id && a.place === 'runner_up');
        const beaten = ru && (ru.club ? club(ru.club)?.name : (history.past || []).find(p => p.id === ru.past_team)?.name);
        add(code, `${n} won the title in ${seasonName(titles[0])}${beaten ? `, finishing ahead of ${beaten}` : ''}`, 7);
      }
      if (titles.length >= 2) add(code, `${n} have won the title ${titles.length} times`, 8);
      if (!titles.length && seconds.length) add(code, `${n} finished runners-up in ${seasonName(seconds[0])}${seconds.length > 1 ? ` and ${seconds.length - 1} more time${seconds.length === 2 ? '' : 's'}` : ''}, but have never won the title`, 7);
      if (!titles.length && !seconds.length && history.seasons.length >= 2) add(code, `${n} are still chasing their first title`, 4);
    }
  }


  // ---- more to say: tactics, the calendar, the title race, the league's leaders and a little character ----
  const POS_WORD = { GK: 'goalkeeper', DEF: 'defender', MID: 'midfielder', FWD: 'forward' };
  const byId = new Map(players.map(p => [String(p.id), p]));
  const lockedXI = c => { const s = sheetFor(c); return s && s.lineup && Object.keys(s.lineup).length ? s : null; };
  const formOf = s => (FORMATIONS[s.formation] ? s.formation : DEFAULT_FORMATION);
  const sh = { home: lockedXI(fx.home), away: lockedXI(fx.away) };
  // tactics, from the locked line-ups
  for (const side of ['home', 'away']) {
    const s = sh[side]; if (!s) continue;
    const code = fx[side], slots = FORMATIONS[formOf(s)];
    const off = Object.entries(s.lineup).map(([slot, id]) => ({ p: byId.get(String(id)), want: slots[slot]?.want })).filter(x => x.p && x.want && x.p.position !== x.want);
    if (off.length) add(code, `${name(code)}'s XI has ${plural(off.length, 'player')} out of position, including ${off[0].p.name}, a ${POS_WORD[off[0].p.position]} playing as a ${POS_WORD[off[0].want]}`, 7);
  }
  if (sh.home && sh.away) {
    const mid = s => Object.keys(s.lineup).filter(k => [2, 3].includes(lineOfSlot(formOf(s), k))).length;
    const mh = mid(sh.home), ma = mid(sh.away);
    if (mh !== ma) { const [w, l, a, b] = mh > ma ? [fx.home, fx.away, mh, ma] : [fx.away, fx.home, ma, mh]; add(w, `${name(w)} have an extra player in midfield, ${a} against ${name(l)}'s ${b}`, 6); }
    if (formOf(sh.home) !== formOf(sh.away)) add(fx.home, `${name(fx.home)} line up in ${formOf(sh.home)} against ${name(fx.away)}'s ${formOf(sh.away)}`, 4);
    const xi = c => startingXI(c, players, sheetFor(c)).xi;
    const everyone = [...xi(fx.home).map(p => ({ p, c: fx.home })), ...xi(fx.away).map(p => ({ p, c: fx.away }))];
    const att = everyone.filter(x => x.p.position !== 'GK').sort((x, y) => y.p.offense - x.p.offense);
    if (att.length > 1 && att[0].p.offense > att[1].p.offense) add(att[0].c, `${att[0].p.name} is the best attacker on the pitch, with an attack rating of ${att[0].p.offense}`, 5);
    const gks = [fx.home, fx.away].map(c => ({ c, p: xi(c).find(p => p.position === 'GK') })).filter(x => x.p);
    if (gks.length === 2 && gks[0].p.defense !== gks[1].p.defense) { const [g, o] = gks[0].p.defense > gks[1].p.defense ? gks : [gks[1], gks[0]]; add(g.c, `${g.p.name} in goal for ${name(g.c)} rates ${g.p.defense} for defence, against ${o.p.defense} for ${o.p.name}`, 4); }
  }
  // the calendar: first matches, first home or away match, rest, the last round
  const before = c => (cutoff ? season.fixtures.filter(f => !f.test && !f.exhibition && (f.home === c || f.away === c) && f.id !== fx.id && kickoff(f) && kickoff(f) < cutoff).sort(byKickoff) : []);
  const rest = {};
  for (const code of [fx.home, fx.away]) {
    const prior = before(code), n = name(code);
    if (!cutoff) continue;
    if (!prior.length) { add(code, `This is ${n}'s first match of the season`, 6); continue; }
    rest[code] = Math.round((cutoff - kickoff(prior[prior.length - 1])) / 864e5);
    if (code === fx.home && !prior.some(f => f.home === code)) add(code, `This is ${n}'s first home match of the season`, 5);
    if (code === fx.away && !prior.some(f => f.away === code)) add(code, `This is ${n}'s first away match of the season`, 5);
  }
  if (rest[fx.home] != null && rest[fx.away] != null && Math.abs(rest[fx.home] - rest[fx.away]) >= 2) {
    const [f, o] = rest[fx.home] > rest[fx.away] ? [fx.home, fx.away] : [fx.away, fx.home];
    add(f, `${name(f)} are the fresher side: ${plural(rest[f], 'day')} since their last match, against ${rest[o]} for ${name(o)}`, 5);
  }
  const leagueWeeks = season.fixtures.filter(f => !f.test && !f.exhibition && !f.stage && f.week != null).map(f => f.week);
  if (new Set(leagueWeeks).size >= 3 && fx.week === Math.max(...leagueWeeks)) add(fx.home, 'This is part of the last round of the league season', 6);
  // the table race: what a win would do
  for (const code of [fx.home, fx.away]) {
    const me = rows.find(r => r.team.code === code); if (!me || !me.p) continue;
    const after = 1 + rows.filter(r => r.team.code !== code && r.pts > me.pts + 3).length, n = name(code);
    if (me.rank > 1 && after === 1) add(code, `A win would take ${n} to the top of the table`, 8);
    else if (me.rank > 4 && after <= 4) add(code, `A win would lift ${n} into the top four, the Finals places`, 8);
    if (rows.length >= 4 && me.rank === rows.length) add(code, `${n} are bottom of the table, in the wooden spoon place`, 6);
  }
  // the league's leaders (only when nobody is level with them)
  const games = countedFixtures(played);
  if (games.length >= 6) {
    const hw = games.filter(f => f.result.home > f.result.away).length;
    add(fx.home, `Home sides have won ${hw} of the ${games.length} league matches this season (${Math.round(hw / games.length * 100)}%)`, 4);
    const lg = games.reduce((s, f) => s + f.result.home + f.result.away, 0) / games.length;
    for (const code of [fx.home, fx.away]) {
      const mine = games.filter(f => f.home === code || f.away === code);
      if (mine.length < 3) continue;
      const av = mine.reduce((s, f) => s + f.result.home + f.result.away, 0) / mine.length;
      if (Math.abs(av - lg) >= 1) add(code, `Matches involving ${name(code)} average ${av.toFixed(1)} goals, against ${lg.toFixed(1)} across the league`, 5);
    }
  }
  if (games.length >= 4) {
    const stats = totals(games), who = c => c === fx.home || c === fx.away;
    const lone = (list, key) => (list.length && (list.length === 1 || list[0][key] > list[1][key]) ? list[0] : null);   // a clear leader, not a tie
    const scorer = lone([...stats.players].filter(p => p.g > 0).sort((a, b) => b.g - a.g), 'g');
    if (scorer && scorer.g >= 2 && who(scorer.team)) add(scorer.team, `${scorer.name} is the league's top scorer, with ${plural(scorer.g, 'goal')}`, 8);
    const helper = lone([...stats.players].filter(p => p.a > 0).sort((a, b) => b.a - a.a), 'a');
    if (helper && helper.a >= 2 && who(helper.team)) add(helper.team, `${helper.name} leads the league for assists, with ${helper.a}`, 7);
    const rated = [...stats.players].filter(p => p.apps >= 2).map(p => ({ ...p, avg: p.ratingSum / p.apps })).sort((a, b) => b.avg - a.avg);
    if (rated.length && (rated.length === 1 || rated[0].avg - rated[1].avg >= 0.05) && who(rated[0].team)) add(rated[0].team, `${rated[0].name} has the best average rating in the league (${rated[0].avg.toFixed(1)})`, 7);
    const ts = stats.teams.filter(t => t.p >= 2);
    if (ts.length >= 4) {
      const lead = (key, per, dir = 1) => { const l = ts.map(t => ({ t, v: per ? t[key] / t.p : t[key] })).sort((a, b) => (b.v - a.v) * dir); return l.length > 1 && l[0].v !== l[1].v ? l[0] : null; };
      const note = (hit, text, w) => { if (hit && who(hit.t.code)) add(hit.t.code, text(hit.t, hit.v), w); };
      note(lead('gf', false), t => `${name(t.code)} have scored the most goals in the league (${t.gf})`, 7);
      note(lead('ga', false, -1), t => `${name(t.code)} have the best defensive record in the league, with ${t.ga} conceded in ${t.p}`, 7);
      note(lead('ga', false), t => `${name(t.code)} have let in the most goals in the league (${t.ga})`, 6);
      note(lead('yellow_cards', false), t => `${name(t.code)} lead the league for yellow cards (${t.yellow_cards})`, 5);
      note(lead('red_cards', false), t => (t.red_cards ? `${name(t.code)} have had the most red cards in the league (${t.red_cards})` : ''), 6);
      note(lead('possession', true), (t, v) => `${name(t.code)} average ${Math.round(v)}% possession, the most in the league`, 6);
      note(lead('xg', true), (t, v) => `${name(t.code)} create the best chances in the league: ${v.toFixed(1)} expected goals a match`, 6);
    }
  }
  // a little character
  for (const code of [fx.home, fx.away]) {
    const motto = String(club(code)?.motto || '').replace(/^["“”]+|["“”]+$/g, '').trim();
    if (motto) add(code, `“${motto}” is ${name(code)}'s motto`, 3);
  }

  // the best nine, at most five about one club
  const kept = [], count = {};
  for (const i of [...out].sort((a, b) => b.w - a.w)) {
    if (!i.text || (count[i.code] || 0) >= 5 || kept.length >= 9) continue;
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
