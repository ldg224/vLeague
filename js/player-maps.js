// Maps for the player page (player.html): where a player shot, passed, spent the match and defended, worked out from the saved match files
// (the engine's full record: events with pitch positions, and every player's position five times a second; js/sim/docs/OUTPUT_FORMAT.md).
//
//   extractMaps(file, playerId) -> { shots, passes, touches, def, grid, frames, minutes } for one match, every point turned so the player's club always attacks left to right
//   mergeMaps(list)             -> the same, added up over several matches
//   shotMap(m) / passMap(m) / heatMap(m) / defMap(m) -> html (inline SVG, the one pitch drawing), with the numbers under it
//   pitchSvg({ half, body })    the pitch itself: 105 x 68 m, or the attacking half
// Pure functions, so tests/player-maps.test.mjs can run them on a tiny made-up match. Looks (dataviz skill): him in vLeague blue on a quiet pitch, one hue for
// density, shapes (not just colour) for the kinds of defensive action, a data-tip on every mark.
const PW = 105, PH = 68, GW = 21, GH = 14;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const r1 = v => Math.round(v * 10) / 10;

// ---- reading a match file ----
export function extractMaps(d, id) {
  const me = (d.players || []).find(p => String(p.id) === String(id));
  const out = { shots: [], passes: [], touches: [], def: [], grid: new Array(GW * GH).fill(0), frames: 0, minutes: 0 };
  if (!me) return out;
  const periods = d.periods || [];
  // Which way his club attacks in a period: home_attacks says it for the home club; the away club goes the other way.
  const right = period => { const p = periods.find(x => x.period === period); const homeRight = p ? p.home_attacks === 'right' : true; return me.team === (d.match?.home ?? d.home) ? homeRight : !homeRight; };
  const turn = (x, y, period) => (right(period) ? [x, y] : [PW - x, PH - y]);
  for (const e of d.events || []) {
    const mine = String(e.player) === String(id);
    if (!mine || e.x == null) continue;
    const [x, y] = turn(e.x, e.y, e.period);
    const at = { x: r1(x), y: r1(y), minute: e.minute };
    if (e.type === 'shot') out.shots.push({ ...at, xg: e.xg || 0, outcome: e.outcome, on: Boolean(e.on_target || e.outcome === 'goal' || e.outcome === 'saved'), body: e.body, kind: e.subtype });
    else if (e.type === 'pass' && e.end_x != null) { const [ex, ey] = turn(e.end_x, e.end_y, e.period); out.passes.push({ ...at, ex: r1(ex), ey: r1(ey), ok: e.outcome === 'complete', kind: e.subtype }); out.touches.push(at); }
    else if (e.type === 'tackle') out.def.push({ ...at, kind: 'tackle', won: Boolean(e.won) });
    else if (e.type === 'aerial_duel') out.def.push({ ...at, kind: 'aerial', won: Boolean(e.won) });
    else if (e.type === 'clearance') out.def.push({ ...at, kind: 'clearance', won: true });
    else if (e.type === 'block') out.def.push({ ...at, kind: 'block', won: true });
    else if (e.type === 'control') { out.touches.push(at); if (e.how === 'interception') out.def.push({ ...at, kind: 'interception', won: true }); }
    else if (e.type === 'take_on' || e.type === 'shot') out.touches.push(at);
  }
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
  const m = { shots: [], passes: [], touches: [], def: [], grid: new Array(GW * GH).fill(0), frames: 0, minutes: 0, matches: list.length };
  for (const x of list) {
    for (const k of ['shots', 'passes', 'touches', 'def']) m[k].push(...x[k]);
    x.grid.forEach((v, i) => { m.grid[i] += v; });
    m.frames += x.frames; m.minutes += x.minutes;
  }
  return m;
}

