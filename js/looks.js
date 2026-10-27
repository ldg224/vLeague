// Scoreboard looks (1.17): one registry that the Game centre's scoreboard (js/scoreboard.js) and the in-game score bug drawn on the
// canvas (js/viewer/look-canvas.js) both read, so a look is described once and looks the same on every screen.
//
// A look is a row in the `looks` table (key, name, settings). Its `settings.theme` says how it is drawn; the presets below are the
// looks vLeague ships with, and the row's own settings overlay them (so a preset can be tuned from the database without a release).
// To add a look: add an entry to PRESETS (see docs/LOOKS.md), release, and it appears in the Editor's look picker (the Editor adds
// the missing `looks` row by itself). Colours are #rrggbb only, effects come from FX, so a look can't put anything else on the page.
//
//   theme: { bg: [top, bottom], edge, ink, score: [top, bottom], plate: [left, right], plateInk, glow, clock, clockInk, fx: [names] }
//   resolveLook(key, row)  -> { key, name, accent, banner, ornament, theme | null }   (theme null = one of the five older bespoke looks)
//   themeVars(theme)       -> the CSS custom properties for the scoreboard
//   fxHtml(names)          -> the decoration layers for the scoreboard (DOM)
//   PRESET_ROWS            -> [{ key, name, settings }] for the Editor to insert into `looks` when they are missing

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const pair = (v, d) => (Array.isArray(v) ? [hex(v[0], d[0]), hex(v[1] ?? v[0], d[1])] : typeof v === 'string' && HEX.test(v) ? [v.toLowerCase(), v.toLowerCase()] : d);

// The effects a look can switch on. Each is drawn once in css/scoreboard.css (page) and js/viewer/look-canvas.js (video).
export const FX = ['shine', 'snow', 'lights', 'stars', 'sparkle', 'confetti', 'moustache'];

const BASE = {
  bg: ['#12182a', '#0a0e1a'], edge: '#3a4560', ink: '#f2f2f2', score: ['#ffffff', '#ffffff'],
  plate: ['#2a3350', '#1e2540'], plateInk: '#ffffff', glow: '#6b8cff', clock: '#6b8cff', clockInk: '#ffffff', fx: [],
};

// Colours and effects are checked here, whatever the database holds.
export function cleanTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    bg: pair(raw.bg, BASE.bg), edge: hex(raw.edge, BASE.edge), ink: hex(raw.ink, BASE.ink), score: pair(raw.score, BASE.score),
    plate: pair(raw.plate, BASE.plate), plateInk: hex(raw.plateInk, BASE.plateInk), glow: hex(raw.glow, BASE.glow),
    clock: hex(raw.clock, BASE.clock), clockInk: hex(raw.clockInk, BASE.clockInk),
    fx: (Array.isArray(raw.fx) ? raw.fx : []).filter(n => FX.includes(n)).slice(0, 5),
  };
}

