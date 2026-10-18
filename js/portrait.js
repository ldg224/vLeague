// Player portraits: a small illustrated head and shoulders for every player, drawn in the browser as SVG from the player's id, so nothing
// is stored except `look` and `face` on the player (supabase/migrations/0058_player_portraits.sql). The same id, face and look always give the
// same man. `look` picks the skin tones, hair, beard and facial features that suit his name (see LOOKS); `face` is a number the Editor bumps to
// re-roll. The shirt is the player's club colours (a free agent wears grey), with a pattern chosen from the club's code so a squad matches.
//
//   portrait(player, club, size, decorative) -> SVG markup. player: { id, name, look, face }; club: { code, colour, colour2, chest? } or null (chest: a
//                                     data URL of the chest of the club's real kit, which then replaces the simple shirt);
//                                     size: width in px (the height follows), or omit it to let CSS size the SVG. It is an image for
//                                     screen readers, unless `decorative` is true (the name is printed beside it).
//   LOOKS                          -> [[look, label]] for the Editor's picker.
//   lookOf(player)                 -> the look to draw (a player without one is drawn as 'euro').
import { isHex } from './club-colour.js';

// The thin outline that keeps dark hair visible on a dark card and white kit visible on a white one: the text colour, faded.
const RIM = 'drop-shadow(0 0 .6px color-mix(in srgb, var(--text, #222) 55%, transparent))';

export const LOOKS = [['euro', 'European'], ['latin', 'Latin'], ['mena', 'Middle Eastern'], ['southasian', 'South Asian'], ['eastasian', 'East Asian'], ['black', 'Black'], ['pacific', 'Pacific Islander']];

const SKIN = ['#f6d5bd', '#eab98f', '#d19a6c', '#b07548', '#8a5530', '#5e3a22', '#f0cfa5'];
const BLK = '#1d1d22', DKB = '#3b2a20', BRN = '#6b4528', AUB = '#8e3b1f', BLD = '#d9b45a', GIN = '#c4521e';
// Each background sets skin, hair, beard and the face itself (head shape, eyes, nose, lips, brows) the way it really tends to look.
const DB = '#2a1a14', BLUE = '#4a7bb5', GREEN = '#5b8a5a', HAZEL = '#7a5a2a', WARM = '#4a2c1a';
const GROUPS = {
  euro:       { skin: [0, 0, 1], hairC: [BLK, DKB, BRN, BRN, BLD, AUB, GIN], hair: ['short', 'short', 'quiff', 'sidepart', 'buzz', 'curly', 'bald'], beard: ['none', 'none', 'stubble', 'beard', 'moustache', 'goatee'],
                face: [22.5, 4, 29, 4, .3, .4], eyes: ['wide', 'dot', 'sleepy', 'happy'], iris: [DB, BLUE, GREEN, HAZEL], eyeX: 11, nose: 'narrow', lip: 1.8, brow: 2 },
  latin:      { skin: [1, 2, 2], hairC: [BLK, BLK, DKB, BRN], hair: ['short', 'quiff', 'sidepart', 'buzz', 'curly'], beard: ['none', 'none', 'stubble', 'beard', 'goatee'],
                face: [23.5, 4, 28.5, 3.5, .4, .4], eyes: ['wide', 'dot', 'sleepy', 'happy'], iris: [WARM, HAZEL, DB], eyeX: 11, nose: 'medium', lip: 2, brow: 2.6 },
  mena:       { skin: [2, 2, 3], hairC: [BLK, BLK, DKB], hair: ['short', 'quiff', 'sidepart', 'buzz'], beard: ['none', 'stubble', 'beard', 'beard', 'moustache', 'goatee'],
                face: [23, 4, 29.5, 3.5, .3, .35], eyes: ['wide', 'wide', 'dot', 'sleepy'], iris: [DB, WARM], eyeX: 10.8, nose: 'aquiline', lip: 2, brow: 3.3 },
  southasian: { skin: [2, 3, 3, 4], hairC: [BLK, BLK, DKB], hair: ['short', 'quiff', 'sidepart', 'buzz', 'curly'], beard: ['none', 'none', 'stubble', 'beard', 'moustache'],
                face: [22.5, 4, 29, 3.5, .4, .4], eyes: ['wide', 'wide', 'dot', 'sleepy'], iris: [DB, WARM], eyeX: 11, nose: 'aquiline', lip: 2.1, brow: 3.4 },
  eastasian:  { skin: [6, 6, 1], hairC: [BLK, BLK, BLK, DKB], hair: ['fringe', 'fringe', 'short', 'sidepart', 'quiff', 'buzz'], beard: ['none', 'none', 'none', 'stubble', 'goatee'],
                face: [25.5, 3, 27.5, 3, .75, .25], eyes: ['almond', 'almond', 'almond', 'happy'], iris: [DB], eyeX: 12, nose: 'flat', lip: 1.9, brow: 1.8 },
  pacific:    { skin: [3, 4, 3], hairC: [BLK, BLK, DKB], hair: ['short', 'buzz', 'curly', 'quiff', 'sidepart'], beard: ['none', 'stubble', 'beard', 'goatee', 'moustache'],
                face: [24.5, 4, 28.5, 3.5, .45, .4], eyes: ['wide', 'dot', 'happy', 'sleepy'], iris: [DB, WARM], eyeX: 11.2, nose: 'medium', lip: 2.3, brow: 2.9 },
  black:      { skin: [4, 5, 5, 3], hairC: [BLK], hair: ['buzz', 'short', 'afro', 'curly', 'hightop', 'twists', 'bald'], beard: ['none', 'none', 'stubble', 'beard', 'goatee', 'moustache'],
                face: [24.5, 4, 28, 3.5, .5, .4], eyes: ['wide', 'dot', 'happy', 'sleepy'], iris: [DB, WARM], eyeX: 11.5, nose: 'broad', lip: 2.5, brow: 2.6 }
};
export const lookOf = p => (GROUPS[p?.look] ? p.look : 'euro');

