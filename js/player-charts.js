// Charts for the player page (player.html). String builders only (HTML and inline SVG), so tests/player-charts.test.mjs can run them without a browser;
// the page (js/player.js) draws them, keeps the picks and shows one shared tooltip for anything with data-tip.
//
//   profileChart(groups, compare)             percentile bars: where he stands among his position on every stat (the "pizza" idea, as bars)
//   cumulativeChart(log)                      goals and xG added up match by match: is he finishing above or below his chances
//   matchBarsChart(ms, log, pick, ctx)        one stat match by match against his position's average per appearance; pills choose the stat
//   scatterChart(peers, meId, pick, ctx)      every player of his position on two stats, him marked, the league's middle shown; pills choose the pair
//   tableOf(head, rows)                       the same numbers as a table (a chart is never the only way to read them)
// Look (dataviz skill): one hue for him (vLeague blue), grey for everyone else (emphasis, not a rainbow), one axis per chart, thin marks, a dashed line for the
// average, direct labels only where they help, and a data-tip on every mark. Class colours are the player page's (css/player.css).
import { CLASSES, AXES } from './player-stats.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const f = (v, dp = 1) => (Number.isFinite(v) ? v.toFixed(dp) : '–');
const ord = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const clsOfPlace = p => CLASSES.find(([, , from]) => p >= from)[0];

// A tidy top and ticks for an axis from 0: 1, 2, 5 times a power of ten.
export function niceTicks(max, want = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / want, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  const top = Math.round(Math.ceil(max / step - 1e-9) * step * 1e6) / 1e6, ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { top, ticks };
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

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
  return `<div class="pc-profile" role="group" aria-label="Percentile profile">${note}<div class="pc-phead"><span></span><span>0 · 50 · 100 percentile</span><span>Per 90</span><span>Pct</span></div>${rows}</div>`
    + tableOf(['Stat', 'Per 90 / value', 'League avg', 'Percentile'], shown.flatMap(g => g.rows.map(r => [r.label, r.per90 ?? r.total, r.avg, r.place])));
}

