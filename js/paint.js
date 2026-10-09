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
