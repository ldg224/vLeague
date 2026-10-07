// The scoreboard (0.35): the plate above a match and the board under it, drawn in the round's "look" (Classic, Finals, Grand Final,
// Christmas, Derby, or any look the office adds as data). The round's own name ("Opening Week") sits on the plate above the board.
// Colours come from the two clubs. No page code: a page hands over what it already knows.
//
//   lookInfo(season, fx)  -> { key, name, accent, banner, ornament }
//   scoreboard({ fx, season, look, h, a, hColour, aColour, crests: [homeHtml, awayHtml], score, state, goals: [homeHtml, awayHtml], meta })
//   bug({ look, hCode, aCode, score, clock, hColour, aColour }) -> the small score bug shown on the pitch
import { esc } from './member.js';

const HEX = /^#[0-9a-f]{6}$/i;
export const KNOWN_LOOKS = ['classic', 'finals', 'grand_final', 'christmas', 'derby'];

export function lookInfo(season, fx) {
  const row = season?.looks?.[fx?.look], s = row?.settings || {};
  const key = row ? fx.look : 'classic';
  return { key, name: row?.name || 'Classic', accent: HEX.test(s.accent || '') ? s.accent : null, banner: s.banner || null, ornament: s.ornament || null };
}

// The round's name for the plate: a named round shows its name big and "Round 3" small; an unnamed one shows "Round 3".
export function roundPlate(season, fx) {
  const r = season?.rounds?.[fx.week] || {};
  const stage = fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Grand Final' : null;
  if (stage) return { big: stage, small: r.name || r.label || '' };
  if (r.name) return { big: r.name, small: r.numbered && r.no ? `Round ${r.no}` : '' };
  return { big: r.label || `Week ${fx.week}`, small: '' };
}

const colourVars = (h, a) => `--h:${HEX.test(h || '') ? h : '#38bdf8'};--a:${HEX.test(a || '') ? a : '#f43f5e'}`;

export function scoreboard(o) {
  const { fx, season, look, crests, score, state, goals, meta, h, a } = o, plate = roundPlate(season, fx);
  const banner = look.banner && look.banner.toLowerCase() !== plate.big.toLowerCase() ? look.banner : '';
  return `<div class="sb" data-look="${esc(look.key)}" style="${look.accent ? `--look:${esc(look.accent)};` : ''}${colourVars(o.hColour, o.aColour)}">
    <div class="sb-plate">${look.ornament ? `<span class="sb-orn" aria-hidden="true">${esc(look.ornament)}</span>` : ''}
      <span class="sb-roundbox"><span class="sb-round">${esc(plate.big)}</span>${plate.small ? `<small class="sb-sub">${esc(plate.small)}</small>` : ''}</span>
      ${banner ? `<span class="sb-banner">${esc(banner)}</span>` : ''}${look.ornament ? `<span class="sb-orn" aria-hidden="true">${esc(look.ornament)}</span>` : ''}</div>
    <div class="sb-board">
      <div class="sb-team h">${crests[0]}<b>${esc(h)}</b><ul class="sb-goals">${goals[0]}</ul></div>
      <div class="sb-mid">${score}<span class="sb-state">${state}</span></div>
      <div class="sb-team a">${crests[1]}<b>${esc(a)}</b><ul class="sb-goals">${goals[1]}</ul></div>
    </div>${meta ? `<p class="sb-meta">${meta}</p>` : ''}</div>`;
}

export const bug = ({ look, hCode, aCode, score, clock, hColour, aColour, round }) => `<div class="sb-bug" data-look="${esc(look.key)}" style="${look.accent ? `--look:${esc(look.accent)};` : ''}${colourVars(hColour, aColour)}">
  ${round ? `<span class="sb-bug-round">${look.ornament ? `${esc(look.ornament)} ` : ''}${esc(round)}</span>` : ''}
  <span class="sb-bug-row"><i class="hc"></i><b>${esc(hCode)}</b><strong>${score}</strong><b>${esc(aCode)}</b><i class="ac"></i><em>${esc(clock)}</em></span></div>`;
