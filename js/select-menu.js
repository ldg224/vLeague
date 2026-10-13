// Menus for <select>s, in the look of the Seasons toggle on the league page (css/select-menu.css). The select stays the real control: it keeps its
// place, its layout, its value, its label, its validation and its change event, and is only drawn as a pill. Opening it (a click, or Enter, Space or an
// arrow key) shows a card of choices instead of the browser's own list. A choice sets the select and fires `input` and `change`, so the page's own code
// never knows the difference.
//   enableSelectMenus(root, { skip })   root: the element whose selects get the menu (class .sm-on is put on it); skip: a selector to leave native
import { icon } from './icons.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let open = null;   // { select, menu }

// The select's name for the menu's small heading: its aria-label, else its label.
function nameOf(sel) {
  const aria = sel.getAttribute('aria-label');
  if (aria) return aria;
  const lab = (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)) || sel.closest('label');
  if (!lab) return '';
  const clone = lab.cloneNode(true);
  clone.querySelectorAll('select, small, i, .ed-msg').forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
}

function close(restoreFocus = true) {
  if (!open) return;
  const { select, menu } = open;
  open = null;
  menu.remove();
  select.removeAttribute('aria-expanded');
  removeEventListener('resize', onAway);
  removeEventListener('scroll', onScroll, true);
  document.removeEventListener('pointerdown', onOutside, true);
  if (restoreFocus) select.focus({ preventScroll: true });
}
const onAway = () => close(false);
const onScroll = e => { if (open && !open.menu.contains(e.target)) close(false); };
const onOutside = e => { if (open && !open.menu.contains(e.target) && e.target !== open.select) close(false); };

function choose(sel, index) {
  if (sel.selectedIndex !== index) {
    sel.selectedIndex = index;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  close();
}

function show(sel) {
  if (open?.select === sel) return close();
  close(false);
  if (sel.disabled) return;
  const title = nameOf(sel);
  let html = title ? `<p class="sm-head">${esc(title)}</p>` : '';
  const row = o => `<button type="button" role="option" class="sm-opt" data-i="${o.index}" aria-selected="${o.selected}"${o.disabled ? ' disabled' : ''}><span>${esc(o.textContent)}</span>${icon('check')}</button>`;
  for (const n of sel.children) {
    if (n.tagName === 'OPTGROUP') html += `<p class="sm-group">${esc(n.label)}</p>${[...n.children].map(row).join('')}`;
    else if (n.tagName === 'OPTION') html += row(n);
  }
  const menu = document.createElement('div');
  menu.className = 'sm-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', title || 'Choose');
  menu.innerHTML = html;
  document.body.append(menu);
  // Under the select, as wide as it (at least 200 px), or above it when there is more room there.
  const r = sel.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  menu.style.minWidth = `${Math.min(Math.max(r.width, 200), vw - 24)}px`;
  const mw = menu.offsetWidth, below = vh - r.bottom - 12, above = r.top - 12;
  const up = menu.scrollHeight > below && above > below, room = Math.max(140, up ? above : below);
  menu.style.maxHeight = `${Math.min(room, 360)}px`;
  menu.style.left = `${Math.max(12, Math.min(r.left, vw - mw - 12))}px`;
  if (up) menu.style.bottom = `${vh - r.top + 6}px`;
  else menu.style.top = `${r.bottom + 6}px`;
  open = { select: sel, menu };
  sel.setAttribute('aria-expanded', 'true');
  addEventListener('resize', onAway);
  addEventListener('scroll', onScroll, true);
  document.addEventListener('pointerdown', onOutside, true);
  const first = menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector('.sm-opt:not(:disabled)');
  if (first) menu.scrollTop = first.offsetTop - (menu.clientHeight - first.offsetHeight) / 2;   // the chosen row in the middle (scrollIntoView could scroll the page, which closes the menu)
  first?.focus({ preventScroll: true });
}

function menuKey(e) {
  const items = [...open.menu.querySelectorAll('.sm-opt:not(:disabled)')], i = items.indexOf(document.activeElement);
  const go = n => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'Tab') close(false);
  else if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    const hit = items.find(b => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
    if (hit) { e.preventDefault(); hit.focus(); }
  }
}

export function enableSelectMenus(root, { skip = '.rt, [multiple], [size]' } = {}) {
  root.classList.add('sm-on');
  const mine = e => { const s = e.target.closest?.('select'); return s && root.contains(s) && !s.matches(skip) ? s : null; };
  root.addEventListener('pointerdown', e => {
    const s = mine(e);
    if (s && e.button === 0) { e.preventDefault(); s.focus({ preventScroll: true }); show(s); }
  });
  root.addEventListener('mousedown', e => { if (mine(e)) e.preventDefault(); });   // the browser's own list never opens
  root.addEventListener('keydown', e => {
    const s = mine(e);
    if (s && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.altKey) { e.preventDefault(); show(s); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.sm-menu .sm-opt');
    if (b && open) choose(open.select, Number(b.dataset.i));
  });
  document.addEventListener('keydown', e => { if (open && open.menu.contains(document.activeElement)) menuKey(e); });
}
