// Full-match "broadcast" view: the whole match drawn like the highlights (3D camera, stands,
// referee, score bug and clock, goal banners, card graphics, half-time and full-time scorelines,
// goal and chance replays, REF CAM), for watching live or after full time.
//
//   const r = new BroadcastRenderer(data, { season, fixture, assets, scale });
//   r.frame(tSim)  -> canvas (W*scale × H*scale), for any sim time in [r.t0, r.t1]
//
// frame(tSim) is a pure function of tSim: the camera path and the "director" (which shot is on
// air when) are worked out once for the whole match, so seeking, live jumps and fast exports all
// show exactly the same picture. The director only ever cuts away after something has happened
// (celebrations, REF CAM, replays in the next stoppage), so live viewers never get a spoiler.
// `markers` lists goals, cards, half-time and full-time for a seek bar.

import { HighlightsRenderer, W, H, makeCam, makeCamAt, clamp, lerp, easeOut, easeInOut, seg01, lastName, LIME, DARK } from './highlights.js';

const REF_DT = 0.2;        // referee path sample step (sim seconds)
const CAM_DT = 0.1;        // camera path sample step
const BANNER_HOLD = 5.4;   // goal banner stays up this long (then slides away over 0.5s)
const CARD_SHOW = 3.4;     // card caption length
const WIPE = 0.3;          // half-length of the replay wipe
const REPLAY_RATE = 0.7;   // replays run slower than real time

// Keep the ball inside this box around the camera target (metres at the widest zoom): the
// broadcast view never loses the ball, however fast play (or the playback) moves.
const KEEP_X = 13, KEEP_NEAR = 9, KEEP_FAR = 22;

export class BroadcastRenderer extends HighlightsRenderer {
  constructor(data, opts = {}) {
    super(data, opts);
    const P = data.periods, frames = data.frames.data;
    this.t0 = P[0].start_t;
    this.t1 = Math.min(P[P.length - 1].end_t ?? Infinity, frames[frames.length - 1][0] / 10);
    this.duration = this.t1 - this.t0;
    this.half2 = P[1]?.start_t ?? Infinity;
    this.fouls = data.events.filter(e => e.type === 'foul');
    this.buildReferee();
    this.buildCamera();
    this.buildDirector();
    this.markers = [
      ...this.goals.map(g => ({ t: g.t, type: 'goal', team: g.team, label: `${g.minute}' ${this.names[g.scorer] || ''}${g.own_goal ? ' (OG)' : ''}` })),
      ...this.cards.map(k => ({ t: k.e.t, type: 'card', team: k.e.team, card: k.second ? 'second_yellow' : k.colour, label: `${k.e.minute}' ${k.second ? 'Second yellow, red' : k.colour === 'yellow' ? 'Yellow' : 'Red'} card: ${this.names[k.e.player] || ''}` })),
      ...(P.length > 1 ? [{ t: P[0].end_t, type: 'ht', label: 'Half-time' }] : []),
      { t: this.t1, type: 'ft', label: 'Full-time' },
    ].sort((a, b) => a.t - b.t);
  }

