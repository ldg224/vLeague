// Matches (0.34): every game of a round as a card, in the style of a football app's match list. Each card shows the two clubs
// (league position, form), the score or kick-off time, the win chance (js/match-model.js), the stadium and each club's home or
// away record. A card opens the Game centre (game.html), where the match is watched and its full statistics live.
// Scores follow the same rules as League: hidden before kick-off, live while it plays, and behind "Show score" with
// spoiler-free results on. Redraws every 15 s, reloads every minute.
import { enterPlace } from './shell.js';
import { paint } from './paint.js';
import { esc, clubs } from './member.js';
import { loadSeason, matchUrl, kickoff, status, shownScore, liveMinute, liveState, byKickoff, activeWeek } from './dashboard-data.js';
import { crest, teamOf, nameOf, fullNameOf, useClubs, day } from './places.js';
import { prefs, fmtTime, spoilerHidden, revealScore } from './prefs.js';
import { db } from './auth.js';
import { winChance, percents, clubSummary } from './match-model.js';
import { weekBar, wireWeekBar, weekBarArrow } from './week-tabs.js';

const ctx = await enterPlace('matches');
if (ctx) {
  const rows = await clubs().catch(() => []);
  useClubs(rows);
  await prefs().catch(() => null);
  const { main } = ctx, mine = ctx.club?.code;
  let onlyMine = false; try { onlyMine = !!mine && localStorage.getItem('vleague-matches-mine') === '1'; } catch { /* storage blocked */ }
  let season = ctx.season, week = null, sheets = [], hidden = new Set(), seen = season;
  const stadium = code => rows.find(c => c.code === code)?.stadium || '';
  const loadSheets = async () => { try { const r = await (await db()).from('week_sheets').select('week, club, lineup').range(0, 999); sheets = r.data || []; } catch { /* the model falls back to squads */ } };

  const weeksList = () => [...new Set(season.fixtures.map(f => f.week))].filter(w => w != null).sort((a, b) => a - b);
  const chips = form => `<span class="chips">${form.map(o => `<abbr class="res-${o}" title="${{ W: 'Won', D: 'Drew', L: 'Lost' }[o]}">${o}</abbr>`).join('') || '<i class="mc-none">No games yet</i>'}</span>`;
  const rec = r => `${r.w}-${r.d}-${r.l}`;

  function side(code, fx, now, cls) {
    const t = teamOf(season, code), s = clubSummary(seen, code, now);
    return `<div class="mc-team ${cls}${code === mine ? ' me' : ''}">${crest(t, 40)}<b class="nm">${esc(nameOf(t))}</b>
      <small>${s.p && s.rank ? `${s.rank}${['th', 'st', 'nd', 'rd'][(s.rank % 100 > 10 && s.rank % 100 < 14) || s.rank % 10 > 3 ? 0 : s.rank % 10]} · ${s.pts} pts` : 'No games yet'}</small>${chips(s.form)}</div>`;
  }

  function card(fx, now) {
    const st = status(fx, season, now), k = kickoff(fx), hid = hidden.has(fx.id), sc = hid ? null : shownScore(fx, season, now);
    const badge = st === 'live' ? `<span class="live"><span class="dot"></span>${liveMinute(fx, season, now)}'</span>` : { ft: 'Full time', upcoming: 'Upcoming', awaiting: 'Kicking off', postponed: 'Postponed', tba: 'Date to be confirmed' }[st];
    const mid = st === 'live' || st === 'ft'
      ? (hid ? `<button type="button" class="show-score" data-reveal="${esc(fx.id)}">Show score</button>` : `<strong class="mc-score${st === 'live' ? ' is-live' : ''}">${sc.home}<i>–</i>${sc.away}</strong>`)
      : `<strong class="mc-ko">${k ? esc(fmtTime(k)) : 'TBA'}</strong>`;
    // Win chance (before the match, or while it is being played). A finished match shows its result instead.
    let chance = '';
    if (st === 'upcoming' || st === 'awaiting' || st === 'tba' || st === 'live') {
      const w = winChance(season, fx, { sheets, now, live: hid ? null : liveState(fx, season, now) }), [h, d, a] = percents(w), ht = nameOf(teamOf(season, fx.home)), at = nameOf(teamOf(season, fx.away));
      chance = `<div class="mc-chance" role="group" aria-label="Win chance: ${esc(ht)} ${h} percent, draw ${d} percent, ${esc(at)} ${a} percent">
        <div class="mc-bar"><i class="bh" style="flex:${h}"></i><i class="bd" style="flex:${d}"></i><i class="ba" style="flex:${a}"></i></div>
        <div class="mc-pcts"><span><b>${h}%</b> ${esc(ht)}</span><span><b>${d}%</b> Draw</span><span><b>${a}%</b> ${esc(at)}</span></div>
        <small>Win chance${w.live ? ', updating live' : ''} · ${w.basis === 'line-ups' ? 'from the locked line-ups' : w.basis === 'squads' ? 'from squad ratings' : 'early days, so mostly league averages'}, results, form and home ground · expected goals ${w.xg[0].toFixed(1)} to ${w.xg[1].toFixed(1)}</small></div>`;
    }
    const hs = clubSummary(seen, fx.home, now), as = clubSummary(seen, fx.away, now), sd = stadium(fx.home);
    const foot = `<div class="mc-foot"><span class="mc-venue">${sd ? `<b>Stadium</b> ${esc(sd)}` : `<b>Home</b> ${esc(fullNameOf(teamOf(season, fx.home)))}`}</span>
      <span><b>${esc(teamOf(season, fx.home).code)}</b> at home ${rec(hs.home)}</span><span><b>${esc(teamOf(season, fx.away).code)}</b> away ${rec(as.away)}</span></div>`;
    const label = `${fullNameOf(teamOf(season, fx.home))} against ${fullNameOf(teamOf(season, fx.away))}`;
    const hc = (rows.find(c => c.code === fx.home)?.colour || teamOf(season, fx.home)?.colour), ac = (rows.find(c => c.code === fx.away)?.colour || teamOf(season, fx.away)?.colour);
    return `<article class="mc is-${st}${fx.home === mine || fx.away === mine ? ' me' : ''}"${hc ? ` style="--hc:${esc(hc)};${ac && ac.toLowerCase() !== hc.toLowerCase() ? `--ac:${esc(ac)}` : ''}"` : ''}>
      <a class="mc-open" href="${esc(matchUrl(fx))}" data-open="${esc(fx.id)}" aria-label="Open ${esc(label)} in the Game centre"></a>
      <header><span class="mc-when">${fx.test ? '<span class="mc-test">TEST MATCH</span>' : ''}</span><span class="mc-state">${badge}</span></header>
      <div class="mc-teams">${side(fx.home, fx, now, 'h')}<div class="mc-mid">${mid}</div>${side(fx.away, fx, now, 'a')}</div>
      ${chance}${foot}</article>`;
  }

  function draw() {
    const now = new Date(), weeks = weeksList();
    hidden = new Set(season.fixtures.filter(f => spoilerHidden(f, season)).map(f => f.id));
    seen = hidden.size ? { ...season, fixtures: season.fixtures.map(f => (hidden.has(f.id) ? { ...f, result: null } : f)) } : season;
    if (!weeks.length) { paint(main, '<h1 class="page-title" tabindex="-1">Matches</h1><p class="empty">No fixtures yet.</p>'); return; }
    if (!weeks.includes(week)) week = activeWeek(season, now);
    const scroll = main.querySelector('.weektabs')?.scrollLeft;
    const groups = new Map();
    for (const f of season.fixtures.filter(f => f.week === week && (!onlyMine || f.home === mine || f.away === mine)).sort(byKickoff)) {
      const k = kickoff(f), key = k ? k.toDateString() : 'tba';
      if (!groups.has(key)) groups.set(key, { label: k ? day(k, now) : 'Date to be confirmed', items: [] });
      groups.get(key).items.push(f);
    }
    const painted = paint(main, `<div class="matches"><div class="mc-titlebar"><h1 class="page-title" tabindex="-1">Matches</h1>${mine ? `<button type="button" class="mc-filter" data-mine aria-pressed="${onlyMine}">My club only</button>` : ''}</div>
      ${weekBar(weeks.map(w => `<button type="button" role="tab" data-week="${esc(w)}" aria-selected="${w === week}">${esc(season.rounds?.[w]?.short || w)}</button>`).join(''), 'Rounds')}
      <p class="mc-round">${esc(season.rounds?.[week]?.label || `Week ${week}`)}</p>
      ${groups.size ? '' : `<p class="empty">${onlyMine ? 'Your club isn’t playing this round. <button type="button" class="link-btn" data-mine>Show every match</button>' : 'No matches in this round yet.'}</p>`}${[...groups.values()].map(g => `<h2 class="day">${esc(g.label)}</h2><div class="mcs">${g.items.map(f => card(f, now)).join('')}</div>`).join('')}</div>`);
    if (painted) wireWeekBar(main, scroll);
  }

  main.classList.add('league-main');
  main.addEventListener('click', async e => {
    const show = e.target.closest('[data-reveal]');
    if (show) { e.preventDefault(); await revealScore([show.dataset.reveal]); draw(); return; }
    if (e.target.closest('[data-mine]')) { onlyMine = !onlyMine; try { localStorage.setItem('vleague-matches-mine', onlyMine ? '1' : '0'); } catch { /* storage blocked */ } draw(); return; }
    if (weekBarArrow(main, e)) return;
    const b = e.target.closest('.weektabs button');
    if (!b) return;
    week = Number(b.dataset.week); draw();
    main.querySelector(`.weektabs [data-week="${week}"]`)?.focus();
  });

  if (!season) paint(main, '<p class="empty">The league didn’t load. <a href="matches.html">Try again</a></p>');
  else {
    season.fixtures ||= [];
    await loadSheets();
    draw();
    setInterval(() => { if (!document.hidden) draw(); }, 15000);
    setInterval(async () => {
      if (document.hidden) return;
      try { season = await loadSeason(); season.fixtures ||= []; await loadSheets(); draw(); } catch { /* keep the last copy */ }
    }, 60000);
  }
  main.setAttribute('aria-busy', 'false');
}
