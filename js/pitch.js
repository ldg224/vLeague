// The XI on a pitch (0.6): the read-only team sheet (the reveal graphic, also used on Home) and the
// editable one on My club. Formations, slot names and tactics match the match engine
// (hcl-s3/js/sim/hcl_sim/tactics.py); keep them in step.
//   renderPitch(el, { formation, lineup, captain, players, editable, selected, onSlot })
//   normaliseSheet(row, squad)    -> a complete team sheet from a team_sheets / week_sheets row (or null)
//   autoLineup(formation, squad)  -> the best XI for a formation { slot: id }
//   reshape(lineup, from, to, squad) -> the XI in a new formation: same-named slots keep their player, the rest refilled
import { esc } from './member.js';

// Rows across a vertical pitch, attacking upwards: % up from the own goal line.
const ROW = { GK: 9, DEF: 26, MID: 48, AM: 65, FWD: 80 };
// slot: (engine line, across 0..68, forward nudge, wanted position)
const s = (line, across, adj, want) => ({ x: across / 68 * 100, y: ROW[line] + adj * 1.4, want });
export const FORMATIONS = {
  '4-3-3': {
    GK: s('GK', 34, 0, 'GK'), LB: s('DEF', 7, 0, 'DEF'), LCB: s('DEF', 25, -1, 'DEF'), RCB: s('DEF', 43, -1, 'DEF'), RB: s('DEF', 61, 0, 'DEF'),
    LCM: s('MID', 21, 3, 'MID'), CDM: s('MID', 34, -5, 'MID'), RCM: s('MID', 47, 3, 'MID'),
    LW: s('FWD', 8, -3, 'FWD'), ST: s('FWD', 34, 1, 'FWD'), RW: s('FWD', 60, -3, 'FWD'),
  },
  '4-4-2': {
    GK: s('GK', 34, 0, 'GK'), LB: s('DEF', 7, 0, 'DEF'), LCB: s('DEF', 25, -1, 'DEF'), RCB: s('DEF', 43, -1, 'DEF'), RB: s('DEF', 61, 0, 'DEF'),
    LM: s('MID', 8, 1, 'MID'), LCM: s('MID', 26, -1, 'MID'), RCM: s('MID', 42, -1, 'MID'), RM: s('MID', 60, 1, 'MID'),
    LST: s('FWD', 28, 0, 'FWD'), RST: s('FWD', 40, 0, 'FWD'),
  },
  '4-2-3-1': {
    GK: s('GK', 34, 0, 'GK'), LB: s('DEF', 7, 0, 'DEF'), LCB: s('DEF', 25, -1, 'DEF'), RCB: s('DEF', 43, -1, 'DEF'), RB: s('DEF', 61, 0, 'DEF'),
    LDM: s('MID', 27, -3, 'MID'), RDM: s('MID', 41, -3, 'MID'),
    LW: s('AM', 9, 0, 'FWD'), CAM: s('AM', 34, 0, 'MID'), RW: s('AM', 59, 0, 'FWD'), ST: s('FWD', 34, 2, 'FWD'),
  },
  '3-5-2': {
    GK: s('GK', 34, 0, 'GK'), LCB: s('DEF', 20, 0, 'DEF'), CB: s('DEF', 34, -2, 'DEF'), RCB: s('DEF', 48, 0, 'DEF'),
    LWB: s('MID', 6, -2, 'DEF'), LCM: s('MID', 24, 1, 'MID'), CDM: s('MID', 34, -4, 'MID'), RCM: s('MID', 44, 1, 'MID'), RWB: s('MID', 62, -2, 'DEF'),
    LST: s('FWD', 28, 0, 'FWD'), RST: s('FWD', 40, 0, 'FWD'),
  },
};
export const DEFAULT_FORMATION = '4-3-3';
export const POS_ORDER = ['GK', 'DEF', 'MID', 'FWD'];

