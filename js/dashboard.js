// The dashboard: the league at a glance for guests (managers use League).
// The matchday board leads with the live match (or the next one), then this week's matches, the table,
// league news and the leaders. It redraws every 15 s so live scores tick on, and reloads the data every minute.
import { currentUser, db } from './auth.js';
import { VERSION } from './version.js';
import {
  loadSeason, logoUrl, matchUrl, kickoff, status, shownScore, shownGoals, liveMinute,
  byKickoff, activeWeek, featured, ladder, leaders, guestNews, parseStamp,
} from './dashboard-data.js';

const $ = s => document.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const safeColour = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#475569');
// Dark or white text, whichever reads on a club colour.
function onColour(hex) {
  const c = safeColour(hex).slice(1), n = parseInt(c.length === 3 ? c.replace(/./g, '$&$&') : c, 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) >= 150 ? '#061a38' : '#ffffff';
}

let season = null, week = null, weekPinned = false, newsShown = null;
const lineups = new Map();   // week -> { CODE: locked sheet } once that week's deadline has passed
let deadlines = [];          // line-up deadline per week, set by the league office (0.6)

// ---------- Formatting ----------

const tfmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const dfmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
const sfmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
const time = d => tfmt.format(d).replace(/\s/g, ' ').toLowerCase();
function day(d, now = new Date()) {
  const n = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  return { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }[n] || dfmt.format(d);
}
function until(target, now = new Date()) {
  const m = Math.max(0, Math.ceil((target - now) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  if (m < 1) return 'any moment';
  return [d && `${d} d`, h && `${h} h`, !d && `${m % 60} min`].filter(Boolean).join(' ');
}
function ago(date, now = new Date()) {
  const m = Math.round((now - date) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return sfmt.format(date);
}

const teamOf = code => season.teams.find(t => t.code === code) || { code: code || '?', name: code ? code : 'To be decided', colour: '#475569' };
function crest(team, size) {
  const code = esc(team.code?.slice(0, 3) || '?');
  return `<span class="crest" style="--s:${size}px;--c:${esc(safeColour(team.colour))};--on:${onColour(team.colour)}">`
    + `<img src="${esc(logoUrl(team.code))}" alt="" loading="lazy" onerror="this.parentNode.classList.add('none');this.remove()"><i>${code}</i></span>`;
}

// ---------- Matchday board ----------

function goalLines(fx, side, now) {
  const mine = shownGoals(fx, season, now).filter(g => g.team === (side === 'home' ? fx.home : fx.away));
  if (!mine.length) return '';
  const by = new Map();
  for (const g of mine) {
    const key = (g.scorer_name || 'Unknown') + (g.own_goal ? ' (og)' : '');
    by.set(key, [...(by.get(key) || []), `${g.minute}'`]);
  }
  return `<ul class="scorers">${[...by].map(([n, m]) => `<li>${esc(n)} <span>${m.join(', ')}</span></li>`).join('')}</ul>`;
}

// Line-ups are the team sheets each club locked at the week's deadline (Supabase week_sheets, public from then).
function lineupHtml(fx, now) {
  const d = deadlines.find(x => x.week === fx.week);
  if (!d) return '';
  const opens = new Date(d.locks_at);
  if (now < opens || !d.locked_at) {
    const at = now < opens ? opens : now;
    return `<p class="xi-note">Out at <b>${esc(time(at))}</b>${sameDate(at, now) ? '' : ` ${esc(/^Tomorrow$/.test(day(at, now)) ? 'tomorrow' : `on ${day(at, now)}`)}`}</p>`;
  }
  const week = lineups.get(fx.week);
  if (!week) { fetchLineups(fx.week); return '<p class="xi-note">Loading line-ups…</p>'; }
  const got = { home: toXi(week[fx.home]), away: toXi(week[fx.away]) };
  const side = (code, xi) => {
    const t = teamOf(code);
    const rows = xi ? xi.xi.map(p => `<li><span class="slot">${esc(p.slot)}</span><span>${esc(p.name)}${p.id === xi.captain ? ' <abbr title="Captain">(c)</abbr>' : ''}</span></li>`).join('') : '';
    return `<div class="xi" style="--c:${esc(safeColour(t.colour))}"><h3>${esc(t.name)}${xi?.formation ? ` <span>${esc(xi.formation)}</span>` : ''}</h3>`
      + (xi ? `<ol>${rows}</ol>` : '<p class="xi-note">Picked by the engine</p>') + '</div>';
  };
  return `<div class="xis">${side(fx.home, got.home)}${side(fx.away, got.away)}</div>`;
}
const sameDate = (a, b) => a.toDateString() === b.toDateString();

// A locked sheet as the list the board shows: slots in pitch order, names from the season's players.
const SLOT_ORDER = ['GK', 'LB', 'LWB', 'LCB', 'CB', 'RCB', 'RB', 'RWB', 'LDM', 'CDM', 'RDM', 'LM', 'LCM', 'RCM', 'RM', 'LW', 'CAM', 'RW', 'LST', 'ST', 'RST'];
function toXi(row) {
  if (!row || !Object.keys(row.lineup || {}).length) return null;
  const names = new Map(season.players.map(p => [String(p.id), p.name]));
  const xi = Object.entries(row.lineup).map(([slot, id]) => ({ slot, id: String(id), name: names.get(String(id)) || 'Unknown player' }))
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  return { formation: row.formation || '', xi, captain: row.captain ? String(row.captain) : null };
}

async function fetchLineups(week) {
  if (lineups.has(week)) return;
  lineups.set(week, null);
  try {
    const { data, error } = await (await db()).from('week_sheets').select('*').eq('week', week);
    if (error) throw error;
    lineups.set(week, Object.fromEntries((data || []).map(r => [r.club, r])));
  } catch { lineups.delete(week); return; }
  drawBoard();
}

async function loadDeadlines() {
  try {
    const { data, error } = await (await db()).from('deadlines').select('*');
    if (!error) deadlines = data || [];
  } catch { /* no deadlines: no line-ups section */ }
}

function drawBoard(now = new Date()) {
  const el = $('#board-in');
  $('#board').setAttribute('aria-busy', 'false');
  const f = featured(season, now);
  if (!f) {
    const clubs = season.teams.filter(t => !t.withdrawn);
    const first = season.fixtures.map(kickoff).filter(k => k && k > now).sort((a, b) => a - b)[0];
    el.innerHTML = `<div class="board-empty">
      <h2>Season ${esc(season.season || 1)}</h2>${first ? `<p class="board-sub">Kick-off ${esc(day(first, now))}, ${esc(time(first))}</p>` : ''}
      <ul class="clubs">${clubs.map(t => `<li>${crest(t, 44)}<span>${esc(t.name)}</span></li>`).join('')}</ul>
    </div>`;
    return;
  }
  const { fx, why } = f, k = kickoff(fx), h = teamOf(fx.home), a = teamOf(fx.away);
  const sc = shownScore(fx, season, now);
  let state, centre, action = '';
  if (why === 'live') {
    state = `<span class="live"><span class="dot"></span>Live</span><span class="minute">${liveMinute(fx, season, now)}'</span>`;
    centre = `<span class="score">${sc.home}<i>–</i>${sc.away}</span>`;
    action = `<a class="btn board-btn" href="${esc(matchUrl(fx))}">Watch live</a>`;
    if (f.others) action += `<a class="board-more" href="#matches">${f.others} more live</a>`;
  } else if (why === 'ft') {
    state = `<span class="tag">Full time</span><span class="when">${esc(day(k, now))}</span>`;
    centre = `<span class="score">${sc.home}<i>–</i>${sc.away}</span>`;
    action = `<a class="btn board-btn" href="${esc(matchUrl(fx))}">Watch the replay</a>`;
  } else if (why === 'awaiting') {
    state = `<span class="tag">Kicked off</span>`;
    centre = `<span class="ko">${esc(time(k))}</span>`;
    action = '<p class="board-sub">Waiting for the result</p>';
  } else {
    state = `<span class="tag">Next match</span><span class="when">${esc(day(k, now))}</span>`;
    centre = `<span class="ko">${esc(time(k))}</span>`;
    action = `<p class="board-sub">Kick-off in <b>${esc(until(k, now))}</b></p>`;
  }
  // The round's look (0.13): its banner and accent. Unknown looks fall back to Classic.
  const look = season.looks?.[fx.look]?.settings || {}, board = $('#board');
  board.dataset.look = season.looks?.[fx.look] ? fx.look : 'classic';
  board.style.setProperty('--look', look.accent && /^#[0-9a-f]{6}$/i.test(look.accent) ? look.accent : '');
  const stage = look.banner ? `${look.ornament ? `${esc(look.ornament)} ` : ''}${esc(look.banner)}`
    : fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Grand Final' : esc(fx.round || `Week ${fx.week}`);
  const xiHtml = (why === 'live' || why === 'upcoming' || why === 'awaiting') ? lineupHtml(fx, now) : '';
  el.innerHTML = `
    <div class="board-top"><span class="stage">${stage}</span>${state}</div>
    <div class="fixture">
      <div class="side home" style="--c:${esc(safeColour(h.colour))}">${crest(h, 76)}<p class="name">${esc(h.name)}</p>${goalLines(fx, 'home', now)}</div>
      <div class="centre">${centre}</div>
      <div class="side away" style="--c:${esc(safeColour(a.colour))}">${crest(a, 76)}<p class="name">${esc(a.name)}</p>${goalLines(fx, 'away', now)}</div>
    </div>
    <div class="board-act">${action}</div>
    ${xiHtml ? `<div class="lineups"><h2>Line-ups</h2>${xiHtml}</div>` : ''}`;
}

// ---------- Matches ----------

function weeksList() { return [...new Set(season.fixtures.map(f => f.week))].filter(w => w != null).sort((a, b) => a - b); }

function row(fx, now) {
  const st = status(fx, season, now), k = kickoff(fx), h = teamOf(fx.home), a = teamOf(fx.away);
  const sc = shownScore(fx, season, now);
  const left = {
    live: () => `<span class="live small"><span class="dot"></span>${liveMinute(fx, season, now)}'</span>`,
    ft: () => '<span class="ft">FT</span>',
    upcoming: () => `<span class="t">${esc(time(k))}</span>`,
    awaiting: () => '<span class="ft">Playing</span>',
    postponed: () => '<span class="ft">Postponed</span>',
    tba: () => '<span class="ft">TBA</span>',
  }[st]();
  const mid = sc ? `<b>${sc.home}</b><b>${sc.away}</b>` : '<span class="v">v</span>';
  const win = side => (st === 'ft' && sc && (side === 'home' ? sc.home > sc.away : sc.away > sc.home) ? ' won' : '');
  const inner = `<span class="when">${left}</span>
    <span class="team h${win('home')}"><span class="nm">${esc(h.name)}</span>${crest(h, 24)}</span>
    <span class="res${sc ? '' : ' none'}${st === 'live' ? ' is-live' : ''}">${mid}</span>
    <span class="team a${win('away')}">${crest(a, 24)}<span class="nm">${esc(a.name)}</span></span>`;
  const label = `${h.name} ${sc ? `${sc.home}, ${a.name} ${sc.away}` : `against ${a.name}`}`;
  return (st === 'live' || st === 'ft')
    ? `<a class="fx is-${st}" href="${esc(matchUrl(fx))}" aria-label="${esc(label)}, ${st === 'live' ? 'live now' : 'full time'}">${inner}</a>`
    : `<div class="fx is-${st}">${inner}</div>`;
}

function drawMatches(now = new Date()) {
  const weeks = weeksList(), box = $('#fixtures');
  if (!weeks.length) {
    $('#weeks').hidden = true;
    box.innerHTML = '<p class="empty">No fixtures yet.</p>';
    return;
  }
  if (!weekPinned || !weeks.includes(week)) week = activeWeek(season, now);
  const i = weeks.indexOf(week);
  $('#weeks').hidden = false;
  $('#week-label').textContent = `Week ${week}`;
  $('#week-prev').disabled = i <= 0;
  $('#week-next').disabled = i >= weeks.length - 1;
  const list = season.fixtures.filter(f => f.week === week).sort(byKickoff);
  const groups = new Map();
  for (const f of list) {
    const k = kickoff(f), key = k ? k.toDateString() : 'tba';
    if (!groups.has(key)) groups.set(key, { label: k ? day(k, now) : 'Date to be confirmed', items: [] });
    groups.get(key).items.push(f);
  }
  box.innerHTML = [...groups.values()].map(g => `<h3 class="day">${esc(g.label)}</h3><div class="fxs">${g.items.map(f => row(f, now)).join('')}</div>`).join('');
}

// ---------- Table ----------

function drawTable(now = new Date()) {
  const rows = ladder(season, now);
  const played = rows.some(r => r.p);
  $('#ladder').innerHTML = `<table class="ladder">
    <thead><tr><th scope="col"><abbr title="Position">#</abbr></th><th scope="col" class="club">Club</th><th scope="col"><abbr title="Played">P</abbr></th><th scope="col" class="wide"><abbr title="Won">W</abbr></th><th scope="col" class="wide"><abbr title="Drawn">D</abbr></th><th scope="col" class="wide"><abbr title="Lost">L</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col"><abbr title="Points">Pts</abbr></th></tr></thead>
    <tbody>${rows.map(r => `<tr style="--c:${esc(safeColour(r.team.colour))}">
      <td class="pos">${r.rank}</td>
      <th scope="row" class="club">${crest(r.team, 22)}<span>${esc(r.team.name)}</span></th>
      <td>${r.p}</td><td class="wide">${r.w}</td><td class="wide">${r.d}</td><td class="wide">${r.l}</td>
      <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`).join('')}</tbody>
  </table>${played ? formStrip(rows) : ''}`;
}
function formStrip(rows) {
  const top = rows.filter(r => r.form.length).slice(0, 3);
  if (!top.length) return '';
  const label = { W: 'Won', D: 'Drew', L: 'Lost' };
  return `<div class="form"><h3>Form</h3>${top.map(r => `<p><span>${esc(r.team.name)}</span><span class="chips">${r.form.map(o => `<abbr class="res-${o}" title="${label[o]}">${o}</abbr>`).join('')}</span></p>`).join('')}</div>`;
}

// ---------- News ----------

function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function markdown(text) {
  const t = String(text ?? '').replace(/\{team\}/g, 'your club').replace(/\{manager\}/g, 'manager').replace(/\{due\}/g, 'the deadline');
  return esc(t).split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => (/^[-*] /m.test(p) ? `<ul>${p.split('\n').map(l => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('')}</ul>` : `<p>${inline(p).replace(/\n/g, '<br>')}</p>`)).join('');
}

let sbPosts = [];   // public posts the office wrote (Editor -> News, 0.18)
async function loadPosts() {
  sbPosts = await db().then(c => c.from('news').select('*').eq('kind', 'post').eq('public', true).order('created_at', { ascending: false }).limit(12))
    .then(r => r.data || []).catch(() => sbPosts);
}

function drawNews() {
  const posts = guestNews(season).slice(0, 4);
  const mine = sbPosts.map(r => `<details class="post" style="--c:#1e88e5">
      <summary><span class="post-title">${esc(r.title)}</span><span class="post-meta">${r.pinned ? 'Pinned, ' : ''}${esc(ago(new Date(r.created_at)))}</span></summary>
      <div class="post-body">${markdown(r.body)}</div></details>`);
  if (!posts.length && !mine.length) { $('#newslist').innerHTML = '<p class="empty small">No news yet.</p>'; return; }
  $('#newslist').innerHTML = mine.join('') + posts.map(p => {
    const blocks = p.blocks || [];
    const embed = blocks.find(b => b.type === 'embed') || {};
    const title = embed.title || embed.author?.name || 'League update';
    const sent = parseStamp(p.sent);
    const poll = blocks.find(b => b.type === 'poll');
    const body = [markdown(embed.description),
      ...(embed.fields || []).filter(f => f.name || f.value).map(f => `<p><b>${esc(f.name)}</b><br>${inline(esc(f.value || ''))}</p>`),
      poll ? `<p class="poll">Club poll${poll.question ? `: ${esc(poll.question)}` : ''}</p>` : '',
    ].join('');
    return `<details class="post" style="--c:${esc(safeColour(embed.colour || '#1e88e5'))}">
      <summary><span class="post-title">${esc(title)}</span><span class="post-meta">${p.pinned ? 'Pinned, ' : ''}${sent ? esc(ago(sent)) : ''}</span></summary>
      <div class="post-body">${body}</div>
    </details>`;
  }).join('');
}

// ---------- Leaders ----------

function drawLeaders(now = new Date()) {
  const L = leaders(season, now);
  $('#leaders').hidden = !L.goals.length && !L.assists.length && !L.rating.length;
  const list = (title, rows, value) => (rows.length ? `<div class="lead"><h3>${title}</h3>`
    + `<ol>${rows.map(p => `<li>${crest(teamOf(p.team), 20)}<span class="who">${esc(p.name)}</span><b>${value(p)}</b></li>`).join('')}</ol></div>` : '');
  $('#leaderlists').innerHTML = `<div class="leads">${list('Goals', L.goals, p => p.g)}${list('Assists', L.assists, p => p.a)}${list('Average rating', L.rating, p => p.avg.toFixed(2))}</div>`;
}

// ---------- Page ----------

// The clock tick redraws only what changes with time; news is left alone so an open post stays open.
function drawClock(now = new Date()) { drawBoard(now); drawMatches(now); }
function drawAll() {
  const now = new Date();
  drawClock(now); drawTable(now); drawLeaders(now);
  if (JSON.stringify([season.news || [], sbPosts]) !== newsShown) { newsShown = JSON.stringify([season.news || [], sbPosts]); drawNews(); }
}

async function refresh() {
  try {
    [season] = await Promise.all([loadSeason(), loadDeadlines(), loadPosts()]);
    season.fixtures ||= []; season.teams ||= []; season.players ||= [];
    drawAll();
  } catch (e) {
    console.error(e);
    if (!season) {
      $('#board').setAttribute('aria-busy', 'false');
      $('#board-in').innerHTML = `<div class="board-empty"><h2>The league didn’t load</h2><p><a href="dashboard.html">Try again</a></p></div>`;
    }
  }
}

for (const [id, step] of [['#week-prev', -1], ['#week-next', 1]]) {
  $(id).addEventListener('click', () => {
    const weeks = weeksList(), i = weeks.indexOf(week) + step;
    if (i < 0 || i >= weeks.length) return;
    week = weeks[i]; weekPinned = true;
    drawMatches();
  });
}

$('#version').textContent = `v${VERSION}`;

// Someone signed in (back here from a match page, say) keeps their session: the corner button takes them home.
currentUser().then(user => {
  if (!user) return;
  const a = $('#account');
  a.href = 'home.html';
  a.textContent = 'Home';
});

await refresh();
setInterval(() => { if (season && !document.hidden) drawClock(); }, 15000);
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
