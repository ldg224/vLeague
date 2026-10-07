// 2D top-down match replay drawn from a vLeague match file (see the simulator's OUTPUT_FORMAT.md).
// In live mode playback is locked to real time, so viewers can't skip ahead of the "broadcast".

import { onColour, safeColour } from './ui.js';

const PAD = 30, SC = 10;   // canvas pixels: margin, per metre

export class Replay {
  constructor(canvas, data, { onFrame } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.d = data;
    this.onFrame = onFrame;
    const fr = data.frames.data;
    this.t0 = fr[0][0] / 10;
    this.t1 = fr[fr.length - 1][0] / 10;
    this.t = this.t0;
    this.speed = 4;
    this.playing = false;
    this.maxT = null;          // function returning the latest viewable time (live mode)
    this.nHome = data.teams.home.lineup.length;
    this.cols = [safeColour(data.teams.home.colour), safeColour(data.teams.away.colour)];
    this.half2 = data.periods[1]?.start_t ?? Infinity;
    this._last = 0;
    this._raf = requestAnimationFrame(ts => this._loop(ts));
    this.draw();
  }

  destroy() { cancelAnimationFrame(this._raf); }
  limit() { return this.maxT ? Math.min(this.t1, this.maxT()) : this.t1; }
  seek(t) { this.t = Math.max(this.t0, Math.min(t, this.limit())); this.draw(); }
  play() { this.playing = true; }
  pause() { this.playing = false; }

  _loop(ts) {
    if (this.playing) {
      this.t += (ts - this._last) / 1000 * this.speed;
      const lim = this.limit();
      if (this.t >= lim) { this.t = lim; if (!this.maxT || lim >= this.t1) this.playing = false; }
      this.draw();
    }
    this._last = ts;
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  _index(t) {
    const d = this.d.frames.data, ds = t * 10;
    let lo = 0, hi = d.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (d[mid][0] <= ds) lo = mid; else hi = mid - 1; }
    return lo;
  }

  _pitch() {
    const c = this.ctx;
    c.fillStyle = '#0d2817'; c.fillRect(0, 0, this.cv.width, this.cv.height);
    for (let i = 0; i < 12; i++) if (i % 2) { c.fillStyle = 'rgba(255,255,255,0.025)'; c.fillRect(PAD + i * 87.5, PAD, 87.5, 680); }
    c.save(); c.translate(PAD, PAD);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2;
    c.strokeRect(0, 0, 1050, 680);
    c.beginPath(); c.moveTo(525, 0); c.lineTo(525, 680); c.stroke();
    c.beginPath(); c.arc(525, 340, 91.5, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(525, 340, 3, 0, Math.PI * 2); c.fill();
    for (const right of [false, true]) {
      const x0 = right ? 1050 : 0, s = right ? -1 : 1;
      c.strokeRect(right ? 885 : 0, 138.4, 165, 403.2);
      c.strokeRect(right ? 995 : 0, 248.4, 55, 183.2);
      c.beginPath(); c.arc(x0 + s * 110, 340, 3, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x0 + s * 110, 340, 91.5, right ? Math.PI - 0.93 : -0.93, right ? Math.PI + 0.93 : 0.93); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(right ? 1050 : -16, 303.4, 16, 73.2);
      c.strokeRect(right ? 1050 : -16, 303.4, 16, 73.2); c.fillStyle = 'rgba(255,255,255,.55)';
    }
    c.restore();
  }

  draw() {
    const d = this.d.frames.data, sc = this.d.frames.scale, c = this.ctx;
    const i = this._index(this.t), a = d[i], b = d[Math.min(i + 1, d.length - 1)];
    const crossesHalf = a[0] / 10 < this.half2 && b[0] / 10 >= this.half2;
    const f = b[0] > a[0] && !crossesHalf ? Math.min(1, (this.t * 10 - a[0]) / (b[0] - a[0])) : 0;
    const lerp = k => (a[k] + (b[k] - a[k]) * f) / sc;
    this._pitch();
    c.save(); c.translate(PAD, PAD);
    const holder = a[4];
    this.d.players.forEach((p, k) => {
      const x = lerp(6 + 2 * k) * SC, y = lerp(7 + 2 * k) * SC, col = this.cols[k < this.nHome ? 0 : 1];
      c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2);
      const g = c.createRadialGradient(x - 4, y - 4, 2, x, y, 12);
      g.addColorStop(0, col); g.addColorStop(1, shade(col));
      c.fillStyle = g; c.fill();
      c.lineWidth = holder === k ? 3.5 : 1.5; c.strokeStyle = holder === k ? '#ffffff' : col; c.stroke();
      c.fillStyle = onColour(col); c.font = '800 9px Figtree, system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(p.slot.slice(0, 3), x, y + 0.5);
      if (holder === k) {
        c.font = '700 12px Figtree, system-ui'; c.fillStyle = '#fff';
        c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 4;
        c.fillText(p.name.split(' ').slice(-1)[0], x, y - 22);
        c.shadowBlur = 0;
      }
    });
    const inPlay = a[5] && b[5];
    const bx = (inPlay ? lerp(1) : a[1] / sc) * SC, by = (inPlay ? lerp(2) : a[2] / sc) * SC, bz = inPlay ? lerp(3) : 0;
    c.globalAlpha = a[5] ? 1 : 0.3;
    c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(bx + bz * 3, by + bz * 3, 5.5, 3.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by - bz * 2, 5.5 + bz * 0.8, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 1; c.stroke(); c.globalAlpha = 1;
    c.restore();
    if (this.onFrame) this.onFrame(this.t);
  }
}

function shade(hex) {
  const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).split('').map(x => x + x).join('') : hex.slice(1), 16);
  const r = (n >> 16 & 255) * 0.35, g = (n >> 8 & 255) * 0.35, b = (n & 255) * 0.35;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
