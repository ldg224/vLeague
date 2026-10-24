// The match page's shot map (Stats tab), built on FotMob's: one side's shots on a half pitch with the goal at the bottom, a hollow ring for a shot that missed or was
// blocked, a lighter filled dot for a save, a solid dot for a goal, and a card for the shot you pick (shot type, situation, result, xG and xGOT with a little goal
// showing where it crossed the line). Filter pills with counts sit below (Goals, Regular play, Set piece, Header ... Inside / Outside the box), and a switch turns the
// pitch into the goal-mouth view. Under the map: Shots, Goals, xG and xGOT.
//   shotMapCard(fx, file, ctx, st) -> html.  ctx = { team(code), club(code), crest(team, px), accent(code) -> '#rrggbb' | '', horizon }
//   st = { team, sel, filter, view } is kept by the page (so a redraw keeps the pick); shotMapClick(target, st, fx) changes it and says whether the click was ours.
// xG is the engine's own. The engine does not rate shot placement, so xGOT (xG once the shot is on target) is worked out here from where the shot crossed the goal line:
// a shot in the corners is worth more than one at the keeper. It is an estimate, only for shots on target (as FotMob), and shows as "–" for the rest.
import { esc } from './member.js';

const HALF = 52.5, GOAL_W = 7.32, GOAL_H = 2.44, MID = 34;
const BOX = { y0: 13.84, y1: 54.16, depth: 16.5 };
const RESULT = { goal: 'Goal', saved: 'Saved', blocked: 'Blocked', off_target: 'Off target', woodwork: 'Hit the woodwork' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// xG after the shot is on target, from where it crossed the line (end_y across the goal, end_z up it).
export function xgot(e) {
  if (!(e.on_target || e.outcome === 'goal' || e.outcome === 'saved') || e.end_y == null) return null;
  const lat = clamp(Math.abs(e.end_y - MID) / (GOAL_W / 2), 0, 1), up = clamp((e.end_z ?? 0.8) / GOAL_H, 0, 1);
  const q = Math.min(1, Math.hypot(lat * 0.8, Math.max(0, up - 0.2) * 1.2));
  return clamp((e.xg || 0) * (0.7 + 1.8 * q), (e.xg || 0) * 0.6, 0.97);
}

// One side's shots, turned to attack the same goal, each with what the card and the filters need.
export function shotsOf(file, code, horizon = Infinity) {
  const ev = file.events || [], out = [];
  for (const e of ev) {
    if (e.type !== 'shot' || e.team !== code || e.x == null || e.t > horizon) continue;
    const flip = e.x <= HALF, nx = flip ? 105 - e.x : e.x, ny = flip ? 68 - e.y : e.y;
    const prior = ev.filter(p => p.type === 'pass' && p.poss === e.poss && p.t < e.t && e.t - p.t < 10).pop()?.subtype;
    const situation = e.subtype === 'penalty' ? 'Penalty' : e.subtype === 'free_kick' ? 'Free kick' : prior === 'corner' ? 'Corner' : prior === 'free_kick' ? 'Set piece' : prior === 'throw' ? 'Throw-in set piece' : 'Regular play';
    const head = e.body === 'head' || e.subtype === 'header';
    const type = e.subtype === 'penalty' ? 'Penalty' : e.subtype === 'free_kick' ? 'Free kick' : head ? 'Header' : e.subtype === 'volley' ? 'Volley' : 'Foot';
    out.push({ id: String(e.id), e, nx, ny, xg: e.xg || 0, xgot: xgot(e), result: e.outcome || (e.on_target ? 'saved' : 'off_target'), minute: e.minute, situation, type, head, inBox: nx >= HALF * 2 - BOX.depth && ny >= BOX.y0 && ny <= BOX.y1 });
  }
  return out;
}

const SETPIECE = new Set(['Set piece', 'Free kick', 'Corner', 'Throw-in set piece']);
const FILTERS = [
  ['goals', 'Goals', s => s.result === 'goal'],
  ['regular', 'Regular play', s => s.situation === 'Regular play'],
  ['set', 'Set piece', s => SETPIECE.has(s.situation)],
  ['pen', 'Penalty', s => s.situation === 'Penalty'],
  ['head', 'Header', s => s.head],
  ['foot', 'Foot', s => s.type === 'Foot' || s.type === 'Volley'],
  ['in', 'Shots inside box', s => s.inBox],
  ['out', 'Shots outside box', s => !s.inBox],
];

const f2 = v => (v == null ? '–' : Number(v).toFixed(2));
const cls = s => (s.result === 'goal' ? 'is-goal' : s.result === 'saved' ? 'is-save' : 'is-miss');
const r = s => 0.9 + 2.4 * Math.sqrt(s.xg);

const PITCH = '<g class="sm-lines"><rect x="0" y="0" width="68" height="52.5" rx="3"/><path d="M13.84 52.5V36h40.32v16.5M24.84 52.5V47h18.32v5.5M26.69 36a9.15 9.15 0 0 0 14.62 0"/><circle cx="34" cy="41.5" r=".5"/><path class="sm-goal" d="M30.34 52.5v1.6h7.32v-1.6"/></g>';

function pitchSvg(list, sel) {
  const dots = list.map(s => `<circle class="sm-dot ${cls(s)}${s.id === sel ? ' is-sel' : ''}" cx="${s.ny.toFixed(2)}" cy="${(s.nx - HALF).toFixed(2)}" r="${r(s).toFixed(2)}" data-sm-shot="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`${s.minute}′, ${RESULT[s.result] || s.result}, ${f2(s.xg)} xG`)}"/>`);
  const ring = list.find(s => s.id === sel);
  return `<svg class="sm-pitch" viewBox="-2 -2 72 58.5" role="group" aria-label="Shot map">${PITCH}${ring ? `<circle class="sm-ring" cx="${ring.ny.toFixed(2)}" cy="${(ring.nx - HALF).toFixed(2)}" r="${(r(ring) + 1.3).toFixed(2)}"/>` : ''}${dots.join('')}</svg>`;
}

// Where each shot crossed the goal line, seen from the pitch (the goal is 7.32 m by 2.44 m).
function goalSvg(list, sel, tiny) {
  const gx = s => (s.e.end_y - (MID - GOAL_W / 2)) * 10, gy = s => (GOAL_H - clamp(s.e.end_z ?? 0, 0, 3)) * 10;
  const dots = list.filter(s => s.e.end_y != null).map(s => `<circle class="sm-dot ${cls(s)}${s.id === sel ? ' is-sel' : ''}" cx="${gx(s).toFixed(1)}" cy="${gy(s).toFixed(1)}" r="${tiny ? 4 : (r(s) * 1.5).toFixed(1)}"${tiny ? '' : ` data-sm-shot="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`${s.minute}′, ${RESULT[s.result] || s.result}`)}"`}/>`);
  const net = Array.from({ length: 7 }, (_, i) => `M${(i + 1) * 9.15} 0V24.4`).join('') + Array.from({ length: 3 }, (_, i) => `M0 ${(i + 1) * 6.1}H73.2`).join('');
  return `<svg class="${tiny ? 'sm-mini' : 'sm-mouth'}" viewBox="-14 -12 101.2 ${tiny ? 42 : 48}" aria-hidden="${tiny}"><path class="sm-net" d="${net}"/><path class="sm-frame" d="M0 24.4V0h73.2v24.4"/><path class="sm-ground" d="M-14 24.4H87.2"/>${dots.join('')}</svg>`;
}

export function shotMapCard(fx, file, ctx, st) {
  const code = st.team === fx.away ? fx.away : fx.home, all = shotsOf(file, code, ctx.horizon), t = ctx.team(code), c = ctx.club(code);
  const flt = FILTERS.find(f => f[0] === st.filter), list = flt ? all.filter(flt[2]) : all;
  const sel = list.find(s => s.id === st.sel) || list.find(s => s.result === 'goal') || [...list].sort((a, b) => b.xg - a.xg)[0] || null;
  const pill = k => { const col = ctx.accent(k); return col ? ` style="--k:${esc(col)}"` : ''; };
  const side = k => { const tm = ctx.team(k), cl = ctx.club(k); return `<button type="button" class="sm-team${k === code ? ' is-on' : ''}" data-sm-team="${esc(k)}" aria-pressed="${k === code}"${pill(k)}>${ctx.crest(tm, 22)}<b>${esc(cl?.short_name || cl?.name || tm.name)}</b></button>`; };
  const goals = all.filter(s => s.result === 'goal').length, onT = all.filter(s => s.result === 'goal' || s.result === 'saved').length;
  const xG = all.reduce((a, s) => a + s.xg, 0), xGOT = all.reduce((a, s) => a + (s.xgot || 0), 0);
  const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const filters = FILTERS.map(([id, label, fn]) => [id, label, all.filter(fn).length]).filter(([, , n]) => n).map(([id, label, n]) => `<button type="button" class="sm-pill${st.filter === id ? ' is-on' : ''}" data-sm-filter="${id}" aria-pressed="${st.filter === id}">${label} <b>${n}</b></button>`).join('');
  const goalView = st.view === 'goal';
  const detail = sel ? `<dl class="sm-facts"><div><dt>Shot type</dt><dd>${esc(sel.type)}</dd></div><div><dt>Situation</dt><dd>${esc(sel.situation)}</dd></div><div><dt>Result</dt><dd>${esc(RESULT[sel.result] || sel.result)}</dd></div><div><dt>Minute</dt><dd>${esc(sel.minute)}′</dd></div></dl>
      <div class="sm-xg">${goalSvg([sel], sel.id, true)}<div><b>${f2(sel.xg)}</b><span>xG</span></div><div><b>${f2(sel.xgot)}</b><span>xGOT</span></div></div>`
    : '<p class="empty">No shots to show.</p>';
  return `<section class="lg-card st sm" aria-labelledby="sm-h"><div class="st-head"><h2 id="sm-h" class="st-title">Shot map</h2><div class="sm-teams">${side(fx.home)}${side(fx.away)}</div></div>
    <div class="sm-body"><div class="sm-left"${pill(code)}><div class="sm-bar"><span class="sm-sub">On target: ${all.length ? Math.round(100 * onT / all.length) : 0}%</span><button type="button" class="sm-switch${goalView ? ' is-on' : ''}" data-sm-view="${goalView ? 'pitch' : 'goal'}" role="switch" aria-checked="${goalView}"><i aria-hidden="true"></i><span>Goal view</span></button></div>
      <div class="sm-stage"${pill(code)}>${all.length ? (goalView ? goalSvg(list, sel?.id) : pitchSvg(list, sel?.id)) : `<p class="empty">${esc(c?.short_name || t.name)} had no shots.</p>`}</div>
      <p class="sm-key" aria-hidden="true"><i class="k-miss"></i>Missed or blocked <i class="k-save"></i>Saved <i class="k-goal"></i>Goal <em>Bigger = higher xG</em></p>
      <div class="sm-stats">${stat(all.length, 'Shots')}${stat(goals, 'Goals')}${stat(f2(xG), 'xG')}${stat(f2(xGOT), 'xGOT')}</div></div>
      <div class="sm-right"${pill(code)}>${detail}<h3 class="sm-fh">Filter</h3><div class="sm-pills">${filters}</div></div></div></section>`;
}

export function shotMapClick(target, st, fx) {
  const q = sel => target.closest?.(sel);
  const team = q('[data-sm-team]'), flt = q('[data-sm-filter]'), shot = q('[data-sm-shot]'), view = q('[data-sm-view]');
  if (team) { st.team = team.dataset.smTeam; st.sel = null; st.filter = null; return true; }
  if (flt) { st.filter = st.filter === flt.dataset.smFilter ? null : flt.dataset.smFilter; st.sel = null; return true; }
  if (shot) { st.sel = shot.dataset.smShot; return true; }
  if (view) { st.view = view.dataset.smView; return true; }
  return false;
}
