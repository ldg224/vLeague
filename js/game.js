// Game centre (0.34): the page for one match, opened from Matches, League, Home or the guest dashboard (game.html?id=...).
// Before kick-off it is a preview (win chance, form, records, line-ups once locked). From kick-off it is the watching spot:
// the match viewer (js/viewer/): the broadcast view of the whole match, the tactical top-down view and, after full time, a
// highlights video, with a download for each (0.36). A live match is a broadcast: no play, pause or seek controls, and the picture
// is held to the live clock. Then a timeline, the full statistics and the line-ups with ratings. The scoreboard above is drawn in
// the round's look (Classic, Finals, Grand Final, Christmas, Derby...) and the two clubs' colours (0.35).
// Everything shown is cut off at "now" in the match, so a live match never gives away what hasn't happened yet.
// Works for guests too (the match file is readable by anyone once the match has kicked off).
import { chrome, esc, clubs } from './member.js';
import { currentUser, myProfile, db } from './auth.js';
import { paintClub } from './shell.js';
import { loadSeason, kickoff, status, shownScore, liveSimTime, liveMinute } from './dashboard-data.js';
import { crest, teamOf, nameOf, fullNameOf, useClubs, day } from './places.js';
import { prefs, fmtTime, spoilerHidden, revealScore } from './prefs.js';
import { winChance, percents, clubSummary } from './match-model.js';
import { lookInfo, scoreboard } from './scoreboard.js';
import { playerCard, MatchPlayer } from './viewer/player.js';

chrome();
const main = document.getElementById('main');
const id = new URLSearchParams(location.search).get('id');
const TABS = [['watch', 'Watch'], ['timeline', 'Timeline'], ['stats', 'Stats'], ['lineups', 'Line-ups'], ['preview', 'Preview']];
const KEY_EVENTS = new Set(['goal', 'card', 'woodwork', 'penalty']);

let season = null, fx = null, clubsRows = [];
const fxOf = s => s?.fixtures.find(f => String(f.id) === String(id)) || null;
try {
  const user = await currentUser().catch(() => null);
  [clubsRows, season] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null)]);
  useClubs(clubsRows);
  if (user) {
    document.getElementById('back').href = 'matches.html';
    document.getElementById('back').textContent = '← Matches';
    await prefs().catch(() => null);
    const prof = await myProfile().catch(() => null);
    paintClub(clubsRows.find(c => c.code === prof?.club) || null);
  }
  fx = fxOf(season);
  if (!fx) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Game centre</h1><p class="empty">That match couldn’t be found. <a href="matches.html">See all matches</a></p>'; main.setAttribute('aria-busy', 'false'); }
  else await run();
} catch (e) {
  main.innerHTML = `<p class="empty">The Game centre didn’t load. ${esc(e.message || "")} <a href="game.html?id=${esc(id)}">Try again</a></p>`;
  main.setAttribute('aria-busy', 'false');
}

