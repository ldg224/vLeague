// Charts for the player page (player.html). String builders only (HTML and inline SVG), so tests/player-charts.test.mjs can run them without a browser;
// the page (js/player.js) draws them, keeps the picks and shows one shared tooltip for anything with data-tip.
//
//   profileChart(groups, compare)   percentile bars: where he stands among his position on every stat, coloured by class (the player page's one chart)
//   tableOf(head, rows)             the same numbers as a table (a chart is never the only way to read them)
// Kept deliberately small (the user, 26 Oct 2026: "just some simple ones, easily understandable"). The maps are in js/player-maps.js.
import { CLASSES } from './player-stats.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const ord = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const clsOfPlace = p => CLASSES.find(([, , from]) => p >= from)[0];


export function tableOf(head, rows) {
  return `<details class="pc-table"><summary>Show as a table</summary><div class="pc-scroll"><table><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map(r => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

// ---- 1. percentile profile ----
export function profileChart(groups, compare) {
  const shown = groups.map(g => ({ title: g.title, rows: g.rows.filter(r => r.place != null) })).filter(g => g.rows.length);
  if (!shown.length) return '<p class="pp-note">The profile appears once enough players of his position have played.</p>';
  const rows = shown.map(g => `<h4 class="pc-strip">${esc(g.title)}</h4>${g.rows.map(r => {
    const c = clsOfPlace(r.place);
    const tip = `${r.label}: ${r.per90 ?? r.total} · ${ord(r.place)} percentile of ${compare.n} ${compare.word}${r.low ? ' (fewer is better)' : ''} · league avg ${r.avg}`;
    return `<div class="pc-prow is-${c}" data-tip="${esc(tip)}" tabindex="0"><span class="pc-pl">${esc(r.label)}</span>`
      + `<span class="pc-track" aria-hidden="true"><i style="width:${Math.max(r.place, 2)}%"></i><u></u></span><b class="pc-pv">${esc(r.per90 ?? r.total)}</b><span class="pc-pp">${r.place}</span></div>`;
  }).join('')}`).join('');
  const note = compare.eligible ? '' : `<p class="pp-note pc-prov">Provisional: ${compare.apps} match${compare.apps === 1 ? '' : 'es'} so far. The percentiles settle as the season goes on.</p>`;
  const key = `<div class="pc-leg" aria-label="Colour key">${CLASSES.map(([k, label]) => `<span class="is-${k}"><i></i>${label}</span>`).join('')}</div>`;
  return `<div class="pc-profile" role="group" aria-label="Percentile profile">${note}${key}<div class="pc-phead"><span></span><span>0 · 50 · 100 percentile</span><span>Per 90</span><span>Pct</span></div>${rows}</div>`
    + tableOf(['Stat', 'Per 90 / value', 'League avg', 'Percentile'], shown.flatMap(g => g.rows.map(r => [r.label, r.per90 ?? r.total, r.avg, r.place])));
}

