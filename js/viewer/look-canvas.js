// A moustache (the Movember dash between the scores), centred on (cx, cy), `w` wide.
export function drawMoustache(c, cx, cy, w, fill) {
  const k = w / 72;
  c.save(); c.translate(cx - w / 2, cy - 10 * k); c.scale(k, k); c.fillStyle = fill; c.fill(new Path2D(MOUSTACHE_PATH)); c.restore();
}

// The artwork behind the score bug: dark mowing stripes (`mow`), the same with a chalk pitch marked on them (`chalk`), or floodlights over the stripes (`beams`).
// Fixed spots, not random, so it looks the same every frame. `line` is the chalk's and the beams' colour; `t` (seconds) sways the beams slowly.
const CHALK_DUST = [[0.03, 0.2], [0.09, 0.86], [0.17, 0.12], [0.24, 0.9], [0.31, 0.3], [0.37, 0.92], [0.57, 0.06], [0.61, 0.94], [0.69, 0.1], [0.73, 0.88], [0.8, 0.14], [0.86, 0.9], [0.93, 0.16], [0.98, 0.8]];
export function drawLookArt(c, x, y, w, h, art, line = '#ffffff', t = 0, centre = x + w / 2) {
  c.save(); c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.clip();
  // The stripes lean slightly, as a pitch does from a broadcast camera.
  const band = 44, lean = 22;
  for (let i = -1, k = 0; i * band < w + lean; i++, k++) {
    const bx = x + i * band;
    c.fillStyle = k % 2 ? 'rgba(255,255,255,.075)' : 'rgba(0,0,0,.15)';
    c.beginPath(); c.moveTo(bx + lean, y); c.lineTo(bx + lean + band, y); c.lineTo(bx + band, y + h); c.lineTo(bx, y + h); c.closePath(); c.fill();
  }
  if (art === 'chalk') {
    c.strokeStyle = line; c.globalAlpha = 0.34; c.lineWidth = 2;
    c.beginPath(); c.moveTo(centre + 8, y); c.lineTo(centre - 8, y + h); c.stroke();                 // the halfway line
    c.beginPath(); c.arc(centre, y + h / 2, 58, 0, Math.PI * 2); c.stroke();                       // the centre circle
    for (const side of [-1, 1]) {                                                                 // a penalty area and its arc at each end
      const edge = side < 0 ? x : x + w, front = edge - side * 52, top = y + 7, bottom = y + h - 7;
      c.beginPath(); c.moveTo(edge, top); c.lineTo(front, top); c.lineTo(front, bottom); c.lineTo(edge, bottom); c.stroke();
      c.beginPath(); c.arc(front, y + h / 2, 15, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : Math.PI * 1.5); c.stroke();
    }
    c.globalAlpha = 0.28; c.fillStyle = line;
    for (const [fx, fy] of CHALK_DUST) { c.beginPath(); c.arc(x + w * fx, y + h * fy, 0.9, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
  } else if (art === 'beams') {
    c.globalCompositeOperation = 'lighter';
    [[0.14, 0.9], [0.5, 2.3], [0.86, 4.1]].forEach(([fx, phase]) => {
      const from = x + w * fx, to = from + Math.sin(t * 0.35 + phase) * 34, spread = 62, g = c.createLinearGradient(0, y - 8, 0, y + h);
      g.addColorStop(0, `${line}48`); g.addColorStop(0.7, `${line}14`); g.addColorStop(1, `${line}00`);
      c.fillStyle = g; c.beginPath(); c.moveTo(from - 5, y - 8); c.lineTo(from + 5, y - 8); c.lineTo(to + spread, y + h); c.lineTo(to - spread, y + h); c.closePath(); c.fill();
    });
    c.globalCompositeOperation = 'source-over';
  }
  // Darker towards both ends and the bottom, so the art stays behind the names and the score.
  const ends = c.createLinearGradient(x, 0, x + w, 0);
  ends.addColorStop(0, 'rgba(0,0,0,.34)'); ends.addColorStop(0.2, 'rgba(0,0,0,0)'); ends.addColorStop(0.8, 'rgba(0,0,0,0)'); ends.addColorStop(1, 'rgba(0,0,0,.34)');
  c.fillStyle = ends; c.fillRect(x, y, w, h);
  const under = c.createLinearGradient(0, y, 0, y + h);
  under.addColorStop(0, 'rgba(255,255,255,.1)'); under.addColorStop(0.08, 'rgba(255,255,255,0)'); under.addColorStop(0.6, 'rgba(0,0,0,0)'); under.addColorStop(1, 'rgba(0,0,0,.26)');
  c.fillStyle = under; c.fillRect(x, y, w, h);
  c.restore();
}

// A themed look's decoration for the score bug drawn on the canvas (the broadcast view and the highlights): the same effects as the
// page's scoreboard (js/looks.js FX, css/scoreboard.css), drawn small. The bug is 560 x 64; (x, y) is its top left corner.
import { MOUSTACHE_PATH } from '../looks.js';

const BULBS = ['#ffc247', '#ff5a6e', '#e9e9e9', '#37c47a'];

function star(c, cx, cy, n, r) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n - Math.PI / 2, d = i % 2 ? r * 0.45 : r; c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * d, cy + Math.sin(a) * d); }
  c.closePath(); c.fill();
}
function sparkle(c, cx, cy, r) {
  c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.25, cy - r * 0.25); c.lineTo(cx + r, cy); c.lineTo(cx + r * 0.25, cy + r * 0.25);
  c.lineTo(cx, cy + r); c.lineTo(cx - r * 0.25, cy + r * 0.25); c.lineTo(cx - r, cy); c.lineTo(cx - r * 0.25, cy - r * 0.25); c.closePath(); c.fill();
}

