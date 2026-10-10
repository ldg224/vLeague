// Kits (S-23, S-20): a club's shirts. One design is drawn onto an "unrolled shirt" canvas (the whole way round the player,
// front in the middle), which the editor wraps round a 3D player and the match views cut down to a flat front sprite.
//   design = { v: 1, pattern, colours: [main, second, third], text: { name, number, colour }, crest: { show }, logo: { x, y, scale } }
//   drawKit(ctx, design, w, h, imgs)  paints the unrolled shirt; imgs = { crest, logo } (loaded images, both optional)
//   kitSprite(design, imgs)           a small cached canvas of the front, for the 2D match views
// Pure canvas, no DOM beyond creating canvases, so every view draws the same shirt.
import { isHex, onColour } from './club-colour.js';

export const SLOTS = [['home', 'Home'], ['away', 'Away'], ['gk', 'Goalkeeper'], ['special', 'Special']];
export const FIELD_SLOTS = ['home', 'away', 'special'];   // the kits an outfield team can be picked to wear
// A kit's name: the one its club gave it, else the slot's plain name.
export const kitName = (slot, design) => design?.name || SLOTS.find(s => s[0] === slot)?.[1] || slot;
export const PATTERNS = [
  ['plain', 'Plain'], ['hoops', 'Hoops'], ['stripes', 'Stripes'], ['pinstripe', 'Pinstripes'], ['halves', 'Halves'],
  ['quarters', 'Quarters'], ['sash', 'Sash'], ['chevron', 'Chevron'], ['checks', 'Checks'], ['band', 'Chest band'],
];
const FALLBACK = ['#1e88e5', '#ffffff', '#0a0f19'];
export const GK_DEFAULT = { home: '#f5b042', away: '#a855f7' };

const col = (c, i) => (isHex(c) ? c : FALLBACK[i]);

// A design with every field present and valid, whatever was stored.
export function cleanDesign(d, fallback = {}) {
  d = d && typeof d === 'object' ? d : {};
  const cs = Array.isArray(d.colours) ? d.colours : [];
  const t = d.text || {};
  return {
    v: 1,
    name: String(d.name || '').replace(/\s+/g, ' ').trim().slice(0, 24),
    pattern: PATTERNS.some(p => p[0] === d.pattern) ? d.pattern : 'plain',
    colours: [0, 1, 2].map(i => col(cs[i] || (fallback.colours || [])[i], i)),
    text: { name: String(t.name || '').slice(0, 14).toUpperCase(), number: String(t.number || '').replace(/\D/g, '').slice(0, 2), colour: isHex(t.colour) ? t.colour : '' },
    crest: { show: d.crest?.show !== false },
    logo: { x: clamp(d.logo?.x ?? 0.5, 0.15, 0.85), y: clamp(d.logo?.y ?? 0.38, 0.2, 0.6), scale: clamp(d.logo?.scale ?? 0.16, 0.08, 0.3) },
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || lo));

// A starting design for a club: its two club colours.
export function startDesign(club, slot = 'home') {
  const a = club?.colour, b = club?.colour2;
  if (slot === 'away') return cleanDesign({ colours: [b && isHex(b) ? b : '#ffffff', a, a] });
  if (slot === 'gk') return cleanDesign({ colours: [GK_DEFAULT.home, '#0a0f19', '#ffffff'] });
  return cleanDesign({ colours: [a, b, b] });
}

