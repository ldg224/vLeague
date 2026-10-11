// Club colours on the page. Pure functions, no DOM (the setup wizard and the shell both use them).
// A club's primary colour is the colour of its whole signed-in page, as it was picked (0.17): no lifted "accent" any more.
//   contrast(a, b)  -> WCAG contrast ratio of two '#rrggbb' colours (1 to 21)
//   onColour(c)     -> the text colour ('#ffffff' or the navy) that reads best on top of the colour c
//   isHex(c)        -> true for '#rrggbb'

export const NAVY = '#0a0f19';

export const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

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

export const onColour = c => (contrast(c, '#ffffff') >= contrast(c, NAVY) ? '#ffffff' : NAVY);

// Website revamp (WR-03): a club's colour as an accent that always reads, like FotMob's lightMode/darkMode team colours.
// The colour is mixed toward white (dark theme) or black (light theme) only as far as it takes to reach 3:1 against the
// card surface, so a navy club gets a lighter shade on dark greys and a white or yellow club a deeper one on white.
const hex2 = v => Math.round(v).toString(16).padStart(2, '0');
export function mixHex(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join('')}`;
}
export function accentFor(c, theme) {
  if (!isHex(c)) return theme === 'light' ? '#1565c0' : '#64b5f6';
  const surface = theme === 'light' ? '#ffffff' : '#222222', toward = theme === 'light' ? '#000000' : '#ffffff';
  for (let t = 0; t <= 0.9; t += 0.05) {
    const m = mixHex(c, toward, t);
    if (contrast(m, surface) >= 3) return m;
  }
  return mixHex(c, toward, 0.9);
}

// The colour for the header panel's glow (WR-03, 11 Oct 2026): a very dark club colour (SKS's navy) leaves nothing to shine on the deep panel, so its
// lightness is raised, keeping its hue and colourfulness, until it is as bright as a plain mid blue (luminance GLOW_MIN). (Mixing with white would
// wash it to grey.) Colours already bright enough are untouched.
export const GLOW_MIN = 0.12;
function toHsl(hex) {
  const [r, g, b] = rgb(hex).map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map(v => hex2(v * 255)).join('')}`;
}
export function glowFor(c) {
  if (!isHex(c) || luminance(c) >= GLOW_MIN) return c;
  const [h, s, l] = toHsl(c), sat = s < 0.08 ? s : Math.max(s, 0.55);   // a near-black navy keeps its blue, not a grey; a true black or grey stays neutral
  for (let x = l; x <= 0.9; x += 0.01) {
    const m = fromHsl(h, sat, x);
    if (luminance(m) >= GLOW_MIN) return m;
  }
  return fromHsl(h, sat, 0.9);
}
