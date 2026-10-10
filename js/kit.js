// Kits (S-23, S-20): a club's shirts. One design is drawn onto an "unrolled shirt" canvas (the whole way round the player, front in
// the middle), which the editor wraps round a 3D player and every flat view cuts down to a front (or back) picture.
//   design = { v: 1, name, pattern, colours: [main, second, third], text: { name, number, colour },
//              crest: { show, pos }, logo: { x, y, scale } }
//   drawKit(ctx, design, w, h, imgs)           paints the unrolled shirt; imgs = { crest, logo } (loaded images, both optional)
//   drawKitFront(ctx, design, imgs, x, y, w, h, side)   paints the shirt as seen from the front or back into a box of any shape
//   kitSprite(design, imgs, size)              a small cached canvas of the front, for the 2D match views
// The unrolled shirt has the same pixel density across and down (TEX_W x TEX_H matches the 3D body's circumference and height), so
// a round logo is round on the 3D player and in every flat view. Pure canvas, so every view draws the same shirt.
import { isHex, onColour } from './club-colour.js';

export const SLOTS = [['home', 'Home'], ['away', 'Away'], ['gk', 'Goalkeeper'], ['special', 'Special']];
export const FIELD_SLOTS = ['home', 'away', 'special'];   // the kits an outfield team can be picked to wear
// A kit's name: the one its club gave it, else the slot's plain name.
export const kitName = (slot, design) => design?.name || SLOTS.find(s => s[0] === slot)?.[1] || slot;

export const PATTERNS = [
  ['plain', 'Plain'], ['hoops', 'Hoops'], ['stripes', 'Stripes'], ['pinstripe', 'Pinstripes'], ['halves', 'Halves'], ['quarters', 'Quarters'],
  ['sash', 'Sash'], ['chevron', 'Chevron'], ['checks', 'Checks'], ['band', 'Chest band'], ['diagonal', 'Diagonals'], ['fade', 'Fade'], ['bar', 'Centre bar'],
];
export const TEX_W = 1024, TEX_H = 694;   // 2 pi r : (cylinder + caps) of the 3D body (radius .42, cylinder .95), so the density matches
const FALLBACK = ['#1e88e5', '#ffffff', '#0a0f19'];
export const GK_DEFAULT = { home: '#f5b042', away: '#a855f7' };
const CREST_POS = { left: 0.075, centre: 0, right: -0.075 };

const col = (c, i) => (isHex(c) ? c : FALLBACK[i]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));

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
    crest: { show: d.crest?.show !== false, pos: CREST_POS[d.crest?.pos] !== undefined ? d.crest.pos : 'left' },
    logo: { x: clamp(d.logo?.x ?? 0.5, 0.05, 0.95), y: clamp(d.logo?.y ?? 0.4, 0.12, 0.7), scale: clamp(d.logo?.scale ?? 0.18, 0.08, 0.34) },
  };
}

// A starting design for a club: its two club colours.
export function startDesign(club, slot = 'home') {
  const a = club?.colour, b = club?.colour2;
  if (slot === 'away') return cleanDesign({ colours: [b && isHex(b) ? b : '#ffffff', a, a] });
  if (slot === 'gk') return cleanDesign({ colours: [GK_DEFAULT.home, '#0a0f19', '#ffffff'] });
  return cleanDesign({ colours: [a, b, b] });
}

// ---------------------------------------------------------------- the unrolled shirt
// u runs round the player (0 to 1, front at 0.5), v from the collar down.
function paint(c, d, w, h) {
  const [m, s, t] = d.colours;
  c.fillStyle = m; c.fillRect(0, 0, w, h);
  c.fillStyle = s;
  const rect = (x0, y0, x1, y1) => c.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
  switch (d.pattern) {
    case 'hoops': for (let i = 0; i < 5; i++) rect(0, 0.1 + i * 0.19, 1, 0.1 + i * 0.19 + 0.095); break;
    case 'stripes': for (let i = 1; i < 12; i += 2) rect(i / 12, 0, (i + 1) / 12, 1); break;
    case 'pinstripe': for (let i = 0; i < 24; i++) rect((i + 0.4) / 24, 0, (i + 0.6) / 24, 1); break;
    case 'halves': rect(0.5, 0, 1, 1); break;
    case 'quarters': rect(0.25, 0, 0.5, 0.5); rect(0.5, 0.5, 0.75, 1); rect(0.75, 0.5, 1, 1); rect(0, 0, 0.25, 0.5); break;
    case 'sash': {
      c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();
      c.strokeStyle = s; c.lineWidth = w * 0.11; c.beginPath();
      for (const o of [-1, 0, 1]) { c.moveTo((0.34 + o) * w, -h * 0.05); c.lineTo((0.66 + o) * w, h * 1.05); }
      c.stroke(); c.restore(); break;
    }
    case 'chevron': {
      c.save(); c.strokeStyle = s; c.lineWidth = h * 0.085; c.lineJoin = 'miter';
      for (const off of [0.14, 0.32, 0.5]) { c.beginPath(); c.moveTo(0.36 * w, (off + 0.02) * h); c.lineTo(0.5 * w, (off + 0.16) * h); c.lineTo(0.64 * w, (off + 0.02) * h); c.stroke(); }
      c.restore(); break;
    }
    case 'checks': for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) rect(i / 16, j / 8, (i + 1) / 16, (j + 1) / 8); break;
    case 'band': rect(0, 0.3, 1, 0.5); break;
    case 'diagonal': {
      c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();
      c.strokeStyle = s; c.lineWidth = w * 0.03; c.beginPath();
      for (let i = -8; i < 24; i++) { c.moveTo((i / 16) * w, 0); c.lineTo((i / 16) * w + h * 0.9, h); }
      c.stroke(); c.restore(); break;
    }
    case 'fade': { const g = c.createLinearGradient(0, h * 0.15, 0, h * 0.95); g.addColorStop(0, m); g.addColorStop(1, s); c.fillStyle = g; c.fillRect(0, 0, w, h); break; }
    case 'bar': rect(0.43, 0, 0.57, 1); rect(0.93, 0, 1, 1); rect(0, 0, 0.07, 1); break;
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
  // crest (small, on the chest) and logo (placed by the club), at the front. Both are drawn square, and the texture has the same
  // density both ways, so they stay square on the player.
  if (imgs.crest && d.crest.show) { const s = h * 0.12; ctx.drawImage(imgs.crest, (front + CREST_POS[d.crest.pos]) * w - s / 2, h * 0.26, s, s); }
  if (imgs.logo) { const s = h * d.logo.scale; ctx.drawImage(imgs.logo, (0.35 + 0.3 * d.logo.x) * w - s / 2, d.logo.y * h - s / 2, s, s); }
  // number on the chest (small), name and number on the back
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (d.text.number) {
    ctx.font = `900 ${h * 0.08}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.number, (front - 0.075) * w, h * 0.31);
    for (const u of [back, back + 1]) { ctx.font = `900 ${h * 0.3}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.number, u * w, h * 0.6); }
  }
  if (d.text.name) for (const u of [back, back + 1]) { ctx.font = `800 ${h * 0.075}px Oswald, Arial Narrow, sans-serif`; ctx.fillText(d.text.name, u * w, h * 0.23); }
}

