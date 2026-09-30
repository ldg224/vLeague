// Club colours on the vLeague navy. Pure functions, no DOM (the setup wizard and the Editor both use them).
//   contrast(a, b)           -> WCAG contrast ratio of two '#rrggbb' colours (1 to 21)
//   accentFor(colour, colour2) -> the site-safe accent '#rrggbb': the club colour lifted until it reads on the navy
//                              (at least 4.5:1). A near-white, grey or black club tries its second colour, and
//                              falls back to vLeague blue if that's grey too.
//   accentInfo(colour, colour2) -> { accent, from: 'colour' | 'colour2' | 'blue', lifted } (why the accent is what it is)
//   isHex(c)                 -> true for '#rrggbb'

export const NAVY = '#0a0f19';
export const VLEAGUE_BLUE = '#64b5f6';
export const MIN_CONTRAST = 4.5;   // the accent is used for small text too (links, labels), so WCAG AA for text

export const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  if (!isHex(a) || !isHex(b)) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(hex) {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([r, g, b].map(v => (v + m) * 255));
}

// Grey, white and black have no hue to lift, so they don't count as a club colour here.
const greyish = hex => { const [, s, l] = hsl(hex); return s < 0.2 || l > 0.94 || l < 0.04; };

// Raise the lightness in small steps (keeping hue and saturation) until the colour reads on the navy.
function lift(hex) {
  const [h, s, l0] = hsl(hex);
  for (let l = l0; l <= 0.95; l += 0.01) {
    const c = fromHsl(h, s, l);
    if (contrast(c, NAVY) >= MIN_CONTRAST) return c;
  }
  return fromHsl(h, s, 0.95);
}

export function accentInfo(colour, colour2) {
  for (const [from, c] of [['colour', colour], ['colour2', colour2]]) {
    if (!isHex(c) || greyish(c)) continue;
    const ok = contrast(c, NAVY) >= MIN_CONTRAST;
    return { accent: ok ? c.toLowerCase() : lift(c), from, lifted: !ok };
  }
  return { accent: VLEAGUE_BLUE, from: 'blue', lifted: false };
}

export const accentFor = (colour, colour2) => accentInfo(colour, colour2).accent;