// The engine reads these as team.tactic(name), 0..1 (0.5 = balanced).
export const TACTICS = [
  { key: 'tempo', label: 'Tempo', lo: 'Slow', hi: 'Fast' },
  { key: 'pressing', label: 'Pressing', lo: 'Low', hi: 'High' },
  { key: 'width', label: 'Width', lo: 'Narrow', hi: 'Wide' },
  { key: 'line_height', label: 'Defensive line', lo: 'Deep', hi: 'High' },
  { key: 'directness', label: 'Passing', lo: 'Short', hi: 'Direct' },
];
export const STEPS = [0, 0.25, 0.5, 0.75, 1];
export const PRESETS = {
  Balanced: { tempo: 0.5, pressing: 0.5, width: 0.5, line_height: 0.5, directness: 0.5 },
  Possession: { tempo: 0.25, pressing: 0.5, width: 0.75, line_height: 0.75, directness: 0 },
  'High press': { tempo: 0.75, pressing: 1, width: 0.5, line_height: 1, directness: 0.5 },
  Counter: { tempo: 1, pressing: 0.25, width: 0.5, line_height: 0.25, directness: 1 },
  'Park the bus': { tempo: 0.25, pressing: 0, width: 0.25, line_height: 0, directness: 0.75 },
};

const slotsOf = f => FORMATIONS[f] || FORMATIONS[DEFAULT_FORMATION];
const fit = (p, want) => (p.position === want ? 100 : 0) + (want === 'GK' ? p.defense * 3 : want === 'DEF' ? p.defense * 2 + p.offense
  : want === 'FWD' ? p.offense * 2 + p.defense * 0.5 : p.offense + p.defense);

// Fill the empty slots of `lineup` with the best unused players, goalkeeper first.
function fill(formation, squad, lineup = {}) {
  const out = { ...lineup }, used = new Set(Object.values(out).map(String));
  const order = Object.entries(slotsOf(formation)).filter(([n]) => !out[n]).sort(([, a], [, b]) => (b.want === 'GK') - (a.want === 'GK'));
  for (const [name, sl] of order) {
    const best = squad.filter(p => !used.has(String(p.id))).sort((a, b) => fit(b, sl.want) - fit(a, sl.want))[0];
    if (best) { out[name] = String(best.id); used.add(String(best.id)); }
  }
  return out;
}
export const autoLineup = (formation, squad) => fill(formation, squad);
export function reshape(lineup, from, to, squad) {
  const keep = {};
  for (const [slot, id] of Object.entries(lineup)) if (slotsOf(to)[slot]) keep[slot] = id;
  // Players whose slot vanished go to the free slots that want their position, before anyone from the bench.
  const free = Object.keys(slotsOf(to)).filter(n => !keep[n]);
  const byId = new Map(squad.map(p => [String(p.id), p]));
  for (const [slot, id] of Object.entries(lineup)) {
    if (keep[slot] || slotsOf(to)[slot]) continue;
    const p = byId.get(String(id)), i = p ? free.findIndex(n => slotsOf(to)[n].want === p.position) : -1;
    if (i >= 0) keep[free.splice(i, 1)[0]] = id;
  }
  return fill(to, squad, keep);
}

