// The match page (website revamp, WR-31): one match at match.html?id=<fixture id>, signed-in only (WR-02). The league header card, then a match
// header card in FotMob's order: the round, a strip with the date and the ground, the two clubs with the middle block (kick-off and a live
// countdown, or the score and "Full time", or LIVE and the minute), the scorers under each club, then the tabs.
//   Upcoming: Preview, Head-to-Head.   Finished or live: Facts, Lineup, Stats, Head-to-Head.   (no Table, no Commentary)
// Each tab has its own address (match.html?id=7#lineup). The tab cards arrive card by card (WR-32 onwards); until then a tab says so.
// Spoiler-free mode: a result, the scorers and the red cards stay out of the header until the viewer chooses "Show".
// Localhost only, to look at it without signing in: match.html?id=...&preview&mine=TUR&theme=light
import { chrome, esc, clubs, crestUrl } from './member.js';
import { currentUser, myProfile } from './auth.js';
import { paintClub } from './shell.js';
import { mountSubFrame } from './frame.js';
import { loadSeason, kickoff, status, shownScore, shownGoals, liveMinute, liveState } from './dashboard-data.js';
import { crest, teamOf, nameOf, fullNameOf, useClubs, time } from './places.js';
import { prefs, spoilerHidden, revealScore } from './prefs.js';
import { paint, quietly } from './paint.js';
import { icon } from './icons.js';
import { accentFor, isHex } from './club-colour.js';

chrome();
const main = document.getElementById('main');
const q = new URLSearchParams(location.search), id = q.get('id');
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && q.has('preview');
const TABS = {
  upcoming: [['preview', 'Preview'], ['h2h', 'Head-to-Head']],
  played: [['facts', 'Facts'], ['lineup', 'Lineup'], ['stats', 'Stats'], ['h2h', 'Head-to-Head']],
};
const SOON = {
  preview: 'The predicted line-ups, form and insights for this match are coming.',
  facts: 'The momentum chart, top stats and events for this match are coming.',
  lineup: 'The line-ups for this match are coming.',
  stats: 'The full team stats for this match are coming.',
  h2h: 'The meetings between these two clubs are coming.',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const when = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time(d)}`;
const countdown = ms => {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), p = n => String(n).padStart(2, '0');
  return `${d ? `${d}d ` : ''}${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
};