// The looks that ship with the app. The five older looks (classic, finals, grand_final, christmas, derby) keep their own designs in
// css/scoreboard.css and have no theme here.
export const PRESETS = {
  movember: {
    name: 'Movember', banner: 'MOVEMBER', accent: '#26c6da',
    theme: { bg: ['#0e3a5c', '#07192e'], edge: '#1b7f9a', ink: '#eaf9ff', score: ['#ffffff', '#aef0ff'], plate: ['#8a5a3a', '#6b4429'], plateInk: '#ffffff', glow: '#26c6da', clock: '#26c6da', clockInk: '#04222a', fx: ['moustache'] },
  },
  australia_day: {
    name: 'Australia Day', banner: 'AUSTRALIA DAY', accent: '#ffc72c',
    theme: { bg: ['#1b4a2a', '#0e2a18'], edge: '#8a7a1c', ink: '#f4f1dc', score: ['#ffe27a', '#f2b705'], plate: ['#ffc72c', '#e0a800'], plateInk: '#2a1d00', glow: '#f2b705', clock: '#ffc72c', clockInk: '#2a1d00', fx: ['stars'] },
  },
  new_year: {
    name: 'New Year', banner: 'NEW YEAR', accent: '#e8c76a',
    theme: { bg: ['#1c2150', '#0a0d24'], edge: '#6f6a96', ink: '#f3ecd6', score: ['#fff3c9', '#d9b863'], plate: ['#f1deb0', '#d9b863'], plateInk: '#2a2208', glow: '#e8c76a', clock: '#e8d3a2', clockInk: '#2a2208', fx: ['sparkle', 'confetti'] },
  },
  festive: {
    name: 'Festive', banner: 'FESTIVE', accent: '#b3203a',
    theme: { bg: ['#174a31', '#4a1f2c'], edge: '#b23a4e', ink: '#fff7ea', score: ['#fff3dc', '#f1d9a8'], plate: ['#b3203a', '#8f1a2e'], plateInk: '#ffffff', glow: '#d4a373', clock: '#a3182f', clockInk: '#ffffff', fx: ['lights', 'snow'] },
  },
};

export const PRESET_ROWS = Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, settings: { accent: p.accent, banner: p.banner, theme: p.theme } }));

// A look by its key. `row` is the `looks` row (or null); a preset fills in what the row doesn't say.
export function resolveLook(key, row) {
  const preset = PRESETS[key], st = row?.settings || {};
  if (!row && !preset) return { key: 'classic', name: 'Classic', accent: null, banner: null, ornament: null, theme: null };
  const raw = preset || st.theme ? { ...(preset?.theme || {}), ...(st.theme || {}) } : null;
  return {
    key, name: row?.name || preset?.name || key,
    accent: hex(st.accent ?? preset?.accent, null), banner: st.banner ?? preset?.banner ?? null, ornament: st.ornament || null,
    theme: cleanTheme(raw),
  };
}

// The five older looks' colours, for the little previews in the Editor's look picker (their designs live in css/scoreboard.css).
const OLDER = {
  classic: { bg: ['#1b2638', '#0f1622'], edge: '#3a4560', ink: '#ffffff', accent: '#3b82f6' },
  finals: { bg: ['#3a2f10', '#14110a'], edge: '#f5c542', ink: '#ffd86b', accent: '#f5c542' },
  grand_final: { bg: ['#3d3300', '#0b101a'], edge: '#ffd700', ink: '#ffe566', accent: '#ffd700' },
  christmas: { bg: ['#11261a', '#0d1a14'], edge: '#c62828', ink: '#ffffff', accent: '#e53935' },
  derby: { bg: ['#1f4a63', '#5a2a1a'], edge: '#ff7043', ink: '#ffffff', accent: '#ff7043' },
};
// What a look's preview is painted with: { bg: [top, bottom], edge, ink, accent }.
export function swatch(look) {
  const t = look.theme;
  if (t) return { bg: t.bg, edge: t.edge, ink: t.score[0], accent: t.plate[0] };
  const o = OLDER[look.key];
  if (o) return o;
  const a = look.accent || '#3b82f6';
  return { bg: ['#1b2638', '#0f1622'], edge: a, ink: '#ffffff', accent: a };
}
const FX_NAMES = { shine: 'Shine', snow: 'Snow', lights: 'Lights', stars: 'Stars', sparkle: 'Sparkle', confetti: 'Confetti', moustache: 'Moustache' };
export const fxNames = look => (look.theme?.fx || []).map(n => FX_NAMES[n]).filter(Boolean);