// A complete sheet from a stored row: unknown slots, players who left the squad and repeats are dropped and refilled.
export function normaliseSheet(row, squad) {
  const ids = new Set(squad.map(p => String(p.id)));
  const formation = FORMATIONS[row?.formation] ? row.formation : DEFAULT_FORMATION;
  const lineup = {}, seen = new Set();
  for (const [slot, id] of Object.entries(row?.lineup || {})) {
    const v = String(id);
    if (slotsOf(formation)[slot] && ids.has(v) && !seen.has(v)) { lineup[slot] = v; seen.add(v); }
  }
  const full = fill(formation, squad, lineup);
  const tactics = {};
  for (const t of TACTICS) {
    const v = Number(row?.tactics?.[t.key]);
    tactics[t.key] = Number.isFinite(v) ? STEPS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : 0.5;
  }
  const inXI = new Set(Object.values(full));
  const pick = id => (id != null && inXI.has(String(id)) ? String(id) : null);
  return {
    formation, lineup: full, tactics, bench: benchOf(full, squad),
    captain: pick(row?.captain), penalties: pick(row?.penalties), freekicks: pick(row?.freekicks), corners: pick(row?.corners),
    kit: ['home', 'away', 'special'].includes(row?.kit) ? row.kit : null,   // the kit worn (S-23); null = automatic
  };
}
// Everyone not in the XI, goalkeepers first.
export const benchOf = (lineup, squad) => {
  const inXI = new Set(Object.values(lineup).map(String));
  return squad.filter(p => !inXI.has(String(p.id)))
    .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.name.localeCompare(b.name)).map(p => String(p.id));
};

const LINES = `<svg class="pt-lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
  <rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/><circle cx="34" cy="52.5" r="9.15"/>
  <rect x="13.84" y="1" width="40.32" height="16.5"/><rect x="24.84" y="1" width="18.32" height="5.5"/>
  <rect x="13.84" y="87.5" width="40.32" height="16.5"/><rect x="24.84" y="98.5" width="18.32" height="5.5"/>
  <path d="M26.7 17.5a9.15 9.15 0 0 0 14.6 0M26.7 87.5a9.15 9.15 0 0 1 14.6 0"/></svg>`;
const surname = n => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; };
const POS_NAME = { GK: 'goalkeeper', DEF: 'defender', MID: 'midfielder', FWD: 'forward' };

export function renderPitch(el, { formation, lineup = {}, captain = null, players = [], editable = false, selected = null, onSlot = null } = {}) {
  const f = FORMATIONS[formation] ? formation : DEFAULT_FORMATION;
  const byId = new Map(players.map(p => [String(p.id), p]));
  const tokens = Object.entries(slotsOf(f)).map(([slot, sl]) => {
    const id = lineup[slot] != null ? String(lineup[slot]) : null, p = id ? byId.get(id) : null;
    const off = p && p.position !== sl.want, cap = p && String(captain) === id;
    const label = p ? `${slot}: ${p.number != null && p.number !== '' ? `number ${p.number}, ` : ''}${p.name}${cap ? ', captain' : ''}${off ? `, a ${POS_NAME[p.position] || 'player'} out of position` : ''}` : `${slot}: empty`;
    const cls = `pt-slot${p ? '' : ' empty'}${off ? ' off' : ''}${slot === selected ? ' sel' : ''}`;
    const inner = `<span class="pt-disc">${esc(slot)}${cap ? '<b class="pt-c" aria-hidden="true">C</b>' : ''}</span><span class="pt-name">${p ? `${p.number != null && p.number !== '' ? `<b class="pt-no">${esc(p.number)}</b> ` : ''}${esc(surname(p.name))}` : '&nbsp;'}</span>`;
    const pos = `left:${sl.x.toFixed(1)}%;bottom:${sl.y.toFixed(1)}%`;
    return editable
      ? `<button type="button" class="${cls}" data-slot="${esc(slot)}" style="${pos}" aria-label="${esc(label)}" aria-pressed="${slot === selected}">${inner}</button>`
      : `<div class="${cls}" style="${pos}" role="listitem" aria-label="${esc(label)}">${inner}</div>`;
  }).join('');
  el.innerHTML = `<div class="pt${editable ? ' pt-edit' : ''}">${LINES}<span class="pt-form">${esc(f)}</span>
    <div class="pt-xi"${editable ? '' : ' role="list" aria-label="Starting XI"'}>${tokens}</div></div>`;
  if (editable && onSlot) {
    el.querySelector('.pt-xi').onclick = e => { const b = e.target.closest('[data-slot]'); if (b) onSlot(b.dataset.slot); };
  }
}
