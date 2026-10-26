// Maps for the player page (player.html): where a player shot, passed, spent the match and defended, worked out from the saved match files
// (the engine's full record: events with pitch positions, and every player's position five times a second; js/sim/docs/OUTPUT_FORMAT.md).
//
//   extractMaps(file, playerId) -> { grid, frames, minutes } for one match, every point turned so the player's club always attacks left to right
//   mergeMaps(list)             -> the same, added up over several matches
//   heatMap(m)                  -> html (inline SVG, the one pitch drawing), with the numbers under it
//   pitchSvg({ half, body })    the pitch itself: 105 x 68 m, or the attacking half
// Pure functions, so tests/player-maps.test.mjs can run them on a tiny made-up match. Kept to two simple maps (the user, 26 Oct 2026). Looks: him in vLeague
// blue on a quiet pitch, one hue for density, a data-tip on every mark.
const PW = 105, PH = 68, GW = 21, GH = 14;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const r1 = v => Math.round(v * 10) / 10;

// ---- reading a match file ----
export function extractMaps(d, id) {
  const me = (d.players || []).find(p => String(p.id) === String(id));
  const out = { grid: new Array(GW * GH).fill(0), frames: 0, minutes: 0 };
  if (!me) return out;
  const periods = d.periods || [];
  // Which way his club attacks in a period: home_attacks says it for the home club; the away club goes the other way.
  const right = period => { const p = periods.find(x => x.period === period); const homeRight = p ? p.home_attacks === 'right' : true; return me.team === (d.match?.home ?? d.home) ? homeRight : !homeRight; };
  const turn = (x, y, period) => (right(period) ? [x, y] : [PW - x, PH - y]);
  // Time on the pitch: his position in every frame, as a grid of 5 m squares.
  const fr = d.frames;
  if (fr?.fields && fr.data) {
    const ix = fr.fields.indexOf(`p${me.idx}_x`), iy = fr.fields.indexOf(`p${me.idx}_y`), scale = fr.scale || 10;
    if (ix > -1 && iy > -1) {
      for (const row of fr.data) {
        const t = row[0] / scale, per = periods.find(p => t >= p.start_t && t <= p.end_t);
        if (!per) continue;
        const [x, y] = turn(row[ix] / scale, row[iy] / scale, per.period);
        const cx = Math.min(GW - 1, Math.max(0, Math.floor((x / PW) * GW))), cy = Math.min(GH - 1, Math.max(0, Math.floor((y / PH) * GH)));
        out.grid[cy * GW + cx]++; out.frames++;
      }
      out.minutes = Math.round(out.frames / (fr.fps || 5) / 60);
    }
  }
  return out;
}
export function mergeMaps(list) {
  const m = { grid: new Array(GW * GH).fill(0), frames: 0, minutes: 0, matches: list.length };
  for (const x of list) {
    x.grid.forEach((v, i) => { m.grid[i] += v; });
    m.frames += x.frames; m.minutes += x.minutes;
  }
  return m;
}

// ---- the pitch ----
// 105 x 68 m with every marking: halfway line and circle, both boxes, six-yard boxes, penalty spots and arcs, corner arcs, goals. `half` crops to the attacking half
// (x 52.5 to 105). `direction` draws a quiet arrow along the touchline with the words, so the way the team is attacking is on the pitch itself, not only in the caption.
export function pitchSvg({ half = false, body = '', under = '', label = '', direction = true }) {
  const x0 = half ? PW / 2 : 0, W = PW - x0, m = 3, cy = PH / 2;
  const box = (x, dir) => `<rect x="${dir > 0 ? x : x - 16.5}" y="${cy - 20.16}" width="16.5" height="40.32" class="pm-line"/><rect x="${dir > 0 ? x : x - 5.5}" y="${cy - 9.16}" width="5.5" height="18.32" class="pm-line"/>`
    + `<circle cx="${x + dir * 11}" cy="${cy}" r=".45" class="pm-spot"/><path d="M${x + dir * 16.5} ${cy - 7.31}A9.15 9.15 0 0 ${dir > 0 ? 1 : 0} ${x + dir * 16.5} ${cy + 7.31}" class="pm-line"/>`
    + `<rect x="${dir > 0 ? x - 2 : x}" y="${cy - 3.66}" width="2" height="7.32" class="pm-goal"/>`;
  const corner = (x, y, sweep) => `<path d="M${x === 0 ? 1 : x - 1} ${y}A1 1 0 0 ${sweep} ${x} ${y === 0 ? 1 : y - 1}" class="pm-line"/>`;
  const left = half ? '' : `<circle cx="${PW / 2}" cy="${cy}" r="9.15" class="pm-line"/><circle cx="${PW / 2}" cy="${cy}" r=".45" class="pm-spot"/>${box(0, 1)}${corner(0, 0, 1)}${corner(0, PH, 0)}`;
  const ax = half ? x0 + 6 : 36, aw = half ? 22 : 30, ay = PH - 5;
  const arrow = direction ? `<g class="pm-dir" aria-hidden="true"><path d="M${ax} ${ay}H${ax + aw}M${ax + aw - 2.2} ${ay - 1.6}L${ax + aw} ${ay}L${ax + aw - 2.2} ${ay + 1.6}" class="pm-dirline"/><text x="${ax}" y="${ay - 2.4}" class="pm-dirtext">Attacking</text></g>` : '';
  return `<svg class="pm-svg${half ? ' is-half' : ''}" viewBox="${x0 - m} ${-m} ${W + 2 * m} ${PH + 2 * m}" role="img" aria-label="${esc(label)}">
    <rect x="${x0}" y="0" width="${W}" height="${PH}" class="pm-turf"/>
    ${under}
    <rect x="${x0}" y="0" width="${W}" height="${PH}" class="pm-line"/>
    ${half ? '' : `<line x1="${PW / 2}" x2="${PW / 2}" y1="0" y2="${PH}" class="pm-line"/>`}${half ? `<path d="M${x0} ${cy - 9.15}A9.15 9.15 0 0 1 ${x0} ${cy + 9.15}" class="pm-line"/>` : ''}
    ${left}${box(PW, -1)}${corner(PW, 0, 0)}${corner(PW, PH, 1)}
    ${arrow}${body}
  </svg>`;
}
const count = (a, f) => a.filter(f).length;
const pctOf = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