const MOUSTACHE = 'M36 8C32 3 25 3 19 6C13 9 8 8 4 4C3 3 1 4 2 6C4 13 12 17 20 16C26 15.5 31 13 36 15C41 13 46 15.5 52 16C60 17 68 13 70 6C71 4 69 3 68 4C64 8 59 9 53 6C47 3 40 3 36 8Z';
// The moustache as a picture for CSS (the dash between the scores); encoded so it can sit inside a style attribute.
const MOUS_URI = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 20"><path d="${MOUSTACHE}"/></svg>`).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
export const themeVars = t => (t ? `${t.fx.includes('moustache') ? `--mous:url(data:image/svg+xml,${MOUS_URI});` : ''}--t-bg1:${t.bg[0]};--t-bg2:${t.bg[1]};--t-edge:${t.edge};--t-ink:${t.ink};--t-s1:${t.score[0]};--t-s2:${t.score[1]};--t-p1:${t.plate[0]};--t-p2:${t.plate[1]};--t-pink:${t.plateInk};--t-glow:${t.glow};--t-clock:${t.clock};--t-clockink:${t.clockInk};` : '');

// ------------------------------------------------------------------ decoration (DOM)
// Spots are fixed, not random, so a scoreboard looks the same every time it is drawn (and a redraw doesn't make it jump).
const BULBS = ['#ffc247', '#ff5a6e', '#e9e9e9', '#37c47a'];
const CONFETTI = [[2, 20, 24], [5, 50, -30], [3, 78, 50], [8, 10, 12], [95, 16, -20], [97, 48, 40], [94, 76, -45], [91, 9, 15], [50, 5, 70], [62, 92, -10]];
const SPARKLE = [[4, 14, 0], [10, 26, 1.3], [30, 9, 2.1], [70, 8, 0.7], [92, 24, 1.8], [96, 62, 2.6], [50, 90, 0.4]];

// A 7 or 5 pointed star as polygon points, centred on (cx, cy).
export function starPoints(n, cx, cy, r) {
  const out = [];
  for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n - Math.PI / 2, d = i % 2 ? r * 0.45 : r; out.push(`${(cx + Math.cos(a) * d).toFixed(1)},${(cy + Math.sin(a) * d).toFixed(1)}`); }
  return out.join(' ');
}
// The Southern Cross: four seven-pointed stars and one smaller five-pointed one.
const CROSS = [[48, 12, 7, 9], [50, 88, 7, 10], [16, 52, 7, 8], [82, 40, 7, 8], [64, 64, 5, 4.5]];

const FX_HTML = {
  shine: () => '<span class="fx fx-shine"></span>',
  snow: () => '<span class="fx fx-snow"></span>',
  lights: () => `<span class="fx fx-lights">${BULBS.concat(BULBS, BULBS, BULBS, BULBS).slice(0, 18).map((c, i) => `<i style="--x:${(i * 100 / 17).toFixed(2)}%;--y:${(Math.sin(i * 1.1) * 3 + 5).toFixed(1)}px;--c:${c};--d:${(i % 5) * 0.4}s"></i>`).join('')}</span>`,
  stars: () => `<svg class="fx fx-stars" viewBox="0 0 100 100" aria-hidden="true">${CROSS.map(([x, y, n, r]) => `<polygon points="${starPoints(n, x, y, r)}"/>`).join('')}</svg>`,
  sparkle: () => `<span class="fx fx-sparkle">${SPARKLE.map(([x, y, d]) => `<i style="--x:${x}%;--y:${y}%;--d:${d}s"></i>`).join('')}</span>`,
  confetti: () => `<span class="fx fx-confetti">${CONFETTI.map(([x, y, r], i) => `<i style="--x:${x}%;--y:${y}%;--r:${r}deg;--i:${i}"></i>`).join('')}</span>`,
  moustache: () => `<span class="fx fx-mous"><svg viewBox="0 0 72 20" aria-hidden="true"><path d="${MOUSTACHE}"/></svg></span>`,
};
export const fxHtml = names => (names || []).filter(n => FX_HTML[n]).map(n => FX_HTML[n]()).join('');
export const MOUSTACHE_PATH = MOUSTACHE;
