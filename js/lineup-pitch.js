// The Game centre's line-ups on a pitch (FU-08). Pure functions, no DOM: they return html.
//   byPlace(formation)       -> a sort for items with a `slot`: goalkeeper, then defence, midfield and attack, each line left to right
//   pitchHtml(home, away, k) -> both elevens on one pitch, the home side on the left attacking right (home at the top on a phone)
// A side is { code, formation, captain, items: [{ id, name, slot, position }], extras(id) -> { goals, assists, cards } icon html, rating(id) -> { value, cls, motm } | null }.
// k = { colour(code) -> '#rrggbb' | undefined, label(code) -> the club's name, shirt(id) -> shirt number | undefined }.
import { FORMATIONS, DEFAULT_FORMATION } from './pitch.js';
import { onColour } from './club-colour.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A slot's height is its line (GK, defence, midfield, attacking midfield, attack) plus a small forward or back nudge, so it is
// snapped to the nearest line first; otherwise a nudged centre-back would sort ahead of the full-backs.
const LINES = [9, 26, 48, 65, 80];   // the rows in js/pitch.js
const lineOf = y => LINES.reduce((best, v, i) => (Math.abs(v - y) < Math.abs(LINES[best] - y) ? i : best), 0);
const slotOf = (formation, slot) => (FORMATIONS[formation] || FORMATIONS[DEFAULT_FORMATION])[slot];

// The line a slot is on: 0 goalkeeper, 1 defence, 2 midfield, 3 attacking midfield, 4 attack (null for an unknown slot).
export const lineOfSlot = (formation, slot) => { const s = slotOf(formation, slot); return s ? lineOf(s.y) : null; };

export const byPlace = formation => (a, b) => {
  const sa = slotOf(formation, a.slot), sb = slotOf(formation, b.slot);
  const [ay, ax] = sa ? [lineOf(sa.y), sa.x] : [Infinity, 0], [by, bx] = sb ? [lineOf(sb.y), sb.x] : [Infinity, 0];
  return ay - by || ax - bx;
};

const FALLBACK_LINE = { GK: 0, DEF: 1, MID: 2, FWD: 4 };   // when a player has no known slot
const placeOf = (formation, x) => {
  const s = slotOf(formation, x.slot);
  return s ? [lineOf(s.y), s.x] : [FALLBACK_LINE[x.position] ?? 2, 50];
};
// Material Design Icons (Pictogrammers, free licence) star, for the rating pill.
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/></svg>';
const surname = name => String(name || '').trim().split(/\s+/).slice(-1)[0] || '?';
const sameColour = (x, y) => !!x && !!y && String(x).toLowerCase() === String(y).toLowerCase();

function side(s, colour, cls, k) {
  const bands = [];
  for (const x of s.items) { const [line, across] = placeOf(s.formation, x); (bands[line] ||= []).push({ x, across }); }
  return `<div class="pp-half ${cls}" style="--b:${esc(colour)};--t:${esc(onColour(colour))}">${bands.filter(Boolean).map(b => `<div class="pp-band">${b.sort((p, q) => p.across - q.across).map(({ x }) => {
    const r = s.rating?.(x.id), n = k.shirt?.(x.id), ev = s.extras?.(x.id) || {}, pos = x.slot || x.position || '';
    // On the marker: rating pill top right, captain C top left, cards on the left, assists bottom left, goals bottom right.
    const pill = r ? `<span class="rating pp-rt ${r.cls}">${esc(r.value)}${r.value === 'N/A' ? '' : STAR}</span>` : '';
    return `<div class="pp-p${r?.motm ? ' motm' : ''}" title="${esc(x.name)}"><div class="pp-b${pos.length > 2 ? ' pp-s' : ''}">${esc(pos)}${pill}${ev.cards ? `<span class="pp-cards">${ev.cards}</span>` : ''}${ev.assists ? `<span class="pp-ast" title="Assists">${ev.assists}</span>` : ''}${ev.goals ? `<span class="pp-gl" title="Goals">${ev.goals}</span>` : ''}${s.captain === x.id ? '<i class="pp-c" title="Captain">C</i>' : ''}</div><div class="pp-n">${n == null || n === '' ? '' : `<b class="pp-no">${esc(n)}</b> `}${esc(surname(x.name))}</div></div>`;
  }).join('')}</div>`).join('')}</div>`;
}

export function pitchHtml(h, a, k) {
  const hc = k.colour(h.code) || '#1e88e5', ac0 = k.colour(a.code), ac = ac0 && !sameColour(hc, ac0) ? ac0 : '#90caf9';
  const cap = (s, c) => `<span style="--b:${esc(c)}"><i></i>${esc(k.label(s.code))}${s.formation ? ` <small>${esc(s.formation)}</small>` : ''}</span>`;
  return `<div class="pp-wrap"><div class="pp-cap">${cap(h, hc)}${cap(a, ac)}</div>
    <div class="pp" role="group" aria-label="Line-ups on a pitch"><i class="pp-mid"></i><i class="pp-circle"></i><i class="pp-box l"></i><i class="pp-box r"></i><i class="pp-six l"></i><i class="pp-six r"></i>${side(h, hc, 'home', k)}${side(a, ac, 'away', k)}</div></div>`;
}
