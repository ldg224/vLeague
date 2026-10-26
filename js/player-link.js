// Player names that open the player popup (js/player-overlay.js). A name is a quiet link: no colour, no underline (css/site.css, .plk); the page
// wires one listener for all of them, so a renderer only has to wrap the name.
//   plink(id, html)             -> html wrapped so a click or Enter opens that player's popup; html as it is when there is no id
//   wirePlayerLinks({ open })   -> once per page (chrome() in js/member.js does it); `open(id)` defaults to the popup, loaded only when first needed
// A span, not an <a>: a name often sits inside a row that is already a link (a match row, a table row) and links cannot be nested. The listener runs first
// (capture) and stops the row's own click, so tapping a name opens the player and tapping anywhere else opens the row.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const plink = (id, html) => (id == null || id === '' ? html : `<span class="plk" role="link" tabindex="0" data-pid="${esc(id)}">${html}</span>`);

let wired = false;
const defaultOpen = id => import('./player-overlay.js').then(m => m.openPlayer(id));
export function wirePlayerLinks({ open = defaultOpen } = {}) {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const go = (el, e) => { e.preventDefault(); e.stopPropagation(); open(el.dataset.pid); };
  document.addEventListener('click', e => { const el = e.target.closest?.('[data-pid]'); if (el && (e.button ?? 0) === 0) go(el, e); }, true);
  document.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const el = e.target.closest?.('[data-pid]'); if (el && el === e.target) go(el, e); }, true);
}
