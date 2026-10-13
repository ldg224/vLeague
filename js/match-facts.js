// The match page's Facts tab for a played or live match (WR-38), built from the saved match file (js/match-file.js):
//   factsView(fx, file, ctx) -> html: one card with the Momentum chart beside the Top stats, then the Events card.
//   ctx = { team(code) -> team, club(code) -> clubs row, accent(code) -> '#rrggbb' | '', horizon: match seconds seen so far (Infinity once it is over),
//           live: bool, scoreAt?: unused }
// Momentum: the pressure each side puts on the other's goal (touches in the final third, nearer goal counts more, plus corners and the expected goals of shots), home minus
// away, so the home side fills up from the line in its club colour while it has the better of it and the away side fills down in its own; goals along each side's edge,
// red cards just inside them, 0', HT and FT underneath.
// Top stats: a possession bar, then expected goals, total shots, shots on target and big chances, the leader's figure in a pill in its club colour. (The engine does not
// save touches in the box, so that row is not here; while a match is live there is no possession bar, since it would need the ball's whole history.)
// Events: the goals (score after, assist, penalty, own goal), cards and woodwork in a timeline, the minute in a round badge in the middle, the home side's events on
// the left and the away side's on the right, "+4 minutes added" and "HT 1 - 0" between. Only what the engine really records: no substitutions, VAR or injuries exist.
import { esc } from './member.js';
import { icon } from './icons.js';
import { onColour } from './club-colour.js';

const W = 640, H = 170, MID = 85;   // the chart's own coordinates

const periodsOf = file => file.periods || [];
const totalOf = file => periodsOf(file).reduce((m, p) => Math.max(m, p.end_t || 0), 0) || file.result?.duration_t || 5400;
const surname = n => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; };
const nameOf = (file, id) => file.byId?.[id]?.name || '';

// ---- the chart
// Momentum is the pressure each side puts on the other's goal: every touch in the final third counts for more the nearer it is to goal, a corner a little extra, and a shot
// for its expected goals. Home minus away, smoothed over about a minute and a half: above the line while the home side has the better of it, below while the away side has.
const ATTACKING = new Set(['pass', 'control', 'take_on', 'shot', 'corner', 'free_kick', 'throw_in', 'miscontrol']);
function pressure(fx, file, horizon) {
  const total = totalOf(file), step = 20, n = Math.ceil(total / step) + 1, bins = new Array(n).fill(0);
  const dir = (code, period) => { const left = periodsOf(file).find(p => p.period === period)?.home_attacks === 'left'; return (code === fx.home) === left ? 'left' : 'right'; };   // which goal this side attacks
  for (const e of file.events) {
    if (e.t > horizon) break;
    if (!ATTACKING.has(e.type) || (e.team !== fx.home && e.team !== fx.away) || e.x == null) continue;
    const d = dir(e.team, e.period) === 'left' ? e.x : 105 - e.x;
    let w = d < 42 ? ((42 - d) / 42) ** 2 : 0;
    if (e.type === 'corner') w += 0.5;
    if (e.type === 'shot') w += 0.2 + 4 * (e.xg || 0);
    bins[Math.min(n - 1, Math.floor(e.t / step))] += e.team === fx.home ? w : -w;
  }
  const k = 4.5, kernel = Array.from({ length: Math.ceil(4 * k) * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - Math.ceil(4 * k)) / k) ** 2)), half = Math.ceil(4 * k);
  return { step, total, n, net: bins.map((_, i) => { let s = 0, ws = 0; kernel.forEach((w, j) => { const v = bins[i + j - half]; if (v != null) { s += v * w; ws += w; } }); return ws ? s / ws : 0; }) };
}

