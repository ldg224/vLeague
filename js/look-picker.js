// The look picker (1.17): a pill that says which scoreboard look a round or a match has, and a menu card of the looks, each with a little
// preview, in the manner of the Seasons toggle (css/select-menu.css). Used by the Editor's Fixtures tab: one on every round (the whole
// week) and one on every match (its own look, or "Same as the round").
//   lookPicker({ scope: 'round' | 'match', id, looks, value, roundLook })  -> html   value: a look key, or '' for a match with no look of its own
//   mountLookPicker(root, { looks, onPick(scope, id, value) })              -> wires every picker inside root (once)
import { resolveLook, swatch, fxNames } from './looks.js';
import { icon } from './icons.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thumb = look => { const s = swatch(look); return `<span class="lk-thumb" style="--b1:${s.bg[0]};--b2:${s.bg[1]};--e:${s.edge};--i:${s.ink};--a:${s.accent}" aria-hidden="true"><b>2–1</b></span>`; };
const byKey = (looks, key) => resolveLook(key, looks.find(l => l.key === key));

export function lookPicker({ scope, id, looks, value, roundLook }) {
  const inherit = scope === 'match' && !value, look = byKey(looks, inherit ? roundLook : value);
  const what = scope === 'round' ? 'the round' : 'this match';
  return `<button type="button" class="lk-btn${inherit ? ' is-inherit' : ''}" data-lk="${scope}" data-id="${esc(id)}" data-value="${esc(value || '')}" data-round="${esc(roundLook || '')}" aria-haspopup="listbox" aria-label="Scoreboard look for ${what}: ${esc(inherit ? `same as the round (${look.name})` : look.name)}">
    ${thumb(look)}<span class="lk-name">${esc(look.name)}${inherit ? '<small>Round</small>' : ''}</span>${icon('chevron-down')}</button>`;
}

let open = null;   // { btn, menu }
function close(restoreFocus = true) {
  if (!open) return;
  const { btn, menu } = open;
  open = null; menu.remove(); btn.removeAttribute('aria-expanded');
  removeEventListener('resize', away); removeEventListener('scroll', scrolled, true); document.removeEventListener('pointerdown', outside, true);
  if (restoreFocus) btn.focus({ preventScroll: true });
}
const away = () => close(false);
const scrolled = e => { if (open && !open.menu.contains(e.target)) close(false); };
const outside = e => { if (open && !open.menu.contains(e.target) && !open.btn.contains(e.target)) close(false); };

function show(btn, looks) {
  if (open?.btn === btn) return close();
  close(false);
  const scope = btn.dataset.lk, cur = btn.dataset.value, roundLook = btn.dataset.round;
  const row = (value, look, label, note) => `<button type="button" role="option" class="sm-opt lk-opt" data-v="${esc(value)}" aria-selected="${value === cur}">${thumb(look)}<span class="lk-text"><b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ''}</span>${icon('check')}</button>`;
  const all = looks.map(l => resolveLook(l.key, l));
  let html = `<p class="sm-head">${scope === 'round' ? 'Scoreboard look for the whole round' : 'Scoreboard look for this match'}</p>`;
  if (scope === 'match') html += row('', byKey(looks, roundLook), 'Same as the round', byKey(looks, roundLook).name);
  html += all.map(l => row(l.key, l, l.name, fxNames(l).join(', ') || (l.theme ? '' : 'Built in'))).join('');
  const menu = document.createElement('div');
  menu.className = 'sm-menu lk-menu'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', 'Scoreboard look'); menu.innerHTML = html;
  document.body.append(menu);
  const r = btn.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  menu.style.minWidth = `${Math.min(Math.max(r.width, 260), vw - 24)}px`;
  const mw = menu.offsetWidth, below = vh - r.bottom - 12, above = r.top - 12, up = menu.scrollHeight > below && above > below;
  menu.style.maxHeight = `${Math.min(Math.max(160, up ? above : below), 420)}px`;
  menu.style.left = `${Math.max(12, Math.min(r.left, vw - mw - 12))}px`;
  if (up) menu.style.bottom = `${vh - r.top + 6}px`; else menu.style.top = `${r.bottom + 6}px`;
  open = { btn, menu }; btn.setAttribute('aria-expanded', 'true');
  addEventListener('resize', away); addEventListener('scroll', scrolled, true); document.addEventListener('pointerdown', outside, true);
  const first = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.lk-opt');
  if (first) menu.scrollTop = first.offsetTop - (menu.clientHeight - first.offsetHeight) / 2;
  first?.focus({ preventScroll: true });
}

let current = null, wired = false;   // the page that mounted last: its looks and what to do with a choice
export function mountLookPicker(root, { looks, onPick }) {
  current = { looks, onPick };
  if (root._lookPicker) return;
  root._lookPicker = true;
  root.addEventListener('click', e => { const b = e.target.closest?.('.lk-btn'); if (b && root.contains(b)) { e.preventDefault(); e.stopPropagation(); show(b, current.looks); } }, true);
  if (wired) return;
  wired = true;
  document.addEventListener('click', e => {
    const o = e.target.closest?.('.lk-menu .lk-opt');
    if (!o || !open) return;
    const { btn } = open, value = o.dataset.v;
    close();
    if (value !== btn.dataset.value) current.onPick(btn.dataset.lk, btn.dataset.id, value);
  });
  document.addEventListener('keydown', e => {
    if (!open) return;
    const items = [...open.menu.querySelectorAll('.lk-opt')], i = items.indexOf(document.activeElement), go = n => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
  });
}
