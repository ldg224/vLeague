// The match page's shot map (Stats tab), copied from FotMob's match page: one full pitch with both clubs' shots (the home club attacks the left goal, the away club the
// right), each club in its own colour, a hollow ring for a shot that missed or was blocked, a filled dot for one on target and a ball for a goal. Above the pitch sits the
// shot you picked: the club and shooter, arrows to step through the shots by minute, then Shot type, Situation and Result beside a little goal showing where it crossed the
// line, with its xG and xGOT. The All / 1st / 2nd pills choose the half. The Stats card under it carries the xG split (open play, set play, penalty, xGOT).
//   shotMapCard(fx, file, ctx, st) -> html.  ctx = { team(code), club(code), crest(team, px), accent(code) -> '#rrggbb' | '', players, horizon }
//   st = { sel, period } is kept by the page (a redraw keeps the pick); the card also leaves st.ids (the shots on show) for the arrows.
//   shotMapClick(target, st) changes st and says whether the click was ours.
// xG is the engine's own. The engine does not rate shot placement, so xGOT (xG once the shot is on target) is worked out here from where the shot crossed the goal line:
// a shot in the corners is worth more than one at the keeper. It is an estimate, only for shots on target (as FotMob), and shows as "–" for the rest.
import { esc } from './member.js';