function momentum(fx, file, ctx) {
  const { step, total, net } = pressure(fx, file, ctx.horizon), seen = Math.min(total, ctx.horizon), last = Math.floor(seen / step);
  const peak = Math.max(0.0001, ...net.map(Math.abs)), x = t => (t / total) * W, up = MID - 18;
  const area = sign => {
    const pts = net.slice(0, last + 1).map((v, i) => `${x(i * step).toFixed(1)},${(MID - sign * Math.max(0, sign * v) / peak * up).toFixed(1)}`);
    return `M${x(0).toFixed(1)},${MID} L${pts.join(' L')} L${x(last * step).toFixed(1)},${MID} Z`;
  };
  const marks = [];
  for (const e of file.events) {
    if (e.t > ctx.horizon || (e.type !== 'goal' && !(e.type === 'card' && e.card !== 'yellow'))) continue;
    const credit = e.type === 'goal' && e.own_goal ? (e.team === fx.home ? fx.away : fx.home) : e.team, top = credit === fx.home;
    if (e.type === 'goal') marks.push(`<g class="mo-goal" transform="translate(${x(e.t).toFixed(1)} ${top ? 11 : H - 11})"><circle r="6.5"/><path d="m0 -3 2.9 2.1-1.1 3.4h-3.6l-1.1-3.4z"/></g>`);
    else marks.push(`<rect class="mo-red" x="${(x(e.t) - 3).toFixed(1)}" y="${top ? 24 : H - 36}" width="6" height="12" rx="1.5"/>`);
  }
  const ht = periodsOf(file)[0]?.end_t, htX = ht ? x(ht) : W / 2;
  return `<svg class="mo-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Momentum through the match: the home side above the line while it has the better of it, the away side below">
      <line class="mo-axis" x1="0" x2="${W}" y1="${MID}" y2="${MID}"/><line class="mo-ht" x1="${htX.toFixed(1)}" x2="${htX.toFixed(1)}" y1="0" y2="${H}"/>
      <path class="mo-h" d="${area(1)}"/><path class="mo-a" d="${area(-1)}"/>${marks.join('')}</svg>
    <div class="mo-labels" aria-hidden="true"><span>0′</span><span style="left:${(htX / W * 100).toFixed(1)}%">HT</span><span>FT</span></div>`;
}

// ---- the top stats
function topStats(fx, file, ctx) {
  const T = file.stats?.teams;
  if (!T) return '<p class="ts-none">No team stats for this match.</p>';
  const at = side => {   // full-time totals, or what the events show so far while live
    if (!ctx.live) return T[side];
    const code = fx[side], mine = file.events.filter(e => e.team === code && e.t <= ctx.horizon && e.type === 'shot');
    return { xg: mine.reduce((s, e) => s + (e.xg || 0), 0), shots: mine.length, shots_on_target: mine.filter(e => e.on_target).length, big_chances: mine.filter(e => (e.xg || 0) >= 0.3).length };
  };
  const h = at('home'), a = at('away'), pillOf = code => { const c = ctx.accent(code); return c ? `style="--k:${esc(c)};--on:${esc(onColour(c))}"` : ''; };
  const rows = [['Expected goals (xG)', 'xg', 2], ['Total shots', 'shots', 0], ['Shots on target', 'shots_on_target', 0], ['Big chances', 'big_chances', 0]].map(([label, key, dp]) => {
    const l = Number(h[key] || 0), r = Number(a[key] || 0), f = v => (dp ? v.toFixed(dp) : String(v));
    const cell = (v, code, lead) => `<b class="ts-v${lead ? ' is-lead' : ''}"${lead ? ' ' + pillOf(code) : ''}>${f(v)}</b>`;
    return `<li>${cell(l, fx.home, l > r)}<span>${label}</span>${cell(r, fx.away, r > l)}</li>`;
  }).join('');
  const poss = !ctx.live && h.possession != null && a.possession != null
    ? `<div class="ts-poss"><p>Ball possession</p><div class="ts-bar" role="img" aria-label="Possession: home ${Math.round(h.possession)} percent, away ${Math.round(a.possession)} percent"><i class="is-h" style="width:${h.possession}%;${ctx.accent(fx.home) ? `background:${esc(ctx.accent(fx.home))};color:${esc(onColour(ctx.accent(fx.home)))}` : ''}">${Math.round(h.possession)}%</i><i class="is-a" style="width:${a.possession}%;${ctx.accent(fx.away) ? `background:${esc(ctx.accent(fx.away))};color:${esc(onColour(ctx.accent(fx.away)))}` : ''}">${Math.round(a.possession)}%</i></div></div>` : '';
  return `${poss}<ul class="ts-rows">${rows}</ul>`;
}