// ---- where he spent the match ----
// The colour scale (as FotMob's): cool blue where he barely was, through green and yellow to orange and red where he spent most of the match. Each stop is
// [position 0-1, r, g, b, alpha]; the cells are blurred together into soft blobs, the pitch lines drawn over them.
const RAMP = [[0, 43, 140, 255, 0], [0.14, 43, 140, 255, 0.4], [0.38, 38, 190, 120, 0.7], [0.62, 245, 215, 55, 0.85], [0.82, 255, 145, 0, 0.92], [1, 235, 55, 55, 0.96]];
export function heatColour(t) {
  const x = Math.max(0, Math.min(1, t)), i = Math.max(1, RAMP.findIndex(r => r[0] >= x)), a = RAMP[i - 1], b = RAMP[i], k = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
  const mix = n => a[n] + (b[n] - a[n]) * k;
  return `rgba(${Math.round(mix(1))},${Math.round(mix(2))},${Math.round(mix(3))},${mix(4).toFixed(2)})`;
}
const SCALE = `linear-gradient(90deg, ${RAMP.map(r => `rgb(${r[1]},${r[2]},${r[3]}) ${Math.round(r[0] * 100)}%`).join(', ')})`;

export function heatMap(m) {
  const max = Math.max(...m.grid), tot = m.grid.reduce((a, b) => a + b, 0);
  if (!(max > 0)) return '<p class="pp-note">No position data in these matches.</p>';
  const cw = PW / GW, ch = PH / GH;
  const cells = m.grid.map((v, i) => (v ? `<rect x="${((i % GW) * cw).toFixed(2)}" y="${(Math.floor(i / GW) * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" fill="${heatColour(Math.sqrt(v / max))}"/>` : '')).join('');
  const tips = m.grid.map((v, i) => (v ? `<rect x="${((i % GW) * cw).toFixed(2)}" y="${(Math.floor(i / GW) * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" class="pm-hit" data-tip="${esc(`${(100 * v / tot).toFixed(1)}% of his time here`)}"/>` : '')).join('');
  const blobs = `<defs><filter id="pm-blur" filterUnits="userSpaceOnUse" x="-6" y="-6" width="117" height="80"><feGaussianBlur stdDeviation="2.8"/></filter><clipPath id="pm-clip"><rect width="${PW}" height="${PH}"/></clipPath></defs><g clip-path="url(#pm-clip)"><g filter="url(#pm-blur)">${cells}</g></g>`;
  let ax = 0, ay = 0;
  m.grid.forEach((v, i) => { ax += v * ((i % GW) + 0.5) * cw; ay += v * (Math.floor(i / GW) + 0.5) * ch; });
  ax /= tot; ay /= tot;
  const third = [0, 1, 2].map(k => m.grid.reduce((a, v, i) => a + ((i % GW) * cw + cw / 2 >= (k * PW) / 3 && (i % GW) * cw + cw / 2 < ((k + 1) * PW) / 3 ? v : 0), 0) / tot);
  const mark = `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.2" class="pm-avgpos" data-tip="Average position"/>`;
  return `${pitchSvg({ under: blobs, body: tips + mark, label: 'Where he spent his time on the pitch' })}
    <div class="pm-key pm-scale"><span>Less time</span><i class="pm-heat" style="background:${SCALE}"></i><span>More time</span><span><i class="pm-avgpos"></i>Average position</span></div>
    <p class="pp-note">Average position ${Math.round(ax)} m from his own goal, ${Math.round(ay)} m across. Time by third: ${Math.round(third[0] * 100)}% in his own, ${Math.round(third[1] * 100)}% in the middle, ${Math.round(third[2] * 100)}% in the attacking third. From his position five times a second over ${m.minutes} minutes.</p>`;
}
