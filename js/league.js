// League (0.5): the table with the manager's club marked, fixtures and results by week, and the top scorers.
// Scores follow the broadcast rules (hidden before kick-off, live while it plays). With spoiler-free results on (0.7),
// a result stays behind "Show score" until revealed, and the table and top players leave hidden results out.
// Redraws every 15 s, reloads every minute.
import { enterPlace } from './shell.js';
import { esc, clubs } from './member.js';
import {
  loadSeason, matchUrl, kickoff, status, shownScore, liveMinute, byKickoff, activeWeek, ladder, leaders,
} from './dashboard-data.js';
import { crest, teamOf, nameOf, fullNameOf, useClubs, day } from './places.js';
import { prefs, fmtTime, spoilerHidden, revealScore } from './prefs.js';

const ctx = await enterPlace('league');
if (ctx) {
  useClubs(await clubs().catch(() => []));
  await prefs().catch(() => null);
  const { main } = ctx;
  let season = ctx.season, week = null;
  let hidden = new Set(), seen = season;   // fixtures whose result is hidden; the season without them
  const mine = ctx.club?.code;

  const weeksList = () => [...new Set(season.fixtures.map(f => f.week))].filter(w => w != null).sort((a, b) => a - b);

  function tableHtml(now) {
    const rows = ladder(seen, now);
    const label = { W: 'Won', D: 'Drew', L: 'Lost' };
    return `<table class="ladder">
      <thead><tr><th scope="col"><abbr title="Position">#</abbr></th><th scope="col" class="club">Club</th><th scope="col"><abbr title="Played">P</abbr></th><th scope="col" class="wide"><abbr title="Won">W</abbr></th><th scope="col" class="wide"><abbr title="Drawn">D</abbr></th><th scope="col" class="wide"><abbr title="Lost">L</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col"><abbr title="Points">Pts</abbr></th><th scope="col" class="form">Form</th></tr></thead>
      <tbody>${rows.map(r => `<tr${r.team.code === mine ? ' class="me"' : ''}${/^#[0-9a-f]{3,6}$/i.test(r.team.colour || '') ? ` style="--tc:${r.team.colour}"` : ''}>
        <td class="pos">${r.rank}</td>
        <th scope="row" class="club"><span class="cl">${crest(r.team, 22)}<span class="nm">${esc(fullNameOf(r.team))}</span></span></th>
        <td>${r.p}</td><td class="wide">${r.w}</td><td class="wide">${r.d}</td><td class="wide">${r.l}</td>
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
        <td class="form"><span class="chips">${r.form.map(o => `<abbr class="res-${o}" title="${label[o]}">${o}</abbr>`).join('')}</span></td></tr>`).join('')}</tbody>
    </table>${hidden.size ? `<p class="spoil">${hidden.size === 1 ? '1 result' : `${hidden.size} results`} hidden · <button type="button" class="link-btn" data-reveal-all>Show all</button></p>` : ''}`;
  }

  function row(fx, now) {
    const st = status(fx, season, now), k = kickoff(fx), h = teamOf(season, fx.home), a = teamOf(season, fx.away);
    const hid = hidden.has(fx.id), sc = hid ? null : shownScore(fx, season, now);
    const left = {
      live: () => `<span class="live"><span class="dot"></span>${liveMinute(fx, season, now)}'</span>`,
      ft: () => 'FT',
      upcoming: () => `<span class="t">${esc(fmtTime(k))}</span>`,
      awaiting: () => 'Playing',
      postponed: () => 'Postponed',
      tba: () => 'TBA',
    }[st]();
    const won = side => (st === 'ft' && sc && (side === 'home' ? sc.home > sc.away : sc.away > sc.home) ? ' won' : '');
    const cls = `fx is-${st}${fx.home === mine || fx.away === mine ? ' me' : ''}`;
    const inner = `<span class="when">${left}</span>
      <span class="team h${won('home')}"><span class="nm">${esc(h.code)}</span>${crest(h, 24)}</span>
      ${hid ? `<button type="button" class="show-score" data-reveal="${esc(fx.id)}" aria-label="Show score: ${esc(nameOf(h))} against ${esc(nameOf(a))}">Show score</button>`
        : `<span class="res${sc ? '' : ' none'}${st === 'live' ? ' is-live' : ''}">${sc ? `<b>${sc.home}</b><b>${sc.away}</b>` : '<span class="v">v</span>'}</span>`}
      <span class="team a${won('away')}">${crest(a, 24)}<span class="nm">${esc(a.code)}</span></span>`;
    const label = `${nameOf(h)} ${sc ? `${sc.home}, ${nameOf(a)} ${sc.away}` : `against ${nameOf(a)}`}`;
    // A hidden result: the row still opens the match (which reveals it), with the Show score button above the link.
    if (hid) return `<div class="${cls} hid"><a class="fx-open" href="${esc(matchUrl(fx))}" data-open="${esc(fx.id)}" aria-label="Watch ${esc(nameOf(h))} against ${esc(nameOf(a))}"></a>${inner}</div>`;
    return st === 'live' || st === 'ft'
      ? `<a class="${cls}" href="${esc(matchUrl(fx))}" aria-label="${esc(label)}, ${st === 'live' ? 'live now' : 'full time'}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }

  function fixturesHtml(now) {
    const weeks = weeksList();
    if (!weeks.length) return '<p class="empty">No fixtures yet.</p>';
    if (!weeks.includes(week)) week = activeWeek(season, now);
    const groups = new Map();
    for (const f of season.fixtures.filter(f => f.week === week).sort(byKickoff)) {
      const k = kickoff(f), key = k ? k.toDateString() : 'tba';
      if (!groups.has(key)) groups.set(key, { label: k ? day(k, now) : 'Date to be confirmed', items: [] });
      groups.get(key).items.push(f);
    }
    const playing = new Set(season.fixtures.filter(f => f.week === week).flatMap(f => [f.home, f.away]));
    const byes = season.fixtures.some(f => f.week === week && f.test) ? [] : season.teams.filter(t => !playing.has(t.code));
    const byeHtml = byes.length ? `<h3 class="day">Bye</h3><div class="byes">${byes.map(t => `<span class="bye">${crest(t, 20)}<span class="nm">${esc(fullNameOf(t))}</span></span>`).join('')}</div>` : '';
    return `<div class="weektabs" role="tablist" aria-label="Weeks">${weeks.map(w => `<button type="button" role="tab" data-week="${esc(w)}" aria-selected="${w === week}"${season.rounds?.[w] ? ` aria-label="${esc(season.rounds[w].label)}" title="${esc(season.rounds[w].label)}"` : ''}>${esc(season.rounds?.[w]?.short ?? w)}</button>`).join('')}</div>
      <div role="tabpanel" aria-label="${esc(season.rounds?.[week]?.label || `Week ${week}`)}">${[...groups.values()].map(g => `<h3 class="day">${esc(g.label)}</h3><div class="fxs">${g.items.map(f => row(f, now)).join('')}</div>`).join('')}${byeHtml}</div>`;
  }

  function leadersHtml(now) {
    const L = leaders(seen, now);
    const list = (title, rows, value) => (rows.length ? `<div class="lead"><h3>${title}</h3><ol>${rows.map(p => `<li${p.team === mine ? ' class="me"' : ''}>${crest(teamOf(season, p.team), 20)}<span class="who">${esc(p.name)}</span><b>${value(p)}</b></li>`).join('')}</ol></div>` : '');
    const html = list('Goals', L.goals, p => p.g) + list('Assists', L.assists, p => p.a);
    return html ? `<section class="sect"><div class="sect-head"><h2>Top players</h2></div><div class="leads">${html}</div></section>` : '';
  }

  function draw() {
    const now = new Date();
    hidden = new Set(season.fixtures.filter(f => spoilerHidden(f, season)).map(f => f.id));
    seen = hidden.size ? { ...season, fixtures: season.fixtures.map(f => (hidden.has(f.id) ? { ...f, result: null } : f)) } : season;
    const scroll = main.querySelector('.weektabs')?.scrollLeft;
    main.innerHTML = `<div class="league">
      <section class="sect table-sect"><div class="sect-head"><h2>Table</h2></div>${tableHtml(now)}</section>
      <section class="sect fixtures-sect"><div class="sect-head"><h2>Matches</h2></div>${fixturesHtml(now)}</section>
      <div class="leaders-sect">${leadersHtml(now)}</div>
    </div>`;
    const tabs = main.querySelector('.weektabs');
    if (tabs) {
      if (scroll != null) tabs.scrollLeft = scroll;
      else {
        const sel = tabs.querySelector('[aria-selected="true"]');
        if (sel) tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.offsetWidth) / 2;
      }
    }
  }

  main.classList.add('league-main');
  main.addEventListener('click', async e => {
    const show = e.target.closest('[data-reveal]'), all = e.target.closest('[data-reveal-all]'), open = e.target.closest('[data-open]');
    if (show || all || open) {
      e.preventDefault();
      const ids = show ? [show.dataset.reveal] : open ? [open.dataset.open] : [...hidden];
      await revealScore(ids);
      if (open) { location.href = open.href; return; }
      for (const id of ids) hidden.delete(id);
      draw();
      if (show) main.querySelector(`a.fx[href$="=${CSS.escape(encodeURIComponent(show.dataset.reveal))}"]`)?.focus();
      return;
    }
    const b = e.target.closest('.weektabs button');
    if (!b) return;
    week = Number(b.dataset.week);
    draw();
    main.querySelector(`.weektabs [data-week="${week}"]`)?.focus();
  });

  if (!season) main.innerHTML = '<p class="empty">The league didn’t load. <a href="league.html">Try again</a></p>';
  else {
    season.fixtures ||= [];
    draw();
    setInterval(() => { if (!document.hidden) draw(); }, 15000);
    setInterval(async () => {
      if (document.hidden) return;
      try { season = await loadSeason(); season.fixtures ||= []; draw(); } catch { /* keep the last copy */ }
    }, 60000);
  }
  main.setAttribute('aria-busy', 'false');
}