// ---- the events
function events(fx, file, ctx) {
  const shots = new Map(file.events.filter(e => e.type === 'shot').map(e => [e.id, e]));
  const list = [];
  for (const e of file.events) {
    if (e.t > ctx.horizon) break;
    if (e.type === 'goal') {
      const own = e.own_goal, side = (own ? e.team === fx.home : e.team === fx.away) ? 'away' : 'home', s = shots.get(e.shot), pen = s?.subtype === 'penalty';
      const assist = !own && e.assist ? `Assist: ${surname(nameOf(file, e.assist))}` : '';
      list.push({ t: e.t, minute: e.minute, side, icon: 'ball', who: nameOf(file, e.scorer), sub: [Array.isArray(e.score) ? `${e.score[0]} – ${e.score[1]}` : '', own ? 'Own goal' : pen ? 'Penalty' : '', assist].filter(Boolean).join(' · '), goal: true });
    } else if (e.type === 'card') {
      const red = e.card !== 'yellow';
      list.push({ t: e.t, minute: e.minute, side: e.team === fx.home ? 'home' : 'away', icon: red ? 'red' : 'yellow', who: nameOf(file, e.player), sub: e.card === 'second_yellow' ? 'Second yellow card' : red ? 'Red card' : 'Yellow card' });
    } else if (e.type === 'woodwork') {
      list.push({ t: e.t, minute: e.minute, side: e.team === fx.home ? 'home' : 'away', icon: 'wood', who: nameOf(file, e.player), sub: e.part === 'bar' ? 'Hit the crossbar' : 'Hit the post' });
    } else if (e.type === 'added_time') {
      list.push({ t: e.t, divider: `+${e.minutes} ${e.minutes === 1 ? 'minute' : 'minutes'} added` });
    } else if (e.type === 'period_end') {
      const goals = file.events.filter(g => g.type === 'goal' && g.t <= e.t), score = { home: 0, away: 0 };
      for (const g of goals) score[(g.own_goal ? g.team === fx.home : g.team === fx.away) ? 'away' : 'home']++;
      list.push({ t: e.t + 0.01, divider: `${e.period === 1 ? 'HT' : 'FT'} ${score.home} – ${score.away}`, strong: true });
    }
  }
  const ic = { ball: icon('ball'), yellow: '<i class="ev-card is-y"></i>', red: '<i class="ev-card is-r"></i>', wood: icon('map-pin') };
  const row = it => it.divider
    ? `<li class="ev-div${it.strong ? ' is-strong' : ''}"><span>${esc(it.divider)}</span></li>`
    : `<li class="ev-row is-${it.side}${it.goal ? ' is-goal' : ''}"><div class="ev-text">${it.who ? `<b>${esc(it.who)}</b>` : ''}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>`
      + `<span class="ev-badge">${esc(it.minute)}′</span><span class="ev-ic">${ic[it.icon]}</span></li>`;
  return list.length ? `<ol class="ev-list" aria-label="Match events">${list.map(row).join('')}</ol>` : '<p class="ev-none">No goals, cards or other events yet.</p>';
}

export function factsView(fx, file, ctx) {
  return `<section class="lg-card mf2" aria-labelledby="mo-h"><div class="mf2-cols">
      <div class="mf2-col"><h2 id="mo-h">Momentum</h2><div class="mo">${momentum(fx, file, ctx)}</div></div>
      <div class="mf2-col"><h2>Top stats</h2>${topStats(fx, file, ctx)}</div></div>
      <a class="mf2-all" href="#stats">All stats</a></section>
    <section class="lg-card ev" aria-labelledby="ev-h"><div class="ev-head"><h2 id="ev-h">Events</h2></div>${events(fx, file, ctx)}</section>`;
}
