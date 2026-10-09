// Redraw only when something changed. Pages that refresh on a timer used to rebuild their whole contents every time, which
// threw away whatever you were doing there (focus, a typed-but-unsaved field, an open panel, a text selection, hover).
//   paint(el, html) -> true if the page was redrawn, false if it was already showing exactly this (nothing touched).
// Write to the element only through paint() once a page uses it, so the remembered copy stays true.
const shown = new WeakMap();
let hands = false;   // true while a timed update runs (see quietly)

// Is someone using this part of the page right now: focus in a field, something typed and not saved, or text selected?
function inUse(el) {
  const a = document.activeElement;
  if (a && el.contains(a) && a.matches?.('input, textarea, select')) return true;
  if (hasUnsavedInput(el)) return true;
  const sel = window.getSelection?.();
  return Boolean(sel && !sel.isCollapsed && el.contains(sel.anchorNode));
}

// Run a timed refresh (a poll, a countdown) under this rule: it never redraws a part of the page someone is using. The next tick
// tries again, so the page catches up as soon as they let go. Updates that come from a person's own click or typing do NOT use this.
export function quietly(fn) {
  hands = true;
  try { return fn(); } finally { hands = false; }
}

export function paint(el, html) {
  if (shown.get(el) === html) return false;
  if (hands && inUse(el)) return false;
  shown.set(el, html);
  el.innerHTML = html;
  return true;
}

// True if anything inside `root` has been changed by the person and not saved: a typed field, a ticked box, a different option.
// A timed refresh must leave the page alone while this is true.
export function hasUnsavedInput(root) {
  for (const el of root.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') continue;
    if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.selected !== o.defaultSelected)) return true; }
    else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
    else if (el.value !== el.defaultValue) return true;
  }
  return false;
}

// ---- Keeping what someone has typed across a redraw that has to happen (after a save, a reaction, a pick by someone else).
//   const snap = snapshotInputs(root);  ...rebuild root.innerHTML...  restoreInputs(root, snap);
// Only fields the person has changed are kept, and each goes back to the same field (found by what it is and the labelled
// section it sits in), so a list that reorders never puts text in the wrong row. Focus and the caret are put back too.
function sectionOf(el, root) {
  const parts = [];
  for (let p = el.parentElement; p && p !== root && parts.length < 2; p = p.parentElement) {
    const d = [...p.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`);
    if (d.length) parts.push(`${p.tagName}[${d.join(',')}]`);
  }
  return parts.join('<');
}
function fieldKeys(root) {
  const seen = new Map(), out = new Map();
  for (const el of root.querySelectorAll('input, textarea, select')) {
    if (['hidden', 'button', 'submit', 'file', 'password'].includes(el.type)) continue;
    const base = [sectionOf(el, root), el.tagName, el.type, el.name || el.id || el.getAttribute('aria-label') || el.placeholder || '',
      el.type === 'checkbox' || el.type === 'radio' ? el.value : ''].join('|');
    const n = seen.get(base) || 0; seen.set(base, n + 1);
    out.set(`${base}#${n}`, el);
  }
  return out;
}
// The part of the page the person just acted on (a form they submitted, the row whose button they pressed) is rebuilt from the
// saved data as normal, so a saved form clears instead of refilling. Everywhere else keeps what was typed.
let acted = null, actedAt = 0;
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('submit', e => { acted = e.target; actedAt = Date.now(); }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button, a, [role=button], summary');
    if (b) { acted = b.closest('form') || b.closest('li, tr, details, section, article') || b.parentElement; actedAt = Date.now(); }
  }, true);
}
export function snapshotInputs(root) {
  const snap = { fields: [], focus: null };
  const scope = Date.now() - actedAt < 8000 ? acted : null;
  for (const [key, el] of fieldKeys(root)) {
    if (scope && scope.contains(el)) continue;
    let value;
    if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.selected !== o.defaultSelected)) value = el.value; else continue; }
    else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) value = el.checked; else continue; }
    else if (el.value !== el.defaultValue) value = el.value;
    else continue;
    snap.fields.push({ key, value });
  }
  const a = document.activeElement;
  if (a && root.contains(a)) for (const [key, el] of fieldKeys(root)) if (el === a) snap.focus = { key, start: a.selectionStart, end: a.selectionEnd };
  return snap;
}
export function restoreInputs(root, snap) {
  if (!snap || (!snap.fields.length && !snap.focus)) return;
  const keys = fieldKeys(root);
  for (const { key, value } of snap.fields) {
    const el = keys.get(key); if (!el) continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value;
  }
  const f = snap.focus && keys.get(snap.focus.key);
  if (f) { f.focus({ preventScroll: true }); try { if (snap.focus.start != null) f.setSelectionRange(snap.focus.start, snap.focus.end); } catch { /* not a text field */ } }
}