// The effects of `th.fx` over the board's rectangle; `t` (seconds, optional) makes the lights and sparkles twinkle.
export function drawLookFx(c, x, y, w, h, th, t = 0) {
  c.save(); c.beginPath(); c.roundRect(x, y, w, h, [0, 14, 14, 14]); c.clip();
  for (const name of th.fx) {
    c.save();
    if (name === 'lights') {
      c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y + 3); c.quadraticCurveTo(x + w / 2, y + 12, x + w, y + 3); c.stroke();
      for (let i = 0; i < 18; i++) {
        const bx = x + 14 + i * (w - 28) / 17, by = y + 5 + Math.sin(i * 1.1) * 2.5, on = 0.7 + 0.3 * Math.sin(t * 2.6 + i * 0.9);
        c.globalAlpha = on; c.fillStyle = BULBS[i % 4]; c.shadowColor = BULBS[i % 4]; c.shadowBlur = 8;
        c.beginPath(); c.ellipse(bx, by + 4, 3, 4.5, 0, 0, Math.PI * 2); c.fill();
      }
    } else if (name === 'snow') {
      c.fillStyle = '#fff'; c.globalAlpha = 0.3;
      for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(x + (i * 97) % w, y + ((i * 41 + t * 6) % h), i % 3 ? 1 : 1.6, 0, Math.PI * 2); c.fill(); }
    } else if (name === 'stars') {
      c.fillStyle = th.score[1]; c.globalAlpha = 0.3;
      [[0.78, 0.2, 7, 7], [0.93, 0.78, 7, 6], [0.66, 0.74, 7, 5], [0.9, 0.3, 7, 5], [0.84, 0.56, 5, 3.5]].forEach(([fx, fy, n, r]) => star(c, x + w * fx, y + h * fy, n, r));
    } else if (name === 'sparkle') {
      c.fillStyle = th.score[0];
      [[0.04, 0.3], [0.12, 0.72], [0.36, 0.14], [0.66, 0.84], [0.74, 0.2], [0.96, 0.6]].forEach(([fx, fy], i) => { c.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7)); sparkle(c, x + w * fx, y + h * fy, 3.4); });
    } else if (name === 'confetti') {
      c.globalAlpha = 0.5;
      [[0.02, 0.3, 0.4], [0.05, 0.7, -0.5], [0.09, 0.2, 0.9], [0.62, 0.9, -0.2], [0.95, 0.25, -0.3], [0.97, 0.65, 0.7], [0.58, 0.1, 1.2]].forEach(([fx, fy, a], i) => {
        c.fillStyle = [th.score[0], th.score[1], th.ink][i % 3]; c.save(); c.translate(x + w * fx, y + h * fy); c.rotate(a); c.fillRect(-1.5, -4, 3, 8); c.restore();
      });
    } else if (name === 'moustache') {
      c.translate(x + 246 - 130, y + h / 2 - 10 * 260 / 72); c.scale(260 / 72, 260 / 72);   // big, behind the score box (drawn before it)
      const p = new Path2D(MOUSTACHE_PATH); c.globalAlpha = 0.8; c.fillStyle = `${th.plate[0]}aa`; c.strokeStyle = th.plate[0]; c.lineWidth = 0.7; c.fill(p); c.stroke(p);
    } else if (name === 'shine') {
      const k = ((t / 6) % 1) * 1.6 - 0.3, g = c.createLinearGradient(x + w * (k - 0.15), 0, x + w * (k + 0.15), 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.13)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
    }
    c.restore();
  }
  c.restore();
}
