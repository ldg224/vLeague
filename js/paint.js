// Redraw only when something changed. Pages that refresh on a timer used to rebuild their whole contents every time, which
// threw away whatever you were doing there (focus, a typed-but-unsaved field, an open panel, a text selection, hover).
//   paint(el, html) -> true if the page was redrawn, false if it was already showing exactly this (nothing touched).
// Write to the element only through paint() once a page uses it, so the remembered copy stays true.
const shown = new WeakMap();
export function paint(el, html) {
  if (shown.get(el) === html) return false;
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