// ---- the pitch ----
export function pitchSvg({ half = false, body = '', label = '' }) {
  const x0 = half ? PW / 2 : 0, W = PW - x0, m = 2;
  const goal = (x, dir) => `<rect x="${dir > 0 ? x : x - 2}" y="${PH / 2 - 3.66}" width="2" height="7.32" class="pm-goal"/>`;
  const box = (x, dir) => `<rect x="${dir > 0 ? x : x - 16.5}" y="${PH / 2 - 20.16}" width="16.5" height="40.32" class="pm-line"/><rect x="${dir > 0 ? x : x - 5.5}" y="${PH / 2 - 9.16}" width="5.5" height="18.32" class="pm-line"/><circle cx="${x + dir * 11}" cy="${PH / 2}" r=".5" class="pm-spot"/>`;
  return `<svg class="pm-svg${half ? ' is-half' : ''}" viewBox="${x0 - m} ${-m} ${W + 2 * m} ${PH + 2 * m}" role="img" aria-label="${esc(label)}">
    <rect x="${x0}" y="0" width="${W}" height="${PH}" class="pm-turf"/>
    <rect x="${x0}" y="0" width="${W}" height="${PH}" class="pm-line"/>
    ${half ? '' : `<line x1="${PW / 2}" x2="${PW / 2}" y1="0" y2="${PH}" class="pm-line"/><circle cx="${PW / 2}" cy="${PH / 2}" r="9.15" class="pm-line"/>${box(0, 1)}${goal(0, -1)}`}
    ${half ? `<path d="M${x0} 0V${PH}" class="pm-line"/>` : ''}${box(PW, -1)}${goal(PW, 1)}
    ${body}
  </svg>`;
}
const arrow = '<span class="pm-arrow" aria-hidden="true">Attacking this way →</span>';
const count = (a, f) => a.filter(f).length;
const pctOf = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

// ---- 1. shots ----
export function shotMap(m) {
  if (!m.shots.length) return '<p class="pp-note">No shots in these matches.</p>';
  const dots = m.shots.map(s => {
    const r = 1.2 + Math.sqrt(s.xg) * 4.2, tip = `${s.minute}′ ${s.outcome === 'goal' ? 'Goal' : s.outcome === 'saved' ? 'Saved' : s.outcome === 'blocked' ? 'Blocked' : s.outcome === 'woodwork' ? 'Hit the woodwork' : 'Off target'} · xG ${s.xg.toFixed(2)}${s.kind && s.kind !== 'open' ? ` · ${s.kind.replace('_', ' ')}` : ''}${s.body === 'head' ? ' · header' : ''}`;
    return `<circle cx="${s.x}" cy="${s.y}" r="${r.toFixed(2)}" class="pm-shot is-${s.outcome === 'goal' ? 'goal' : s.on ? 'on' : 'off'}" data-tip="${esc(tip)}" tabindex="0"/>`;
  }).join('');
  const goals = count(m.shots, s => s.outcome === 'goal'), xg = m.shots.reduce((a, s) => a + s.xg, 0), on = count(m.shots, s => s.on);
  return `${pitchSvg({ half: true, body: dots, label: `${m.shots.length} shots, ${goals} goals, ${xg.toFixed(1)} xG` })}
    <div class="pm-key"><span><i class="pm-shot is-goal"></i>Goal</span><span><i class="pm-shot is-on"></i>On target</span><span><i class="pm-shot is-off"></i>Off or blocked</span><span>Bigger dot = bigger chance (xG)</span></div>
    <p class="pp-note">${m.shots.length} shots · ${goals} goals · ${xg.toFixed(2)} xG (${(xg / m.shots.length).toFixed(2)} a shot) · ${pctOf(on, m.shots.length)} on target. ${arrow}</p>`;
}

// ---- 2. passes ----
export function passMap(m) {
  if (!m.passes.length) return '<p class="pp-note">No passes in these matches.</p>';
  const lines = m.passes.map(p => `<line x1="${p.x}" y1="${p.y}" x2="${p.ex}" y2="${p.ey}" class="pm-pass is-${p.ok ? 'ok' : 'miss'}" data-tip="${esc(`${p.minute}′ ${(p.kind || 'pass').replace('_', ' ')} · ${p.ok ? 'completed' : 'not completed'} · ${Math.round(Math.hypot(p.ex - p.x, p.ey - p.y))} m`)}"/>`).join('')
    + m.passes.filter(p => p.ok).map(p => `<circle cx="${p.ex}" cy="${p.ey}" r=".7" class="pm-end"/>`).join('');
  const ok = count(m.passes, p => p.ok), prog = count(m.passes, p => p.ok && p.ex - p.x >= 10), fwd = count(m.passes, p => p.ex - p.x >= 10);
  const final = count(m.passes, p => p.ok && p.ex >= PW * 2 / 3 && p.x < PW * 2 / 3);
  return `${pitchSvg({ body: lines, label: `${m.passes.length} passes, ${ok} completed` })}
    <div class="pm-key"><span><i class="pm-ln is-ok"></i>Completed</span><span><i class="pm-ln is-miss"></i>Not completed</span><span>Dot = where it landed</span></div>
    <p class="pp-note">${m.passes.length} passes · ${pctOf(ok, m.passes.length)} completed · ${prog} progressive (10 m or more toward goal, completed; ${pctOf(prog, fwd)} of forward passes) · ${final} into the final third. ${arrow}</p>`;
}

