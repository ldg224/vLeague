// Highlights video generator. Everything runs in the browser:
//   picks the best moments from a match file, renders a broadcast-style 1080p video
//   (multi-angle 3D cameras, referee and REF CAM, scorebug, goal banners, branded transitions,
//   intro / full-time / player-of-the-match cards), encodes a silent MP4 (video only) with
//   WebCodecs, and makes a matching thumbnail plus YouTube title and description.

import { safeColour, onColour, logoPath } from './ui.js';
import { kickoff } from './data.js';

export const W = 1920, H = 1080, FPS = 30;
const GOAL_Y1 = 30.34, GOAL_Y2 = 37.66, GOAL_H = 2.44;
// vLeague brand (docs/BRAND.md): Material Blue ramp, white as the accent, navy background. The old
// names stay so the graphics code reads the same: LIME = Blue 300 (accent text), YEL -> LIME2 = the
// Blue 400 -> 800 button gradient (white text on it), DARK = navy.
const LIME = '#64b5f6', LIME2 = '#1565c0', YEL = '#42a5f5', DARK = '#061a38';
const FONT = 'Oswald, Figtree, system-ui, sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

function loadImg(src) {
  return new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
const shirt = id => String(Number(String(id).slice(-2)) || String(id).slice(-2));   // a test match's made-up ids end in the shirt number
// A colour moved toward another by t (0 = a, 1 = b), as a hex string.
const mixHex = (a, b, t) => { const n = s => parseInt(String(s).slice(1), 16), x = n(a), y = n(b), f = (p, q) => Math.round(p + (q - p) * t); return '#' + [16, 8, 0].map(sh => f(x >> sh & 255, y >> sh & 255).toString(16).padStart(2, '0')).join(''); };
const LEAGUE_ASPECT = 116 / 158;   // the vLeague crest's width over its height (assets/brand/crest.svg viewBox)
const lastName = n => String(n || '').split(' ').slice(-1)[0];

// ---------------------------------------------------------------- match state

// Catmull-Rom through four samples (k = 0..1 between the middle two): smooth paths from frames written five times a second.
const cr = (p0, p1, p2, p3, k) => 0.5 * (2 * p1 + (p2 - p0) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k * k + (3 * p1 - p0 - 3 * p2 + p3) * k * k * k);
// Is the ball's path through these steps one smooth movement (no kick, bounce or deflection in the middle)?
const smoothSteps = (u, v) => {
  const lu = Math.hypot(u[0], u[1], u[2]), lv = Math.hypot(v[0], v[1], v[2]);
  if (lu < 8 || lv < 8) return true;
  const dot = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv), r = lv / lu;
  return dot > 0.8 && r > 0.4 && r < 2.5;
};