// ---- 2. goals against xG, cumulative ----
export function cumulativeChart(log) {
  const m = log.filter(l => l.s.min > 0);
  if (m.length < 2 || !m.some(l => l.s.xg > 0)) return '';
  let g = 0, x = 0;
  const pts = m.map((l, i) => { g += l.s.g || 0; x += l.s.xg || 0; return { i, g, x, l }; });
  const W = 360, H = 190, L = 34, R = 56, T = 12, B = 28, { top, ticks } = niceTicks(Math.max(g, x, 1), 4);
  const X = i => L + (i * (W - L - R)) / (pts.length - 1), Y = v => H - B - (v / top) * (H - T - B);
  const line = key => pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' ');
  const last = pts.at(-1), diff = last.g - last.x;
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals and expected goals, cumulative by match. ${last.g} goals from ${f(last.x, 1)} xG.">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="pc-grid"/><text x="${L - 6}" y="${(Y(t) + 4).toFixed(1)}" class="pc-ax" text-anchor="end">${t}</text>`).join('')}
    ${pts.map((p, i) => `<text x="${X(i).toFixed(1)}" y="${H - 8}" class="pc-ax" text-anchor="middle">${i + 1}</text>`).join('')}
    <path d="${line('x')}" class="pc-line is-ref"/><path d="${line('g')}" class="pc-line is-me"/>
    ${pts.map(p => `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.g).toFixed(1)}" r="4" class="pc-dot is-me" data-tip="${esc(`After match ${p.i + 1}: ${p.g} goal${p.g === 1 ? '' : 's'}, ${f(p.x, 2)} xG`)}" tabindex="0"/>`).join('')}
    <text x="${W - R + 6}" y="${(Y(last.g) + (last.g >= last.x ? -2 : 10)).toFixed(1)}" class="pc-lab is-me">Goals ${last.g}</text>
    <text x="${W - R + 6}" y="${(Y(last.x) + (last.g >= last.x ? 10 : -2)).toFixed(1)}" class="pc-lab is-ref">xG ${f(last.x, 1)}</text>
  </svg>
  <p class="pp-note">${Math.abs(diff) < 0.5 ? 'Scoring about as often as his chances say he should.' : diff > 0 ? `Finishing ${f(diff, 1)} goals above his xG, so some of it is luck or elite finishing.` : `Finishing ${f(-diff, 1)} goals below his xG: unlucky, or wasteful.`} Match number along the bottom.</p>`
    + tableOf(['Match', 'Goals', 'xG', 'Total goals', 'Total xG'], pts.map(p => [`${p.i + 1} v ${p.l.opp}`, p.l.s.g || 0, f(p.l.s.xg, 2), p.g, f(p.x, 2)]));
}

// ---- 3. one stat, match by match ----
export function matchBarsChart(ms, log, pick, ctx) {
  const list = ms.filter(m => m.values.some(v => v != null));
  if (!list.length || !log.length) return '';
  const m = list.find(x => x.key === pick) || list[0];
  const pills = `<div class="pc-pills" role="group" aria-label="Stat">${list.map(x => `<button type="button" class="pc-pill" data-pcbar="${esc(x.key)}" aria-pressed="${x.key === m.key}">${esc(x.label)}</button>`).join('')}</div>`;
  const vals = m.values, W = 360, H = 190, L = 34, R = 50, T = 16, B = 34, n = vals.length;
  const { top, ticks } = niceTicks(Math.max(...vals.filter(v => v != null), m.avg || 0, 1e-9), 4);
  const slot = (W - L - R) / n, bw = Math.min(34, slot * 0.62), Y = v => H - B - (v / top) * (H - T - B);
  const bars = vals.map((v, i) => {
    if (v == null) return '';
    const cx = L + slot * (i + 0.5), y = Y(v), h = Math.max(H - B - y, v === 0 ? 0 : 1);
    const l = log[i];
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" class="pc-bar" data-tip="${esc(`${ctx.name(l.opp)} (${l.home ? 'H' : 'A'}) ${l.gf}–${l.ga}: ${m.label} ${f(v, m.dp)}${m.avg != null ? ` · league avg ${f(m.avg, Math.max(m.dp, 1))}` : ''}`)}" tabindex="0"/>`
      + (n <= 14 ? `<text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" class="pc-val" text-anchor="middle">${f(v, m.dp)}</text>` : '');
  }).join('');
  const xs = vals.map((v, i) => `<text x="${(L + slot * (i + 0.5)).toFixed(1)}" y="${H - 16}" class="pc-ax" text-anchor="middle">${esc(ctx.name(log[i].opp).slice(0, 4))}</text><text x="${(L + slot * (i + 0.5)).toFixed(1)}" y="${H - 5}" class="pc-ax is-soft" text-anchor="middle">${log[i].home ? 'H' : 'A'} ${esc(log[i].res)}</text>`).join('');
  const avgY = m.avg != null ? Y(m.avg) : null;
  return `${pills}<svg class="pc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)} in each match${m.avg != null ? `, league average ${f(m.avg, Math.max(m.dp, 1))}` : ''}">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="pc-grid"/><text x="${L - 6}" y="${(Y(t) + 4).toFixed(1)}" class="pc-ax" text-anchor="end">${t}</text>`).join('')}
    ${bars}${xs}
    ${avgY != null ? `<line x1="${L}" x2="${W - R}" y1="${avgY.toFixed(1)}" y2="${avgY.toFixed(1)}" class="pc-avg"/><text x="${W - R + 5}" y="${(avgY + 4).toFixed(1)}" class="pc-lab is-ref">Avg ${f(m.avg, Math.max(m.dp, 1))}</text>` : ''}
  </svg>`
    + tableOf(['Match', 'Result', m.label], log.map((l, i) => [`${ctx.name(l.opp)} (${l.home ? 'H' : 'A'})`, `${l.res} ${l.gf}–${l.ga}`, f(vals[i], m.dp)]));
}

// ---- 4. the league on two stats ----
export const PRESETS = {
  GK: [['sv', 'gc'], ['pas', 'pcp'], ['clr', 'sv']],
  DEF: [['tk', 'int'], ['clr', 'blk'], ['aw', 'clr'], ['pas', 'pcp'], ['tch', 'pas']],
  MID: [['xg', 'g'], ['kp', 'a'], ['pas', 'pcp'], ['dr', 'fd'], ['tk', 'int']],
  FWD: [['xg', 'g'], ['sh', 'sot'], ['kp', 'a'], ['dr', 'fd'], ['pas', 'pcp']],
};
export function scatterChart(peers, meId, pick, ctx) {
  const pairs = PRESETS[ctx.pos] || PRESETS.MID;
  const [xk, yk] = (pairs.find(p => p.join('|') === pick) || pairs[0]);
  const ax = k => AXES.find(a => a.key === k), X = ax(xk), Yx = ax(yk);
  const pts = peers.map(p => ({ ...p, x: p.v[xk], y: p.v[yk] })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return '';
  const pills = `<div class="pc-pills" role="group" aria-label="Stats to compare">${pairs.map(p => `<button type="button" class="pc-pill" data-pcsc="${p.join('|')}" aria-pressed="${p.join('|') === `${xk}|${yk}`}">${esc(ax(p[1]).label.replace(' per 90', ''))} v ${esc(ax(p[0]).label.replace(' per 90', ''))}</button>`).join('')}</div>`;
  const W = 360, H = 280, L = 40, R = 12, T = 12, B = 40;
  const tx = niceTicks(Math.max(...pts.map(p => p.x)), 4), ty = niceTicks(Math.max(...pts.map(p => p.y)), 4);
  const sx = v => L + (v / tx.top) * (W - L - R), sy = v => H - B - (v / ty.top) * (H - T - B);
  const mx = median(pts.map(p => p.x)), my = median(pts.map(p => p.y));
  const me = pts.find(p => String(p.id) === String(meId));
  const dot = (p, mine) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${mine ? 7 : 4.5}" class="pc-sdot${mine ? ' is-me' : ''}" data-pid="${esc(p.id)}" role="link" tabindex="0" data-tip="${esc(`${p.name} (${ctx.name(p.team)}): ${Yx.label} ${f(p.y, 2)} · ${X.label} ${f(p.x, 2)}`)}"/>`;
  return `${pills}<svg class="pc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(Yx.label)} against ${esc(X.label)} for ${pts.length} ${esc(ctx.word)}">
    ${tx.ticks.map(t => `<line x1="${sx(t).toFixed(1)}" x2="${sx(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="pc-grid"/><text x="${sx(t).toFixed(1)}" y="${H - B + 14}" class="pc-ax" text-anchor="middle">${t}</text>`).join('')}
    ${ty.ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}" class="pc-grid"/><text x="${L - 6}" y="${(sy(t) + 4).toFixed(1)}" class="pc-ax" text-anchor="end">${t}</text>`).join('')}
    <line x1="${sx(mx).toFixed(1)}" x2="${sx(mx).toFixed(1)}" y1="${T}" y2="${H - B}" class="pc-avg"/><line x1="${L}" x2="${W - R}" y1="${sy(my).toFixed(1)}" y2="${sy(my).toFixed(1)}" class="pc-avg"/>
    ${pts.filter(p => p !== me).map(p => dot(p, false)).join('')}${me ? dot(me, true) : ''}
    ${me ? `<text x="${Math.min(sx(me.x) + 10, W - R - 4).toFixed(1)}" y="${(sy(me.y) - 10).toFixed(1)}" class="pc-lab is-me" text-anchor="${sx(me.x) > W - 90 ? 'end' : 'start'}">${esc(me.name.split(' ').pop())}</text>` : ''}
    <text x="${(L + (W - L - R) / 2).toFixed(1)}" y="${H - 6}" class="pc-axt" text-anchor="middle">${esc(X.label)}</text>
    <text transform="translate(11 ${(T + (H - T - B) / 2).toFixed(1)}) rotate(-90)" class="pc-axt" text-anchor="middle">${esc(Yx.label)}</text>
  </svg>
  <p class="pp-note">${pts.length} ${esc(ctx.word)} with 90+ minutes. Dashed lines are the league middle (median). Up and to the right is more of both.${me ? '' : ' He is not on the chart yet (not enough minutes).'} Click a dot to open that player.</p>`
    + tableOf(['Player', X.label, Yx.label], [...pts].sort((a, b) => b.y - a.y).map(p => [p.name, f(p.x, 2), f(p.y, 2)]));
}
