// Sortable tables with sort levels, shared by the Draft's Available players (js/draft.js) and the Office's Squad and Market (js/office.js).
// A click on a column heading sorts by it (again flips it); shift-click adds it as the next level. The "Sorted by" chips under the filters show every
// level (tap to flip, x to drop, "Then by…" to add one, Reset to go back to the default). Pure functions returning html: no page, so the tests run them.
//   cols:   [{ key, label, long, first: 1 | -1, val: row => number | string }]   first: the direction a first click sorts (1 low to high)
//   levels: [{ key, dir }]   the sort, most important first
//   sortRows(list, levels, cols)                     -> a sorted copy (name breaks ties)
//   clickSort(levels, key, add, cols)                -> the new levels after a heading click (add: shift held)
//   isDefault(levels, defaults)                      -> true when the sort is the table's own
//   sortHead({ t, levels, cols, extra })             -> <thead> with a button per column (data-t, data-sort)
//   sortBar({ t, levels, cols, defaults, label })    -> the "Sorted by" chips (data-sflip, data-sdel, data-sadd, data-sreset)
import { icon } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const colOf = (cols, key) => cols.find(c => c.key === key);
const arrow = d => (d > 0 ? icon('chevron-up') : icon('chevron-down'));

export function sortRows(list, levels, cols) {
  const ls = levels.filter(l => colOf(cols, l.key));
  return [...list].sort((a, b) => {
    for (const { key, dir } of ls) { const c = colOf(cols, key), x = c.val(a), y = c.val(b); if (x !== y) return (x < y ? -1 : 1) * dir; }
    return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0;
  });
}

export function clickSort(levels, key, add, cols) {
  const s = levels.map(l => ({ ...l })), i = s.findIndex(x => x.key === key), first = colOf(cols, key)?.first ?? -1;
  if (add) { if (i >= 0) s[i].dir *= -1; else s.push({ key, dir: first }); return s; }
  if (i === 0 && s.length === 1) { s[0].dir *= -1; return s; }
  return [{ key, dir: i === 0 ? s[0].dir * -1 : first }];
}

export const isDefault = (levels, defaults) => levels.length === defaults.length && levels.every((l, i) => l.key === defaults[i].key && l.dir === defaults[i].dir);

export function sortHead({ t, levels, cols, extra = '' }) {
  return `<thead><tr>${cols.map(c => {
    const i = levels.findIndex(x => x.key === c.key);
    return `<th class="c-${c.key}" aria-sort="${i < 0 ? 'none' : levels[i].dir > 0 ? 'ascending' : 'descending'}"><button type="button" data-t="${t}" data-sort="${c.key}" title="${esc(c.long)}">${esc(c.label)}${i < 0 ? '' : ` <span class="dr-ar">${arrow(levels[i].dir)}${levels.length > 1 ? `<sup>${i + 1}</sup>` : ''}</span>`}</button></th>`;
  }).join('')}${extra}</tr></thead>`;
}

export function sortBar({ t, levels, cols, defaults, label = 'Sorted by' }) {
  const unused = cols.filter(c => !levels.some(x => x.key === c.key));
  return `<div class="dr-sortbar"><span class="dr-sortl">${esc(label)}</span>${levels.map((x, i) => `<span class="dr-chip"><button type="button" data-t="${t}" data-sflip="${i}" title="Flip direction">${esc(colOf(cols, x.key)?.long)} ${arrow(x.dir)}</button>${levels.length > 1 ? `<button type="button" data-t="${t}" data-sdel="${i}" aria-label="Stop sorting by ${esc(colOf(cols, x.key)?.long)}">${icon('x')}</button>` : ''}</span>`).join('')}
    ${unused.length ? `<label class="dr-then"><select data-sadd="${t}" aria-label="Then sort by"><option value="">Then by…</option>${unused.map(c => `<option value="${c.key}">${esc(c.long)}</option>`).join('')}</select>${icon('chevron-down')}</label>` : ''}
    ${isDefault(levels, defaults) ? '' : `<button type="button" class="dr-link" data-t="${t}" data-sreset>Reset</button>`}</div>`;
}