  // ------------------------------------------------ referee
  // The referee isn't in the match data: simulate him once for the whole match. He shadows play
  // 10-15 m away, sprints to fouls, and shows cards once he reaches the players (as in the highlights).
  buildReferee() {
    const n = Math.ceil((this.t1 - this.t0) / REF_DT) + 1, xs = new Float32Array(n), ys = new Float32Array(n);
    const ideal = b => [b[0] + (b[0] > 52.5 ? -11 : 11), b[1] + (b[1] < 34 ? 10 : -10)];
    let [rx, ry] = ideal(this.fr.ball(this.t0)), vx = 0, vy = 0, fi = 0;
    const SUB = 2, dt = REF_DT / SUB;
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < SUB; s++) {
        const t = this.t0 + (i - 1) * REF_DT + (s + 1) * dt;
        while (fi < this.fouls.length && this.fouls[fi].t + 6 <= t) fi++;
        const f = fi < this.fouls.length && this.fouls[fi].t <= t ? this.fouls[fi] : null;
        let [tx, ty] = ideal(this.fr.ball(t)), vmax = 5.5;
        if (f) { tx = f.x + 1.6; ty = f.y + (f.y < 34 ? 1.4 : -1.4); vmax = 7.6; }
        const dx = tx - rx, dy = ty - ry, d = Math.hypot(dx, dy);
        const want = Math.min(vmax, Math.sqrt(2 * 4 * Math.max(0, d - 0.4)));
        let dvx = (d > 1e-6 ? dx / d * want : 0) - vx, dvy = (d > 1e-6 ? dy / d * want : 0) - vy;
        const dv = Math.hypot(dvx, dvy), lim = 5 * dt;
        if (dv > lim) { dvx *= lim / dv; dvy *= lim / dv; }
        vx += dvx; vy += dvy; rx = clamp(rx + vx * dt, -1, 106); ry = clamp(ry + vy * dt, -1, 69);
      }
      xs[i] = rx; ys[i] = ry;
    }
    this.ref = { xs, ys, n };
    // Fouled players go down for a few seconds.
    this.falls = this.fouls.map(f => {
      const idx = this.d.players.findIndex(p => p.id === f.on);
      if (idx < 0) return null;
      const pos = this.fr.at(f.t).players[idx], prev = this.fr.at(f.t - 0.3).players[idx];
      return { idx, t: f.t, until: f.t + 3.2, x: pos[0], y: pos[1], ang: Math.atan2(pos[1] - prev[1], pos[0] - prev[0]) || 0 };
    }).filter(Boolean);
    // Each card goes up once the referee reaches the players.
    this.cards = this.d.events.filter(e => e.type === 'card').map(e => {
      const f = [...this.fouls].reverse().find(f => f.player === e.player && f.t <= e.t + 0.01 && e.t - f.t < 3) || { t: e.t, x: e.x, y: e.y };
      let up = f.t + 1.5;
      for (let t = f.t; t < f.t + 5; t += 0.1) { const r = this.refPos(t); if (Math.hypot(r[0] - f.x, r[1] - f.y) < 3.5) { up = t + 0.6; break; } }
      return { t: Math.max(up, e.t), until: Math.max(up, e.t) + 3.8, colour: e.card === 'yellow' ? 'yellow' : 'red', second: e.card === 'second_yellow', player: e.player, e };
    });
  }
  refPos(t) {
    const { xs, ys, n } = this.ref, u = clamp((t - this.t0) / REF_DT, 0, n - 1), i = Math.floor(u), j = Math.min(i + 1, n - 1), k = u - i;
    return [xs[i] + (xs[j] - xs[i]) * k, ys[i] + (ys[j] - ys[i]) * k];
  }

  // ------------------------------------------------ main camera
  // Broadcast wide angle from the main stand: follows the ball (slightly ahead of it), wide in
  // midfield and tighter, leaning towards the goal, near the box. Smoothed forwards and
  // backwards over the whole match (no lag), then held so the ball stays well inside the frame.
  camTarget(t) {
    const b = this.fr.ball(Math.min(t + 0.4, this.t1));
    const gx = b[0] > 52.5 ? 105 : 0, k = clamp(1 - Math.hypot(b[0] - gx, b[1] - 34) / 34, 0, 0.35);
    return [clamp(lerp(b[0], gx, k), 18, 87), clamp(lerp(b[1], 34, k * 0.6), 20, 48), lerp(60, 44, k / 0.35)];
  }
  buildCamera() {
    const n = Math.ceil((this.t1 - this.t0) / CAM_DT) + 1, X = new Float32Array(n), Y = new Float32Array(n), D = new Float32Array(n);
    const tAt = i => this.t0 + i * CAM_DT;
    const smooth = (A, tau, dir) => {
      const a = 1 - Math.exp(-CAM_DT / tau);
      if (dir > 0) { for (let i = 1; i < n; i++) if (!this.cutBefore(i)) A[i] = lerp(A[i - 1], A[i], a); }
      else for (let i = n - 2; i >= 0; i--) if (!this.cutBefore(i + 1)) A[i] = lerp(A[i + 1], A[i], a);
    };
    this.camN = n; this.camHalf = Math.round((this.half2 - this.t0) / CAM_DT);
    for (let i = 0; i < n; i++) { const [x, y, d] = this.camTarget(tAt(i)); X[i] = x; Y[i] = y; D[i] = d; }
    for (const dir of [1, -1]) { smooth(X, 0.8, dir); smooth(Y, 1.1, dir); smooth(D, 1.6, dir); }
    // Keep the actual ball inside the frame.
    const keep = () => {
      for (let i = 0; i < n; i++) {
        const t = tAt(i), fi = this.fr.f[this.fr.idx(t)];
        if (!fi[5]) continue;   // ball dead (being placed for a restart): let the camera pan there smoothly
        const b = this.fr.ball(t), z = D[i] / 60;
        X[i] = clamp(X[i], b[0] - KEEP_X * z, b[0] + KEEP_X * z);
        Y[i] = clamp(Y[i], b[1] - KEEP_NEAR * z, b[1] + KEEP_FAR * z);
      }
    };
    keep();
    for (const dir of [1, -1]) { smooth(X, 0.25, dir); smooth(Y, 0.25, dir); }
    keep();
    this.cam = { X, Y, D };
  }
  // A hard cut in the camera path: the second-half kick-off (everyone is back in position).
  cutBefore(i) { return i === this.camHalf; }
  camAt(t) {
    const { X, Y, D } = this.cam, u = clamp((t - this.t0) / CAM_DT, 0, this.camN - 1), i = Math.floor(u), j = Math.min(i + 1, this.camN - 1), k = j === this.camHalf ? 0 : u - i;
    return [X[i] + (X[j] - X[i]) * k, Y[i] + (Y[j] - Y[i]) * k, D[i] + (D[j] - D[i]) * k];
  }

  // ------------------------------------------------ director
  // Special shots, each only after its moment has happened:
  //   goal      -> close-up on the scorer celebrating, then a slow-motion replay in the stoppage
  //   card      -> REF CAM on the referee showing the card
  //   big chance (save, woodwork, a sitter missed) -> replay in the next stoppage, if it's long enough
  buildDirector() {
    const d = this.d, shots = [], fr = this.fr;
    // Stoppages: stretches where the ball is out of play.
    const stops = [], f = d.frames.data;
    for (let i = 0, start = null; i < f.length; i++) {
      const out = !f[i][5];
      if (out && start == null) start = f[i][0] / 10;
      if ((!out || i === f.length - 1) && start != null) { stops.push([start, f[i][0] / 10]); start = null; }
    }
    const stopAfter = t => stops.find(s => s[1] > t + 0.5 && s[0] >= t - 0.2);
    const kickoffs = d.events.filter(e => e.type === 'kickoff' || e.type === 'period_end');
    const path = (from, to, pick, tau = 0.35) => {
      const out = []; let x = null, y = null;
      for (let t = from; t <= to + CAM_DT; t += CAM_DT) {
        const p = pick(t); if (x == null) { x = p[0]; y = p[1]; }
        const a = 1 - Math.exp(-CAM_DT / tau); x = lerp(x, p[0], a); y = lerp(y, p[1], a); out.push([x, y]);
      }
      for (let i = out.length - 2; i >= 0; i--) { const a = 1 - Math.exp(-CAM_DT / tau); out[i] = [lerp(out[i + 1][0], out[i][0], a), lerp(out[i + 1][1], out[i][1], a)]; }
      return { from, pts: out };
    };
    const replay = (e, prio, before, after, stop) => {
      if (!stop) return;
      const s0 = stop.from, avail = stop.to - s0;
      let r1 = e.t + after, r0 = e.t - before;
      if ((r1 - r0) / REPLAY_RATE > avail) r0 = r1 - avail * REPLAY_RATE;
      if (r1 - r0 < 2.5) return;
      const goalX = (e.x ?? fr.ball(e.t)[0]) > 52.5 ? 105 : 0;
      shots.push({ kind: 'replay', prio, from: s0, to: s0 + (r1 - r0) / REPLAY_RATE, r0, goalX, e, path: path(r0 - 1, r1 + 1, t => fr.ball(t)) });
    };
    for (const g of this.goals) {
      const scorer = d.players.findIndex(p => p.id === g.scorer);
      if (scorer >= 0) shots.push({ kind: 'celebrate', prio: 0, from: g.t + 1.2, to: g.t + 6.6, path: path(g.t, g.t + 7, t => fr.at(t).players[scorer], 0.5) });
      const ko = kickoffs.find(k => k.t > g.t);
      const shot = d.events.find(s => s.id === g.shot);
      const start = shot ? Math.max(8, Math.min(12, g.t - (d.events.find(x => x.poss === g.poss)?.t ?? g.t - 8) + 1)) : 8;
      replay(g, 1, start, 1.5, ko && { from: g.t + 7.4, to: ko.t - 1 });
    }
    for (const k of this.cards) shots.push({ kind: 'refcam', prio: 2, from: Math.max(k.e.t, k.t - 0.8), to: k.t + 3.2 });
    for (const s of d.events.filter(e => e.type === 'shot' && e.outcome !== 'goal')) {
      const big = s.outcome === 'woodwork' || (s.outcome === 'saved' && s.xg >= 0.15) || s.xg >= 0.25;
      if (!big) continue;
      const stop = stopAfter(s.t);
      if (!stop || stop[0] - s.t > 30) continue;   // replayed at the next stoppage, like TV
      replay(s, 3, 3.5, 1.3, { from: stop[0] + 0.8, to: stop[1] - 0.8 });
    }
    // Highest priority first; skip anything that clashes with a shot already on the schedule.
    // The half-time and full-time scorelines own their moments.
    const P = d.periods, placed = [{ kind: 'panel', from: this.t1 - 4.5, to: this.t1 + 1 }];
    if (P.length > 1) placed.push({ kind: 'panel', from: P[0].end_t - 4.5, to: P[0].end_t + 2 });
    for (const s of shots.sort((a, b) => a.prio - b.prio || a.from - b.from)) {
      if (s.to - s.from < 1.5) continue;
      if (placed.some(p => s.from < p.to + 0.5 && s.to > p.from - 0.5)) continue;
      placed.push(s);
    }
    this.shots = placed.filter(s => s.kind !== 'panel').sort((a, b) => a.from - b.from);
    this.kickoffs = d.events.filter(e => e.type === 'period_start');
  }
  shotAt(t) {
    for (const s of this.shots) { if (s.from > t) break; if (t < s.to) return s; }
    return null;
  }
  pathAt(p, t) {
    const i = clamp((t - p.from) / CAM_DT, 0, p.pts.length - 1), a = Math.floor(i), b = Math.min(a + 1, p.pts.length - 1), k = i - a;
    return [lerp(p.pts[a][0], p.pts[b][0], k), lerp(p.pts[a][1], p.pts[b][1], k)];
  }

  // ------------------------------------------------ frame

  frame(tSim) {
    const t = clamp(+tSim || 0, this.t0, this.t1), c = this.c, sh = this.shotAt(t);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.clearRect(0, 0, W, H);
    let cam, ts = t;   // ts = the moment of the match being shown (differs during replays)
    if (sh?.kind === 'replay') {
      ts = sh.r0 + (t - sh.from) * REPLAY_RATE;
      const [bx, by] = this.pathAt(sh.path, ts), gs = sh.goalX === 105 ? 1 : -1;
      cam = makeCamAt([sh.goalX + gs * 13, clamp(lerp(34, by, 0.35), 24, 44), 7.5], [lerp(bx, sh.goalX, 0.3), lerp(by, 34, 0.3), 0.5], 48);
    } else if (sh?.kind === 'celebrate') {
      const [x, y] = this.pathAt(sh.path, t);
      cam = makeCam(clamp(x, 4, 101), clamp(y, 6, 62), 15, 12, 34);
    } else if (sh?.kind === 'refcam') {
      const [x, y] = this.refPos(t), k = seg01(t, sh.from, sh.to), dist = lerp(12.5, 9.5, easeInOut(k)), e = 10 * Math.PI / 180;
      cam = makeCamAt([x, y + dist * Math.cos(e), 1.7 + dist * Math.sin(e)], [x, y, 1.75], 36);
    } else {
      const [x, y, dist] = this.camAt(t);
      cam = makeCam(x, y, dist, 28, 40);
    }
    this.drawScene(cam, ts);
    if (sh?.kind === 'refcam') this.drawRefCamOverlay(t - sh.from);
    this.overlays(t, sh);
    return this.cv;
  }

  drawScene(cam, t) {
    const c = this.c, st = this.fr.at(t);
    this.drawPitch(cam);
    this.drawGoal(cam, 0); this.drawGoal(cam, 105);
    // Players and referee, far to near.
    const items = st.players.map((p, i) => {
      const fall = this.falls.find(f => f.idx === i && t >= f.t && t < f.until + 0.5);
      let x = p[0], y = p[1], lying = false;
      if (fall) { const k = seg01(t, fall.until, fall.until + 0.5); x = lerp(fall.x, p[0], k); y = lerp(fall.y, p[1], k); lying = t < fall.until ? fall : false; }
      return { i, x, y, lying, d: cam.p(x, y)?.[2] ?? 0 };
    });
    const [rx, ry] = this.refPos(t);
    items.push({ ref: true, x: rx, y: ry, card: this.cards.find(k => t >= k.t && t < k.until), d: cam.p(rx, ry)?.[2] ?? 0 });
    items.sort((a, b) => a.d - b.d);
    // Ball trail: where the ball was over the last 0.3s (worked out from t, so it's the same on every call).
    this.trail = [];
    if (st.inPlay) for (let i = 7; i >= 1; i--) {
      const q = this.fr.at(t - i * 0.04); if (!q.inPlay) continue;
      const p = cam.p(q.ball[0], q.ball[1], q.ball[2] + 0.11); if (p) this.trail.push(p);
    }
    const bd = cam.p(st.ball[0], st.ball[1])?.[2] ?? 0;
    let ballDrawn = false;
    for (const it of items) {
      if (!ballDrawn && it.d > bd) { this.drawBall(cam, st); ballDrawn = true; }
      if (it.ref) this.drawReferee(cam, it, t);
      else if (it.lying) this.drawLying(cam, it);
      else this.drawPlayer(cam, it, st.holder === it.i);
    }
    if (!ballDrawn) this.drawBall(cam, st);
    if (!this.vignette) {
      this.vignette = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.0);
      this.vignette.addColorStop(0, 'rgba(0,0,0,0)'); this.vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    }
    c.fillStyle = this.vignette; c.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------ overlays

  overlays(t, sh) {
    const P = this.d.periods;
    if (sh?.kind === 'replay') this.replayTag(t - sh.from, sh);
    // Half-time and full-time scorelines.
    if (P.length > 1) {
      const h = P[0].end_t, a = seg01(t, h - 4, h - 3.4) * (1 - seg01(t, h + 1, h + 1.6));
      if (a > 0) this.momentPanel('HALF-TIME', this.scoreAt(h - 0.01), a, false);
    }
    // Goal banners and card captions.
    for (const g of this.goals) { const s = t - g.t; if (s >= 0 && s < BANNER_HOLD + 0.6) this.goalBanner(g, s, BANNER_HOLD); }
    for (const k of this.cards) { const s = t - k.t; if (s >= 0 && s < CARD_SHOW) this.lowerThird({ kind: k.colour, e: k.e }, s); }
    for (const ps of this.kickoffs) { const s = t - ps.t; if (s >= 0 && s < 4.5) this.kickoffTag(ps, s); }
    const ft = seg01(t, this.t1 - 4, this.t1 - 3.4);
    if (ft > 0) this.momentPanel('FULL-TIME', [this.d.result.home, this.d.result.away], ft, true);
    this.bug(t);
    // Branded wipe into and out of replays.
    for (const s of this.shots) {
      if (s.kind !== 'replay') continue;
      for (const b of [s.from, s.to]) if (Math.abs(t - b) < WIPE) this.wipe((t - b + WIPE) / (2 * WIPE));
      if (s.from > t + WIPE) break;
    }
  }

  // "REPLAY" tag and lime frame bars, plus what's being replayed.
  replayTag(local, sh) {
    const c = this.c, a = seg01(local, 0.2, 0.6);
    c.save(); c.globalAlpha = a;
    this.pill(W - 290, 52, 220, 56, 'rgba(6,26,56,0.88)', 12);
    c.fillStyle = LIME; c.beginPath(); c.arc(W - 258, 80, 9, 0, Math.PI * 2); c.fill();
    this.text('REPLAY', W - 236, 91, { size: 30, weight: 900, spacing: 4 });
    const e = sh.e, what = e.type === 'goal' ? `GOAL · ${lastName(this.names[e.scorer]).toUpperCase()}`
      : e.outcome === 'woodwork' ? `OFF THE WOODWORK · ${lastName(this.names[e.player]).toUpperCase()}`
      : e.outcome === 'saved' ? `GREAT SAVE · ${this.keeperName(e)}` : `SO CLOSE · ${lastName(this.names[e.player]).toUpperCase()}`;
    c.font = `700 26px Oswald, Figtree, system-ui, sans-serif`;
    const w = c.measureText(what).width + 90, x = 70, y = H - 150;
    this.pill(x, y, 110, 54, this.limeGrad(x, y, x + 110, y + 54), 10);
    this.text(`${e.minute}'`, x + 55, y + 38, { size: 30, weight: 900, align: 'center', colour: '#fff' });
    this.pill(x + 120, y, w, 54, 'rgba(6,26,56,0.88)', 10);
    c.fillStyle = e.team === this.home.code ? this.hc : this.ac; c.fillRect(x + 120, y, 6, 54);
    this.text(what, x + 142, y + 37, { size: 26, weight: 900, spacing: 2 });
    c.restore();
    c.fillStyle = 'rgba(66,165,245,0.9)'; c.fillRect(0, 0, W, 5); c.fillRect(0, H - 5, W, 5);
  }

  // "1ST HALF · KICK-OFF" tag at the start of each half.
  kickoffTag(ps, s) {
    const c = this.c, a = seg01(s, 0.2, 0.7) * (1 - seg01(s, 3.8, 4.4));
    if (a <= 0) return;
    const x = 70 - (1 - easeOut(a)) * 60, y = H - 150, half = ps.period === 1 ? '1ST HALF' : ps.period === 2 ? '2ND HALF' : `PERIOD ${ps.period}`;
    c.save(); c.globalAlpha = a;
    this.pill(x, y, 190, 54, this.limeGrad(x, y, x + 190, y + 54), 10);
    this.text(half, x + 95, y + 37, { size: 26, weight: 900, align: 'center', colour: '#fff', spacing: 2 });
    this.pill(x + 200, y, 230, 54, 'rgba(6,26,56,0.88)', 10);
    this.text('KICK-OFF', x + 222, y + 37, { size: 26, weight: 900, spacing: 4 });
    c.restore();
  }

  // Branded wipe (k: 0..1 across the cut), as between the highlights' clips.
  wipe(k) {
    const c = this.c, x = lerp(W * 1.25, -W * 0.6, easeInOut(k));
    c.save(); c.translate(x, 0); c.transform(1, 0, -0.35, 1, 0, 0);
    c.fillStyle = DARK; c.fillRect(0, 0, W * 0.9, H);
    c.fillStyle = this.limeGrad(0, 0, 140, 0); c.fillRect(-60, 0, 60, H);
    c.fillStyle = 'rgba(66,165,245,0.35)'; c.fillRect(-110, 0, 22, H);
    c.restore();
    if (this.A.league && Math.abs(k - 0.5) < 0.3) { c.save(); c.globalAlpha = 1 - Math.abs(k - 0.5) / 0.3; c.drawImage(this.A.league, W / 2 - 80, H / 2 - 80, 160, 160); c.restore(); }
  }

  // Small red cards above a team's name on the score bug, one per player sent off so far.
  redCards(t, code, x, y) {
    const n = this.cards.filter(k => k.colour === 'red' && k.e.team === code && k.t <= t).length, c = this.c;
    for (let i = 0; i < n; i++) {
      c.fillStyle = '#e53935'; c.fillRect(x + i * 14, y, 10, 14);
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.5; c.strokeRect(x + i * 14, y, 10, 14);
    }
  }

  // Score bug with the match clock (top left) and the league mark (bottom right).
  bug(t) {
    const c = this.c, sc = this.scoreAt(t), x = 60, y = 86;
    this.scoreBoard(x, y, sc, t >= this.t1 ? 'FT' : this.clockAt(t));
    this.redCards(t, this.home.code, x + 88, y + 4);
    this.redCards(t, this.away.code, x + 322, y + 4);
    if (t < this.t1) this.addedBoard(x, y, t);
    if (this.A.league) { c.globalAlpha = 0.75; c.drawImage(this.A.league, W - 110, H - 110, 60, 60); c.globalAlpha = 1; }
  }

  // A scoreline over the pitch at half-time and full-time.
  momentPanel(label, sc, a, scorers) {
    const c = this.c;
    c.save(); c.globalAlpha = a;
    c.fillStyle = 'rgba(6,26,56,0.62)'; c.fillRect(0, 0, W, H);
    this.stripes(0, 0.35);
    const k = easeOut(a);
    this.text(label, W / 2, 330, { size: 50, weight: 900, align: 'center', colour: LIME, spacing: 12, shadow: 16 });
    this.scoreLine(sc, 580, k);
    c.globalAlpha = a;   // scoreLine resets it
    if (scorers) {
      const list = side => this.goals.filter(g => g.team === (side ? this.away.code : this.home.code))
        .map(g => `⚽ ${lastName(this.names[g.scorer])} ${g.minute}'${g.own_goal ? ' (OG)' : ''}`);
      list(0).slice(0, 4).forEach((s, i) => this.text(s, W / 2 - 520, 760 + i * 38, { size: 27, weight: 700, align: 'center' }));
      list(1).slice(0, 4).forEach((s, i) => this.text(s, W / 2 + 520, 760 + i * 38, { size: 27, weight: 700, align: 'center' }));
    }
    c.restore();
  }
}
