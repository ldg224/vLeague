// The scoreboard (0.35): the plate above a match and the board under it, drawn in the round's "look" (Classic, Finals, Grand Final,
// Christmas, Derby, or any look the office adds as data). The round's own name ("Opening Week") sits on the plate above the board.
// Colours come from the two clubs. No page code: a page hands over what it already knows.
//
//   lookInfo(season, fx)  -> { key, name, accent, banner, ornament, theme }
//   scoreboard({ fx, season, look, h, a, hColour, aColour, crests: [homeHtml, awayHtml], score, state, goals: [homeHtml, awayHtml], meta })
import { resolveLook, themeVars, fxHtml } from './looks.js';

const HEX = /^#[0-9a-f]{6}$/i;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));   // (not imported from member.js, which pulls in the sign-in code: this file stays pure, so the Editor's previews and the tests can use it)

// A match's look (1.17): its own, else its window's or round's (already worked out into fx.look), drawn from the registry in js/looks.js.
export function lookInfo(season, fx) { return resolveLook(fx?.look, season?.looks?.[fx?.look]); }

// The round's name for the plate: a named round shows its name big and "Round 3" small; an unnamed one shows "Round 3".
export function roundPlate(season, fx) {
  const r = season?.rounds?.[fx.week] || {};
  const stage = fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Grand Final' : null;
  if (stage) return { big: stage, small: r.name || r.label || '' };
  if (r.name) return { big: r.name, small: r.numbered && r.no ? `Round ${r.no}` : '' };
  return { big: r.label || `Week ${fx.week}`, small: '' };
}

// Text that reads on the look's accent colour (dark on a light accent, white on a dark one).
const inkOn = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) >= 150 ? '#1b1400' : '#ffffff'; };
const colourVars = (h, a) => `--h:${HEX.test(h || '') ? h : '#38bdf8'};--a:${HEX.test(a || '') ? a : '#f43f5e'}`;

export function scoreboard(o) {
  const { fx, season, look, crests, score, state, goals, meta, h, a } = o, plate = roundPlate(season, fx);
  const banner = look.banner && look.banner.toLowerCase() !== plate.big.toLowerCase() ? look.banner : '';
  return `<div class="sb" data-look="${esc(look.key)}"${look.theme ? ` data-themed data-fx="${esc(look.theme.fx.join(' '))}"` : ''} style="${themeVars(look.theme)}${look.accent ? `--look:${esc(look.accent)};--look-ink:${inkOn(look.accent)};` : ''}${colourVars(o.hColour, o.aColour)}">
    <div class="sb-plate">${look.ornament ? `<span class="sb-orn" aria-hidden="true">${esc(look.ornament)}</span>` : ''}
      <span class="sb-roundbox"><span class="sb-round">${esc(plate.big)}</span>${plate.small ? `<small class="sb-sub">${esc(plate.small)}</small>` : ''}</span>
      ${banner ? `<span class="sb-banner">${esc(banner)}</span>` : ''}${look.ornament ? `<span class="sb-orn" aria-hidden="true">${esc(look.ornament)}</span>` : ''}</div>
    <div class="sb-board">${look.theme ? `<div class="sb-fx" aria-hidden="true">${fxHtml(look.theme.fx)}</div>` : ''}
      <div class="sb-team h">${crests[0]}<b>${esc(h)}</b><ul class="sb-goals">${goals[0]}</ul></div>
      <div class="sb-mid">${score}<span class="sb-state">${state}</span></div>
      <div class="sb-team a">${crests[1]}<b>${esc(a)}</b><ul class="sb-goals">${goals[1]}</ul></div>
    </div>${meta ? `<p class="sb-meta">${meta}</p>` : ''}</div>`;
}