let season = null, fx = null, rows = [], mine = null;
try {
  const user = preview ? { id: 'preview' } : await currentUser().catch(() => null);
  if (!user) { location.replace('index.html?signin'); await new Promise(() => {}); }   // signed-out visitors only see sign-in (WR-02)
  if (preview && q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  [rows, season] = await Promise.all([clubs().catch(() => []), loadSeason().catch(() => null)]);
  useClubs(rows);
  if (!preview) await prefs().catch(() => null);
  const prof = preview ? { role: q.has('office') ? 'office' : 'manager', club: q.get('mine') } : await myProfile().catch(() => null);
  mine = rows.find(c => c.code === prof?.club) || null;
  paintClub(mine);
  document.body.classList.toggle('has-club', Boolean(mine));
  mountSubFrame(document.getElementById('frame'), { office: prof?.role === 'office', crest: mine?.crest_path ? crestUrl(mine.crest_path) : '', here: '', title: '', back: { href: 'league.html#fixtures', label: 'Matches' } });
  fx = season?.fixtures.find(f => String(f.id) === String(id)) || null;
  if (!fx) main.innerHTML = '<div class="mh"><section class="lg-card"><p class="empty">That match couldn’t be found. <a href="league.html#fixtures">See all matches</a></p></section></div>';
  else start();
} catch (e) {
  main.innerHTML = `<p class="empty">The match page didn’t load. ${esc(e.message || '')} <a href="match.html?id=${esc(id)}">Try again</a></p>`;
}
main.setAttribute('aria-busy', 'false');

function start() {
  const home = teamOf(season, fx.home), away = teamOf(season, fx.away);
  const club = code => rows.find(c => c.code === code);
  const state = () => {
    const now = new Date(), st = status(fx, season, now);
    return { now, st, played: st === 'live' || st === 'ft', hid: spoilerHidden(fx, season, now) };
  };
  const tabsFor = st => (st === 'live' || st === 'ft' ? TABS.played : TABS.upcoming);
  const tabNow = st => { const t = location.hash.slice(1), list = tabsFor(st); return list.some(x => x[0] === t) ? t : list[0][0]; };
  const redsOf = code => (fx.result?.cards || []).filter(c => c.team === code && (c.card === 'red' || c.card === 'second_yellow')).length;

  // ---- the middle block
  const watch = st => `<a class="mh-watch" href="game.html?id=${esc(fx.id)}">${icon('play')}<span>${st === 'live' ? 'Watch live' : 'Watch'}</span></a>`;   // TEMP until WR-41 moves the viewer in
  const middle = ({ now, st, played, hid }) => {
    if (played && hid) {
      return `<strong class="mh-score is-hidden" aria-label="Score hidden"><b>–</b><i>·</i><b>–</b></strong><span class="mh-sub">${st === 'live' ? 'Live' : 'Full time'}</span>
        <p class="mh-hide">Results hidden · <button type="button" data-reveal>Show</button></p>${watch(st)}`;
    }
    if (played) {
      const sc = shownScore(fx, season, now), live = st === 'live' ? liveState(fx, season, now) : null;
      const reds = side => (live ? live.reds[side] : redsOf(side === 'home' ? fx.home : fx.away));
      const mark = n => (n ? `<span class="mh-reds" aria-label="${n === 1 ? 'Sent off' : `${n} sent off`}">${'<i></i>'.repeat(Math.min(n, 3))}</span>` : '<span></span>');
      return `<strong class="mh-score${live ? ' is-live' : ''}"><b>${sc.home}</b><i>–</i><b>${sc.away}</b></strong>
        <span class="mh-sub${live ? ' is-live' : ''}">${live ? `LIVE ${liveMinute(fx, season, now) ?? ''}′` : 'Full time'}</span>
        ${reds('home') || reds('away') ? `<span class="mh-redrow">${mark(reds('home'))}${mark(reds('away'))}</span>` : ''}${watch(st)}`;
    }
    if (st === 'postponed') return '<strong class="mh-ko">Postponed</strong>';
    const k = kickoff(fx);
    if (!k) return '<strong class="mh-ko">TBA</strong>';
    return `<strong class="mh-ko">${esc(time(k))}</strong><span class="mh-sub mh-count" data-until="${+k}">${st === 'awaiting' ? 'Kicking off' : countdown(k - now)}</span>`;
  };

  // ---- scorers under each club, with a ball in the middle
  const scorers = ({ now, played, hid }) => {
    if (!played || hid) return '';
    const goals = shownGoals(fx, season, now);
    if (!goals.length) return '';
    const side = code => goals.filter(g => (g.own_goal ? g.team !== code : g.team === code)).sort((a, b) => a.t - b.t);
    const line = g => `<li>${esc(g.scorer_name || 'Goal')} <small>${esc(g.minute)}′${g.own_goal ? ' (og)' : ''}</small></li>`;
    return `<div class="mh-scorers"><ul class="is-home">${side(fx.home).map(line).join('')}</ul><span class="mh-ball">${icon('ball')}</span><ul class="is-away">${side(fx.away).map(line).join('')}</ul></div>`;
  };

  const header = s => {
    const k = kickoff(fx), ground = club(fx.home)?.stadium || '', list = tabsFor(s.st), cur = tabNow(s.st);
    const side = (code, t, cls) => `<a class="mh-team ${cls}" href="team.html?c=${esc(code)}"><b class="mh-name"><span class="mh-full">${esc(fullNameOf(t))}</span><span class="mh-short">${esc(nameOf(t))}</span></b>${crest(t, 88)}</a>`;
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const acc = code => { const c = club(code)?.colour || teamOf(season, code).colour; return isHex(c) ? accentFor(c, theme) : ''; };
    const ghost = (code, t, cls) => `<span class="mh-ghost ${cls}" aria-hidden="true"><b class="mh-full">${esc(fullNameOf(t))}</b><b class="mh-code">${esc(code)}</b></span>`;
    return `<section class="lg-card mh-head" aria-label="Match" style="${acc(fx.home) ? `--ha:${acc(fx.home)};` : ''}${acc(fx.away) ? `--aa:${acc(fx.away)};` : ''}">
      <p class="mh-round">${esc(fx.round || `Round ${fx.week}`)}</p>
      <p class="mh-info">${k ? `<span>${icon('calendar-days')}${esc(when(k))}</span>` : ''}${ground ? `<span>${icon('map-pin')}${esc(ground)}</span>` : ''}</p>
      <div class="mh-teams">${ghost(fx.home, home, 'is-home')}${ghost(fx.away, away, 'is-away')}${side(fx.home, home, 'is-home')}<div class="mh-mid">${middle(s)}</div>${side(fx.away, away, 'is-away')}</div>
      ${scorers(s)}
      <nav class="mh-tabs" aria-label="Match">${list.map(([t, l]) => `<a href="#${t}"${t === cur ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
    </section>`;
  };
  const body = s => `<section class="lg-card mh-soon"><p class="empty">${esc(SOON[tabNow(s.st)])}</p></section>`;

  const draw = () => {
    const s = state();
    document.title = `${nameOf(home)} v ${nameOf(away)} | vLeague`;
    paint(main, `<div class="mh">${header(s)}<div id="mh-body">${body(s)}</div></div>`);
  };
  draw();
  addEventListener('hashchange', draw);
  main.addEventListener('click', async e => {
    if (!e.target.closest('[data-reveal]')) return;
    await revealScore([fx.id]).catch(() => {});   // a person's own click, so it redraws straight away
    draw();
  });
  // The countdown ticks in place; the page redraws (quietly) only when the match changes state (kick-off, live, full time) or a live score moves.
  const key = () => { const s = state(); return JSON.stringify([s.st, s.hid, s.played && !s.hid ? shownScore(fx, season, s.now) : null, s.st === 'live' ? liveMinute(fx, season, s.now) : null]); };
  let last = key();
  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    main.querySelectorAll('[data-until]').forEach(el => { if (now < Number(el.dataset.until)) el.textContent = countdown(Number(el.dataset.until) - now); });
    const k = key();
    if (k !== last) { last = k; quietly(draw); }
  }, 1000);
}
