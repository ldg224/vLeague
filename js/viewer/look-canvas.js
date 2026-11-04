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

// What falls (or rises) past the score bug, over the board and the picture around it. Every piece is drawn as a shape and fades out
// at the ends of its path, so there is no box or edge to see. Fixed spots, so it repeats exactly every SPILL_LOOP seconds.
// `front` picks the layer: most pieces pass behind the board (drawn before it), one in four in front (drawn after everything).
const SPILL_LOOP = 4, ABOVE = 150, BELOW = 110, SIDE = 40, FADE = 0.14;
const SPILLS = {
  confetti: { n: 84, loops: [1, 2], sway: 12 }, gold: { n: 96, loops: [1, 2], sway: 12 },
  snow: { n: 72, loops: [1], sway: 14 }, petals: { n: 40, loops: [1], sway: 22 },
  embers: { n: 56, loops: [1, 2], sway: 10, rise: true }, stars: { n: 26, loops: [1], sway: 8 }, moustaches: { n: 16, loops: [1], sway: 14 },
  glints: { n: 44, loops: [1], sway: 6 },
};
const GOLD = ['#ffe566', '#ffd700', '#fff3b0', '#d4a900'];
const PETALS = ['#ffc4d6', '#ffe0ea', '#ff9fbd'];
const roll = (i, salt) => { const v = Math.sin((i + 1) * (12.9898 + salt * 7.233)) * 43758.5453; return v - Math.floor(v); };

export function drawLookSpill(c, x, y, w, h, kind, colours, t = 0, front = false) {
  if (!SPILLS[kind]) return;
  // A piece in front fades as it reaches the plate's text, the names and the score, so it only crosses the edges and the text stays clean.
  const clear = front ? (px, py) => Math.min(1, Math.max((px < x + 340 ? y - 30 : y + 12) - py, py - (y + h - 12), 0) / 8) : null;
  drawPieces(c, { left: x - SIDE, top: y - ABOVE, across: w + SIDE * 2, down: h + ABOVE + BELOW }, kind, colours, t, { only: i => (i % 4 === 0) === front, clear });
}

// The same pieces over a whole page's background (js/look-page.js): they start and end off screen, so none of the fading is seen, and fall more slowly over the longer way.
export function drawPageSpill(c, vw, vh, kind, colours, t = 0, snow = '#ffffff') {
  const S = SPILLS[kind]; if (!S) return;
  const n = Math.min(320, Math.round(S.n * 0.3 * (vw * vh) / (640 * 324)));
  drawPieces(c, { left: -60, top: -170, across: vw + 120, down: vh + 340 }, kind, colours, t, { n, loop: 16, zoom: 1.3, snow });
}

// Fireworks over a page's background: each one climbs from the bottom, bursts and fades, at fixed spots and times, so it repeats exactly.
const FW_LOOP = 11, FW_COUNT = 7, FW_RISE = 0.7, FW_LIFE = 2.4;
const FW_INKS = [['#ffd76a', '#fff3c9'], ['#ff6b8a', '#ffd0dc'], ['#6bc8ff', '#d6f1ff'], ['#9dff8a', '#e6ffe0'], ['#d38bff', '#f1deff'], ['#ff9d4a', '#ffe0c2'], ['#ffffff', '#ffd76a']];
export function drawFireworks(c, vw, vh, t = 0, glow = true) {
  c.save(); if (glow) c.globalCompositeOperation = 'lighter';
  for (let b = 0; b < FW_COUNT; b++) {
    const age = (((t - b * FW_LOOP / FW_COUNT) % FW_LOOP) + FW_LOOP) % FW_LOOP;
    if (age > FW_RISE + FW_LIFE) continue;
    const cx = vw * (0.08 + 0.84 * roll(b, 7)), cy = vh * (0.12 + 0.45 * roll(b, 8)), [a, d] = FW_INKS[b % FW_INKS.length];
    if (age < FW_RISE) {   // the climb
      const k = age / FW_RISE, ease = 1 - (1 - k) ** 2, y = vh + 20 + (cy - vh - 20) * ease;
      c.globalAlpha = 0.9; c.fillStyle = d; c.beginPath(); c.arc(cx, y, 2, 0, Math.PI * 2); c.fill();
      continue;
    }
    const s = age - FW_RISE, fade = (1 - s / FW_LIFE) ** 1.5, travel = (1 - Math.exp(-s * 1.8)) / 1.8, drop = 26 * s * s;
    for (let i = 0; i < 64; i++) {
      const ang = i * 2.39996 + b, speed = (120 + 170 * roll(i + b * 80, 9)) * Math.min(vw / 1000, 1.4);
      for (let tail = 0; tail < 3; tail++) {   // a short trail behind each spark
        const back = travel * (1 - tail * 0.07);
        c.globalAlpha = fade * (1 - tail * 0.32); c.fillStyle = i % 3 ? a : d;
        c.beginPath(); c.arc(cx + Math.cos(ang) * speed * back, cy + Math.sin(ang) * speed * back + drop, 1.9 - tail * 0.45, 0, Math.PI * 2); c.fill();
      }
    }
  }
  c.restore();
}