// ---------------------------------------------------------------- flat views
// The unrolled shirt, drawn once per design and kept (a small cache), then seen from the front or the back by taking thin strips of it:
// a strip at sideways position a (-1 to 1 across the body) comes from the part of the cylinder that faces you there, so the picture bends
// round the body the way the 3D player does.
const texCache = new Map();
function texture(d, imgs) {
  const key = `${JSON.stringify(d)}|${imgs.crest?.src || ''}|${imgs.logo?.src || ''}`;
  let t = texCache.get(key);
  if (!t) {
    if (texCache.size > 40) texCache.clear();
    t = document.createElement('canvas'); t.width = TEX_W; t.height = TEX_H;
    drawKit(t.getContext('2d'), d, TEX_W, TEX_H, imgs);
    texCache.set(key, t);
  }
  return t;
}

// side: 'front' | 'back'. A box about 0.47 wide to 1 tall is a real shirt on this player. A wider box (the match views draw a body 0.58 wide)
// shows a little more of the sides instead of stretching the logo; a narrower one shows a little less.
export function drawKitFront(ctx, design, imgs, x, y, w, h, side = 'front') {
  const d = cleanDesign(design), tex = texture(d, imgs), W = tex.width;
  const centre = (side === 'back' ? 0 : 0.5) * W, wide = (w / h) / 0.47, perRad = W / (2 * Math.PI);
  const n = Math.max(8, Math.min(64, Math.round(w / 2)));
  const blit = (sx, sw, dx, dw) => {   // a source slice of the unrolled shirt, wrapping round its seam
    sx = ((sx % W) + W) % W;
    if (sx + sw <= W) ctx.drawImage(tex, sx, 0, sw, tex.height, dx, y, dw, h);
    else { const a = W - sx; ctx.drawImage(tex, sx, 0, a, tex.height, dx, y, dw * a / sw, h); ctx.drawImage(tex, 0, 0, sw - a, tex.height, dx + dw * a / sw, y, dw * (sw - a) / sw, h); }
  };
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 - 1, a1 = ((i + 1) / n) * 2 - 1;
    const t0 = Math.asin(Math.max(-1, Math.min(1, a0))) * wide, t1 = Math.asin(Math.max(-1, Math.min(1, a1))) * wide;
    blit(centre + t0 * perRad, Math.max(1, (t1 - t0) * perRad), x + (i * w) / n, w / n + 1);   // a 1px overlap so no hairline shows between slices
  }
}

// A small front-view sprite for the flat match views (cached by design). Pass loaded images to include the crest and an approved logo.
const cache = new Map();
export function kitSprite(design, imgs = {}, size = 128) {
  const d = cleanDesign(design), key = `${size}|${JSON.stringify(d)}|${imgs.crest?.src || ''}|${imgs.logo?.src || ''}`;
  if (cache.has(key)) return cache.get(key);
  const out = document.createElement('canvas'); out.width = Math.round(size * 0.58); out.height = size;   // the match views draw a body about 0.58 wide to 1 tall
  drawKitFront(out.getContext('2d'), d, imgs, 0, 0, out.width, out.height, 'front');
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

// Two shirts too alike to tell apart on a pitch? (main colours, the colour that fills most of the shirt)
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function kitsClash(a, b, limit = 70) {
  const x = rgb(col(a?.colours?.[0], 0)), y = rgb(col(b?.colours?.[0], 0));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < limit;
}
