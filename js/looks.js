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
// The artwork behind a score bug (js/viewer/look-canvas.js): mowing stripes, the same with chalk pitch markings, or floodlight beams over the stripes.
export const ART = ['mow', 'chalk', 'beams'];
// What falls (or rises) past the score bug on the video, over the board and the picture around it: drawLookSpill in js/viewer/look-canvas.js.
export const SPILL = ['confetti', 'gold', 'snow', 'petals', 'embers', 'stars', 'moustaches', 'glints'];

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
    art: ART.includes(raw.art) ? raw.art : null,
    spill: SPILL.includes(raw.spill) ? raw.spill : null,
  };
}

// What a look spills past the score bug: its theme's, else the older looks' below, else nothing.
const OLDER_SPILL = { finals: 'gold', grand_final: 'gold', derby: 'embers' };
export const spillOf = look => look?.theme?.spill || OLDER_SPILL[look?.key] || null;
// The colour of the chalk and the beams in a look's artwork.
export const artInk = look => (look?.key === 'finals' || look?.key === 'grand_final' ? '#ffd76a' : look?.theme ? (artOf(look) === 'beams' ? look.theme.glow : look.theme.ink) : '#9cc4ff');

// A look's board colours for a page header (the match page), the same as the score bug on the video: { bg: [top, bottom], edge, ink, plate: [left, right], plateInk, clock, clockInk }.
const OLDER_BOARD = {
  classic: { bg: ['#0d2a52', '#061430'], edge: '#2a4a7a', ink: '#ffffff', plate: ['#1565c0', '#1565c0'], plateInk: '#ffffff', clock: '#1e88e5', clockInk: '#ffffff' },
  finals: { bg: ['#2c2410', '#141007'], edge: '#f5c542', ink: '#ffffff', plate: ['#ffe08a', '#f5c542'], plateInk: '#2a1d00', clock: '#f5c542', clockInk: '#1b1400' },
  grand_final: { bg: ['#2a2308', '#0b101a'], edge: '#ffd700', ink: '#ffffff', plate: ['#fff3b0', '#d4a900'], plateInk: '#2a1d00', clock: '#d4a900', clockInk: '#1b1400' },
  christmas: { bg: ['#0f261a', '#0f261a'], edge: '#c62828', ink: '#ffffff', plate: ['#c62828', '#c62828'], plateInk: '#ffffff', clock: '#c62828', clockInk: '#ffffff' },
  derby: { bg: ['#0b0f17', '#0b0f17'], edge: '#ff7043', ink: '#ffffff', plate: ['#ff8a50', '#ff7043'], plateInk: '#1b0a00', clock: '#ff7043', clockInk: '#1b1400' },
};
export function boardOf(look) {
  const t = look?.theme;
  return t ? { bg: t.bg, edge: t.edge, ink: t.ink, plate: t.plate, plateInk: t.plateInk, clock: t.clock, clockInk: t.clockInk } : OLDER_BOARD[look?.key] || OLDER_BOARD.classic;
}
// A finals match's stage in words, or null. Every plate reads it from here.
export const stageName = fx => ({ SF: 'Semi-final', TP: 'Third place final', GF: 'Grand Final' })[fx?.stage] || null;

// The looks that dress the match page (the user's list, 5 Nov 2026). Any other look, Classic included, leaves the page as it always was.
export const EVENT_LOOKS = ['opening_week', 'spring_blossom', 'movember', 'derby', 'festive', 'new_year', 'australia_day', 'last_round', 'finals', 'third_place', 'grand_final', 'lunar_new_year'];
export const isEventLook = key => EVENT_LOOKS.includes(key);