// ---- 3. where he spent the match ----
export function heatMap(m) {
  const max = Math.max(...m.grid), tot = m.grid.reduce((a, b) => a + b, 0);
  if (!(max > 0)) return '<p class="pp-note">No position data in these matches.</p>';
  const cw = PW / GW, ch = PH / GH;
  const cells = m.grid.map((v, i) => {
    if (!v) return '';
    const x = (i % GW) * cw, y = Math.floor(i / GW) * ch;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" class="pm-cell" style="--a:${(0.12 + 0.78 * Math.sqrt(v / max)).toFixed(2)}" data-tip="${esc(`${(100 * v / tot).toFixed(1)}% of his time here`)}"/>`;
  }).join('');
  let ax = 0, ay = 0;
  m.grid.forEach((v, i) => { ax += v * ((i % GW) + 0.5) * cw; ay += v * (Math.floor(i / GW) + 0.5) * ch; });
  ax /= tot; ay /= tot;
  const third = [0, 1, 2].map(k => m.grid.reduce((a, v, i) => a + ((i % GW) * cw + cw / 2 >= (k * PW) / 3 && (i % GW) * cw + cw / 2 < ((k + 1) * PW) / 3 ? v : 0), 0) / tot);
  const mark = `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2.2" class="pm-avgpos" data-tip="Average position"/>`;
  return `${pitchSvg({ body: cells + mark, label: 'Where he spent his time on the pitch' })}
    <div class="pm-key"><span><i class="pm-heat"></i>Darker = more time</span><span><i class="pm-avgpos"></i>Average position</span></div>
    <p class="pp-note">Average position ${Math.round(ax)} m from his own goal, ${Math.round(ay)} m across. Time by third: ${Math.round(third[0] * 100)}% in his own, ${Math.round(third[1] * 100)}% in the middle, ${Math.round(third[2] * 100)}% in the attacking third. From his position five times a second over ${m.minutes} minutes. ${arrow}</p>`;
}

// ---- 4. defending ----
const SHAPE = {
  tackle: (x, y, c) => `<circle cx="${x}" cy="${y}" r="1.6" class="${c}"/>`,
  interception: (x, y, c) => `<rect x="${x - 1.4}" y="${y - 1.4}" width="2.8" height="2.8" transform="rotate(45 ${x} ${y})" class="${c}"/>`,
  clearance: (x, y, c) => `<path d="M${x} ${y - 1.9}L${x + 1.8} ${y + 1.4}L${x - 1.8} ${y + 1.4}Z" class="${c}"/>`,
  block: (x, y, c) => `<rect x="${x - 1.4}" y="${y - 1.4}" width="2.8" height="2.8" class="${c}"/>`,
  aerial: (x, y, c) => `<path d="M${x - 1.6} ${y}H${x + 1.6}M${x} ${y - 1.6}V${y + 1.6}" class="${c} is-line"/>`,
};
const KIND = { tackle: 'Tackle', interception: 'Interception', clearance: 'Clearance', block: 'Block', aerial: 'Aerial duel' };
export function defMap(m) {
  if (!m.def.length) return '<p class="pp-note">No defensive actions in these matches.</p>';
  const marks = m.def.map(a => `<g data-tip="${esc(`${a.minute}′ ${KIND[a.kind]}${a.kind === 'tackle' || a.kind === 'aerial' ? (a.won ? ' won' : ' lost') : ''}`)}" tabindex="0">${SHAPE[a.kind](a.x, a.y, `pm-def ${a.won ? 'is-won' : 'is-lost'}`)}</g>`).join('');
  const by = k => m.def.filter(a => a.kind === k), won = k => count(by(k), a => a.won);
  const line = k => (by(k).length ? `${by(k).length} ${KIND[k].toLowerCase()}${by(k).length === 1 ? '' : 's'}${k === 'tackle' || k === 'aerial' ? ` (${won(k)} won)` : ''}` : '');
  return `${pitchSvg({ body: marks, label: `${m.def.length} defensive actions` })}
    <div class="pm-key">${Object.keys(KIND).map(k => `<span><svg viewBox="-3 -3 6 6" class="pm-sym">${SHAPE[k](0, 0, 'pm-def is-won')}</svg>${KIND[k]}</span>`).join('')}<span>Hollow = lost</span></div>
    <p class="pp-note">${['tackle', 'interception', 'clearance', 'block', 'aerial'].map(line).filter(Boolean).join(' · ')}. ${arrow}</p>`;
}