const KIT = ['plain', 'hoops', 'stripes', 'sash', 'half'];
const MOUTH = ['smile', 'flat', 'grin', 'smirk', 'open'];

function rng(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function shade(hex, k) {
  let n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return '#' + c.map(function (v) { v = Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); }).join('');
}

let uid = 0;
function draw(seed, club, group, pattern, label, size) {
  let r = rng(seed), id = 'p' + (uid++);
  let g = GROUPS[group];
  let skin = SKIN[pick(r, g.skin)], skinD = shade(skin, -0.14), hairC = pick(r, g.hairC), hair = pick(r, g.hair);
  let kit = pick(r, KIT), eyes = pick(r, g.eyes), iris = pick(r, g.iris), mouth = pick(r, MOUTH), beard = pick(r, g.beard);
  let w = g.face[0] + r() * g.face[1], hh = g.face[2] + r() * g.face[3], jaw = g.face[4] + r() * g.face[5], cy = 64, t = cy - hh;
  let tilt = (r() - 0.5) * 6, browW = g.brow + r() * 0.8, headband = r() < 0.14;
  if (pattern) kit = pattern;
  let hairD = shade(hairC, -0.3), ink = '#2a1a14';
  let s = '';
  let cap = function (extra, hl) {
    let ctrl = 2 * (t + (hl || 11)) - (cy - 12);
    return '<path d="M' + (60 - w - 1.5) + ' ' + (cy - 4) + ' C' + (60 - w - 3) + ' ' + (t - 10 - extra) + ' ' + (60 + w + 3) + ' ' + (t - 10 - extra) + ' ' + (60 + w + 1.5) + ' ' + (cy - 4) +
      ' L' + (60 + w - 1) + ' ' + (cy - 12) + ' Q60 ' + ctrl + ' ' + (60 - w + 1) + ' ' + (cy - 12) + 'Z" fill="' + hairC + '"/>';
  };

  s += '<svg class="portrait" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140"' + (size ? ' width="' + size + '" height="' + Math.round(size * 7 / 6) + '"' : '') + (label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"') + ' style="overflow:visible;filter:' + RIM + '">';
  s += '<defs><clipPath id="' + id + 'k"><path d="M8 140 C8 112 32 104 60 104 C88 104 112 112 112 140Z"/></clipPath>' +
       '</defs>';
  s += '<g>';

  // hair behind the head
  if (hair === 'afro') s += '<circle cx="60" cy="' + (cy - 8) + '" r="' + (w + 13) + '" fill="' + hairC + '"/>';

  // neck, shirt
  s += '<rect x="51" y="84" width="18" height="28" fill="' + skinD + '"/>';
  s += '<g clip-path="url(#' + id + 'k)"><rect x="0" y="100" width="120" height="40" fill="' + club.a + '"/>';
  // The club's real kit (js/kit.js) when given: its chest, cropped to fill the shirt, in place of the simple pattern.
  if (club.chest) s += '<image href="' + club.chest + '" x="0" y="100" width="120" height="40" preserveAspectRatio="xMidYMid slice"/>';
  else if (kit === 'hoops') for (let y = 108; y < 140; y += 10) s += '<rect x="0" y="' + y + '" width="120" height="5" fill="' + club.b + '"/>';
  else if (kit === 'stripes') for (let x = 6; x < 114; x += 16) s += '<rect x="' + x + '" y="100" width="8" height="40" fill="' + club.b + '"/>';
  else if (kit === 'sash') s += '<polygon points="14,104 38,104 106,140 82,140" fill="' + club.b + '"/>';
  else if (kit === 'half') s += '<rect x="60" y="100" width="60" height="40" fill="' + club.b + '"/>';
  s += '</g>';
  s += '<path d="M46 104 L60 123 L74 104Z" fill="' + skinD + '"/>';
  s += '<path d="M44 104 L60 124 L76 104" fill="none" stroke="' + (!club.chest && (kit === 'plain' || kit === 'half') ? club.b : shade(club.a, -0.25)) + '" stroke-width="4.5" stroke-linejoin="round"/>';

  // head
  s += '<circle cx="' + (60 - w) + '" cy="' + (cy + 4) + '" r="4.6" fill="' + skin + '"/><circle cx="' + (60 + w) + '" cy="' + (cy + 4) + '" r="4.6" fill="' + skin + '"/>';
  let jr = Math.min(w * jaw, hh), bot = cy + hh;
  s += '<path d="M' + (60 - w) + ' ' + cy + ' A' + w + ' ' + hh + ' 0 0 1 ' + (60 + w) + ' ' + cy + ' L' + (60 + w) + ' ' + (bot - jr) + ' A' + jr + ' ' + jr + ' 0 0 1 ' + (60 + w - jr) + ' ' + bot + ' L' + (60 - w + jr) + ' ' + bot + ' A' + jr + ' ' + jr + ' 0 0 1 ' + (60 - w) + ' ' + (bot - jr) + 'Z" fill="' + skin + '"/>';

  // facial hair under features
  let jb = '60 ' + (cy + 9);
  if (beard === 'stubble') s += '<path d="M' + (60 - w) + ' ' + (cy + 2) + ' C' + (60 - w) + ' ' + (cy + hh + 6) + ' ' + (60 + w) + ' ' + (cy + hh + 6) + ' ' + (60 + w) + ' ' + (cy + 2) + ' C' + (60 + w - 4) + ' ' + (cy + 12) + ' 64 ' + (cy + 9) + ' ' + jb + ' C56 ' + (cy + 9) + ' ' + (60 - w + 4) + ' ' + (cy + 12) + ' ' + (60 - w) + ' ' + (cy + 2) + 'Z" fill="' + hairD + '" opacity=".14"/>';
  if (beard === 'beard') s += '<path d="M' + (60 - w) + ' ' + (cy + 2) + ' C' + (60 - w) + ' ' + (cy + hh + 6) + ' ' + (60 + w) + ' ' + (cy + hh + 6) + ' ' + (60 + w) + ' ' + (cy + 2) + ' C' + (60 + w - 4) + ' ' + (cy + 12) + ' 64 ' + (cy + 10) + ' ' + jb + ' C56 ' + (cy + 10) + ' ' + (60 - w + 4) + ' ' + (cy + 12) + ' ' + (60 - w) + ' ' + (cy + 2) + 'Z" fill="' + hairC + '"/>';
  if (beard === 'goatee') s += '<ellipse cx="60" cy="' + (cy + hh - 7) + '" rx="8" ry="7" fill="' + hairC + '"/>';

  // nose, eyes, brows
  let nk = 'fill="none" stroke="' + skinD + '" stroke-linecap="round"', ny = cy;
  if (g.nose === 'narrow') s += '<path d="M58.8 ' + (ny + 4) + ' Q57 ' + (ny + 10) + ' 60 ' + (ny + 10.8) + ' Q62.4 ' + (ny + 10.6) + ' 62 ' + (ny + 9.4) + '" ' + nk + ' stroke-width="1.8"/>';
  if (g.nose === 'medium') s += '<path d="M58.6 ' + (ny + 3) + ' Q56.2 ' + (ny + 10) + ' 60 ' + (ny + 11.4) + ' Q63.8 ' + (ny + 10) + ' 61.6 ' + (ny + 3.5) + '" ' + nk + ' stroke-width="1.9"/>';
  if (g.nose === 'aquiline') s += '<path d="M59.4 ' + (ny - 2) + ' Q56.4 ' + (ny + 8) + ' 59.6 ' + (ny + 12) + ' Q63.4 ' + (ny + 12.2) + ' 63 ' + (ny + 9.6) + '" ' + nk + ' stroke-width="2.1"/>';
  if (g.nose === 'broad') s += '<path d="M59 ' + (ny + 2) + ' L58.6 ' + (ny + 8) + '" ' + nk + ' stroke-width="1.4" opacity=".6"/><path d="M55.6 ' + (ny + 10) + ' Q60 ' + (ny + 14) + ' 64.4 ' + (ny + 10) + '" ' + nk + ' stroke-width="2.2"/><circle cx="56.8" cy="' + (ny + 10.6) + '" r="1.3" fill="' + skinD + '"/><circle cx="63.2" cy="' + (ny + 10.6) + '" r="1.3" fill="' + skinD + '"/>';
  if (g.nose === 'flat') s += '<path d="M56.4 ' + (ny + 9.4) + ' Q60 ' + (ny + 12.6) + ' 63.6 ' + (ny + 9.4) + '" ' + nk + ' stroke-width="1.9"/><path d="M59.4 ' + (ny + 5) + ' L59.2 ' + (ny + 8.4) + '" ' + nk + ' stroke-width="1.2" opacity=".5"/>';
  [-g.eyeX, g.eyeX].forEach(function (dx, i) {
    let x = 60 + dx, y = cy + 1;
    if (eyes === 'dot') s += '<circle cx="' + x + '" cy="' + y + '" r="2.8" fill="' + ink + '"/>';
    if (eyes === 'wide') s += '<ellipse cx="' + x + '" cy="' + y + '" rx="4.6" ry="3.8" fill="#fff"/><circle cx="' + (x + (i ? -.5 : .5)) + '" cy="' + y + '" r="2.4" fill="' + iris + '"/><circle cx="' + (x + (i ? -.5 : .5)) + '" cy="' + y + '" r="1.1" fill="' + ink + '"/>';
    if (eyes === 'almond') {
      let dr = i ? 1 : -1, ix = x - dr * 5, iy = y + .8, ox = x + dr * 5.4, oy = y - .8;
      s += '<path d="M' + ix + ' ' + iy + ' Q' + (x + dr * .4) + ' ' + (y - 3.8) + ' ' + ox + ' ' + oy + ' Q' + x + ' ' + (y + 2.4) + ' ' + ix + ' ' + iy + 'Z" fill="#f3ece6"/>' +
        '<ellipse cx="' + (x + dr * .3) + '" cy="' + (y - .2) + '" rx="2.3" ry="2" fill="' + iris + '"/><circle cx="' + (x + dr * .3) + '" cy="' + (y - .2) + '" r="1" fill="' + ink + '"/>' +
        '<path d="M' + (ix - dr * .3) + ' ' + iy + ' Q' + (x + dr * .4) + ' ' + (y - 4.2) + ' ' + (ox + dr * 1) + ' ' + (oy - .4) + '" fill="none" stroke="' + ink + '" stroke-width="1.5" stroke-linecap="round"/>';
    }
    if (eyes === 'sleepy') s += '<circle cx="' + x + '" cy="' + (y + .6) + '" r="2.6" fill="' + ink + '"/><path d="M' + (x - 4.5) + ' ' + (y - .6) + ' L' + (x + 4.5) + ' ' + (y - .6) + '" stroke="' + skinD + '" stroke-width="2.4" stroke-linecap="round"/>';
    if (eyes === 'happy') s += '<path d="M' + (x - 4) + ' ' + (y + 2) + ' Q' + x + ' ' + (y - 4) + ' ' + (x + 4) + ' ' + (y + 2) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    let ty = (i ? -tilt : tilt);
    s += '<path d="M' + (x - 5.5) + ' ' + (cy - 8 + ty / 2) + ' L' + (x + 5.5) + ' ' + (cy - 8 - ty / 2) + '" stroke="' + (hair === 'bald' ? skinD : hairD) + '" stroke-width="' + browW + '" stroke-linecap="round"/>';
  });

  // mouth
  let my = cy + 18;
  if (beard === 'moustache') s += '<path d="M48 ' + (my - 4) + ' Q54 ' + (my - 9) + ' 60 ' + (my - 5) + ' Q66 ' + (my - 9) + ' 72 ' + (my - 4) + ' Q66 ' + (my - 3) + ' 60 ' + (my - 2) + ' Q54 ' + (my - 3) + ' 48 ' + (my - 4) + 'Z" fill="' + hairC + '"/>';
  let lipC = shade(skin, -0.4), mc = beard === 'beard' ? shade(lipC, .3) : lipC;
  if (mouth === 'smile') s += '<path d="M52 ' + (my - 2) + ' Q60 ' + (my + 5) + ' 68 ' + (my - 2) + '" fill="none" stroke="' + mc + '" stroke-width="' + g.lip + '" stroke-linecap="round"/>';
  if (mouth === 'flat') s += '<path d="M53 ' + my + ' L67 ' + my + '" stroke="' + mc + '" stroke-width="' + g.lip + '" stroke-linecap="round"/>';
  if (mouth === 'grin') s += '<path d="M51 ' + (my - 3) + ' Q60 ' + (my + 10) + ' 69 ' + (my - 3) + 'Z" fill="#fff" stroke="' + mc + '" stroke-width="1.8" stroke-linejoin="round"/>';
  if (mouth === 'smirk') s += '<path d="M53 ' + (my + 1) + ' Q62 ' + (my + 3) + ' 69 ' + (my - 3) + '" fill="none" stroke="' + mc + '" stroke-width="' + g.lip + '" stroke-linecap="round"/>';
  if (mouth === 'open') s += '<ellipse cx="60" cy="' + (my + 1) + '" rx="5" ry="3.6" fill="#5a2418"/>';

  // front hair
  if (hair === 'buzz') s += '<g opacity=".92">' + cap(-3, 8) + '</g>';
  if (hair === 'short' || hair === 'sidepart' || hair === 'afro') s += cap(1, 12);
  if (hair === 'quiff') s += cap(2, 12) + '<ellipse cx="66" cy="' + (t - 1) + '" rx="' + (w * 0.72) + '" ry="9" fill="' + hairC + '" transform="rotate(-14 66 ' + t + ')"/>';
  if (hair === 'fringe') s += cap(1, 15);
  if (hair === 'hightop') s += cap(1, 11) + '<rect x="' + (60 - w + 3) + '" y="' + (t - 9) + '" width="' + (2 * w - 6) + '" height="16" rx="4" fill="' + hairC + '"/>';
  if (hair === 'twists') { s += cap(1, 11); for (let q = -3; q <= 3; q++) s += '<rect x="' + (60 + q * 7 - 2.6) + '" y="' + (t - 9 + Math.abs(q) * 1.6) + '" width="5.2" height="13" rx="2.6" fill="' + hairC + '" transform="rotate(' + (q * 7) + ' ' + (60 + q * 7) + ' ' + (t + 4) + ')"/>'; }
  if (hair === 'curly') { s += cap(1, 13); for (let cx = 60 - w + 2; cx <= 60 + w - 2; cx += 8) s += '<circle cx="' + cx + '" cy="' + (t + 2 + (Math.abs(cx - 60) > 14 ? 5 : 0)) + '" r="7.5" fill="' + hairC + '"/>'; }
  if (hair === 'sidepart') s += '<path d="M50 ' + (t + 1) + ' Q48 ' + (t + 12) + ' ' + (60 - w + 2) + ' ' + (t + 17) + '" fill="none" stroke="' + hairD + '" stroke-width="1.6" opacity=".6" stroke-linecap="round"/>';
  if (hair === 'bald') s += '<ellipse cx="52" cy="' + (t + 6) + '" rx="6" ry="3" fill="#fff" opacity=".22" transform="rotate(-20 52 ' + (t + 6) + ')"/>';
  if (headband) s += '<rect x="' + (60 - w - 1) + '" y="' + (cy - 15) + '" width="' + (2 * w + 2) + '" height="6" rx="3" fill="' + club.b + '"/>';
  s += '</g></svg>';
  return s;
}

const cache = new Map(), chestIds = new Map();
const chestId = c => chestIds.get(c) ?? (chestIds.set(c, chestIds.size + 1), chestIds.size);   // a short id for a long data URL, so the cache key stays small
const hash = s => [...String(s)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
export function portrait(p, club, size, decorative = false) {
  if (!p) return '';
  const a = isHex(club?.colour) ? club.colour : '#7d8798', b = isHex(club?.colour2) ? club.colour2 : '#ffffff';
  const look = lookOf(p), pattern = club?.code ? KIT[hash(club.code) % KIT.length] : 'plain';
  const label = decorative ? '' : `Portrait of ${String(p.name || '').replace(/[<>&"]/g, '')}`;
  const chest = club?.chest && String(club.chest).startsWith('data:image/') ? club.chest : '';
  const key = [p.id, p.face || 0, look, a, b, pattern, size || 0, label, chest ? chestId(chest) : ''].join('|');
  if (!cache.has(key)) {
    if (cache.size > 800) cache.clear();
    cache.set(key, draw(`${p.id}#${p.face || 0}`, { a, b, chest }, look, pattern, label, size));
  }
  return cache.get(key);
}
