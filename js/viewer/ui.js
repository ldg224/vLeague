// Small helpers the match viewer's modules share (ported from the s3 site's ui.js, 0.36). Crests come from vLeague's own clubs.
import { logoUrl } from '../dashboard-data.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const safeColour = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#475569');
// A club's crest URL. The "alt" (second) logo doesn't exist in vLeague, so it is empty and the renderers fall back to the main one.
export const logoPath = (code, alt = false) => (alt ? '' : logoUrl(code));
// Text colour with enough contrast on a team colour.
export function onColour(hex) {
  const c = safeColour(hex).slice(1);
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) >= 128 ? '#0f1115' : '#ffffff';
}
export const statusPill = st => (st === 'live' ? '<span class="mp-pill live"><span class="dot"></span>Live</span>' : '');