const HALF = 52.5, GOAL_W = 7.32, GOAL_H = 2.44, MID = 34;
const RESULT = { goal: 'Goal', saved: 'Saved', blocked: 'Blocked', off_target: 'Off target', woodwork: 'Hit the woodwork' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// xG after the shot is on target, from where it crossed the line (end_y across the goal, end_z up it).
export function xgot(e) {
  if (!(e.on_target || e.outcome === 'goal' || e.outcome === 'saved') || e.end_y == null) return null;
  const lat = clamp(Math.abs(e.end_y - MID) / (GOAL_W / 2), 0, 1), up = clamp((e.end_z ?? 0.8) / GOAL_H, 0, 1);
  const q = Math.min(1, Math.hypot(lat * 0.8, Math.max(0, up - 0.2) * 1.2));
  return clamp((e.xg || 0) * (0.7 + 1.8 * q), (e.xg || 0) * 0.6, 0.97);
}

// How the chance came about, from the shot and the pass just before it.
function situationOf(e, ev) {
  if (e.subtype === 'penalty') return 'Penalty';
  if (e.subtype === 'free_kick') return 'Free kick';
  const prior = ev.filter(p => p.type === 'pass' && p.poss === e.poss && p.t < e.t && e.t - p.t < 10).pop()?.subtype;
  return prior === 'corner' ? 'Corner' : prior === 'free_kick' ? 'Set piece' : prior === 'throw' ? 'Throw-in set piece' : 'Regular play';
}
const SETPLAY = new Set(['Corner', 'Set piece', 'Free kick', 'Throw-in set piece']);

// Every shot of the match up to `horizon`, oldest first. Each has pitch spots (X along the pitch, Y across it) with the home club attacking the left goal.
export function shotsOf(file, fx, horizon = Infinity) {
  const ev = file.events || [], out = [], per = n => (file.periods || []).find(p => p.period === n);
  for (const e of ev) {
    if (e.type !== 'shot' || e.x == null || e.t > horizon || (e.team !== fx.home && e.team !== fx.away)) continue;
    const home = e.team === fx.home, right = per(e.period)?.home_attacks, flip = right ? (right === 'right') !== home : e.x <= HALF, nx = flip ? 105 - e.x : e.x, ny = flip ? 68 - e.y : e.y;
    const ey = e.end_y == null ? null : flip ? 68 - e.end_y : e.end_y;   // where it crossed the goal line, turned the same way as X and Y
    const head = e.body === 'head' || e.subtype === 'header';
    out.push({
      id: String(e.id), e, team: e.team, home, period: e.period, minute: e.minute, xg: e.xg || 0, xgot: xgot(e), result: e.outcome || (e.on_target ? 'saved' : 'off_target'),
      situation: situationOf(e, ev), type: e.subtype === 'penalty' ? 'Penalty' : e.subtype === 'free_kick' ? 'Free kick' : head ? 'Header' : e.subtype === 'volley' ? 'Volley' : 'Foot',
      X: home ? 105 - nx : nx, Y: home ? 68 - ny : ny, endY: ey == null ? null : home ? 68 - ey : ey,
    });
  }
  return out;
}

// The xG split for the Stats card: open play, set play, non-penalty, and xG on target.
export function xgSplit(file, fx, code, horizon = Infinity) {
  const mine = shotsOf(file, fx, horizon).filter(s => s.team === code), sum = (list, k = 'xg') => list.reduce((a, s) => a + (s[k] || 0), 0);
  const pen = mine.filter(s => s.situation === 'Penalty'), set = mine.filter(s => SETPLAY.has(s.situation));
  return { xg_open: sum(mine) - sum(set) - sum(pen), xg_set: sum(set), xg_np: sum(mine) - sum(pen), xgot: sum(mine, 'xgot') };
}

const f2 = v => (v == null ? '–' : Number(v).toFixed(2));
const kind = s => (s.result === 'goal' ? 'is-goal' : s.result === 'saved' ? 'is-save' : 'is-miss');
const BALL = '<path d="m0-.45.43.31-.16.51h-.54l-.16-.51z" class="sm-pent"/>';
const radius = () => 2;   // every shot is the same size, goals included

const PITCH = '<g class="sm-lines"><rect x="0" y="0" width="105" height="68" rx="3"/><path d="M52.5 0v68"/><circle cx="52.5" cy="34" r="9.15"/>'
  + '<path d="M0 13.84h16.5v40.32H0M0 24.84h5.5v18.32H0M105 13.84H88.5v40.32H105M105 24.84h-5.5v18.32h5.5"/><path d="M16.5 26.69a9.15 9.15 0 0 1 0 14.62M88.5 26.69a9.15 9.15 0 0 0 0 14.62"/>'
  + '<circle cx="11" cy="34" r=".5" class="sm-spot"/><circle cx="94" cy="34" r=".5" class="sm-spot"/><path class="sm-goal" d="M0 30.34h-1.6v7.32H0M105 30.34h1.6v7.32H105"/></g>';

// The goal as the shooter sees it, standing on the pitch facing it, with the shot where it crossed the line (the home club shoots at the left goal of the map, the away club at the right).
function mouth(s) {
  const e = s.e, has = e.end_y != null, x = (has ? (s.home ? MID + GOAL_W / 2 - s.endY : s.endY - (MID - GOAL_W / 2)) : 0) * 10, y = (GOAL_H - clamp(e.end_z ?? 0, 0, 3)) * 10;
  const net = Array.from({ length: 7 }, (_, i) => `M${(i + 1) * 9.15} 0V24.4`).join('') + Array.from({ length: 3 }, (_, i) => `M0 ${(i + 1) * 6.1}H73.2`).join('');
  return `<svg class="sm-mouth" viewBox="-8 -6 89.2 36" aria-hidden="true"><path class="sm-net" d="${net}"/><path class="sm-frame" d="M0 24.4V0h73.2v24.4"/>${has ? `<circle class="sm-md ${kind(s)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"/>` : ''}</svg>`;
}

export function shotMapCard(fx, file, ctx, st) {
  const period = st.period === 1 || st.period === 2 ? st.period : 'all';
  const all = shotsOf(file, fx, ctx.horizon), list = period === 'all' ? all : all.filter(s => s.period === period);
  st.ids = list.map(s => s.id);
  const sel = list.find(s => s.id === st.sel) || [...list].reverse().find(s => s.result === 'goal') || list[list.length - 1] || null;
  st.sel = sel ? sel.id : null;
  const idx = sel ? list.indexOf(sel) : -1, col = code => ctx.accent(code) || (code === fx.home ? 'var(--blue-600)' : 'var(--blue-300)');
  const pills = [['all', 'All'], [1, '1st'], [2, '2nd']].map(([v, l]) => `<button type="button" class="sm-per${period === v ? ' is-on' : ''}" data-sm-period="${v}" aria-pressed="${period === v}">${l}</button>`).join('');
  const nameOf = s => ctx.players?.find(p => String(p.id) === String(s.e.player))?.name || '';
  const dots = list.map(s => {
    const r = radius(s), common = `class="sm-dot ${kind(s)}${s === sel ? ' is-sel' : ''}" style="--k:${esc(col(s.team))}" data-sm-shot="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`${s.minute}′, ${RESULT[s.result] || s.result}, ${f2(s.xg)} xG`)}"`;
    return s.result === 'goal' ? `<g ${common} transform="translate(${s.X.toFixed(2)} ${s.Y.toFixed(2)}) scale(${r.toFixed(2)})"><circle r="1" class="sm-ball"/>${BALL}</g>`
      : `<circle ${common} cx="${s.X.toFixed(2)}" cy="${s.Y.toFixed(2)}" r="${r.toFixed(2)}"/>`;
  }).join('');
  // The picked shot: a ring round it and a line to where it crossed the goal line.
  const ring = sel ? `${sel.endY != null ? `<line class="sm-trail" x1="${sel.X.toFixed(2)}" y1="${sel.Y.toFixed(2)}" x2="${sel.home ? 0 : 105}" y2="${sel.endY.toFixed(2)}"/>` : ''}<circle class="sm-ring${sel.result === 'goal' ? ' is-goal' : ''}" cx="${sel.X.toFixed(2)}" cy="${sel.Y.toFixed(2)}" r="${(radius(sel) + 1.3).toFixed(2)}"/>` : '';
  const who = sel ? `${ctx.crest(ctx.team(sel.team), 28)}<b>${esc(nameOf(sel) || ctx.club(sel.team)?.short_name || ctx.team(sel.team).name)}</b>` : '';
  const head = sel ? `<div class="sm-pick"><span class="sm-who">${who}</span><span class="sm-step"><button type="button" class="sm-arrow" data-sm-step="-1" aria-label="Previous shot"${idx <= 0 ? ' disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>${esc(sel.minute)}′</b><button type="button" class="sm-arrow" data-sm-step="1" aria-label="Next shot"${idx >= list.length - 1 ? ' disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></span></div>
      <div class="sm-detail"><dl class="sm-facts"><div><dt>Shot type</dt><dd>${esc(sel.type)}</dd></div><div><dt>Situation</dt><dd>${esc(sel.situation)}</dd></div><div><dt>Result</dt><dd>${esc(RESULT[sel.result] || sel.result)}</dd></div></dl>
      <div class="sm-xg">${mouth(sel)}<div><b>${f2(sel.xg)}</b><span>xG</span></div><div><b>${f2(sel.xgot)}</b><span>xGOT</span></div></div></div>` : '';
  return `<section class="lg-card st sm" aria-labelledby="sm-h"><div class="sm-per-row">${pills}</div><div class="st-head"><h2 id="sm-h" class="st-title">Shot map</h2></div>
    <div class="sm-body">${all.length ? `${head}<svg class="sm-pitch" viewBox="-3.5 -3 112 74" role="group" aria-label="Shot map">${PITCH}${ring}${dots}</svg>${list.length ? '' : '<p class="empty">No shots in this half.</p>'}` : '<p class="empty">No shots in this match.</p>'}</div></section>`;
}

export function shotMapClick(target, st) {
  const q = sel => target.closest?.(sel), per = q('[data-sm-period]'), shot = q('[data-sm-shot]'), step = q('[data-sm-step]');
  if (per) { st.period = per.dataset.smPeriod === 'all' ? 'all' : Number(per.dataset.smPeriod); st.sel = null; return true; }
  if (shot) { st.sel = shot.dataset.smShot; return true; }
  if (step && st.ids?.length) {
    const i = st.ids.indexOf(st.sel), cur = i < 0 ? st.ids.length - 1 : i;
    st.sel = st.ids[clamp(cur + Number(step.dataset.smStep), 0, st.ids.length - 1)]; return true;
  }
  return false;
}