// What stands in the bottom corners of an event's match page (assets/looks, Fluent Emoji 3D, MIT): side, height and distance from the edge in px at desktop size, later ones
// in front. `lights` flash on the tree (js/look-page.js). `fireworks` go off over the page's background.
const PROP = (src, side, h, x = 20, extra = {}) => ({ src, side, h, x, ...extra });
export const SCENES = {
  opening_week: { props: [PROP('goal_net', 'right', 170, 70), PROP('soccer_ball', 'right', 76, 24)] },
  spring_blossom: { props: [PROP('cherry_blossom', 'right', 130), PROP('tulip', 'left', 120)] },
  movember: { props: [PROP('barber_pole', 'right', 170)] },
  derby: { props: [PROP('fire', 'right', 150), PROP('crossed_swords', 'left', 110)] },
  festive: { props: [PROP('christmas_tree', 'right', 240, 56, { lights: true }), PROP('wrapped_gift', 'right', 92, 204), PROP('wrapped_gift', 'right', 72, 16), PROP('wrapped_gift', 'left', 84)] },
  new_year: { fireworks: true, props: [PROP('bottle_with_popping_cork', 'right', 170), PROP('party_popper', 'left', 130)] },
  australia_day: { props: [PROP('kangaroo', 'right', 200), PROP('koala', 'left', 110)] },
  last_round: { props: [PROP('chequered_flag', 'right', 150), PROP('hourglass_done', 'left', 110)] },
  finals: { props: [PROP('trophy', 'right', 170)] },
  third_place: { props: [PROP('3rd_place_medal', 'right', 150)] },
  grand_final: { props: [PROP('trophy', 'right', 230), PROP('1st_place_medal', 'left', 120)] },
  lunar_new_year: { props: [PROP('red_paper_lantern', 'right', 170, 92), PROP('red_paper_lantern', 'right', 120, 20), PROP('firecracker', 'left', 110)] },
};

// The colours of what a look spills over a page's background, chosen to read on the page in either theme.
export function pageSpillInk(look, theme) {
  const t = look?.theme;
  if (!t) return ['#ff7043', '#ffb199', '#e0562a'];
  if (spillOf(look) === 'moustaches') return [t.plate[0]];
  if (spillOf(look) === 'embers') return [t.glow, t.plate[0], t.plate[1]];
  return theme === 'light' ? [t.plate[0], t.plate[1], t.edge, t.glow] : [t.score[0], t.score[1], t.glow, t.ink];
}

// Which artwork a look's score bug has: its theme's, else the older looks' below, else mowing stripes.
const OLDER_ART = { grand_final: 'beams' };
export const artOf = look => look?.theme?.art || OLDER_ART[look?.key] || 'mow';