// The paint for one pattern across the unrolled shirt. u runs round the player (0 to 1, front at 0.5), v from the collar down.
function paint(c, d, w, h) {
  const [m, s, t] = d.colours;
  c.fillStyle = m; c.fillRect(0, 0, w, h);
  c.fillStyle = s;
  const rect = (x0, y0, x1, y1) => c.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
  switch (d.pattern) {
    case 'hoops': for (let i = 1; i < 8; i += 2) rect(0, i / 8, 1, (i + 1) / 8); break;
    case 'stripes': for (let i = 1; i < 12; i += 2) rect(i / 12, 0, (i + 1) / 12, 1); break;
    case 'pinstripe': for (let i = 0; i < 24; i++) rect((i + 0.4) / 24, 0, (i + 0.6) / 24, 1); break;
    case 'halves': rect(0.25, 0, 0.75, 1); break;
    case 'quarters': rect(0.25, 0, 0.5, 0.5); rect(0.5, 0.5, 0.75, 1); rect(0.75, 0.5, 1, 1); rect(0, 0, 0.25, 0.5); break;
    case 'sash': {
      c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();
      c.strokeStyle = s; c.lineWidth = h * 0.22; c.beginPath();
      for (const o of [0, 1]) { c.moveTo((0.33 + o) * w - h * 0.05, 0); c.lineTo((0.67 + o) * w - h * 0.05, h); c.moveTo((-0.67 + o) * w, 0); c.lineTo((-0.33 + o) * w, h); }
      c.stroke(); c.restore(); break;
    }
    case 'chevron': {
      c.save(); c.strokeStyle = s; c.lineWidth = h * 0.14; c.lineJoin = 'miter';
      for (const off of [0.25, 0.5]) { c.beginPath(); c.moveTo(0.3 * w, (off + 0.1) * h); c.lineTo(0.5 * w, (off + 0.28) * h); c.lineTo(0.7 * w, (off + 0.1) * h); c.stroke(); }
      c.restore(); break;
    }
    case 'checks': for (let i = 0; i < 12; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) rect(i / 12, j / 6, (i + 1) / 12, (j + 1) / 6); break;
    case 'band': rect(0, 0.3, 1, 0.5); break;
    default: break;
  }
  // collar and hem in the third colour
  c.fillStyle = t; rect(0, 0, 1, 0.045); rect(0, 0.965, 1, 1);
}

export function drawKit(ctx, design, w, h, imgs = {}) {
  const d = cleanDesign(design);
  paint(ctx, d, w, h);
  const ink = d.text.colour || onColour(d.colours[0]);
  const front = 0.5, back = 0;
  // crest (small, left chest) and logo (centre chest), at the front
  if (imgs.crest && d.crest.show) { const s = h * 0.13; ctx.drawImage(imgs.crest, (front + 0.075) * w - s / 2, h * 0.26, s, s); }
  if (imgs.logo) { const s = h * d.logo.scale * 2; ctx.drawImage(imgs.logo, (front + (d.logo.x - 0.5) * 0.25) * w - s / 2, d.logo.y * h - s / 2, s, s); }
  // number on the chest (small), name and number on the back
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (d.text.number) {
    ctx.font = `900 ${h * 0.09}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.number, (front - 0.075) * w, h * 0.32);
    for (const u of [back, back + 1]) {
      ctx.font = `900 ${h * 0.34}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.number, u * w, h * 0.58);
    }
  }
  if (d.text.name) for (const u of [back, back + 1]) {
    ctx.font = `800 ${h * 0.085}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.name, u * w, h * 0.22);
  }
}

// A small front-view sprite for the flat match views (cached by design). Pass loaded images to include the crest and an approved logo.
const cache = new Map();
export function kitSprite(design, imgs = {}, size = 128) {
  const d = cleanDesign(design), key = `${size}|${JSON.stringify(d)}|${imgs.crest?.src || ''}|${imgs.logo?.src || ''}`;
  if (cache.has(key)) return cache.get(key);
  const W = size * 4, tex = document.createElement('canvas'); tex.width = W; tex.height = size * 2;
  drawKit(tex.getContext('2d'), d, W, size * 2, imgs);
  const out = document.createElement('canvas'); out.width = size; out.height = size * 2;
  out.getContext('2d').drawImage(tex, W * 0.375, 0, W * 0.25, size * 2, 0, 0, size, size * 2);   // the middle quarter: the front
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

// Two shirts too alike to tell apart on a pitch? (main colours, the colour that fills most of the shirt)
const lum = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function kitsClash(a, b, limit = 70) {
  const x = lum(col(a?.colours?.[0], 0)), y = lum(col(b?.colours?.[0], 0));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < limit;
}