function drawPieces(c, { left, top, across, down }, kind, colours, t, { n, loop = SPILL_LOOP, zoom = 1, snow = '#ffffff', only = null, clear: clearAt = null } = {}) {
  const S = SPILLS[kind], bottom = top + down, turn = Math.PI * 2 * t / loop, count = n ?? S.n;
  c.save();
  for (let i = 0; i < count; i++) {
    if (only && !only(i)) continue;
    const loops = S.loops[i % S.loops.length], run = (roll(i, 1) + loops * t / loop) % 1, p = S.rise ? 1 - run : run;
    const py = top + p * (bottom - top), px = left + roll(i, 2) * across + Math.sin(roll(i, 3) * 6.283 + turn) * S.sway;
    const edge = Math.min(1, (px - left + S.sway) / 34, (left + across + S.sway - px) / 34);
    const clear = clearAt ? clearAt(px, py) : 1;
    const a = Math.max(0, Math.min(1, run / FADE, (1 - run) / FADE, edge, clear));
    if (a <= 0) continue;
    const spin = roll(i, 4) * 6.283 + turn * (i % 2 ? 1 : -1), size = 0.75 + roll(i, 5) * 0.6;
    c.save(); c.translate(px, py); c.scale(zoom, zoom); c.globalAlpha = a;
    if (kind === 'confetti' || kind === 'gold') {
      const set = kind === 'gold' ? GOLD : colours; c.fillStyle = set[i % set.length];
      c.rotate(spin * 0.5); c.scale(1, Math.max(0.2, Math.abs(Math.cos(spin)))); c.fillRect(-2 * size, kind === 'gold' ? -5 * size : -3.5 * size, 4 * size, kind === 'gold' ? 10 * size : 7 * size);
    } else if (kind === 'snow') {
      c.globalAlpha = a * 0.9; c.fillStyle = snow; c.beginPath(); c.arc(0, 0, 1.2 + roll(i, 5) * 1.9, 0, Math.PI * 2); c.fill();
    } else if (kind === 'petals') {
      c.fillStyle = PETALS[i % 3]; c.rotate(spin * 0.5); c.scale(1, Math.max(0.35, Math.abs(Math.cos(spin)))); c.beginPath(); c.ellipse(0, 0, 5.5 * size, 3.2 * size, 0, 0, Math.PI * 2); c.fill();
    } else if (kind === 'glints') {
      c.globalAlpha = a * (0.45 + 0.55 * Math.abs(Math.sin(turn * 2 + i))); c.fillStyle = colours[i % colours.length]; sparkle(c, 0, 0, 4 + roll(i, 5) * 4);
    } else if (kind === 'embers') {
      c.globalAlpha = a * (0.6 + 0.4 * Math.sin(turn * 3 + i)); c.fillStyle = colours[i % colours.length]; c.shadowColor = colours[0]; c.shadowBlur = 7; c.beginPath(); c.arc(0, 0, 1 + roll(i, 5) * 1.5, 0, Math.PI * 2); c.fill();
    } else if (kind === 'stars') {
      c.fillStyle = colours[0]; c.rotate(spin * 0.25); star(c, 0, 0, 7, 5 * size);
    } else if (kind === 'moustaches') {
      const k = 40 * size / 72; c.rotate(Math.sin(spin) * 0.25); c.scale(k, k); c.translate(-36, -10); c.fillStyle = colours[0]; c.fill(new Path2D(MOUSTACHE_PATH));
    }
    c.restore();
  }
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
    if (name === th.spill) continue;   // falling past the board instead (drawLookSpill)
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
      // The Southern Cross, in the gaps between the crest, the codes, the score and the clock so it can be seen.
      c.fillStyle = th.score[1]; c.globalAlpha = 0.75;
      [[0.297, 0.2, 7, 6.5], [0.297, 0.8, 7, 6.5], [0.3, 0.5, 5, 3], [0.705, 0.22, 7, 5], [0.705, 0.8, 7, 5]].forEach(([fx, fy, n, r]) => star(c, x + w * fx, y + h * fy, n, r));
    } else if (name === 'sparkle') {
      c.fillStyle = th.score[0];
      [[0.04, 0.3], [0.12, 0.72], [0.36, 0.14], [0.66, 0.84], [0.74, 0.2], [0.96, 0.6]].forEach(([fx, fy], i) => { c.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7)); sparkle(c, x + w * fx, y + h * fy, 3.4); });
    } else if (name === 'confetti') {
      // Along the top and bottom edges, so it dresses the board without landing on the names.
      c.globalAlpha = 0.85;
      for (let i = 0; i < 34; i++) {
        const fx = (i * 0.2939 + 0.03) % 1, top = i % 2 === 0, fy = top ? 0.05 + (i * 37 % 10) / 100 : 0.95 - (i * 53 % 10) / 100;
        c.fillStyle = [th.score[0], th.score[1], '#ff8fb1', '#8fd8ff'][i % 4]; c.save(); c.translate(x + w * fx, y + h * fy); c.rotate(i * 1.3); c.fillRect(-1, -2.5, 2, 5); c.restore();
      }
    } else if (name === 'moustache') {
      // A quiet pattern of moustaches across the board, tone on tone, so the names stay clear.
      const p = new Path2D(MOUSTACHE_PATH), k = 30 / 72; c.globalAlpha = 0.2; c.fillStyle = th.glow;
      for (let row = 0; row < 3; row++) for (let col = -1; col * 46 < w; col++) {
        c.save(); c.translate(x + col * 46 + (row % 2 ? 23 : 0), y + 4 + row * 21); c.scale(k, k); c.fill(p); c.restore();
      }
    } else if (name === 'shine') {
      const k = ((t / 6) % 1) * 1.6 - 0.3, g = c.createLinearGradient(x + w * (k - 0.15), 0, x + w * (k + 0.15), 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.13)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
    }
    c.restore();
  }
  c.restore();
}
