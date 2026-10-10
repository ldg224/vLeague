// Game centre (0.34): the page for one match, opened from Matches, League, Home or the guest dashboard (game.html?id=...).
// Before kick-off it is a preview (win chance, form, records, line-ups once locked). From kick-off it is the watching spot:
// the match viewer (js/viewer/): the broadcast view of the whole match, the tactical top-down view and, after full time, a
// highlights video (0.36). A live match is a broadcast: no play, pause or seek controls, and the picture
// is held to the live clock. Then a timeline, the full statistics and the line-ups with ratings. The scoreboard above is drawn in
// the round's look (Classic, Finals, Grand Final, Christmas, Derby...) and the two clubs' colours (0.35).
// Everything shown is cut off at "now" in the match, so a live match never gives away what hasn't happened yet.
// Works for guests too (the match file is readable by anyone once the match has kicked off).
import { chrome, esc, clubs } from './member.js';
import { currentUser, myProfile, db } from './auth.js';
import { paintClub } from './shell.js';
import { loadSeason, kickoff, status, shownScore, liveSimTime, liveMinute, liveState } from './dashboard-data.js';
import { crest, teamOf, nameOf, fullNameOf, useClubs, day } from './places.js';
import { prefs, fmtTime, spoilerHidden, revealScore } from './prefs.js';
import { winChance, percents, clubSummary } from './match-model.js';
import { lookInfo, scoreboard } from './scoreboard.js';
import { playerCard, MatchPlayer } from './viewer/player.js';
import { byPlace, pitchHtml } from './lineup-pitch.js';
import { ratingsAt } from './live-rating.js';
import { icon } from './icons.js';
import { liveReactions } from './reactions.js';
import { loadKits, matchKits } from './kits-data.js';

chrome();
const main = document.getElementById('main');
const id = new URLSearchParams(location.search).get('id');
const KEY_EVENTS = new Set(['goal', 'card', 'woodwork', 'penalty']);

