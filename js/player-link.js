// Player names that open the player's page (player.html?id=...). A name is a quiet link: no colour, no underline (css/site.css, .plk); the page
// wires one listener for all of them, so a renderer only has to wrap the name.
//   plink(id, html)      -> html wrapped so a click or Enter opens that player's page; html as it is when there is no id
//   playerUrl(id)        -> 'player.html?id=...'
//   wirePlayerLinks()    -> once per page (chrome() in js/member.js does it)
// A span, not an <a>: a name often sits inside a row that is already a link (a match row, a table row) and links cannot be nested. The listener runs first
// (capture) and stops the row's own click, so tapping a name opens the player and tapping anywhere else opens the row.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const playerUrl = id => `player.html?id=${encodeURIComponent(id)}`;
export const plink = (id, html) => (id == null || id === '' ? html : `<span class="plk" role="link" tabindex="0" data-pid="${esc(id)}">${html}</span>`);

let wired = false;
export function wirePlayerLinks() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const open = (el, e) => {
    e.preventDefault(); e.stopPropagation();
    const url = playerUrl(el.dataset.pid);
    if (e.ctrlKey || e.metaKey || e.button === 1) window.open(url, '_blank', 'noopener'); else location.href = url;
  };
  document.addEventListener('click', e => { const el = e.target.closest?.('[data-pid]'); if (el && e.button === 0) open(el, e); }, true);
  document.addEventListener('auxclick', e => { const el = e.target.closest?.('[data-pid]'); if (el && e.button === 1) open(el, e); }, true);
  document.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const el = e.target.closest?.('[data-pid]'); if (el && el === e.target) open(el, e); }, true);
}