// The looks that ship with the app. The five older looks (classic, finals, grand_final, christmas, derby) keep their own designs in
// css/scoreboard.css and have no theme here.
export const PRESETS = {
  lunar_new_year: {
    name: 'Lunar New Year', banner: 'LUNAR NEW YEAR', accent: '#e8b923',
    theme: { bg: ['#8f1420', '#3c060c'], edge: '#e8b923', ink: '#fff3d6', score: ['#ffffff', '#ffe9a8'], plate: ['#f2c94c', '#c9971c'], plateInk: '#3c0a0a', glow: '#e8b923', clock: '#f2c94c', clockInk: '#3c0a0a', fx: ['shine'], spill: 'gold' },
  },
  spring_blossom: {
    name: 'Spring Blossom', banner: 'SPRING', accent: '#ff9fbd',
    theme: { bg: ['#3c2a4d', '#1a1226'], edge: '#ffc4d6', ink: '#fff4f8', score: ['#ffffff', '#ffe0ea'], plate: ['#ffc4d6', '#f08fb0'], plateInk: '#3a0f24', glow: '#ff9fbd', clock: '#ffd6e3', clockInk: '#3a0f24', fx: [], spill: 'petals' },
  },
  last_round: {
    name: 'Last Round', banner: 'LAST ROUND', accent: '#42a5f5',
    theme: { bg: ['#0d2a52', '#050d1f'], edge: '#42a5f5', ink: '#f2f8ff', score: ['#ffffff', '#d6ebff'], plate: ['#42a5f5', '#1565c0'], plateInk: '#ffffff', glow: '#90caf9', clock: '#42a5f5', clockInk: '#04142b', fx: [], art: 'beams', spill: 'glints' },
  },
  third_place: {
    name: 'Third Place Final', banner: 'THIRD PLACE FINAL', accent: '#d99a5b',
    theme: { bg: ['#54301a', '#1e1008'], edge: '#d99a5b', ink: '#fbeee0', score: ['#eeb47a', '#c9823f'], plate: ['#eeb47a', '#b0733a'], plateInk: '#241204', glow: '#d99a5b', clock: '#e0a56a', clockInk: '#241204', fx: ['shine'], art: 'beams', spill: 'confetti' },
  },
  opening_week: {
    name: 'Fresh Chalk', banner: 'OPENING WEEK', accent: '#7fd66a',
    theme: { bg: ['#1a6b39', '#0d3d20'], edge: '#7fae88', ink: '#f5f8ef', score: ['#ffffff', '#e4efdc'], plate: ['#f6f8f0', '#dbe6cf'], plateInk: '#0c2a16', glow: '#a6e08a', clock: '#f6f8f0', clockInk: '#0c2a16', fx: [], art: 'chalk' },
  },
  movember: {
    name: 'Movember', banner: 'MOVEMBER', accent: '#26c6da',
    theme: { bg: ['#0e3a5c', '#07192e'], edge: '#1b7f9a', ink: '#eaf9ff', score: ['#ffffff', '#aef0ff'], plate: ['#8a5a3a', '#6b4429'], plateInk: '#ffffff', glow: '#26c6da', clock: '#26c6da', clockInk: '#04222a', fx: ['moustache'], spill: 'moustaches' },
  },
  australia_day: {
    name: 'Australia Day', banner: 'AUSTRALIA DAY', accent: '#ffc72c',
    theme: { bg: ['#1d6a3c', '#0c3a20'], edge: '#ffc72c', ink: '#fff8e0', score: ['#ffe27a', '#f2b705'], plate: ['#ffc72c', '#e0a800'], plateInk: '#2a1d00', glow: '#f2b705', clock: '#ffc72c', clockInk: '#2a1d00', fx: ['stars'], spill: 'stars' },
  },
  new_year: {
    name: 'New Year', banner: 'NEW YEAR', accent: '#e8c76a',
    theme: { bg: ['#262c78', '#0c0f30'], edge: '#e8c76a', ink: '#f8f2de', score: ['#fff3c9', '#d9b863'], plate: ['#f1deb0', '#d9b863'], plateInk: '#2a2208', glow: '#e8c76a', clock: '#e8d3a2', clockInk: '#2a2208', fx: ['sparkle', 'confetti'], art: 'beams', spill: 'confetti' },
  },
  festive: {
    name: 'Festive', banner: 'FESTIVE', accent: '#b3203a',
    theme: { bg: ['#1a5c3e', '#0b2c1f'], edge: '#d9b36a', ink: '#fff7ea', score: ['#fff3dc', '#f1d9a8'], plate: ['#c4213f', '#8f1a2e'], plateInk: '#ffffff', glow: '#d4a373', clock: '#c4213f', clockInk: '#ffffff', fx: ['lights', 'snow'], spill: 'snow' },
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
const SPILL_NAMES = { confetti: 'Falling confetti', gold: 'Gold ticker tape', snow: 'Falling snow', petals: 'Petals', embers: 'Embers', stars: 'Falling stars', moustaches: 'Falling moustaches', glints: 'Glints' };
export const fxNames = look => {
  const fall = spillOf(look), shown = (look.theme?.fx || []).filter(n => n !== fall).map(n => FX_NAMES[n]).filter(Boolean);
  return [...(fall ? [SPILL_NAMES[fall]] : []), ...shown];
};

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