class Frames {
  constructor(d) {
    this.d = d; this.f = d.frames.data; this.sc = d.frames.scale; this.n = d.players.length;
    this.half2 = d.periods[1]?.start_t ?? Infinity;
    this.buildDead();
  }
  idx(t) {
    const f = this.f, ds = t * 10; let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m][0] <= ds) lo = m; else hi = m - 1; }
    return lo;
  }
  // When play stops the engine leaves the ball where it stopped (in the net, over the line) and only places it on the restart spot when
  // the restart is taken, which on screen was a jump. These are the stoppages: where the ball stopped (p0), where it is put back (p1).
  buildDead() {
    const f = this.f, n = f.length, sc = this.sc; this.dead = [];
    for (let i = 0; i < n; i++) {
      if (f[i][5] || (i > 0 && !f[i - 1][5])) continue;
      let j = i; while (j < n && !f[j][5]) j++;
      const p0 = [f[i][1] / sc, f[i][2] / sc], p1 = j < n ? [f[j][1] / sc, f[j][2] / sc] : p0, z1 = j < n ? f[j][3] / sc : 0, z0 = f[i][3] / sc;   // z1: a throw-in is taken with the ball overhead
      this.dead.push({ s: f[i][0] / 10, e: (j < n ? f[j][0] : f[n - 1][0] + 10) / 10, p0, p1, z0, z1 });
      i = j;
    }
  }
  deadAt(t) {
    const D = this.dead; let lo = 0, hi = D.length - 1;
    if (!D.length || t < D[0].s) return null;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (D[m].s <= t) lo = m; else hi = m - 1; }
    return t < D[lo].e ? D[lo] : null;
  }
  // True when the four frames around step i sit in one half (no kick-off reset between them), so a curve through them is safe.
  sameHalf(i) {
    const f = this.f, h = this.half2 * 10;
    return !(f[Math.max(0, i - 1)][0] < h && f[Math.min(f.length - 1, i + 2)][0] >= h);
  }
  // The ball: x, y, z, how visible it is, and whether play is stopped. At a stoppage it waits where it stopped, then is put back on the
  // restart spot: out of sight while it travels, fading in before the restart. The camera follows the same path, so it glides there
  // instead of cutting.
  ballState(t) {
    const dd = this.deadAt(t);
    if (dd) {
      const len = dd.e - dd.s, hold = Math.min(1.4, 0.35 * len), fade = Math.min(1.1, 0.3 * len), g0 = dd.s + hold, g1 = dd.e - fade;
      if (t < g0) return { x: dd.p0[0], y: dd.p0[1], z: dd.z0 * (1 - seg01(t, dd.s, dd.s + 0.5)), alpha: 1 - 0.65 * seg01(t, dd.s + hold * 0.5, g0), dead: true };
      if (t < g1) { const u = easeInOut((t - g0) / Math.max(0.01, g1 - g0)); return { x: lerp(dd.p0[0], dd.p1[0], u), y: lerp(dd.p0[1], dd.p1[1], u), z: 0, alpha: 0, dead: true }; }
      return { x: dd.p1[0], y: dd.p1[1], z: dd.z1, alpha: seg01(t, g1, dd.e), dead: true };
    }
    const f = this.f, n = f.length, i = this.idx(t), a = f[i], b = f[Math.min(i + 1, n - 1)], sc = this.sc;
    const cross = a[0] / 10 < this.half2 && b[0] / 10 >= this.half2;
    const k = b[0] > a[0] && !cross ? clamp((t * 10 - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    let x = (a[1] + (b[1] - a[1]) * k) / sc, y = (a[2] + (b[2] - a[2]) * k) / sc, z = (a[3] + (b[3] - a[3]) * k) / sc;
    if (a[5] && b[5] && !cross && i > 0 && i + 2 < n && f[i - 1][5] && f[i + 2][5] && this.sameHalf(i)) {
      const a0 = f[i - 1], b2 = f[i + 2], v = (p, q) => [q[1] - p[1], q[2] - p[2], q[3] - p[3]];
      if (smoothSteps(v(a0, a), v(a, b)) && smoothSteps(v(a, b), v(b, b2))) {
        x = cr(a0[1], a[1], b[1], b2[1], k) / sc; y = cr(a0[2], a[2], b[2], b2[2], k) / sc; z = Math.max(0, cr(a0[3], a[3], b[3], b2[3], k) / sc);
      }
    }
    return { x, y, z, alpha: 1, dead: false };
  }
  at(t) {
    const f = this.f, n = f.length, i = this.idx(t), a = f[i], b = f[Math.min(i + 1, n - 1)], sc = this.sc;
    const cross = a[0] / 10 < this.half2 && b[0] / 10 >= this.half2;
    const k = b[0] > a[0] && !cross ? clamp((t * 10 - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    const curve = !cross && i > 0 && i + 2 < n && this.sameHalf(i), a0 = f[Math.max(0, i - 1)], b2 = f[Math.min(n - 1, i + 2)];
    const da = Math.max(1, b[0] - a0[0]), db = Math.max(1, b2[0] - a[0]);
    const players = [], vel = [];
    for (let p = 0; p < this.n; p++) {
      const jx = 6 + 2 * p, jy = 7 + 2 * p;
      const x = curve ? cr(a0[jx], a[jx], b[jx], b2[jx], k) : a[jx] + (b[jx] - a[jx]) * k, y = curve ? cr(a0[jy], a[jy], b[jy], b2[jy], k) : a[jy] + (b[jy] - a[jy]) * k;
      players.push([x / sc, y / sc]);
      // Velocity (m/s): the slope each side of this step, blended across it.
      const vax = (b[jx] - a0[jx]) / da * 10 / sc, vay = (b[jy] - a0[jy]) / da * 10 / sc, vbx = (b2[jx] - a[jx]) / db * 10 / sc, vby = (b2[jy] - a[jy]) / db * 10 / sc;
      vel.push(cross ? [0, 0] : [vax + (vbx - vax) * k, vay + (vby - vay) * k]);
    }
    const bs = this.ballState(t);
    return { ball: [bs.x, bs.y, bs.z], inPlay: !bs.dead, ballAlpha: bs.alpha, holder: bs.dead ? -1 : a[4], players, vel };
  }
  // Just the ball [x, y] at t (cheaper than at() when the players aren't needed).
  ball(t) { const b = this.ballState(t); return [b.x, b.y]; }
}

// A point on a path sampled FPS times a second, at fractional sample position u: blended between the two samples either side.
function pathAt(path, u) {
  const n = path.length, x = clamp(u, 0, n - 1), i = Math.floor(x), j = Math.min(i + 1, n - 1), k = x - i;
  return [lerp(path[i][0], path[j][0], k), lerp(path[i][1], path[j][1], k)];
}

// ---------------------------------------------------------------- cameras (pinhole)

// Camera in the main stand, `dist` metres from the target at `elevDeg` above the pitch.
function makeCam(tx, ty, dist, elevDeg, fovDeg) {
  const e = elevDeg * Math.PI / 180;
  return makeCamAt([tx, ty + dist * Math.cos(e), dist * Math.sin(e)], [tx, ty, 0], fovDeg);
}

// Camera at any position C looking at target T.
function makeCamAt(C, T, fovDeg) {
  let f = [T[0] - C[0], T[1] - C[1], T[2] - C[2]]; const fl = Math.hypot(...f); f = f.map(v => v / fl);
  // r = up x f with up = (0,0,1)  ->  (-f1, f0, 0), normalised
  const rl = Math.hypot(f[1], f[0]) || 1;
  const r = [-f[1] / rl, f[0] / rl, 0];
  // u = f x r
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const focal = (W / 2) / Math.tan(fovDeg * Math.PI / 360);
  const NEAR = 0.5;
  // World point -> camera space [right, up, depth].
  const toCam = (x, y, z = 0) => {
    const v0 = x - C[0], v1 = y - C[1], v2 = z - C[2];
    return [v0 * r[0] + v1 * r[1] + v2 * r[2], v0 * u[0] + v1 * u[1] + v2 * u[2], v0 * f[0] + v1 * f[1] + v2 * f[2]];
  };
  const proj = ([xc, yc, zc]) => [W / 2 + focal * xc / zc, H / 2 - focal * yc / zc, focal / zc];
  return {
    focal, C,
    p(x, y, z = 0) { const q = toCam(x, y, z); return q[2] < NEAR ? null : proj(q); },
    // Polygon clipped against the near plane (so shapes partly behind the camera still draw).
    poly(pts) {
      const inp = pts.map(([x, y, z = 0]) => toCam(x, y, z)), out = [];
      for (let i = 0; i < inp.length; i++) {
        const a = inp[i], b = inp[(i + 1) % inp.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
      }
      return out.map(proj);
    },
    // Line segment clipped against the near plane; null if entirely behind.
    seg(a, b) {
      let A = toCam(...a), B = toCam(...b);
      if (A[2] < NEAR && B[2] < NEAR) return null;
      if (A[2] < NEAR) { const t = (NEAR - A[2]) / (B[2] - A[2]); A = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, NEAR]; }
      if (B[2] < NEAR) { const t = (NEAR - B[2]) / (A[2] - B[2]); B = [B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t, NEAR]; }
      return [proj(A), proj(B)];
    },
  };
}

// ---------------------------------------------------------------- highlight selection

function attackStart(d, e) {
  const same = d.events.filter(x => x.poss === e.poss && x.t <= e.t);
  const first = same.length ? same[0].t : e.t - 8;
  return clamp(first - 1.5, e.t - 13, e.t - 5);
}

// Card moments need time after the foul for the referee to arrive and show the card (ref cam).
export const CARD_AFTER = 6.5;
// A second yellow plays out as two cards: the yellow goes up, comes down, the referee reaches into his pocket, then the red goes up.
export const RED_AT = 2.75, SECOND_EXTRA = 2.6;   // seconds after the first card goes up that the red goes up; extra time the shot stays on him
function secondCardPhase(s) {
  if (s < 0) return { up: 0, col: null };
  if (s < 0.25) return { up: easeOut(s / 0.25), col: 'yellow' };
  if (s < 1.7) return { up: 1, col: 'yellow' };
  if (s < 2.15) { const u = 1 - easeInOut((s - 1.7) / 0.45); return { up: u, col: u > 0.12 ? 'yellow' : null }; }
  if (s < RED_AT) return { up: 0, col: null, reach: (s - 2.15) / (RED_AT - 2.15) };
  if (s < RED_AT + 0.25) return { up: easeOut((s - RED_AT) / 0.25), col: 'red' };
  return { up: 1, col: 'red' };
}
// Most of each kind of moment in one video, so it isn't wall-to-wall saves.
const KIND_CAP = { save: 2, chance: 3, woodwork: 2, yellow: 2, red: 2, goal: 99 };

export function planHighlights(d, targetSeconds = 180) {
  const shots = d.events.filter(e => e.type === 'shot');
  const cand = [];
  for (const e of d.events) {
    if (e.type === 'goal') {
      const shot = shots.find(s => s.id === e.shot) || null;
      cand.push({ kind: 'goal', score: 100 + e.t / 1e4, t: e.t, t0: attackStart(d, shot || e), t1: e.t + 4.5, e, shot });
    } else if (e.type === 'shot' && e.outcome !== 'goal') {
      // Only genuine chances: a real save from a good opening, a big miss, or the woodwork.
      const wood = e.outcome === 'woodwork';
      const save = e.outcome === 'saved' && e.xg >= 0.12;
      const chance = e.outcome !== 'saved' && e.xg >= 0.2;
      if (wood || save || chance) cand.push({ kind: wood ? 'woodwork' : save ? 'save' : 'chance', score: 30 + e.xg * 70 + (wood ? 25 : 0), t: e.t, t0: attackStart(d, e), t1: e.t + 2.8, e });
    } else if (e.type === 'card') {
      const red = e.card !== 'yellow';
      const foul = [...d.events].reverse().find(f => f.type === 'foul' && f.player === e.player && f.t <= e.t + 0.01 && e.t - f.t < 3);
      const ft = foul ? foul.t : e.t;
      cand.push({ kind: red ? 'red' : 'yellow', score: red ? 60 : 32, t: ft, t0: ft - 6, t1: ft + CARD_AFTER + (e.card === 'second_yellow' ? SECOND_EXTRA : 0), e, foul });
    }
  }
  const fixed = 4.5 + 4.5 + 3.5 + 9 + 5.5 + 4.5;   // intro, versus, half-time, full-time, motm, outro
  let budget = targetSeconds - fixed;
  const picked = [], used = {};
  for (const c of cand.sort((a, b) => b.score - a.score)) {
    const len = c.t1 - c.t0;
    if ((used[c.kind] || 0) >= KIND_CAP[c.kind]) continue;
    if (len > budget && picked.length) continue;
    if (picked.some(p => c.t0 < p.t1 + 1 && c.t1 > p.t0 - 1)) continue;   // overlaps another clip
    picked.push(c); budget -= len; used[c.kind] = (used[c.kind] || 0) + 1;
  }
  picked.sort((a, b) => a.t - b.t);
  // Spare time: widen clips a little so the video lands near the target length.
  const spare = Math.max(0, budget);
  const each = picked.length ? Math.min(8, spare / picked.length) : 0;
  picked.forEach(c => {
    const per = d.periods.find(p => p.start_t <= c.t && (p.end_t ?? 1e9) >= c.t) || d.periods[0];
    c.t0 = Math.max(c.t0 - each * 0.7, per.start_t + 1);
    c.t1 = Math.min(c.t1 + each * 0.3, (per.end_t ?? c.t1 + 99) - 0.5);
  });
  // Keep clips apart after widening.
  for (let i = 1; i < picked.length; i++) picked[i].t0 = Math.max(picked[i].t0, picked[i - 1].t1 + 0.5);
  return picked;
}

// ---------------------------------------------------------------- timeline

function buildTimeline(d, clips) {
  const segs = [];
  const add = s => { s.start = segs.length ? segs[segs.length - 1].end : 0; s.end = s.start + s.dur; segs.push(s); };
  add({ type: 'intro', dur: 4.5 });
  add({ type: 'versus', dur: 4.5 });
  const half2 = d.periods[1]?.start_t ?? Infinity;
  let htDone = false;
  for (const c of clips) {
    if (!htDone && c.t >= half2 && clips.some(x => x.t < half2)) { add({ type: 'halftime', dur: 3.5 }); htDone = true; }
    add({ type: 'clip', dur: c.t1 - c.t0, t0: c.t0, speed: 1, clip: c });
  }
  add({ type: 'fulltime', dur: 9 });
  add({ type: 'motm', dur: 5.5 });
  add({ type: 'outro', dur: 4.5 });
  return segs;
}

// ---------------------------------------------------------------- renderer

// frame(T) returns a canvas of W*scale × H*scale. Everything is drawn in W×H units on a scaled
// context, so a smaller scale (e.g. 0.5 on phones) just renders fewer pixels. Export uses scale 1.
export class HighlightsRenderer {
  constructor(data, { season, fixture, assets, scale = 1 }) {
    this.d = data; this.fr = new Frames(data); this.season = season; this.fx = fixture; this.A = assets;
    this.home = data.teams.home; this.away = data.teams.away;
    this.hc = safeColour(this.home.colour); this.ac = safeColour(this.away.colour);
    this.nHome = this.home.lineup.length;
    this.names = Object.fromEntries(data.players.map(p => [p.id, p.name]));
    this.clips = planHighlights(data);
    this.segs = buildTimeline(data, this.clips);
    this.duration = this.segs[this.segs.length - 1].end;
    this.goals = data.events.filter(e => e.type === 'goal');
    this.scale = clamp(+scale || 1, 0.1, 2);
    this.cv = document.createElement('canvas'); this.cv.width = Math.round(W * this.scale); this.cv.height = Math.round(H * this.scale);
    this.c = this.cv.getContext('2d');
    this.camState = new Map();
    this.trail = [];
    this.gkIdx = new Set(data.players.filter(p => p.slot === 'GK').map(p => p.idx));
  }

  // Change the drawing resolution without rebuilding anything (the camera and director plans don't depend on it).
  setScale(s) {
    s = clamp(+s || 1, 0.1, 2);
    if (s === this.scale) return;
    this.scale = s;
    this.cv.width = Math.round(W * s); this.cv.height = Math.round(H * s);
  }

  segAt(T) { return this.segs.find(s => T >= s.start && T < s.end) || this.segs[this.segs.length - 1]; }

  scoreAt(t) {
    const sc = [0, 0];
    for (const g of this.goals) if (g.t <= t) sc[g.team === this.home.code ? 0 : 1]++;
    return sc;
  }
  // The clock runs on through added time (46:12, 93:56); addedAt() gives the "+4" shown under it.
  clockAt(t) {
    const p = [...this.d.periods].reverse().find(p => p.start_t <= t + 1e-6) || this.d.periods[0];
    const el = Math.max(0, t - p.start_t), base = p.period === 2 ? 45 : 0;
    const m = Math.floor(el / 60) + base, s = Math.floor(el % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  addedAt(t) {
    const p = [...this.d.periods].reverse().find(p => p.start_t <= t + 1e-6) || this.d.periods[0];
    return p && t - p.start_t >= 2700 && p.added_minutes ? p.added_minutes : 0;
  }
  // The fourth official's board under the clock of the score bug (x, y = the bug's corner).
  addedBoard(x, y, t) {
    const n = this.addedAt(t);
    if (!n) return;
    this.pill(x + 450, y + 56, 76, 32, 'rgba(6,26,56,0.9)', 8);
    this.text(`+${n}`, x + 488, y + 81, { size: 22, weight: 900, align: 'center', colour: LIME });
  }

  // Draw the video frame at output time T (seconds).
  draw(T) {
    const s = this.segAt(T), local = T - s.start, c = this.c;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.save();
    c.clearRect(0, 0, W, H);
    switch (s.type) {
      case 'intro': this.drawIntro(local, s); break;
      case 'versus': this.drawVersus(local, s); break;
      case 'clip': case 'replay': this.drawClip(s, local); break;
      case 'halftime': this.drawHalftime(local, s); break;
      case 'fulltime': this.drawFulltime(local, s); break;
      case 'motm': this.drawMotm(local, s); break;
      case 'outro': this.drawOutro(local, s); break;
    }
    c.restore();
    this.drawTransition(T);
    if (!['intro', 'outro'].includes(s.type)) this.drawBug();
  }

  // ------------------------------------------------ backgrounds and text

  bg(tint = 0.78) {
    const c = this.c, img = this.A.title;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    if (img) {
      const r = Math.max(W / img.width, H / img.height);
      c.drawImage(img, (W - img.width * r) / 2, (H - img.height * r) / 2, img.width * r, img.height * r);
      // Blue duotone, so the stadium photo sits in the brand colours.
      c.save(); c.globalCompositeOperation = 'color'; c.fillStyle = '#1565c0'; c.fillRect(0, 0, W, H); c.restore();
    }
    c.fillStyle = `rgba(6,26,56,${tint})`; c.fillRect(0, 0, W, H);
    this.grid();
  }
  grid() {
    const c = this.c; c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 48) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 48) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
  }
  text(str, x, y, { size = 40, weight = 800, colour = '#fff', align = 'left', italic = false, spacing = 0, shadow = 0, alpha = 1, base = 'alphabetic' } = {}) {
    const c = this.c; c.save();
    c.globalAlpha *= alpha;
    c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = colour; c.textAlign = align; c.textBaseline = base;
    if ('letterSpacing' in c) c.letterSpacing = `${spacing}px`;
    if (shadow) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = shadow; c.shadowOffsetY = shadow / 3; }
    if (italic) { c.translate(x, y); c.transform(1, 0, -0.18, 1, 0, 0); c.fillText(str, 0, 0); } else c.fillText(str, x, y);
    c.restore();
  }
  // A football drawn as a shape, centred at (cx, cy) with diameter d. (The ball emoji is drawn by each device's own font and
  // looks different everywhere; this is the same ball as the icons in the Game centre.)
  ball(cx, cy, d, alpha = 1) {
    const c = this.c; c.save(); c.globalAlpha *= alpha;
    c.translate(cx - d / 2, cy - d / 2); c.scale(d / 24, d / 24);
    c.fillStyle = '#fff'; c.fill(new Path2D('M16.93 17.12L16.13 15.76L17.59 11.39L19 10.92L20 11.67C20 11.7 20 11.75 20 11.81C20 11.88 20.03 11.94 20.03 12C20.03 13.97 19.37 15.71 18.06 17.21L16.93 17.12M9.75 15L8.38 10.97L12 8.43L15.62 10.97L14.25 15H9.75M12 20.03C11.12 20.03 10.29 19.89 9.5 19.61L8.81 18.1L9.47 17H14.58L15.19 18.1L14.5 19.61C13.71 19.89 12.88 20.03 12 20.03M5.94 17.21C5.41 16.59 4.95 15.76 4.56 14.75C4.17 13.73 3.97 12.81 3.97 12C3.97 11.94 4 11.88 4 11.81C4 11.75 4 11.7 4 11.67L5 10.92L6.41 11.39L7.87 15.76L7.07 17.12L5.94 17.21M11 5.29V6.69L7 9.46L5.66 9.04L5.24 7.68C5.68 7 6.33 6.32 7.19 5.66S8.87 4.57 9.65 4.35L11 5.29M14.35 4.35C15.13 4.57 15.95 5 16.81 5.66C17.67 6.32 18.32 7 18.76 7.68L18.34 9.04L17 9.47L13 6.7V5.29L14.35 4.35M4.93 4.93C3 6.89 2 9.25 2 12S3 17.11 4.93 19.07 9.25 22 12 22 17.11 21 19.07 19.07 22 14.75 22 12 21 6.89 19.07 4.93 14.75 2 12 2 6.89 3 4.93 4.93Z'));
    c.restore();
  }
  // A scorer's line: a ball, then the text, the pair centred on x.
  scorerLine(str, x, y, { size = 27, alpha = 1 } = {}) {
    const c = this.c; c.save();
    c.font = `700 ${size}px ${FONT}`; if ('letterSpacing' in c) c.letterSpacing = '0px';
    const w = c.measureText(str).width; c.restore();
    const d = size * 0.95, gap = size * 0.35, x0 = x - (d + gap + w) / 2;
    this.ball(x0 + d / 2, y - size * 0.33, d, alpha);
    this.text(str, x0 + d + gap, y, { size, weight: 700, align: 'left', alpha });
  }
  // Draw a picture centred at (cx, cy), as large as fits inside w x h WITHOUT changing its shape (the crests aren't square).
  fitImg(img, cx, cy, w, h, aspect) {
    const iw = aspect ? aspect * 100 : (img.naturalWidth || img.width || 1), ih = aspect ? 100 : (img.naturalHeight || img.height || 1), s = Math.min(w / iw, h / ih);
    this.c.drawImage(img, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s);
  }
  leagueFit(cx, cy, w, h) { this.fitImg(this.A.league, cx, cy, w, h, LEAGUE_ASPECT); }
  logoAt(team, x, y, size, alpha = 1) {
    const c = this.c, img = this.A.logos[team.code];
    c.save(); c.globalAlpha *= alpha;
    if (img) this.fitImg(img, x, y, size, size);
    else {
      c.fillStyle = safeColour(team.colour); c.beginPath(); c.arc(x, y, size / 2, 0, Math.PI * 2); c.fill();
      this.text(team.code, x, y + size * 0.12, { size: size * 0.32, weight: 900, align: 'center', colour: onColour(team.colour) });
    }
    c.restore();
  }
  pill(x, y, w, h, fill, r = h / 2) {   // r may be one radius or four ([top-left, top-right, bottom-right, bottom-left])
    const c = this.c; c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
  }
  limeGrad(x0, y0, x1, y1) { const g = this.c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, YEL); g.addColorStop(1, LIME2); return g; }

  // ------------------------------------------------ cards

  drawIntro(t) {
    const c = this.c;
    this.bg(0.86);
    // Light sweep
    const sx = lerp(-600, W + 600, easeInOut(t / 2.2));
    const g = c.createLinearGradient(sx - 300, 0, sx + 300, 0);
    g.addColorStop(0, 'rgba(66,165,245,0)'); g.addColorStop(0.5, 'rgba(66,165,245,0.16)'); g.addColorStop(1, 'rgba(66,165,245,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // Diagonal brand bars
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.35);
    for (let i = 0; i < 3; i++) {
      const w = lerp(0, W * 1.6, easeOut((t - 0.1 * i) / 0.9));
      c.fillStyle = i === 1 ? this.limeGrad(-w / 2, 0, w / 2, 0) : `rgba(66,165,245,${0.08 + i * 0.04})`;
      c.fillRect(-w / 2, -260 + i * 170 + (i === 1 ? 70 : 0), w, i === 1 ? 14 : 60);
    }
    c.restore();
    const k = easeOut((t - 0.4) / 0.8);
    if (this.A.league) {
      c.save(); c.shadowColor = 'rgba(66,165,245,0.6)'; c.shadowBlur = 60 * k;
      const s = 260 * (0.6 + 0.4 * k); c.globalAlpha = k;
      this.leagueFit((W / 2 - s / 2) + (s) / 2, (H / 2 - 190 - s / 2 + 60) + (s) / 2, s, s); c.restore();
    }
    const a = easeOut((t - 1.0) / 0.7);
    this.text('vLEAGUE', W / 2, H / 2 + 150, { size: 104, weight: 900, align: 'center', spacing: 6 * a, alpha: a, shadow: 20 });
    const b = easeOut((t - 1.5) / 0.7);
    const L = this.look();
    this.text(`${L.big.toUpperCase()}${L.small ? `  ·  ${L.small.toUpperCase()}` : ''}  ·  HIGHLIGHTS`, W / 2, H / 2 + 225, { size: 34, weight: 800, align: 'center', colour: LIME, spacing: 5, alpha: b });
    this.fadeOut(t, 4.5, 0.35);
  }

  drawVersus(t) {
    const c = this.c;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const split = W / 2 + Math.sin(t * 0.6) * 10, slant = 180;
    const k = easeOut(t / 0.7);
    for (const [side, col] of [[0, this.hc], [1, this.ac]]) {
      c.save(); c.beginPath();
      if (side === 0) { c.moveTo(0, 0); c.lineTo(split + slant / 2, 0); c.lineTo(split - slant / 2, H); c.lineTo(0, H); }
      else { c.moveTo(W, 0); c.lineTo(split + slant / 2 + 6, 0); c.lineTo(split - slant / 2 + 6, H); c.lineTo(W, H); }
      c.closePath(); c.clip();
      const g = c.createLinearGradient(side ? W : 0, 0, split, H);
      g.addColorStop(0, col); g.addColorStop(1, DARK);
      c.globalAlpha = 0.85; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
      this.stripes(t, 0.35);
      const team = side ? this.away : this.home, wm = this.A.logosAlt[team.code] || this.A.logos[team.code];
      if (wm) { c.globalAlpha = 0.08; const s = 900; c.translate(side ? W - 300 : 300, H / 2); c.rotate(side ? 0.35 : -0.35); this.fitImg(wm, 0, 0, s, s); }
      c.restore();
    }
    this.grid();
    const off = (1 - k) * 500;
    for (const [side, team] of [[0, this.home], [1, this.away]]) {
      const x = side ? W * 0.75 + off : W * 0.25 - off;
      c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40; this.logoAt(team, x, H / 2 - 70, 330); c.restore();
      this.text(team.name.toUpperCase(), x, H / 2 + 175, { size: 62, weight: 900, align: 'center', shadow: 16, italic: true });
      this.text(team.code, x, H / 2 + 230, { size: 30, weight: 800, align: 'center', colour: 'rgba(255,255,255,.7)', spacing: 8 });
    }
    const v = easeOut((t - 0.5) / 0.5);
    c.save(); c.translate(W / 2, H / 2 - 60); c.scale(0.6 + 0.4 * v, 0.6 + 0.4 * v); c.globalAlpha = v;
    this.pill(-95, -95, 190, 190, this.limeGrad(-95, -95, 95, 95), 95);
    this.text('VS', 0, 38, { size: 110, weight: 900, align: 'center', colour: '#fff', italic: true });
    c.restore();
    const k0 = kickoff(this.fx || {});
    const when = k0 ? k0.toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    this.text(`WEEK ${this.fx?.week ?? ''}${when ? '  ·  ' + when.toUpperCase() : ''}`, W / 2, H - 90, { size: 30, weight: 800, align: 'center', spacing: 4, alpha: easeOut((t - 0.8) / 0.6) });
  }

  stripes(t, alpha) {
    const c = this.c; c.save(); c.globalAlpha *= alpha; c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 4;
    const off = (t * 40) % 80;
    c.beginPath();
    for (let x = -H; x < W + H; x += 80) { c.moveTo(x + off, H); c.lineTo(x + off + H, 0); }
    c.stroke(); c.restore();
  }

  fadeOut(t, dur, len) { const a = seg01(t, dur - len, dur); if (a > 0) { this.c.fillStyle = `rgba(0,0,0,${a})`; this.c.fillRect(0, 0, W, H); } }

  drawHalftime(t) {
    this.bg(0.84); this.stripes(t, 0.5);
    const half2 = this.d.periods[1]?.start_t ?? 0;
    const sc = this.scoreAt(half2 - 1);
    const k = easeOut(t / 0.6);
    this.text('HALF-TIME', W / 2, 330, { size: 46, weight: 900, align: 'center', colour: LIME, spacing: 10, alpha: k });
    this.scoreLine(sc, 560, k);
  }

  scoreLine(sc, y, k = 1) {
    const c = this.c;
    this.logoAt(this.home, W / 2 - 520, y - 40, 190, k);
    this.logoAt(this.away, W / 2 + 520, y - 40, 190, k);
    this.pill(W / 2 - 230, y - 150, 460, 200, 'rgba(255,255,255,0.96)', 28);
    this.text(`${sc[0]}  -  ${sc[1]}`, W / 2, y + 12, { size: 150, weight: 900, align: 'center', colour: DARK });
    this.text(this.home.name.toUpperCase(), W / 2 - 520, y + 110, { size: 34, weight: 900, align: 'center', alpha: k });
    this.text(this.away.name.toUpperCase(), W / 2 + 520, y + 110, { size: 34, weight: 900, align: 'center', alpha: k });
    c.globalAlpha = 1;
  }

  drawFulltime(t) {
    const c = this.c;
    this.bg(0.86); this.stripes(t, 0.4);
    const k = easeOut(t / 0.6);
    this.text('FULL-TIME', W / 2, 150, { size: 50, weight: 900, align: 'center', colour: LIME, spacing: 12, alpha: k });
    this.scoreLine([this.d.result.home, this.d.result.away], 380, k);
    // Scorers
    const list = side => this.goals.filter(g => g.team === (side ? this.away.code : this.home.code))
      .map(g => `${lastName(this.names[g.scorer])} ${g.minute}'${g.own_goal ? ' (OG)' : ''}`);
    const a = easeOut((t - 0.6) / 0.6);
    list(0).slice(0, 4).forEach((s, i) => this.scorerLine(s, W / 2 - 520, 555 + i * 38, { alpha: a }));
    list(1).slice(0, 4).forEach((s, i) => this.scorerLine(s, W / 2 + 520, 555 + i * 38, { alpha: a }));
    // Stat bars, centred under the score
    const st = this.d.stats.teams;
    const rows = [['POSSESSION %', 'possession'], ['xG', 'xg'], ['SHOTS', 'shots'], ['ON TARGET', 'shots_on_target'], ['PASS ACCURACY %', 'pass_accuracy']];
    rows.forEach(([label, key], i) => {
      const y = 530 + i * 102, b = easeOut((t - 1.1 - i * 0.15) / 0.7);
      const h = +st.home[key] || 0, aw = +st.away[key] || 0, tot = h + aw || 1;
      this.text(label, W / 2, y, { size: 22, weight: 800, align: 'center', colour: 'rgba(255,255,255,.65)', spacing: 3, alpha: b });
      this.text(String(st.home[key]), W / 2 - 330, y + 38, { size: 32, weight: 900, align: 'right', alpha: b });
      this.text(String(st.away[key]), W / 2 + 330, y + 38, { size: 32, weight: 900, alpha: b });
      const bw = 560 * b;
      this.pill(W / 2 - 290, y + 16, 580, 16, 'rgba(255,255,255,0.08)');
      c.fillStyle = this.hc; c.beginPath(); c.roundRect(W / 2 - bw / 2, y + 16, bw * h / tot, 16, 8); c.fill();
      c.fillStyle = this.ac; c.beginPath(); c.roundRect(W / 2 - bw / 2 + bw * h / tot, y + 16, bw * aw / tot, 16, 8); c.fill();
    });
  }

  drawMotm(t) {
    const c = this.c;
    const ps = this.d.stats.players;
    const id = Object.keys(ps).reduce((b, k) => (!b || ps[k].rating > ps[b].rating ? k : b), null);
    const p = this.d.players.find(x => x.id === id), s = ps[id];
    const team = p.team === this.home.code ? this.home : this.away;
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * 0.3, H / 2, 50, W * 0.3, H / 2, 900);
    g.addColorStop(0, safeColour(team.colour)); g.addColorStop(1, DARK);
    c.globalAlpha = 0.55; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    this.stripes(t, 0.4); this.grid();
    const k = easeOut(t / 0.7);
    c.save(); c.shadowColor = 'rgba(100,181,246,.55)'; c.shadowBlur = 60; this.logoAt(team, W * 0.3 - (1 - k) * 300, H / 2, 420, k); c.restore();
    const gold = c.createLinearGradient(0, 0, 600, 0); gold.addColorStop(0, '#ffffff'); gold.addColorStop(1, '#bbdefb');   // was gold; white is the brand's accent
    this.text('PLAYER OF THE MATCH', W * 0.52, 360, { size: 40, weight: 900, colour: gold, spacing: 8, alpha: k });
    this.text(p.name.toUpperCase(), W * 0.52 + (1 - k) * 200, 470, { size: 92, weight: 900, italic: true, alpha: k, shadow: 20 });
    this.text(team.name.toUpperCase(), W * 0.52, 530, { size: 30, weight: 800, colour: 'rgba(255,255,255,.7)', spacing: 4, alpha: k });
    const b = easeOut((t - 0.6) / 0.6);
    this.pill(W * 0.52, 575, 200, 110, '#1e88e5', 20);   // Man of the Match rating: mid blue, as in real-world apps
    this.text(s.rating.toFixed(1), W * 0.52 + 100, 655, { size: 72, weight: 900, align: 'center', colour: '#fff', alpha: b });
    const line = [s.goals && `${s.goals} goal${s.goals > 1 ? 's' : ''}`, s.assists && `${s.assists} assist${s.assists > 1 ? 's' : ''}`, `${s.passes_completed}/${s.passes} passes`, s.saves && `${s.saves} saves`, s.tackles_won && `${s.tackles_won} tackles won`].filter(Boolean).slice(0, 4).join('   ·   ');
    this.text(line, W * 0.52 + 240, 645, { size: 30, weight: 700, alpha: b });
  }

  drawOutro(t) {
    const c = this.c;
    this.bg(0.9);
    const k = easeOut(t / 0.8);
    if (this.A.league) { c.save(); c.globalAlpha = k; c.shadowColor = 'rgba(66,165,245,.5)'; c.shadowBlur = 50; this.leagueFit((W / 2 - 110) + (220) / 2, (240) + (220) / 2, 220, 220); c.restore(); }
    this.text('vLEAGUE', W / 2, 560, { size: 90, weight: 900, align: 'center', spacing: 6, alpha: k });
    this.text('FULL MATCH REPLAY, LADDER AND STATS', W / 2, 640, { size: 30, weight: 800, align: 'center', colour: 'rgba(255,255,255,.7)', spacing: 4, alpha: easeOut((t - 0.5) / 0.6) });
    this.text('ldg224.github.io/s3', W / 2, 700, { size: 40, weight: 900, align: 'center', colour: LIME, alpha: easeOut((t - 0.8) / 0.6) });
    this.fadeOut(t, 4.5, 0.8);
  }

  // ------------------------------------------------ match footage

  // Director: splits each clip into camera shots, like a TV match director cutting between angles.
  //   build-up -> main broadcast camera or high wide "tactical" camera
  //   the chance -> behind-the-goal camera or low touchline close-up
  //   after a goal -> close-up following the scorer's celebration
  shotsFor(s) {
    if (this.camState.has(s)) return this.camState.get(s);
    const clip = s.clip, ev = clip.e, dur = s.dur, evL = clip.t - s.t0;
    const ballAtEvent = this.fr.at(clip.t).ball;
    const goalX = (ev.x ?? ballAtEvent[0]) > 52.5 ? 105 : 0;
    const idx = this.clips.indexOf(clip);
    // When does the attack reach the danger zone (30 m from goal)?
    let tA = null;
    for (let l = 0; l < evL; l += 0.2) {
      const b = this.fr.at(s.t0 + l).ball;
      if (Math.hypot(b[0] - goalX, b[1] - 34) < 30) { tA = l; break; }
    }
    if (tA == null) tA = evL - 3;
    tA = clamp(tA, Math.min(2.5, evL - 1.5), Math.max(0, evL - 2.2));
    const opening = ['main', 'wide', 'corner', 'high', 'spider'][idx % 5];
    const climax = clip.kind === 'save' ? 'endcam' : ['endcam', 'tight', 'corner', 'endcam', 'main'][idx % 5];
    const shots = [];
    const card = clip.kind === 'yellow' || clip.kind === 'red';
    if (card) {
      // Build-up, a close look at the foul (the player goes down), then REF CAM for the card.
      const foulL = evL, refFrom = Math.min(dur - 1.5, foulL + 1.7);
      if (foulL - 2.5 >= 2) shots.push({ from: 0, to: foulL - 2.5, angle: opening });
      shots.push({ from: shots.length ? foulL - 2.5 : 0, to: refFrom, angle: 'tight' });
      shots.push({ from: refFrom, to: dur, angle: 'refcam' });
    } else {
      if (tA >= 2) shots.push({ from: 0, to: tA, angle: opening });
      const after = evL + (clip.kind === 'goal' ? 1.2 : 0.9);
      shots.push({ from: shots.length ? tA : 0, to: Math.min(dur, after), angle: climax });
      if (dur - after >= 1.6) shots.push({ from: after, to: dur, angle: clip.kind === 'goal' ? 'celebrate' : 'main' });
      else shots[shots.length - 1].to = dur;
    }
    // Break up long shots with a second angle, so no single camera holds for too long.
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i], len = sh.to - sh.from;
      if (len > 8 && !['celebrate', 'refcam'].includes(sh.angle)) {
        const alt = { main: 'wide', wide: 'main', corner: 'main', high: 'wide', spider: 'main', endcam: 'main', tight: 'main' }[sh.angle] || 'main';
        const mid = sh.to - Math.min(6, len / 2);
        shots.splice(i, 1, { from: sh.from, to: mid, angle: alt }, { from: mid, to: sh.to, angle: sh.angle });
        i++;
      }
    }
    const plan = { shots, goalX };
    this.planReferee(s, plan);
    // Scorer, followed by the celebration camera.
    const scorerIdx = clip.kind === 'goal' ? this.d.players.findIndex(p => p.id === ev.scorer) : -1;
    // Smoothed target path per shot, so cuts are clean and each shot glides.
    for (const sh of shots) {
      const n = Math.ceil((sh.to - sh.from) * FPS) + 2, raw = [];
      for (let i = 0; i < n; i++) {
        const t = s.t0 + sh.from + i / FPS, st = this.fr.at(t);
        if (sh.angle === 'celebrate' && scorerIdx >= 0) raw.push(st.players[scorerIdx]);
        else if (sh.angle === 'refcam') raw.push(this.refAt(plan, t));
        else if (card && sh.angle === 'tight' && clip.foul && t >= clip.foul.t) raw.push([clip.foul.x, clip.foul.y]);
        else raw.push(st.ball);
      }
      const a = sh.angle === 'tight' || sh.angle === 'celebrate' || sh.angle === 'refcam' ? 0.12 : 0.07;
      const path = []; let cx = raw[0][0], cy = raw[0][1];
      for (const b of raw) { cx = lerp(cx, b[0], a); cy = lerp(cy, b[1], a); path.push([cx, cy]); }
      for (let i = path.length - 2; i >= 0; i--) { path[i][0] = lerp(path[i][0], path[i + 1][0], a * 2); path[i][1] = lerp(path[i][1], path[i + 1][1], a * 2); }
      sh.path = path;
    }
    this.camState.set(s, plan);
    return plan;
  }

  // The referee isn't in the match data, so he's animated here: he shadows play from the
  // inside of the pitch, about 10-15 m away, and sprints to the spot when there's a foul.
  // Fouled players go down; cards are shown by the referee once he arrives.
  planReferee(s, plan) {
    const t0 = s.t0, n = Math.ceil(s.dur * FPS) + 2;
    const fouls = this.d.events.filter(e => e.type === 'foul' && e.t >= t0 - 1 && e.t <= t0 + s.dur);
    const cards = this.d.events.filter(e => e.type === 'card' && e.t >= t0 - 1 && e.t <= t0 + s.dur);
    const ideal = b => [b[0] + (b[0] > 52.5 ? -11 : 11), b[1] + (b[1] < 34 ? 10 : -10)];
    let [rx, ry] = ideal(this.fr.at(t0).ball), vx = 0, vy = 0;
    const path = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + i / FPS, b = this.fr.at(t).ball;
      let [tx, ty] = ideal(b), vmax = 5.5;
      const f = fouls.find(f => t >= f.t && t < f.t + 6);
      if (f) { tx = f.x + 1.6; ty = f.y + (f.y < 34 ? 1.4 : -1.4); vmax = 7.6; }
      const dx = tx - rx, dy = ty - ry, d = Math.hypot(dx, dy);
      const want = Math.min(vmax, Math.sqrt(2 * 4 * Math.max(0, d - 0.4)));
      let dvx = (d > 1e-6 ? dx / d * want : 0) - vx, dvy = (d > 1e-6 ? dy / d * want : 0) - vy;
      const dv = Math.hypot(dvx, dvy), lim = 5 / FPS;
      if (dv > lim) { dvx *= lim / dv; dvy *= lim / dv; }
      vx += dvx; vy += dvy; rx = clamp(rx + vx / FPS, -1, 106); ry = clamp(ry + vy / FPS, -1, 69);
      path.push([rx, ry]);
    }
    plan.ref = { t0, path };
    plan.falls = fouls.map(f => {
      const idx = this.d.players.findIndex(p => p.id === f.on);
      if (idx < 0) return null;
      const pos = this.fr.at(f.t).players[idx];
      const prev = this.fr.at(f.t - 0.3).players[idx];
      return { idx, t: f.t, until: f.t + 3.2, x: pos[0], y: pos[1], ang: Math.atan2(pos[1] - prev[1], pos[0] - prev[0]) || 0 };
    }).filter(Boolean);
    // Card goes up once the referee reaches the players.
    plan.cards = cards.map(c => {
      const f = fouls.find(f => f.player === c.player && c.t - f.t < 3) || { t: c.t, x: c.x, y: c.y };
      let up = f.t + 1.5;
      for (let t = f.t; t < f.t + 5; t += 0.1) { const r = this.refAt(plan, t); if (Math.hypot(r[0] - f.x, r[1] - f.y) < 3.5) { up = t + 0.6; break; } }
      return { t: up, until: up + 3.8 + (c.card === 'second_yellow' ? SECOND_EXTRA : 0), colour: c.card === 'yellow' ? 'yellow' : 'red', second: c.card === 'second_yellow', player: c.player, foulT: f.t, e: c };
    });
  }
  refAt(plan, t) {
    return pathAt(plan.ref.path, (t - plan.ref.t0) * FPS);
  }

  camFor(s, local) {
    const tSim = s.t0 + local;
    const plan = this.shotsFor(s), { shots, goalX } = plan;
    const sh = shots.find(x => local >= x.from && local < x.to) || shots[shots.length - 1];
    const [bx, by] = pathAt(sh.path, (local - sh.from) * FPS);   // blended between samples, so close-up shots glide at any frame rate (B-05)
    const toGoal = Math.hypot(bx - goalX, by - 34);
    const gs = goalX === 105 ? 1 : -1;
    let cam;
    switch (sh.angle) {
      case 'corner': { // high in the corner of the stand, looking diagonally across the box
        const cy = by < 34 ? -16 : 84;
        cam = makeCamAt([goalX + gs * 16, cy, 21], [lerp(bx, goalX, 0.25), lerp(by, 34, 0.3), 0], 42); break;
      }
      case 'spider': // overhead cable camera following the ball
        cam = makeCam(clamp(bx, 10, 95), clamp(by, 10, 58), 30, 72, 52); break;
      case 'refcam': { // close on the referee, slowly pushing in
        const k = clamp((local - sh.from) / Math.max(1, sh.to - sh.from), 0, 1);
        const dist = lerp(12.5, 9.5, easeInOut(k)), e = 10 * Math.PI / 180;
        cam = makeCamAt([bx, by + dist * Math.cos(e), 1.7 + dist * Math.sin(e)], [bx, by, 1.75], 36); break;
      }
      case 'wide':   // high and far: shows the team shapes
        cam = makeCam(clamp(lerp(bx, 52.5, 0.4), 30, 75), 34 + (by - 34) * 0.3, 54, 44, 38); break;   // 54 m (was 74): players stay readable (B-06)
      case 'high':   // steep from the gantry, following play
        cam = makeCam(clamp(bx, 14, 91), clamp(by, 18, 50), 46, 58, 40); break;
      case 'tight':  // low on the touchline, close to the ball
        cam = makeCam(clamp(bx, 4, 101), clamp(by, 6, 62), 19, 15, 36); break;
      case 'celebrate':
        cam = makeCam(clamp(bx, 4, 101), clamp(by, 6, 62), 15, 12, 34); break;
      case 'endcam': { // behind the goal, looking out at the attack: ball and goal both in shot
        const tx = lerp(bx, goalX, 0.3), ty = lerp(by, 34, 0.3);
        cam = makeCamAt([goalX + gs * 13, clamp(lerp(34, by, 0.35), 24, 44), 7.5], [tx, ty, 0.5], 48); break;
      }
      default: {     // main broadcast camera; leans towards the goal as play gets close
        const k = clamp(1 - toGoal / 34, 0, 0.45);
        cam = makeCam(clamp(lerp(bx, goalX, k), 10, 95), clamp(lerp(by, 34, k * 0.6), 14, 54), 36, 27, 38);
      }
    }
    return { cam, tSim, cut: local - sh.from < 1 / FPS, angle: sh.angle, plan };
  }

  drawClip(s, local) {
    const c = this.c;
    const { cam, tSim, cut, angle, plan } = this.camFor(s, local);
    const st = this.fr.at(tSim);
    this.drawPitch(cam);
    this.drawGoal(cam, 0); this.drawGoal(cam, 105);
    // Players (and the referee) far to near, by distance from this camera
    const items = st.players.map((p, i) => {
      const fall = plan.falls.find(f => f.idx === i && tSim >= f.t && tSim < f.until + 0.5);
      let x = p[0], y = p[1], lying = false;
      if (fall) {
        // Down where he was fouled, then gets back up and rejoins his real position.
        const k = seg01(tSim, fall.until, fall.until + 0.5);
        x = lerp(fall.x, p[0], k); y = lerp(fall.y, p[1], k); lying = tSim < fall.until ? fall : false;
      }
      return { i, x, y, vx: st.vel[i][0], vy: st.vel[i][1], lying, d: cam.p(x, y)?.[2] ?? 0 };
    });
    const [rx, ry] = this.refAt(plan, tSim);
    const card = plan.cards.find(k => tSim >= k.t && tSim < k.until);
    items.push({ ref: true, x: rx, y: ry, card, d: cam.p(rx, ry)?.[2] ?? 0 });
    items.sort((a, b) => a.d - b.d);
    // ball trail (reset on every camera cut)
    const bp = cam.p(st.ball[0], st.ball[1], st.ball[2]);
    if (local < 1 / FPS * 1.5 || cut) this.trail = [];
    if (bp && st.inPlay) { this.trail.push(bp); if (this.trail.length > 10) this.trail.shift(); }
    const bd = cam.p(st.ball[0], st.ball[1])?.[2] ?? 0;
    let ballDrawn = false;
    for (const it of items) {
      if (!ballDrawn && it.d > bd) { this.drawBall(cam, st); ballDrawn = true; }
      if (it.ref) this.drawReferee(cam, it, tSim);
      else if (it.lying) this.drawLying(cam, it);
      else this.drawPlayer(cam, it, st.holder === it.i);
    }
    if (!ballDrawn) this.drawBall(cam, st);
    // Vignette
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.0);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    if (angle === 'refcam') this.drawRefCamOverlay(local);
    this.drawClipOverlays(s, local, tSim, plan);
  }

  drawRefCamOverlay(local) {
    const c = this.c;
    // Letterbox bars and a "REF CAM" tag, like a broadcast's referee camera.
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(0, 0, W, 70); c.fillRect(0, H - 70, W, 70);
    const x = W - 330, y = 100;
    this.pill(x, y, 270, 60, 'rgba(6,26,56,0.9)', 12);
    if (Math.floor(local * 2) % 2 === 0) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x + 34, y + 30, 10, 0, Math.PI * 2); c.fill(); }
    this.text('REF CAM', x + 58, y + 42, { size: 32, weight: 900, spacing: 4 });
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
    for (const [cx, cy, sx, sy] of [[90, 110, 1, 1], [W - 90, 110 + 80, -1, 1], [90, H - 110, 1, -1], [W - 90, H - 110, -1, -1]]) {
      c.beginPath(); c.moveTo(cx, cy + sy * 40); c.lineTo(cx, cy); c.lineTo(cx + sx * 40, cy); c.stroke();
    }
  }

  // Referee: black kit; runs in after a foul and holds the card up, with its colour shown above his head.
  drawReferee(cam, it, tSim) {
    const c = this.c, p = cam.p(it.x, it.y); if (!p) return;
    const head = cam.p(it.x, it.y, 1.85); if (!head) return;
    const bh = p[1] - head[1], bw = Math.max(12, bh * 0.42), bx = p[0], top = head[1];
    const r = Math.max(10, p[2] * 0.6);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(bx + r * 0.4, p[1], r * 1.05, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(bx - bw, 0, bx + bw, 0); g.addColorStop(0, '#2b2f38'); g.addColorStop(1, DARK);
    c.fillStyle = g; c.beginPath(); c.roundRect(bx - bw / 2, top + bh * 0.28, bw, bh * 0.72, bw / 2); c.fill();
    c.fillStyle = LIME; c.fillRect(bx - bw / 2, top + bh * 0.3, bw, Math.max(2, bh * 0.04));   // collar trim
    c.fillStyle = '#e8b894'; c.beginPath(); c.arc(bx, top + bh * 0.16, bw * 0.34, 0, Math.PI * 2); c.fill();
    if (it.card) {
      const sc = it.card.second ? secondCardPhase(tSim - it.card.t) : null;   // a second yellow: yellow up, hand down, pocket, red up
      const shown = sc ? sc.col : it.card.colour;                              // the card in his hand (none while he reaches)
      const col = shown === 'yellow' ? '#facc15' : '#ef4444';
      const k = sc ? sc.up : easeOut((tSim - it.card.t) / 0.25);
      const shoulder = [bx + bw * 0.35, top + bh * 0.34];
      let hand;
      if (sc) {
        const hip = [bx + bw * 0.42, top + bh * 0.66], raised = [bx + bw * 0.55, top - bh * 0.28], p = sc.reach ?? 0;
        hand = [lerp(hip[0], raised[0], k) + bw * 0.1 * Math.sin(p * Math.PI), lerp(hip[1], raised[1], k) + bh * 0.05 * Math.sin(p * Math.PI * 3)];
      } else hand = [bx + bw * 0.55, top - bh * 0.28 * k];
      c.strokeStyle = '#1d212a'; c.lineWidth = Math.max(3, bw * 0.28); c.lineCap = 'round';
      c.beginPath(); c.moveTo(...shoulder); c.lineTo(...hand); c.stroke();
      if (shown) {
        const cw = Math.max(8, bw * 0.5), ch = cw * 1.4;
        c.fillStyle = col; c.fillRect(hand[0] - cw / 2, hand[1] - ch, cw, ch);
        // Big card icon floating above his head so it reads at any distance
        const iw = clamp(bw * 0.8, 24, 70), ih = iw * 1.4, ix = bx - iw / 2, iy = top - ih - Math.max(14, bh * 0.22) - (1 - k) * 20;
        c.save(); c.shadowColor = col; c.shadowBlur = 30; c.fillStyle = col; c.beginPath(); c.roundRect(ix, iy, iw, ih, 4); c.fill(); c.restore();
        c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2; c.strokeRect(ix, iy, iw, ih);
      }
    } else {
      this.text('REF', bx, top - 10, { size: Math.max(10, bw * 0.45), weight: 900, align: 'center', colour: 'rgba(255,255,255,0.75)' });
    }
  }

  // A fouled player lying on the grass.
  drawLying(cam, it) {
    const c = this.c, side = it.i < this.nHome ? 0 : 1;
    let col = side ? this.ac : this.hc;
    if (this.gkIdx.has(it.i)) col = side ? '#a855f7' : '#f5b042';
    const a = it.lying.ang, hx = it.x + Math.cos(a) * 0.95, hy = it.y + Math.sin(a) * 0.95, fx = it.x - Math.cos(a) * 0.85, fy = it.y - Math.sin(a) * 0.85;
    const H0 = cam.p(hx, hy, 0.18), F0 = cam.p(fx, fy, 0.15), M = cam.p(it.x, it.y, 0.2);
    if (!H0 || !F0 || !M) return;
    const w = Math.max(8, M[2] * 0.5);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(M[0], M[1] + w * 0.3, Math.abs(H0[0] - F0[0]) / 2 + w, w * 0.6, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(F0[0], F0[1]); c.lineTo(H0[0], H0[1]); c.stroke();
    c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(H0[0], H0[1], w * 0.55, 0, Math.PI * 2); c.fill();
  }

  quad(cam, pts, fill) {
    const P = cam.poly(pts); if (P.length < 3) return;
    const c = this.c; c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath(); c.fillStyle = fill; c.fill();
  }
  line(cam, pts, width = 3, colour = 'rgba(255,255,255,0.85)', close = false) {
    const c = this.c; c.beginPath();
    const list = close ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < list.length; i++) {
      const s = cam.seg(list[i], list[i + 1]); if (!s) continue;
      c.moveTo(s[0][0], s[0][1]); c.lineTo(s[1][0], s[1][1]);
    }
    c.lineWidth = width; c.lineCap = 'round'; c.strokeStyle = colour; c.stroke();
  }
  arc(cx, cy, r, a0, a1, n = 40) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }

  drawPitch(cam) {
    const c = this.c;
    const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#05070a'); sky.addColorStop(1, '#0b1410');
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    this.drawStands(cam);
    this.quad(cam, [[-7, -6], [112, -6], [112, 74], [-7, 74]], '#1d5a2a');
    for (let i = 0; i < 12; i++) this.quad(cam, [[i * 8.75, 0], [(i + 1) * 8.75, 0], [(i + 1) * 8.75, 68], [i * 8.75, 68]], i % 2 ? '#2d7a3b' : '#327f40');
    const lw = 3;
    this.line(cam, [[0, 0], [105, 0], [105, 68], [0, 68]], lw, undefined, true);
    this.line(cam, [[52.5, 0], [52.5, 68]], lw);
    this.line(cam, this.arc(52.5, 34, 9.15, 0, Math.PI * 2, 60), lw);
    for (const [x0, s] of [[0, 1], [105, -1]]) {
      this.line(cam, [[x0, 13.84], [x0 + s * 16.5, 13.84], [x0 + s * 16.5, 54.16], [x0, 54.16]], lw);
      this.line(cam, [[x0, 24.84], [x0 + s * 5.5, 24.84], [x0 + s * 5.5, 43.16], [x0, 43.16]], lw);
      const a = Math.acos(5.5 / 9.15);
      this.line(cam, this.arc(x0 + s * 11, 34, 9.15, s > 0 ? -a : Math.PI - a, s > 0 ? a : Math.PI + a, 24), lw);
      const spot = cam.p(x0 + s * 11, 34); if (spot) { c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(spot[0], spot[1], 3, 0, Math.PI * 2); c.fill(); }
    }
    const cs = cam.p(52.5, 34); if (cs) { c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(cs[0], cs[1], 3.5, 0, Math.PI * 2); c.fill(); }
    this.drawBoards(cam);
  }

  // Advertising boards along the far touchline (y = -3, 1 m tall, facing the pitch). The branding is
  // painted onto each 15 m panel in perspective, so it turns with the boards as the camera moves
  // (it used to be flat screen text that always faced the camera). From behind, only the back shows.
  drawBoards(cam) {
    const c = this.c, Y = -3, Z = 1, X0 = -5, X1 = 110, PANEL = 15;
    this.quad(cam, [[X0, Y, 0], [X1, Y, 0], [X1, Y, Z], [X0, Y, Z]], DARK);
    if (cam.C && cam.C[1] <= Y) return;   // behind the boards: their back is blank
    for (let x = X0, i = 0; x < X1; x += PANEL, i++) this.boardPanel(cam, x, Math.min(X1, x + PANEL), Y, Z, ...(i % 2 ? ['VIRTUAL FOOTBALL', '#90caf9', DARK] : ['vLEAGUE', '#ffffff', '#1565c0']));
  }
  // One panel's artwork, drawn in thin vertical strips; each strip is an affine map of the image
  // onto the projected board, which together give the perspective.
  boardPanel(cam, xa, xb, y, z, label, colour, back = DARK) {
    const art = this.boardArt(label, colour, (xb - xa) / z, back), c = this.c, N = 14, sw = art.width / N;
    for (let k = 0; k < N; k++) {
      const x = xa + (xb - xa) * k / N, x2 = xa + (xb - xa) * (k + 1) / N;
      const tl = cam.p(x, y, z), tr = cam.p(x2, y, z), bl = cam.p(x, y, 0);
      if (!tl || !tr || !bl) continue;
      c.save();
      c.transform((tr[0] - tl[0]) / sw, (tr[1] - tl[1]) / sw, (bl[0] - tl[0]) / art.height, (bl[1] - tl[1]) / art.height, tl[0], tl[1]);
      c.drawImage(art, k * sw, 0, sw, art.height, 0, 0, sw + 0.6, art.height);   // a hair of overlap hides seams
      c.restore();
    }
  }
  boardArt(label, colour, aspect, back = DARK) {
    const key = `${label}|${colour}|${aspect}|${back}`;
    this._boardArt ||= new Map();
    if (this._boardArt.has(key)) return this._boardArt.get(key);
    const h = 64, w = Math.round(h * aspect), cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = back; g.fillRect(0, 0, w, h);
    g.fillStyle = colour; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 0.62)}px ${FONT}`;
    g.fillText(label, w / 2, h / 2 + 2, w * 0.92);
    this._boardArt.set(key, cv);
    return cv;
  }

  // Four stands of crowd around the pitch (only the faces this camera can see).
  drawStands(cam) {
    const c = this.c;
    if (!this.crowd) {
      const s = document.createElement('canvas'); s.width = s.height = 64; const g = s.getContext('2d');
      g.fillStyle = '#10141b'; g.fillRect(0, 0, 64, 64);
      const cols = ['#2a3140', '#3b4252', '#1c2230', '#4b5563', '#5b2130', '#1f3b5b', this.hc, this.ac, '#cbd5e1'];
      for (let i = 0; i < 260; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.globalAlpha = 0.35 + Math.random() * 0.5; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
      this.crowd = c.createPattern(s, 'repeat');
    }
    const faces = [
      [[-12, -6, 0], [117, -6, 0], [117, -26, 14], [-12, -26, 14]],     // far side
      [[-12, 74, 0], [117, 74, 0], [117, 94, 14], [-12, 94, 14]],        // near side
      [[-7, -12, 0], [-7, 80, 0], [-27, 80, 12], [-27, -12, 12]],        // left end
      [[112, -12, 0], [112, 80, 0], [132, 80, 12], [132, -12, 12]],      // right end
    ];
    for (const f of faces) {
      const P = cam.poly(f);
      if (P.length < 3) continue;
      c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath();
      c.fillStyle = this.crowd; c.fill();
      const g = c.createLinearGradient(0, Math.min(...P.map(p => p[1])), 0, Math.max(...P.map(p => p[1])));
      g.addColorStop(0, 'rgba(5,7,10,0.75)'); g.addColorStop(1, 'rgba(5,7,10,0.15)');
      c.fillStyle = g; c.fill();
    }
  }

  drawGoal(cam, gx) {
    const s = gx === 0 ? -1 : 1, d = 2;
    const net = 'rgba(255,255,255,0.35)';
    for (let i = 0; i <= 6; i++) { const y = GOAL_Y1 + (GOAL_Y2 - GOAL_Y1) * i / 6; this.line(cam, [[gx, y, GOAL_H], [gx + s * d, y, GOAL_H * 0.7], [gx + s * d, y, 0]], 1, net); }
    for (let i = 0; i <= 4; i++) { const z = GOAL_H * i / 4; this.line(cam, [[gx + s * d, GOAL_Y1, z * 0.7], [gx + s * d, GOAL_Y2, z * 0.7]], 1, net); }
    this.line(cam, [[gx, GOAL_Y1, 0], [gx, GOAL_Y1, GOAL_H], [gx, GOAL_Y2, GOAL_H], [gx, GOAL_Y2, 0]], 5, '#ffffff');
  }

  // The shirt number on a player's disc: the league's real number, or for a test match's made-up players the last two digits of the id.
  shirtNo(id) {
    this._no ||= new Map((this.season?.players || []).map(p => [String(p.id), p.number]));
    const n = this._no.get(String(id));
    return n == null || n === '' ? shirt(id) : String(n);
  }
  drawPlayer(cam, it, holder) {
    const c = this.c, p = cam.p(it.x, it.y); if (!p) return;
    const side = it.i < this.nHome ? 0 : 1;
    let col = side ? this.ac : this.hc;
    if (this.gkIdx.has(it.i)) col = side ? '#a855f7' : '#f5b042';
    const r = Math.max(10, p[2] * 0.6);
    const head = cam.p(it.x, it.y, 1.85);
    const top = head ? head[1] : p[1] - r * 2;
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(p[0] + r * 0.4, p[1], r * 1.05, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    // body: a short upright capsule, like a player figure seen from the stand
    const bx = p[0], bh = p[1] - top, bw = Math.max(12, bh * 0.42);
    const g = c.createLinearGradient(bx - bw, 0, bx + bw, 0); g.addColorStop(0, col); g.addColorStop(1, shade(col, 0.55));
    c.fillStyle = g; c.beginPath(); c.roundRect(bx - bw / 2, top + bh * 0.28, bw, bh * 0.72, bw / 2); c.fill();
    c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(bx, top + bh * 0.16, bw * 0.34, 0, Math.PI * 2); c.fill();
    if (holder) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.ellipse(p[0], p[1], r * 1.5, r * 0.6, 0, 0, Math.PI * 2); c.stroke(); }
    // shirt number
    const pl = this.d.players[it.i];
    this.text(this.shirtNo(pl.id), bx, top + bh * 0.62, { size: Math.max(9, bw * 0.55), weight: 900, align: 'center', colour: onColour(col), base: 'middle' });
    if (holder) {
      const name = lastName(pl.name).toUpperCase(), fs = 24;
      c.font = `900 ${fs}px ${FONT}`; const w = c.measureText(name).width + 28;
      this.pill(bx - w / 2, top - 46, w, 36, 'rgba(6,26,56,0.88)', 10);
      c.fillStyle = col; c.fillRect(bx - w / 2, top - 46, 6, 36);
      this.text(name, bx + 3, top - 20, { size: fs, weight: 900, align: 'center' });
    }
  }

  drawBall(cam, st) {
    const c = this.c, [x, y, z] = st.ball, alpha = st.ballAlpha ?? (st.inPlay ? 1 : 0.4);
    if (alpha < 0.02) return;
    const g = cam.p(x, y, 0), b = cam.p(x, y, z + 0.11); if (!g || !b) return;
    c.save(); c.globalAlpha = alpha;
    if (this.trail.length > 2 && st.inPlay) {
      c.beginPath(); c.moveTo(this.trail[0][0], this.trail[0][1]);
      for (const q of this.trail) c.lineTo(q[0], q[1]);
      const tg = c.createLinearGradient(this.trail[0][0], this.trail[0][1], b[0], b[1]); tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(255,255,255,0.45)');
      c.strokeStyle = tg; c.lineWidth = Math.max(2, b[2] * 0.18); c.lineCap = 'round'; c.stroke();
    }
    const r = Math.max(4.5, b[2] * 0.22);
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(g[0], g[1], r * 1.1, r * 0.5, 0, 0, Math.PI * 2); c.fill();
    const bg = c.createRadialGradient(b[0] - r / 3, b[1] - r / 3, 1, b[0], b[1], r);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#c9ced6');
    c.fillStyle = bg; c.beginPath(); c.arc(b[0], b[1] - r * 0.2, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1; c.beginPath(); c.arc(b[0], b[1] - r * 0.2, r, 0, Math.PI * 2); c.stroke();
    c.restore();
  }

  drawClipOverlays(s, local, tSim, plan) {
    const clip = s.clip, ev = clip.e;
    // Opening tag: minute + moment type
    const tagA = seg01(local, 0.3, 0.8) * (1 - seg01(local, 3.2, 3.7));
    if (s.type === 'clip' && tagA > 0) {
      const label = { goal: 'GOAL', chance: 'BIG CHANCE', save: 'GREAT SAVE', woodwork: 'OFF THE WOODWORK', red: 'RED CARD', yellow: 'BOOKING' }[clip.kind];
      const team = ev.team === this.home.code ? this.home : this.away;
      const x = 70 - (1 - easeOut(tagA)) * 60, y = H - 150;
      this.c.save(); this.c.globalAlpha = tagA;
      this.pill(x, y, 110, 54, this.limeGrad(x, y, x + 110, y + 54), 10);
      this.text(`${ev.minute}'`, x + 55, y + 38, { size: 30, weight: 900, align: 'center', colour: '#fff' });
      this.pill(x + 120, y, 360, 54, 'rgba(6,26,56,0.88)', 10);
      this.c.fillStyle = safeColour(team.colour); this.c.fillRect(x + 120, y, 6, 54);
      this.text(label, x + 142, y + 37, { size: 26, weight: 900, spacing: 3 });
      this.c.restore();
    }
    if (s.type === 'replay') {
      const a = seg01(local, 0.1, 0.5);
      this.c.save(); this.c.globalAlpha = a;
      this.pill(W - 290, 52, 220, 56, 'rgba(6,26,56,0.88)', 12);
      this.c.fillStyle = LIME; this.c.beginPath(); this.c.arc(W - 258, 80, 9, 0, Math.PI * 2); this.c.fill();
      this.text('REPLAY', W - 236, 91, { size: 30, weight: 900, spacing: 4 });
      this.c.restore();
      this.c.fillStyle = 'rgba(66,165,245,0.9)'; this.c.fillRect(0, 0, W, 5); this.c.fillRect(0, H - 5, W, 5);
    }
    // Goal banner
    if (s.type === 'clip' && clip.kind === 'goal') {
      const since = (tSim - ev.t) / s.speed;
      if (since >= 0) this.goalBanner(ev, since);
    } else if (s.type === 'clip' && (clip.kind === 'yellow' || clip.kind === 'red')) {
      // Caption appears as the referee shows the card.
      const k = plan?.cards.find(x => x.e === ev);
      const since = tSim - (k ? k.t + (k.second ? RED_AT : 0) : clip.t + 2);
      if (since >= 0 && since < 3.4) this.lowerThird(clip, since);
    } else if (s.type === 'clip') {
      const since = (tSim - clip.t) / s.speed;
      if (since >= 0 && since < 3.2) this.lowerThird(clip, since);
    }
  }

  // `hold` = seconds before the banner slides away (the broadcast view keeps it up longer).
  goalBanner(ev, t, hold = 3.6) {
    const c = this.c, team = ev.team === this.home.code ? this.home : this.away, col = safeColour(team.colour);
    const inK = easeOut(t / 0.45), outK = seg01(t, hold, hold + 0.5), a = 1 - outK;
    if (a <= 0) return;
    const y = H - 330, h = 190;
    c.save(); c.globalAlpha = a;
    c.translate(-(1 - inK) * W, 0);
    c.save(); c.beginPath(); c.moveTo(0, y); c.lineTo(W * 0.78, y); c.lineTo(W * 0.72, y + h); c.lineTo(0, y + h); c.closePath(); c.clip();
    const g = c.createLinearGradient(0, 0, W * 0.8, 0); g.addColorStop(0, col); g.addColorStop(1, shade(col, 0.45));
    c.fillStyle = g; c.fillRect(0, y, W, h);
    this.stripes(t * 3, 0.7);
    c.restore();
    c.fillStyle = this.limeGrad(0, y + h, W * 0.72, y + h + 12);
    c.beginPath(); c.moveTo(0, y + h); c.lineTo(W * 0.72, y + h); c.lineTo(W * 0.715, y + h + 12); c.lineTo(0, y + h + 12); c.fill();
    this.pill(90, y + 28, 134, 134, 'rgba(255,255,255,0.95)', 67);
    this.logoAt(team, 157, y + 95, 108);
    const tc = onColour(col);
    const pop = 1 + 0.12 * Math.max(0, 1 - t / 0.35);
    c.save(); c.translate(270, y + 128); c.scale(pop, pop);
    this.text('GOAL!', 0, 0, { size: 128, weight: 900, italic: true, colour: tc, shadow: 16 });
    c.restore();
    const sc = this.scoreAt(ev.t + 0.01);
    const name = this.names[ev.scorer] || '';
    this.text(`${name.toUpperCase()}${ev.own_goal ? '  (OG)' : ''}`, 740, y + 88, { size: 50, weight: 900, colour: tc, italic: true });
    this.text(`${ev.minute}'${ev.assist ? `   ·   ASSIST ${lastName(this.names[ev.assist]).toUpperCase()}` : ''}   ·   ${this.home.code} ${sc[0]}-${sc[1]} ${this.away.code}`,
      742, y + 140, { size: 30, weight: 800, colour: tc, alpha: 0.9 });
    c.restore();
  }

  lowerThird(clip, t) {
    const c = this.c, ev = clip.e;
    const a = easeOut(t / 0.3) * (1 - seg01(t, 2.7, 3.2));
    const text = clip.kind === 'save' ? `SAVE!  ·  ${this.keeperName(ev)}` : clip.kind === 'woodwork' ? `OFF THE ${ev.end_z > 2.2 ? 'BAR' : 'POST'}!  ·  ${lastName(this.names[ev.player])}`
      : clip.kind === 'red' ? `${ev.card === 'second_yellow' ? 'SECOND YELLOW' : 'RED CARD'}  ·  ${this.names[ev.player]}` : clip.kind === 'yellow' ? `YELLOW CARD  ·  ${this.names[ev.player]}`
      : `SO CLOSE!  ·  ${lastName(this.names[ev.player])}  ·  xG ${ev.xg?.toFixed(2)}`;
    const cardCol = clip.kind === 'red' ? '#ef4444' : clip.kind === 'yellow' ? '#facc15' : null;
    const second = clip.kind === 'red' && ev.card === 'second_yellow';   // yellow and red together
    c.save(); c.globalAlpha = a;
    c.font = `900 38px ${FONT}`; const w = c.measureText(text).width + 70 + (cardCol ? 50 : 0) + (second ? 20 : 0);
    const x = W / 2 - w / 2, y = H - 240;
    this.pill(x, y, w, 76, 'rgba(6,26,56,0.9)', 14);
    c.fillStyle = this.limeGrad(x, y, x + w, y); c.fillRect(x, y + 70, w * easeOut(t / 0.6), 6);
    if (cardCol) {
      if (second) { c.fillStyle = '#facc15'; c.beginPath(); c.roundRect(x + 44, y + 20, 34, 48, 5); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.stroke(); }
      c.fillStyle = cardCol; c.beginPath(); c.roundRect(x + 30, y + 14, 34, 48, 5); c.fill();
      if (second) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.stroke(); }
    }
    this.text(text, W / 2 + (cardCol ? 25 : 0) + (second ? 10 : 0), y + 51, { size: 38, weight: 900, align: 'center' });
    c.restore();
  }
  keeperName(ev) {
    const save = this.d.events.find(e => e.type === 'save' && e.t >= ev.t && e.t - ev.t < 3);
    return save ? lastName(this.names[save.player]).toUpperCase() : 'KEEPER';
  }

  // ------------------------------------------------ persistent overlays


  // The round's look (0.36): its design (Classic, Finals, Grand Final, Christmas, Derby, or any look added as data), its accent,
  // banner and ornament, and the round's own name for the plate above the score bug ("Opening Week").
  look() {
    if (this._look) return this._look;
    const S = this.season || {}, fx = this.fx || {}, row = S.looks?.[fx.look], st = row?.settings || {}, r = S.rounds?.[fx.week] || {};
    const stage = fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Grand Final' : null;
    const big = stage || r.name || r.label || (fx.week != null ? `Week ${fx.week}` : '');
    const small = stage ? (r.name || r.label || '') : (r.name && r.numbered && r.no ? `Round ${r.no}` : '');
    return (this._look = { key: row ? fx.look : 'classic', accent: /^#[0-9a-f]{6}$/i.test(st.accent || '') ? st.accent : null, banner: st.banner || '', ornament: st.ornament || '', big, small });
  }

  // The score bug in the round's design: a plate with the round's name above, then the board. Both the highlights and the
  // broadcast view draw it, so a Grand Final looks like a Grand Final in either.
  scoreBoard(x, y, sc, clock) {
    const c = this.c, L = this.look(), w = 560, h = 64, key = L.key, acc = L.accent;
    const plateText = [L.ornament, L.big.toUpperCase(), L.banner && L.banner.toLowerCase() !== L.big.toLowerCase() ? `· ${L.banner}` : ''].filter(Boolean).join(' ');
    const star = key === 'grand_final' ? '★ ' : '';
    const label = `${star}${plateText}${star ? ' ★' : ''}`.trim();
    c.save(); c.font = `800 22px ${FONT}`; const pw = Math.min(w, Math.max(180, c.measureText(label).width + 56)); c.restore();
    const ph = 36, py = y - ph + 2;
    const gold = (a, b) => { const g = c.createLinearGradient(x, py, x, py + ph); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
    // plate
    let plateFill = 'rgba(21,101,192,.95)', plateInk = '#fff';
    if (key === 'finals') { plateFill = gold('#ffe08a', '#f5c542'); plateInk = '#2a1d00'; }
    else if (key === 'grand_final') { plateFill = gold('#fff3b0', '#d4a900'); plateInk = '#2a1d00'; }
    else if (key === 'christmas') { plateFill = '#c62828'; }
    else if (key === 'derby') { plateFill = gold('#ff8a50', '#ff7043'); plateInk = '#1b0a00'; }
    else if (key !== 'classic' && acc) { plateFill = acc; plateInk = onColour(acc); }
    c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 16;
    c.beginPath(); c.roundRect(x, py, pw, ph + 6, [12, 12, 0, 0]); c.fillStyle = plateFill; c.fill(); c.restore();
    if (key === 'christmas') { c.save(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.roundRect(x + 3, py + 3, pw - 6, ph - 2, [9, 9, 0, 0]); c.stroke(); c.restore(); }
    this.text(label, x + pw / 2, py + 27, { size: 22, weight: 900, align: 'center', colour: plateInk, spacing: 2 });
    // board
    c.save(); c.shadowColor = key === 'grand_final' ? 'rgba(255,215,0,.55)' : 'rgba(0,0,0,.4)'; c.shadowBlur = key === 'grand_final' ? 30 : 20;
    let fill = 'rgba(6,26,56,0.92)';
    if (key === 'christmas') fill = 'rgba(15,38,26,0.95)';
    else if (key === 'grand_final') fill = 'rgba(14,20,32,0.96)';
    else if (key === 'derby') { const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, mixHex(this.hc, '#0b0f17', 0.72)); g.addColorStop(0.49, '#0b0f17'); g.addColorStop(0.51, '#0b0f17'); g.addColorStop(1, mixHex(this.ac, '#0b0f17', 0.72)); fill = g; }
    this.pill(x, y, w, h, fill, [0, 14, 14, 14]);
    c.restore();
    // trim
    c.save(); c.lineWidth = 3;
    if (key === 'finals') { c.strokeStyle = '#f5c542'; c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.stroke(); }
    else if (key === 'grand_final') { c.strokeStyle = '#ffd700'; c.lineWidth = 4; c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.stroke(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,215,0,.6)'; c.beginPath(); c.roundRect(x + 5, y + 5, w - 10, h - 10, 10); c.stroke(); }
    else if (key === 'christmas') {
      c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.clip();
      c.lineWidth = 7; const cols = ['#c62828', '#ffffff', '#2e7d32'];
      for (let i = -h, k = 0; i < w + h; i += 16, k++) { c.strokeStyle = cols[k % 3]; c.beginPath(); c.moveTo(x + i, y + h + 4); c.lineTo(x + i + h + 8, y - 4); c.stroke(); }
      c.fillStyle = 'rgba(15,38,26,.97)'; c.beginPath(); c.roundRect(x + 5, y + 5, w - 10, h - 10, 10); c.fill();
    } else if (key === 'derby') { c.fillStyle = '#ff7043'; c.fillRect(x, y + h - 5, w, 5); }
    else if (key !== 'classic' && acc) { c.strokeStyle = acc; c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.stroke(); }
    c.restore();
    // contents
    if (this.A.league) this.leagueFit((x + 12) + (44) / 2, (y + 10) + (44) / 2, 44, 44);
    c.fillStyle = this.hc; c.fillRect(x + 70, y + 12, 6, 40);
    this.text(this.home.code, x + 88, y + 44, { size: 32, weight: 900 });
    this.pill(x + 184, y + 10, 124, 44, '#ffffff', 10);
    this.text(`${sc[0]} - ${sc[1]}`, x + 246, y + 44, { size: 32, weight: 900, align: 'center', colour: DARK });
    this.text(this.away.code, x + 322, y + 44, { size: 32, weight: 900 });
    c.fillStyle = this.ac; c.fillRect(x + 408, y + 12, 6, 40);
    const clockFill = key === 'finals' || key === 'grand_final' ? gold('#ffe08a', '#d4a900') : key === 'christmas' ? '#c62828' : key === 'derby' ? '#ff7043' : this.limeGrad(x + 428, y, x + 548, y);
    this.pill(x + 428, y + 12, 120, 40, clockFill, 10);
    this.text(clock, x + 488, y + 42, { size: 26, weight: 900, align: 'center', colour: key === 'finals' || key === 'grand_final' || key === 'derby' ? '#1b1400' : '#fff' });
    // A test match (made-up players) says so on screen, in the broadcast and the highlights.
    if (this.fx?.test) {
      const tw = 330, tx = W / 2 - tw / 2, ty = 22;
      c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 16; this.pill(tx, ty, tw, 50, '#ffd43b', 12); c.restore();
      c.fillStyle = '#1b1400'; for (let i = 0; i < 7; i++) c.fillRect(tx + 14 + i * 12, ty + 40, 7, 4);
      this.text('TEST MATCH', W / 2, ty + 36, { size: 34, weight: 900, align: 'center', colour: '#1b1400', spacing: 5 });
    }
  }

  drawBug() {
    const T = this._T, s = this.segAt(T);
    if (!['clip', 'replay'].includes(s.type)) return;
    const c = this.c, tSim = s.t0 + (T - s.start) * s.speed;
    const sc = this.scoreAt(tSim);
    const x = 60, y = 86;
    this.scoreBoard(x, y, sc, this.clockAt(tSim));
    this.addedBoard(x, y, tSim);
    // Corner watermark
    if (this.A.league) { c.globalAlpha = 0.75; this.leagueFit((W - 110) + (60) / 2, (H - 110) + (60) / 2, 60, 60); c.globalAlpha = 1; }
  }

  drawTransition(T) {
    // Branded wipe across every cut between segments.
    const c = this.c, len = 0.4;
    for (let i = 1; i < this.segs.length; i++) {
      const b = this.segs[i].start, d = T - b;
      if (d < -len || d > len) continue;
      const k = (d + len) / (2 * len);             // 0..1 across the cut
      const x = lerp(W * 1.25, -W * 0.6, easeInOut(k));
      c.save();
      c.translate(x, 0); c.transform(1, 0, -0.35, 1, 0, 0);
      c.fillStyle = DARK; c.fillRect(0, 0, W * 0.9, H);
      c.fillStyle = this.limeGrad(0, 0, 140, 0); c.fillRect(-60, 0, 60, H);
      c.fillStyle = 'rgba(66,165,245,0.35)'; c.fillRect(-110, 0, 22, H);
      c.fillStyle = this.limeGrad(W * 0.9, 0, W * 0.9 + 40, 0); c.fillRect(W * 0.9, 0, 40, H);
      c.restore();
      if (this.A.league && Math.abs(d) < len * 0.6) {
        const a = 1 - Math.abs(d) / (len * 0.6);
        c.save(); c.globalAlpha = a; this.leagueFit((W / 2 - 80) + (160) / 2, (H / 2 - 80) + (160) / 2, 160, 160); c.restore();
      }
    }
  }

  frame(T) { this._T = T; this.draw(T); return this.cv; }
}

function shade(hex, k) {
  const c = safeColour(hex).slice(1), n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
}

// ---------------------------------------------------------------- assets

export async function loadAssets(teams) {
  const logos = {}, logosAlt = {};
  await Promise.all(teams.map(async t => {
    logos[t.code] = await loadImg(logoPath(t.code));
    logosAlt[t.code] = await loadImg(logoPath(t.code, true));
  }));
  const [league, title] = await Promise.all([loadImg('assets/brand/crest.svg'), loadImg('assets/img/stadium-dusk.jpg')]);
  await Promise.all(['500 40px Oswald', '700 40px Oswald', '700 40px Figtree'].map(f => document.fonts.load(f).catch(() => {})));
  return { logos, logosAlt, league, title };
}

export { Frames, makeCam, makeCamAt, shade, clamp, lerp, easeOut, easeInOut, seg01, lastName, LIME, LIME2, YEL, DARK, FONT };