let season = null, fx = null, clubsRows = [];
const fxOf = s => s?.fixtures.find(f => String(f.id) === String(id)) || null;
try {
  const user = await currentUser().catch(() => null);
  [clubsRows, season] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null)]);
  useClubs(clubsRows);
  if (user) {
    document.getElementById('back').href = 'matches.html';
    document.getElementById('back').innerHTML = `${icon('arrow-left')} Matches`;
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
  let data = null, fileError = '', sheets = [], loadingFile = false;
  let player = null;   // the match viewer
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

  // The shirt (singlet) number comes from the player list; a test match's made-up players have none.
  const shirt = id => (season.players || []).find(p => String(p.id) === String(id))?.number ?? (fx.test ? String(Number(String(id).slice(-2))) : undefined);   // a test match's ids end in the shirt number
  const shirtHtml = id => { const n = shirt(id); return n == null || n === '' ? '' : `<span class="sn" title="Shirt number">${esc(n)}</span>`; };

  async function loadSheets() { try { const r = await (await db()).from('week_sheets').select('week, club, formation, captain, lineup, kit').eq('week', fx.week); sheets = r.data || []; } catch { /* squads are used */ } }

  async function loadFile() {
    if (data || loadingFile || !['live', 'ft'].includes(st()) || !fx.result?.file) return;
    loadingFile = true;
    try {
      const { data: blob, error } = await (await db()).storage.from('matches').download(fx.result.file);
      if (error || !blob) throw new Error(error?.message || 'no file');
      const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      data = JSON.parse(text);
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
  // What each side wears (S-23): their kit's main colour if they have designed one, else the club colour (as before).
  const kitsAll = await loadKits();
  const clubColour = code => clubsRows.find(c => c.code === code)?.colour || teamOf(season, code)?.colour;
  const kitPicks = () => Object.fromEntries(sheets.filter(s => s.kit).map(s => [s.club, s.kit]));
  let wear = matchKits(kitsAll, fx.home, fx.away, { [fx.home]: clubColour(fx.home), [fx.away]: clubColour(fx.away) }, kitPicks());
  const kitColour = code => (code === fx.home ? wear.home.field?.main : code === fx.away ? wear.away.field?.main : null) || clubColour(code);
  const sameColour = (x, y) => !!x && !!y && String(x).toLowerCase() === String(y).toLowerCase();
  const pitchKit = { colour: code => kitColour(code), label: code => fullNameOf(teamOf(season, code)), shirt: id => shirt(id) };
  const sides = () => { const h = kitColour(fx.home), a = kitColour(fx.away); return h ? ` style="--hc:${esc(h)};${a && !sameColour(h, a) ? `--ac:${esc(a)}` : ''}"` : ''; };
  function head() {
    const now = new Date(), k = kickoff(fx), s = st(), sc = shownScore(fx, season, now), h = home(), a = away(), sd = stadium();
    const state = s === 'live' ? `<span class="live"><span class="dot"></span>${liveMinute(fx, season, now)}'</span>` : { ft: 'Full time', upcoming: 'Upcoming', awaiting: 'Kicking off', postponed: 'Postponed', tba: 'Date to be confirmed' }[s];
    const score = sc ? `<strong class="${s === 'live' ? 'is-live' : ''}">${sc.home}<i>–</i>${sc.away}</strong>` : `<strong class="ko">${k ? esc(fmtTime(k)) : 'TBA'}</strong>`;
    const goals = side => (data ? eventsTo(horizon()).filter(e => e.type === 'goal' && e.team === side) : (fx.result?.goals || []).filter(g => g.team === side && (s === 'ft' || g.t <= horizon())))
      .map(g => `<li>${esc(data ? data.byId[g.scorer]?.name || '' : g.scorer_name || '')}${g.own_goal ? ' (og)' : ''} <small>${esc(g.minute)}'</small></li>`).join('');
    return `<section class="gc-head">${fx.test ? '<div class="gc-test" role="note"><b>TEST MATCH</b><span>Made-up players. Not part of the season.</span></div>' : ''}${scoreboard({ fx, season, look: lookInfo(season, fx), h: fullNameOf(h), a: fullNameOf(a), hColour: kitColour(fx.home), aColour: kitColour(fx.away),
      crests: [crest(h, 64), crest(a, 64)], score, state, goals: [goals(fx.home), goals(fx.away)],
      meta: `${k ? `${esc(day(k, now))}, ${esc(fmtTime(k))}` : ''}${sd ? ` · ${esc(sd)}` : ''}` })}</section>`;
  }

  // ---------------------------------------------------------------- preview
  const chips = form => `<span class="chips">${form.map(o => `<abbr class="res-${o}">${o}</abbr>`).join('') || '<i class="mc-none">No games yet</i>'}</span>`;
  const chanceSection = w => {
    const [ph, pd, pa] = percents(w);
    return `<section class="gc-sec" id="gc-chance"><h2>Win chance</h2>
        <div class="mc-bar big"><i class="bh" style="flex:${ph}"></i><i class="bd" style="flex:${pd}"></i><i class="ba" style="flex:${pa}"></i></div>
        <div class="mc-pcts"><span><b>${ph}%</b> ${esc(nameOf(home()))}</span><span><b>${pd}%</b> Draw</span><span><b>${pa}%</b> ${esc(nameOf(away()))}</span></div></section>`;
  };

  function previewSection() {
    const w = winChance(season, fx, { sheets, live: spoilerHidden(fx, season) ? null : liveState(fx, season) }), [ph, pd, pa] = percents(w), now = new Date();
    const sum = c => clubSummary(season, c, now), hs = sum(fx.home), as = sum(fx.away), R = w.factors.ratings;
    const meets = season.fixtures.filter(f => f.result && f.id !== fx.id && ((f.home === fx.home && f.away === fx.away) || (f.home === fx.away && f.away === fx.home)));
    const rec = r => `${r.w}-${r.d}-${r.l}`, rate = v => (v == null ? '–' : v.toFixed(1));
    // A club's locked eleven, in pitch order: { formation, captain, items: [{ id, name, slot, position }] }.
    const lineup = c => {
      const sh = sheets.find(s => s.club === c), by = Object.fromEntries((season.players || []).map(p => [p.id, p]));
      const items = Object.entries(sh?.lineup || {}).filter(([, pid]) => pid && by[pid]).map(([slot, pid]) => ({ slot, id: pid, name: by[pid].name, position: by[pid].position })).sort(byPlace(sh?.formation));
      return { code: c, formation: sh?.formation, captain: sh?.captain, items };
    };
    // Each player's average match rating from this season's finished games (not this one, and not ones hidden by spoiler-free
    // results): N/A until they have played.
    const played = {};
    for (const f of season.fixtures) {
      if (f.id === fx.id || f.test || !f.result || status(f, season, now) !== 'ft' || spoilerHidden(f, season)) continue;
      for (const [pid, p] of Object.entries(f.result.players || {})) if (p.r != null) { const a = played[pid] ??= { sum: 0, n: 0 }; a.sum += p.r; a.n++; }
    }
    const avg = pid => { const a = played[pid]; return a ? { value: (a.sum / a.n).toFixed(1), n: a.n } : null; };
    const avgCls = v => (v >= 7 ? 'r-hi' : v < 6 ? 'r-lo' : 'r-mid');
    const avgChip = pid => { const a = avg(pid); return a ? `<span class="rating ${avgCls(Number(a.value))}" title="Average rating over ${a.n} game${a.n === 1 ? '' : 's'}">${a.value}</span>` : '<span class="rating r-na" title="Hasn’t played yet">N/A</span>'; };
    const lu = x => (x.items.length ? `<ol class="gc-lu">${x.items.map(p => `<li><span class="pos">${esc(p.position)}</span><span class="nm">${shirtHtml(p.id)}${esc(p.name)}${x.captain === p.id ? ' <small>(c)</small>' : ''}</span>${avgChip(p.id)}</li>`).join('')}</ol>` : '<p class="quiet">Line-up not locked yet.</p>');
    const hx = lineup(fx.home), ax = lineup(fx.away);
    for (const x of [hx, ax]) x.rating = pid => { const a = avg(pid); return a ? { value: a.value, cls: avgCls(Number(a.value)) } : { value: 'N/A', cls: 'r-na' }; };
    return `${chanceSection(w)}
      <section class="gc-sec"><h2>How they compare</h2>
        <table class="gc-vs"><thead><tr><th></th><th>${esc(nameOf(home()))}</th><th>${esc(nameOf(away()))}</th></tr></thead><tbody>
          <tr><th>League position</th><td>${hs.rank ?? '–'}</td><td>${as.rank ?? '–'}</td></tr>
          <tr><th>Points</th><td>${hs.pts}</td><td>${as.pts}</td></tr>
          <tr><th>Form</th><td>${chips(hs.form)}</td><td>${chips(as.form)}</td></tr>
          <tr><th>Home record</th><td>${rec(hs.home)}</td><td>${rec(as.home)}</td></tr>
          <tr><th>Away record</th><td>${rec(hs.away)}</td><td>${rec(as.away)}</td></tr>
          <tr><th>Attack rating</th><td>${rate(R.home.att)}</td><td>${rate(R.away.att)}</td></tr>
          <tr><th>Defence rating</th><td>${rate(R.home.def)}</td><td>${rate(R.away.def)}</td></tr></tbody></table>
        ${meets.length ? `<p class="gc-note">Met this season: ${meets.map(f => `${esc(f.home)} ${f.result.home}–${f.result.away} ${esc(f.away)}`).join(', ')}</p>` : ''}</section>
      <section class="gc-sec"><h2>Line-ups</h2>${hx.items.length && ax.items.length
        ? `${pitchHtml(hx, ax, pitchKit)}<p class="gc-note">The number under each name is that player’s average match rating this season, and N/A means they haven’t played yet. The gold C is the captain.</p>`
        : `<div class="gc-two"><div><h3>${esc(nameOf(home()))}</h3>${lu(hx)}</div><div><h3>${esc(nameOf(away()))}</h3>${lu(ax)}</div></div>`}</section>`;
  }

  // ---------------------------------------------------------------- the match viewer
  const unmount = () => { player?.destroy(); player = null; };
  function mount() {
    unmount();
    if (data && document.getElementById('mp')) player = new MatchPlayer({ S: season, FX: fx, st: st(), data, timeline: null, kits: wear });
  }

  // The highest-rated player of the match (both teams): the man of the match.
  const bestPlayer = () => Object.keys(data.stats.players).reduce((b, id) => (data.stats.players[id].rating > (b ? data.stats.players[b].rating : -1) ? id : b), null);

  // ---------------------------------------------------------------- timeline
  // Icons drawn as small SVGs (not emoji, which look different on every phone and PC). The football and the boot (for an assist)
  // are from Material Design Icons (Pictogrammers, free licence); they take the text colour. The cards are plain shapes.
  const svg = (label, body) => `<svg class="ico" viewBox="0 0 24 24" role="img" aria-label="${label}"><title>${label}</title>${body}</svg>`;
  const ICONS = {
    ball: svg('Goal', '<path fill="currentColor" d="M16.93 17.12L16.13 15.76L17.59 11.39L19 10.92L20 11.67C20 11.7 20 11.75 20 11.81C20 11.88 20.03 11.94 20.03 12C20.03 13.97 19.37 15.71 18.06 17.21L16.93 17.12M9.75 15L8.38 10.97L12 8.43L15.62 10.97L14.25 15H9.75M12 20.03C11.12 20.03 10.29 19.89 9.5 19.61L8.81 18.1L9.47 17H14.58L15.19 18.1L14.5 19.61C13.71 19.89 12.88 20.03 12 20.03M5.94 17.21C5.41 16.59 4.95 15.76 4.56 14.75C4.17 13.73 3.97 12.81 3.97 12C3.97 11.94 4 11.88 4 11.81C4 11.75 4 11.7 4 11.67L5 10.92L6.41 11.39L7.87 15.76L7.07 17.12L5.94 17.21M11 5.29V6.69L7 9.46L5.66 9.04L5.24 7.68C5.68 7 6.33 6.32 7.19 5.66S8.87 4.57 9.65 4.35L11 5.29M14.35 4.35C15.13 4.57 15.95 5 16.81 5.66C17.67 6.32 18.32 7 18.76 7.68L18.34 9.04L17 9.47L13 6.7V5.29L14.35 4.35M4.93 4.93C3 6.89 2 9.25 2 12S3 17.11 4.93 19.07 9.25 22 12 22 17.11 21 19.07 19.07 22 14.75 22 12 21 6.89 19.07 4.93 14.75 2 12 2 6.89 3 4.93 4.93Z"/>'),
    yellow: svg('Yellow card', '<rect x="6" y="3" width="12" height="18" rx="2.2" fill="#f5c518" stroke="#b8920a" stroke-width="1"/>'),
    red: svg('Red card', '<rect x="6" y="3" width="12" height="18" rx="2.2" fill="#e5392f" stroke="#a7231b" stroke-width="1"/>'),
    assist: svg('Assist', '<path fill="currentColor" d="M21 8C20.76 8 20.53 8 20.3 8L20.25 7.97C18.14 7.84 16.38 7.17 15.53 6.23L14 7C13.95 7.1 13.89 7.19 13.84 7.28C14.55 7.89 15 8.65 15 9.5C15 9.83 14.91 10.14 14.79 10.45L12.92 8.58C12.7 8.83 12.47 9.07 12.22 9.29L14.25 11.32C14.04 11.57 13.8 11.79 13.5 12L11.43 9.91C11.14 10.11 10.85 10.28 10.55 10.45L12.58 12.5C12.25 12.63 11.89 12.74 11.5 12.82L9.59 10.91C9.25 11.05 8.91 11.18 8.56 11.29L10.26 13C10.17 13 10.09 13 10 13C8.5 13 7.2 12.54 6.28 11.82C5.46 11.95 4.68 12 4 12C2 12 2 15 2 15V15C2 16.11 2.89 17 4 17H4V18C4 18.55 4.45 19 5 19S6 18.55 6 18V17H7V18C7 18.55 7.45 19 8 19S9 18.55 9 18V17H10V18C10 18.55 10.45 19 11 19S12 18.55 12 18V17H15V18C15 18.55 15.45 19 16 19S17 18.55 17 18V17H18V18C18 18.55 18.45 19 19 19S20 18.55 20 18V17H21C21 17 22 17 22 12.5C22 9 21 8 21 8Z"/>'),
    post: svg('Hit the woodwork', '<path d="M5 21V4h14v17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    shot: svg('Shot on target', '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  };
  const SECOND = `<span class="cards2">${ICONS.yellow}${ICONS.red}</span>`;   // a second yellow: the yellow with the red in front of it
  const icon = e => ({ goal: ICONS.ball, card: e.card === 'yellow' ? ICONS.yellow : e.card === 'second_yellow' ? SECOND : ICONS.red, woodwork: ICONS.post, shot: ICONS.shot, penalty: ICONS.ball }[e.type] || '•');
  function eventLi(e) {
    // Matches played before 0.49.1 saved a hit post or bar with no player or team: take them from the shot that hit it.
    if (e.type === 'woodwork' && !e.player) { const sh = [...data.events].reverse().find(x => x.type === 'shot' && x.t <= e.t && e.t - x.t < 4); if (sh) e = { ...e, player: sh.player, team: sh.team }; }
    const nm = i => (i ? data.byId[i]?.name || '' : ''), who = nm(e.player || e.scorer);
    const text = e.type === 'goal' ? `Goal! ${esc(nm(e.scorer))}${e.own_goal ? ' (own goal)' : ''}${e.assist ? ` ${ICONS.assist}${esc(nm(e.assist))}` : ''} <b>${e.score?.[0] ?? ''}–${e.score?.[1] ?? ''}</b>`
      : e.type === 'card' ? `${e.card === 'yellow' ? 'Yellow card' : e.card === 'red' ? 'Red card' : 'Second yellow, sent off'}, ${esc(who)}`
      : e.type === 'woodwork' ? `${esc(who)} hits the ${esc(e.part || 'frame')}` : e.type === 'penalty' ? `Penalty, ${esc(who)}` : `Shot on target, ${esc(who)} <small>xG ${(e.xg || 0).toFixed(2)}</small>`;
    return `<li class="tl-row ${e.team === fx.home ? 'h' : 'a'}" data-t="${e.t}"${live() ? '' : ' title="Watch this moment"'}><span class="min">${esc(e.minute)}'</span><span class="ic">${icon(e)}</span><span class="tx">${text} <small>${esc(nameOf(teamOf(season, e.team)))}</small></span></li>`;
  }
  function timelineSection() {
    const list = eventsTo(horizon()).filter(e => KEY_EVENTS.has(e.type) || (e.type === 'shot' && e.on_target)).reverse();
    return `<section class="gc-sec" id="gc-timeline"><h2>Timeline</h2>${list.length ? `<ul class="gc-ev full">${list.map(eventLi).join('')}</ul>` : '<p class="quiet">Nothing has happened yet.</p>'}</section>`;
  }

  // ---------------------------------------------------------------- stats
  function statsSection() {
    const t = horizon(), full = st() === 'ft', S = full ? finalStats() : statsAt(t), h = S[fx.home], a = S[fx.away];
    const tot = (h.hold || 0) + (a.hold || 0), ph = full ? h.poss : tot ? Math.round(100 * h.hold / tot) : 50, pa = full ? a.poss : 100 - ph;
    const pct = (d, n) => (n ? Math.round(100 * d / n) : 0);
    const R = [['Possession', ph, pa, '%'], ['Expected goals (xG)', +h.xg.toFixed(2), +a.xg.toFixed(2)], ['Shots', h.shots, a.shots], ['Shots on target', h.sot, a.sot],
      ['Passes', h.passes, a.passes], ['Pass accuracy', pct(h.done, h.passes), pct(a.done, a.passes), '%'], ['Corners', h.corners, a.corners], ['Tackles won', h.tackles, a.tackles],
      ['Interceptions', h.interceptions, a.interceptions], ['Clearances', h.clearances, a.clearances], ['Saves', h.saves, a.saves], ['Fouls', h.fouls, a.fouls],
      ['Offsides', h.offsides, a.offsides], ['Yellow cards', h.yellow, a.yellow], ['Red cards', h.red, a.red], ...(full && h.km != null ? [['Distance covered (km)', +h.km.toFixed(1), +a.km.toFixed(1)]] : [])];
    const row = ([l, x, y, u = '']) => { const s = x + y || 1; return `<div class="gc-stat"><span class="v">${x}${u}</span><div class="lbl">${esc(l)}<div class="bars"><i class="bh" style="width:${100 * x / s}%"></i><i class="ba" style="width:${100 * y / s}%"></i></div></div><span class="v">${y}${u}</span></div>`; };
    const bp = full ? bestPlayer() : null, bs = bp ? data.stats.players[bp] : null, bi = bp ? data.byId[bp] : null;
    const motm = bp && bi ? { name: bi.name, team: bi.team, r: bs.rating } : null;
    return `<section class="gc-sec" id="gc-stats"><h2>Match statistics${full ? '' : ' so far'}</h2><div class="gc-statrow head"><b>${esc(nameOf(home()))}</b><b>${esc(nameOf(away()))}</b></div>${R.map(row).join('')}</section>
      ${motm ? `<section class="gc-sec"><h2>Man of the match</h2><p class="gc-motm"><b>${esc(motm.name)}</b> <span>${esc(nameOf(teamOf(season, motm.team)))}</span> <span class="rating r-motm">${Number(motm.r).toFixed(1)}</span></p></section>` : ''}`;
  }

  // ---------------------------------------------------------------- line-ups
  function lineupsSection() {
    const t = horizon(), full = st() === 'ft', ev = eventsTo(t), P = data.stats.players, bestId = full ? bestPlayer() : null;
    const liveR = live() ? ratingsAt(data, t) : null;   // a live match: ratings as they stand now, from the events so far
    const badge = (icon, n) => (n ? icon + (n > 1 ? `<i>${n}</i>` : '') : '');
    const goals = id => ev.filter(e => e.type === 'goal' && e.scorer === id && !e.own_goal).length, assists = id => ev.filter(e => e.type === 'goal' && e.assist === id).length;
    const cards = id => ev.filter(e => e.type === 'card' && e.player === id).map(e => (e.card === 'yellow' ? ICONS.yellow : e.card === 'second_yellow' ? SECOND : ICONS.red)).join('');
    const side = c => {
      const team = data.teams[c === fx.home ? 'home' : 'away'];
      return {
        code: c, formation: team.formation, captain: team.captain, items: [...team.lineup],
        extras: id => ({ goals: badge(ICONS.ball, goals(id)), assists: badge(ICONS.assist, assists(id)), cards: cards(id) }),
        rating: id => { const r = full ? P[id]?.rating : liveR?.[id]; return r ? { value: r.toFixed(1), cls: id === bestId ? 'r-motm' : r >= 7 ? 'r-hi' : r < 6 ? 'r-lo' : 'r-mid', motm: id === bestId } : null; },
      };
    };
    return `<section class="gc-sec" id="gc-lineups"><h2>Line-ups</h2>${pitchHtml(side(fx.home), side(fx.away), pitchKit)}${full ? '' : '<p class="gc-note">Ratings update as the match goes (everyone starts on 6.0). The man of the match is picked at full time.</p>'}</section>`;
  }

  // ---------------------------------------------------------------- page
  // One scrolling page: the scoreboard, then the viewer, then what happened (stats, line-ups, timeline). Before kick-off, the preview.
  const liveChance = () => (live() ? chanceSection(winChance(season, fx, { sheets, live: spoilerHidden(fx, season) ? null : liveState(fx, season) })) : '');
  const below = () => `${liveChance()}${statsSection()}${lineupsSection()}${timelineSection()}`;
  let lastHead = '', lastBelow = '', lastPage = '';
  function pageHtml() {
    const waiting = !data && ['live', 'ft'].includes(st());
    return `<div class="gc"${sides()}>${head()}${data ? `${playerCard(st())}<nav class="gc-jump" aria-label="Jump to a section">${live() ? '<a href="#gc-chance">Win chance</a>' : ''}<a href="#gc-stats">Stats</a><a href="#gc-lineups">Line-ups</a><a href="#gc-timeline">Timeline</a></nav><div id="gc-below">${below()}</div>`
      : `${waiting ? `<p class="quiet">${esc(fileError || 'Loading the match…')}</p>` : ''}${previewSection()}`}</div>`;
  }
  const pageKey = () => (data ? '' : pageHtml());
  function draw() {
    liveReactions(fx.id, live());
    unmount();
    main.innerHTML = lastPage = pageHtml();
    lastHead = head(); lastBelow = data && live() ? below() : '';
    mount();
  }

  // ---------------------------------------------------------------- events
  main.addEventListener('click', e => {
    const row = e.target.closest('.tl-row');
    if (!row || live() || !data) return;   // a timeline row: watch that moment
    const t = +row.dataset.t;
    player?.ready?.then(() => player?.jump(t));
    main.querySelector('#mp')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  // Poll: a match that kicks off or finishes changes what the page can show. While it plays, the scoreboard and everything under the
  // viewer keep up; the viewer itself runs on its own and is never redrawn.
  let was = st();
  async function poll(reload) {
    if (reload) { try { season = await loadSeason(); fx = fxOf(season) || fx; } catch { /* keep the last copy */ } }
    const now = st();
    liveReactions(fx.id, now === 'live');
    if (now !== was || (['live', 'ft'].includes(now) && !data)) {
      was = now;
      if (['live', 'ft'].includes(now)) await loadFile();
      draw();
    } else if (data) {
      // Swap a block only when it changed (the score ticking, a new event); an identical one is left alone, so a text selection or
      // your place in the stats is never reset by the 5-second check. And not at all while something in it is selected.
      const selected = window.getSelection?.(); const holding = el => Boolean(selected && !selected.isCollapsed && el?.contains(selected.anchorNode));
      const h = document.querySelector('.gc-head'), hh = head();
      if (h && hh !== lastHead && !holding(h)) { h.outerHTML = hh; lastHead = hh; }
      const b = document.getElementById('gc-below');
      if (b && live()) { const bb = below(); if (bb !== lastBelow && !holding(b)) { b.innerHTML = bb; lastBelow = bb; } }
    } else if (reload) { if (pageKey() !== lastPage) draw(); }
  }

  await loadSheets();
  wear = matchKits(kitsAll, fx.home, fx.away, { [fx.home]: clubColour(fx.home), [fx.away]: clubColour(fx.away) }, kitPicks());   // now that the locked sheets (and the kits they picked) are in
  if (['live', 'ft'].includes(st())) await loadFile();
  draw();
  main.setAttribute('aria-busy', 'false');
  document.title = `${nameOf(home())} v ${nameOf(away())} | vLeague`;
  setInterval(() => poll(false), 5000);
  setInterval(() => poll(true), 30000);
}