async function run() {
  let tab = (() => { const h = location.hash.slice(1); return TABS.some(t => t[0] === h) ? h : null; })();
  let data = null, fileError = '', sheets = [], loadingFile = false;
  let player = null, fileUrl = '';   // the match viewer, and a link to download the match file
  const home = () => teamOf(season, fx.home), away = () => teamOf(season, fx.away);
  const stadium = () => clubsRows.find(c => c.code === fx.home)?.stadium || '';

  // Seeing a match opens its score for spoiler-free accounts.
  if (['live', 'ft'].includes(status(fx, season)) && spoilerHidden(fx, season)) await revealScore([fx.id]).catch(() => {});

  const st = () => status(fx, season, new Date());
  const live = () => st() === 'live';
  const duration = () => data?.frames?.data?.length ? data.frames.data[data.frames.data.length - 1][0] / 10 : fx.result?.duration_t || 0;
  // How far the match has got: live matches follow the broadcast clock, finished ones are complete.
  const horizon = () => (st() === 'ft' ? duration() : live() ? liveSimTime(fx, season, new Date()) : 0);
  const pace = () => ((duration() || 5400) / ((season.live_minutes || 45) * 60));   // match seconds per real second at the broadcast's pace

  async function loadSheets() { try { const r = await (await db()).from('week_sheets').select('week, club, lineup').eq('week', fx.week); sheets = r.data || []; } catch { /* squads are used */ } }

  async function loadFile() {
    if (data || loadingFile || !['live', 'ft'].includes(st()) || !fx.result?.file) return;
    loadingFile = true;
    try {
      const { data: blob, error } = await (await db()).storage.from('matches').download(fx.result.file);
      if (error || !blob) throw new Error(error?.message || 'no file');
      const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      data = JSON.parse(text);
      fileUrl = URL.createObjectURL(blob);
      data.fi = Object.fromEntries(data.frames.fields.map((f, i) => [f, i]));
      data.byId = Object.fromEntries(data.players.map(p => [p.id, p]));
      data.byIdx = Object.fromEntries(data.players.map(p => [p.idx, p]));
      data.goals = data.events.filter(e => e.type === 'goal');
      fileError = '';
    } catch (e) { fileError = 'The match file isn’t available yet. Try again in a moment.'; }
    loadingFile = false;
  }

  // ---------------------------------------------------------------- what has happened by match second `t`
  const eventsTo = t => (data ? data.events.filter(e => e.t <= t) : []);
  const scoreAt = t => { const s = { home: 0, away: 0 }; for (const e of data.goals) if (e.t <= t) s[e.team === fx.home ? 'home' : 'away']++; return s; };
  function clockAt(t) {
    const periods = data?.periods || fx.result?.periods || [];
    const p = [...periods].reverse().find(p => p.start_t <= t + 1e-6) || periods[0];
    if (!p) return '0:00';
    const s = Math.max(0, t - p.start_t) + (p.period === 2 ? 2700 : 0), over = p.period === 1 ? s > 2700 : s > 5400;
    return over ? `${p.period === 1 ? 45 : 90}+${Math.ceil((s - (p.period === 1 ? 2700 : 5400)) / 60)}'` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  // Team statistics counted from the events and ball holder up to t (a live match can't use the file's full-time totals).
  function statsAt(t) {
    const z = () => ({ shots: 0, sot: 0, xg: 0, passes: 0, done: 0, corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0, tackles: 0, interceptions: 0, clearances: 0, saves: 0, hold: 0 });
    const S = { [fx.home]: z(), [fx.away]: z() };
    for (const e of eventsTo(t)) {
      const s = S[e.team]; if (!s) continue;
      if (e.type === 'shot') { s.shots++; if (e.on_target) s.sot++; s.xg += e.xg || 0; }
      else if (e.type === 'pass') { s.passes++; if (e.outcome === 'complete') s.done++; }
      else if (e.type === 'corner') s.corners++;
      else if (e.type === 'foul') s.fouls++;
      else if (e.type === 'card') { if (e.card === 'yellow') s.yellow++; else s.red++; }
      else if (e.type === 'offside') s.offsides++;
      else if (e.type === 'tackle' && e.won) s.tackles++;
      else if (e.type === 'control' && e.how === 'interception') s.interceptions++;
      else if (e.type === 'clearance') s.clearances++;
      else if (e.type === 'save') s.saves++;
    }
    const fr = data.frames.data, h = data.fi.holder, pi = data.fi.in_play, tt = t * 10;
    const mine = { [fx.home]: new Set(data.players.filter(p => p.team === fx.home).map(p => p.idx)), [fx.away]: new Set(data.players.filter(p => p.team === fx.away).map(p => p.idx)) };
    for (let i = 0; i < fr.length && fr[i][0] <= tt; i++) { const hd = fr[i][h]; if (hd >= 0 && fr[i][pi]) for (const c of [fx.home, fx.away]) if (mine[c].has(hd)) S[c].hold++; }
    return S;
  }
  const finalStats = () => {   // full-time numbers straight from the file
    const T = data.stats.teams, mk = s => ({ shots: s.shots, sot: s.shots_on_target, xg: s.xg, passes: s.passes, done: s.passes_completed, corners: s.corners, fouls: s.fouls,
      yellow: s.yellow_cards, red: s.red_cards, offsides: s.offsides, tackles: s.tackles_won, interceptions: s.interceptions, clearances: s.clearances, saves: s.saves, poss: s.possession, km: s.distance_km, big: s.big_chances });
    return { [fx.home]: mk(T.home), [fx.away]: mk(T.away) };
  };

  // ---------------------------------------------------------------- the header
  const kitColour = code => clubsRows.find(c => c.code === code)?.colour || teamOf(season, code)?.colour;
  function head() {
    const now = new Date(), k = kickoff(fx), s = st(), sc = shownScore(fx, season, now), h = home(), a = away(), sd = stadium();
    const state = s === 'live' ? `<span class="live"><span class="dot"></span>${liveMinute(fx, season, now)}'</span>` : { ft: 'Full time', upcoming: 'Upcoming', awaiting: 'Kicking off', postponed: 'Postponed', tba: 'Date to be confirmed' }[s];
    const score = sc ? `<strong class="${s === 'live' ? 'is-live' : ''}">${sc.home}<i>–</i>${sc.away}</strong>` : `<strong>${k ? esc(fmtTime(k)) : 'TBA'}</strong>`;
    const goals = side => (data ? eventsTo(horizon()).filter(e => e.type === 'goal' && e.team === side) : (fx.result?.goals || []).filter(g => g.team === side && (s === 'ft' || g.t <= horizon())))
      .map(g => `<li>${esc(data ? data.byId[g.scorer]?.name || '' : g.scorer_name || '')}${g.own_goal ? ' (og)' : ''} <small>${esc(g.minute)}'</small></li>`).join('');
    return `<section class="gc-head">${fx.test ? '<div class="gc-test" role="note"><b>TEST MATCH</b><span>Made-up players. Not part of the season.</span></div>' : ''}${scoreboard({ fx, season, look: lookInfo(season, fx), h: fullNameOf(h), a: fullNameOf(a), hColour: kitColour(fx.home), aColour: kitColour(fx.away),
      crests: [crest(h, 64), crest(a, 64)], score, state, goals: [goals(fx.home), goals(fx.away)],
      meta: `${k ? `${esc(day(k, now))}, ${esc(fmtTime(k))}` : ''}${sd ? ` · ${esc(sd)}` : ''}` })}</section>`;
  }

  // ---------------------------------------------------------------- preview
  const chips = form => `<span class="chips">${form.map(o => `<abbr class="res-${o}">${o}</abbr>`).join('') || '<i class="mc-none">No games yet</i>'}</span>`;
  function previewTab() {
    const w = winChance(season, fx, { sheets }), [ph, pd, pa] = percents(w), now = new Date();
    const sum = c => clubSummary(season, c, now), hs = sum(fx.home), as = sum(fx.away), R = w.factors.ratings;
    const meets = season.fixtures.filter(f => f.result && f.id !== fx.id && ((f.home === fx.home && f.away === fx.away) || (f.home === fx.away && f.away === fx.home)));
    const rec = r => `${r.w}-${r.d}-${r.l}`, rate = v => (v == null ? '–' : v.toFixed(1));
    const lineup = c => { const sh = sheets.find(s => s.club === c); const ids = Object.values(sh?.lineup || {}).filter(Boolean); const by = Object.fromEntries((season.players || []).map(p => [p.id, p])); return ids.map(i => by[i]).filter(Boolean); };
    const lu = c => { const l = lineup(c); return l.length ? `<ol class="gc-lu">${l.map(p => `<li><span class="pos">${esc(p.position)}</span>${esc(p.name)}</li>`).join('')}</ol>` : '<p class="quiet">Line-up not locked yet.</p>'; };
    return `<section class="gc-card"><h2>Win chance</h2>
        <div class="mc-bar big"><i class="bh" style="flex:${ph}"></i><i class="bd" style="flex:${pd}"></i><i class="ba" style="flex:${pa}"></i></div>
        <div class="mc-pcts"><span><b>${ph}%</b> ${esc(nameOf(home()))}</span><span><b>${pd}%</b> Draw</span><span><b>${pa}%</b> ${esc(nameOf(away()))}</span></div>
        <p class="gc-note">Expected goals ${w.xg[0].toFixed(1)} to ${w.xg[1].toFixed(1)}. ${w.basis === 'results' ? 'Neither club has a full squad yet, so this leans on the league’s averages and will sharpen as squads and results come in. ' : `Worked out from ${w.basis === 'line-ups' ? 'the locked line-ups' : 'each club’s best eleven'}, `}${w.games} game${w.games === 1 ? '' : 's'} played so far (the more games, the more the results count), recent form, and how much the home side scores in this league (${w.factors.homeBonus.toFixed(2)}× the away side)${meets.length ? ', plus this season’s meetings' : ''}.</p></section>
      <section class="gc-card"><h2>Head to head, side by side</h2>
        <table class="gc-vs"><thead><tr><th></th><th>${esc(nameOf(home()))}</th><th>${esc(nameOf(away()))}</th></tr></thead><tbody>
          <tr><th>League position</th><td>${hs.rank ?? '–'}</td><td>${as.rank ?? '–'}</td></tr>
          <tr><th>Points</th><td>${hs.pts}</td><td>${as.pts}</td></tr>
          <tr><th>Form</th><td>${chips(hs.form)}</td><td>${chips(as.form)}</td></tr>
          <tr><th>Home record</th><td>${rec(hs.home)}</td><td>${rec(as.home)}</td></tr>
          <tr><th>Away record</th><td>${rec(hs.away)}</td><td>${rec(as.away)}</td></tr>
          <tr><th>Attack rating</th><td>${rate(R.home.att)}</td><td>${rate(R.away.att)}</td></tr>
          <tr><th>Defence rating</th><td>${rate(R.home.def)}</td><td>${rate(R.away.def)}</td></tr></tbody></table>
        ${meets.length ? `<p class="gc-note">Met this season: ${meets.map(f => `${esc(f.home)} ${f.result.home}–${f.result.away} ${esc(f.away)}`).join(', ')}</p>` : ''}</section>
      <section class="gc-card"><h2>Line-ups</h2><div class="gc-two"><div><h3>${esc(nameOf(home()))}</h3>${lu(fx.home)}</div><div><h3>${esc(nameOf(away()))}</h3>${lu(fx.away)}</div></div></section>`;
  }

  // ---------------------------------------------------------------- watch (the match viewer)
  function watchTab() {
    if (!data) return `<section class="gc-card"><p class="quiet">${esc(fileError || (loadingFile ? 'Loading the match…' : 'The match isn’t ready to watch yet.'))}</p></section>`;
    return `${playerCard(st())}${recent()}`;
  }
  function recent() {
    const list = eventsTo(horizon()).filter(e => KEY_EVENTS.has(e.type) || (e.type === 'shot' && e.on_target)).slice(-6).reverse();
    return list.length ? `<section class="gc-card"><h2>Latest moments</h2><ul class="gc-ev">${list.map(eventLi).join('')}</ul></section>` : '';
  }
  const unmount = () => { player?.destroy(); player = null; };
  function mount() {
    unmount();
    if (tab === 'watch' && data && document.getElementById('mp')) player = new MatchPlayer({ S: season, FX: fx, st: st(), data, timeline: null, fileUrl });
  }

  // ---------------------------------------------------------------- timeline
  const icon = e => ({ goal: '⚽', card: e.card === 'yellow' ? '🟨' : '🟥', woodwork: '🥅', shot: '🎯', penalty: '⚽' }[e.type] || '•');
  function eventLi(e) {
    const nm = i => (i ? data.byId[i]?.name || '' : ''), who = nm(e.player || e.scorer);
    const text = e.type === 'goal' ? `Goal! ${esc(nm(e.scorer))}${e.own_goal ? ' (own goal)' : ''}${e.assist ? `, assist ${esc(nm(e.assist))}` : ''} <b>${e.score?.[0] ?? ''}–${e.score?.[1] ?? ''}</b>`
      : e.type === 'card' ? `${e.card === 'yellow' ? 'Yellow card' : e.card === 'red' ? 'Red card' : 'Second yellow'}, ${esc(who)}`
      : e.type === 'woodwork' ? `${esc(who)} hits the ${esc(e.part || 'frame')}` : e.type === 'penalty' ? `Penalty, ${esc(who)}` : `Shot on target, ${esc(who)} <small>xG ${(e.xg || 0).toFixed(2)}</small>`;
    return `<li class="tl-row ${e.team === fx.home ? 'h' : 'a'}" data-t="${e.t}"${live() ? '' : ' title="Watch this moment"'}><span class="min">${esc(e.minute)}'</span><span class="ic">${icon(e)}</span><span class="tx">${text} <small>${esc(nameOf(teamOf(season, e.team)))}</small></span></li>`;
  }
  function timelineTab() {
    if (!data) return watchTab();
    const list = eventsTo(horizon()).filter(e => KEY_EVENTS.has(e.type) || (e.type === 'shot' && e.on_target)).reverse();
    return `<section class="gc-card"><h2>Timeline</h2>${list.length ? `<ul class="gc-ev full">${list.map(eventLi).join('')}</ul>` : '<p class="quiet">Nothing has happened yet.</p>'}</section>`;
  }

  // ---------------------------------------------------------------- stats
  function statsTab() {
    if (!data) return watchTab();
    const t = horizon(), full = st() === 'ft', S = full ? finalStats() : statsAt(t), h = S[fx.home], a = S[fx.away];
    const tot = (h.hold || 0) + (a.hold || 0), ph = full ? h.poss : tot ? Math.round(100 * h.hold / tot) : 50, pa = full ? a.poss : 100 - ph;
    const pct = (d, n) => (n ? Math.round(100 * d / n) : 0);
    const R = [['Possession', ph, pa, '%'], ['Expected goals (xG)', +h.xg.toFixed(2), +a.xg.toFixed(2)], ['Shots', h.shots, a.shots], ['Shots on target', h.sot, a.sot],
      ['Passes', h.passes, a.passes], ['Pass accuracy', pct(h.done, h.passes), pct(a.done, a.passes), '%'], ['Corners', h.corners, a.corners], ['Tackles won', h.tackles, a.tackles],
      ['Interceptions', h.interceptions, a.interceptions], ['Clearances', h.clearances, a.clearances], ['Saves', h.saves, a.saves], ['Fouls', h.fouls, a.fouls],
      ['Offsides', h.offsides, a.offsides], ['Yellow cards', h.yellow, a.yellow], ['Red cards', h.red, a.red], ...(full && h.km != null ? [['Distance covered (km)', +h.km.toFixed(1), +a.km.toFixed(1)]] : [])];
    const row = ([l, x, y, u = '']) => { const s = x + y || 1; return `<div class="gc-stat"><span class="v">${x}${u}</span><div class="lbl">${esc(l)}<div class="bars"><i class="bh" style="width:${100 * x / s}%"></i><i class="ba" style="width:${100 * y / s}%"></i></div></div><span class="v">${y}${u}</span></div>`; };
    const motm = full && fx.result?.motm ? fx.result.players?.[fx.result.motm] : null;
    return `<section class="gc-card"><h2>Match statistics${full ? '' : ' so far'}</h2><div class="gc-statrow head"><b>${esc(nameOf(home()))}</b><b>${esc(nameOf(away()))}</b></div>${R.map(row).join('')}</section>
      ${motm ? `<section class="gc-card"><h2>Man of the match</h2><p class="gc-motm"><b>${esc(motm.name)}</b> <span>${esc(nameOf(teamOf(season, motm.team)))}</span> <span class="rating r-hi">${Number(motm.r).toFixed(1)}</span></p></section>` : ''}`;
  }

  // ---------------------------------------------------------------- line-ups
  function lineupsTab() {
    if (!data) return watchTab();
    const t = horizon(), full = st() === 'ft', ev = eventsTo(t), P = data.stats.players;
    const goals = id => ev.filter(e => e.type === 'goal' && e.scorer === id && !e.own_goal).length, assists = id => ev.filter(e => e.type === 'goal' && e.assist === id).length;
    const cards = id => ev.filter(e => e.type === 'card' && e.player === id).map(e => (e.card === 'yellow' ? '🟨' : '🟥')).join('');
    const col = c => { const team = data.teams[c === fx.home ? 'home' : 'away']; return `<div><h3>${esc(fullNameOf(teamOf(season, c)))} <small>${esc(team.formation || '')}</small></h3><ol class="gc-lu">${team.lineup.map(x => {
      const r = full ? P[x.id]?.rating : null;
      return `<li><span class="pos">${esc(x.slot || x.position)}</span><span class="nm">${esc(x.name)}${team.captain === x.id ? ' <small>(c)</small>' : ''} ${'⚽'.repeat(goals(x.id))}${'🅰️'.repeat(assists(x.id))}${cards(x.id)}</span>${r ? `<span class="rating ${r >= 7 ? 'r-hi' : r < 6 ? 'r-lo' : 'r-mid'}">${r.toFixed(1)}</span>` : ''}</li>`; }).join('')}</ol></div>`; };
    return `<section class="gc-card"><h2>Line-ups</h2><div class="gc-two">${col(fx.home)}${col(fx.away)}</div>${full ? '' : '<p class="gc-note">Ratings appear at full time.</p>'}</section>`;
  }

  // ---------------------------------------------------------------- page
  const available = () => (data ? TABS : TABS.filter(t => t[0] === 'preview'));
  function draw() {
    const tabs = available();
    if (!tabs.some(t => t[0] === tab)) tab = data ? 'watch' : 'preview';
    const body = { watch: watchTab, timeline: timelineTab, stats: statsTab, lineups: lineupsTab, preview: previewTab }[tab]();
    unmount();
    main.innerHTML = `<div class="gc">${head()}<nav class="dr-tabs gc-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</nav>
      ${!data && ['live', 'ft'].includes(st()) ? `<p class="quiet">${esc(fileError || 'Loading the match…')}</p>` : ''}${body}</div>`;
    mount();
  }

  // ---------------------------------------------------------------- events
  main.addEventListener('click', e => {
    const row = e.target.closest('.tl-row');
    if (row && !live() && data) {   // a timeline row: watch that moment
      tab = 'watch'; location.hash = tab; draw();
      const t = +row.dataset.t; player?.ready?.then(() => player?.jump(t));
      main.querySelector('#mp')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const b = e.target.closest('button');
    if (b?.dataset.tab) { tab = b.dataset.tab; location.hash = tab; draw(); }
  });

  // Poll: a match that kicks off or finishes changes what the page can show.
  let was = st();
  async function poll(reload) {
    if (reload) { try { season = await loadSeason(); fx = fxOf(season) || fx; } catch { /* keep the last copy */ } }
    const now = st();
    if (now !== was || (['live', 'ft'].includes(now) && !data)) {
      was = now;
      if (['live', 'ft'].includes(now)) { await loadFile(); if (data && !tab) tab = 'watch'; }
      draw();
    } else if (tab === 'watch') {
      const h = document.querySelector('.gc-head'); if (h) h.outerHTML = head();   // the scoreboard keeps up; the picture runs itself
    } else draw();
  }

  await loadSheets();
  if (['live', 'ft'].includes(st())) await loadFile();
  if (!tab) tab = data ? 'watch' : 'preview';
  draw();
  main.setAttribute('aria-busy', 'false');
  document.title = `${nameOf(home())} v ${nameOf(away())} | vLeague`;
  setInterval(() => poll(false), 5000);
  setInterval(() => poll(true), 30000);
}
