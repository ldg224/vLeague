// The XI on a pitch (0.6): the read-only team sheet (the reveal graphic, also used on Home) and the
// editable one on My club. Formations, slot names and tactics match the match engine
// (hcl-s3/js/sim/hcl_sim/tactics.py); keep them in step.
//   renderPitch(el, { formation, lineup, captain, players, editable, selected, onSlot })
//   normaliseSheet(row, squad)    -> a complete team sheet from a team_sheets / week_sheets row (or null)
//   autoLineup(formation, squad)  -> the best XI for a formation { slot: id }
//   reshape(lineup, from, to, squad) -> the XI in a new formation: same-named slots keep their player, the rest refilled
//   customFormation(name)  -> the slots of a custom formation like '4-1-4-1' (S-30), or null; FORMATIONS[name] gives these too, for any valid name
//   isFormation(name), customNames(), formationFromSlots(slotNames)
import { esc } from './member.js';

// Rows across a vertical pitch, attacking upwards: % up from the own goal line.
const ROW = { GK: 9, DEF: 26, MID: 48, AM: 65, FWD: 80 };
// slot: (engine line, across 0..68, forward nudge, wanted position)
const s = (line, across, adj, want) => ({ x: across / 68 * 100, y: ROW[line] + adj * 1.4, want, line, across });
const BASE = {
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

// S-30: custom formations. Any "D-M-F" or "D-M-A-F" that adds up to 10 outfield players is a formation: defenders first, forwards last, one or two
// midfield rows between (the second is the attacking midfield). Built row by row with the preset slot names, as the engine does
// (hcl-s3/js/sim/hcl_sim/tactics.py, custom_formation); tests/formations.test.mjs checks the two agree.
const ACROSS = {
  DEF: { 1: [34], 2: [25, 43], 3: [20, 34, 48], 4: [7, 25, 43, 61], 5: [7, 20, 34, 48, 61] },
  MID: { 1: [34], 2: [27, 41], 3: [21, 34, 47], 4: [8, 26, 42, 60], 5: [7, 20, 34, 48, 61] },
  AM: { 1: [34], 2: [24, 44], 3: [9, 34, 59], 4: [9, 26, 42, 59], 5: [9, 22, 34, 46, 59] },
  FWD: { 1: [34], 2: [28, 40], 3: [8, 34, 60] },
};
const NAMES = {
  DEF: { 1: ['CB'], 2: ['LCB', 'RCB'], 3: ['LCB', 'CB', 'RCB'], 4: ['LB', 'LCB', 'RCB', 'RB'], 5: ['LB', 'LCB', 'CB', 'RCB', 'RB'] },
  MID: { 1: ['CDM'], 2: ['LCM', 'RCM'], 3: ['LCM', 'CM', 'RCM'], 4: ['LM', 'LCM', 'RCM', 'RM'], 5: ['LM', 'LCM', 'CM', 'RCM', 'RM'] },
  MID2: { 1: ['CDM'], 2: ['LDM', 'RDM'], 3: ['LCM', 'CDM', 'RCM'], 4: ['LM', 'LCM', 'RCM', 'RM'], 5: ['LM', 'LCM', 'CM', 'RCM', 'RM'] },
  AM: { 1: ['CAM'], 2: ['LAM', 'RAM'], 3: ['LAM', 'CAM', 'RAM'], 4: ['LM', 'LAM', 'RAM', 'RM'], 5: ['LM', 'LAM', 'CAM', 'RAM', 'RM'] },
  AMW: { 3: ['LW', 'CAM', 'RW'] },
  FWD: { 1: ['ST'], 2: ['LST', 'RST'], 3: ['LW', 'ST', 'RW'] },
};
const made = new Map();
export function customFormation(name) {
  if (typeof name !== 'string' || !/^\d(-\d){2,3}$/.test(name)) return null;
  if (made.has(name)) return made.get(name);
  const rows = name.split('-').map(Number), mids = rows.slice(1, -1);
  const ok = rows.reduce((a, b) => a + b, 0) === 10 && rows[0] >= 3 && rows[0] <= 5 && rows.at(-1) >= 1 && rows.at(-1) <= 3 && mids.every(n => n >= 1 && n <= 5);
  let out = null;
  if (ok) {
    out = { GK: s('GK', 34, 0, 'GK') };
    const plan = [['DEF', 'DEF', 'DEF', 'DEF']];
    if (mids.length === 1) plan.push(['MID', 'MID', 'MID', 'MID']);
    else plan.push(['MID', 'MID2', 'MID', 'MID'], ['AM', rows.at(-1) !== 3 && mids[1] === 3 ? 'AMW' : 'AM', 'AM', 'MID']);   // three forwards take the winger names
    plan.push(['FWD', 'FWD', 'FWD', 'FWD']);
    plan.forEach(([line, names, across, want], i) => NAMES[names][rows[i]].forEach((slot, j) => {
      out[slot] = s(line, ACROSS[across][rows[i]][j], 0, (slot === 'LW' || slot === 'RW') && line === 'AM' ? 'FWD' : want);
    }));
  }
  made.set(name, out);
  return out;
}
// Every formation name the site accepts: the presets, then the custom ones (a shape of 3 to 5 defenders, 1 to 3 forwards).
export const FORMATIONS = new Proxy(BASE, {
  get: (t, k) => (typeof k !== 'string' || k in t ? t[k] : customFormation(k) || undefined),
  has: (t, k) => k in t || (typeof k === 'string' && customFormation(k) !== null),
});
export const isFormation = name => typeof name === 'string' && FORMATIONS[name] != null;
export function customNames() {
  const out = [];
  for (let d = 3; d <= 5; d++) for (let f = 1; f <= 3; f++) {
    const rest = 10 - d - f;
    for (let m = 1; m <= Math.min(5, rest); m++) {
      const one = `${d}-${m}-${f}`;
      if (m === rest) out.push(one);
      else if (rest - m <= 5) out.push(`${d}-${m}-${rest - m}-${f}`);
    }
  }
  return out.filter(n => customFormation(n) && !(n in BASE));
}
// The formation whose slots are exactly these (a played match only records who stood where).
export function formationFromSlots(slotNames) {
  const have = new Set(slotNames);
  const same = f => { const k = Object.keys(FORMATIONS[f]); return k.length === have.size && k.every(x => have.has(x)); };
  return Object.keys(BASE).find(same) || customNames().find(same) || null;
}
export const DEFAULT_FORMATION = '4-3-3';
// S-25: what a player's match rating loses for standing in a slot that wants another position. A step along defence-midfield-attack costs 0.5,
// a forward in defence (or the other way round) 3, an outfield player in goal 4, a keeper in the outfield 3.5. Keep in step with OUT_OF_POSITION
// in js/sim/hcl_sim/output.py and with js/live-rating.js.
const OUT_OF_POSITION = { GK: { DEF: 4, MID: 4, FWD: 4 }, DEF: { GK: 3.5, MID: 0.5, FWD: 3 }, MID: { GK: 3.5, DEF: 0.5, FWD: 0.5 }, FWD: { GK: 4, DEF: 3, MID: 0.5 } };
export const positionPenalty = (want, have) => (want && have && want !== have ? OUT_OF_POSITION[want]?.[have] ?? 0 : 0);
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
export const fillLineup = fill;   // keeps who is already placed and fills the empty spots with the best of the rest
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
