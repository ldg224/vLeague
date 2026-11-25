// The XI on a pitch (0.6): the read-only team sheet (the reveal graphic, also used on Home) and the
// editable one on My club. Formations, slot names and tactics match the match engine
// (hcl-s3/js/sim/hcl_sim/tactics.py); keep them in step.
//   renderPitch(el, { formation, lineup, captain, players, editable, selected, onSlot, club })
//   normaliseSheet(row, squad)    -> a complete team sheet from a team_sheets / week_sheets row (or null)
//   autoLineup(formation, squad)  -> the best XI for a formation { slot: id }
//   reshape(lineup, from, to, squad) -> the XI in a new formation: same-named slots keep their player, the rest refilled
//   customFormation(name)  -> the slots of a custom formation like '4-1-4-1' (S-30), or null; FORMATIONS[name] gives these too, for any valid name
//   isFormation(name), customNames(), formationFromSlots(slotNames)
//   spotsOf(formation, shape), nameShape(points), cleanShape(formation, shape)  -> a manager's own shape (S-49): spots dragged anywhere
import { esc } from './member.js';
import { portrait } from './portrait.js';

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
// midfield rows between (the second is the attacking midfield). S-49 (25 Nov 2026): no limits on a line, 0 to 10 each (one keeper is the only
// rule); a D-M-A-F name needs at least one in the attacking midfield, else it is the D-M-F one. Built row by row with the preset slot names, as the engine does
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
// A line the tables don't cover (6 or more, 4 or more forwards, or names an earlier line took): spread evenly across, named from the outside in
// with a side so mirroring still pairs them (LCB2 LCB1 CB RCB1 RCB2). As tactics.py _side_names.
const BASE_NAME = { DEF: ['CB', 'CB'], MID: ['CM', 'CM'], MID2: ['CM', 'CM'], AM: ['AM', 'CAM'], AMW: ['AM', 'CAM'], FWD: ['ST', 'ST'] };
const spread = n => (n === 1 ? [34] : Array.from({ length: n }, (_, i) => Math.floor(7 + 54 * i / (n - 1) + 0.5)));
function sideNames(names, n) {
  const [base, mid] = BASE_NAME[names], half = Math.floor(n / 2);
  return [...Array.from({ length: half }, (_, i) => `L${base}${half - i}`), ...(n % 2 ? [mid] : []), ...Array.from({ length: half }, (_, i) => `R${base}${i + 1}`)];
}
const made = new Map();
export function customFormation(name) {
  if (typeof name !== 'string' || !/^\d{1,2}(-\d{1,2}){2,3}$/.test(name)) return null;
  if (made.has(name)) return made.get(name);
  const rows = name.split('-').map(Number), mids = rows.slice(1, -1);
  const ok = rows.reduce((a, b) => a + b, 0) === 10 && !(rows.length === 4 && rows[2] === 0);
  let out = null;
  if (ok) {
    out = { GK: s('GK', 34, 0, 'GK') };
    const plan = [['DEF', 'DEF', 'DEF', 'DEF']];
    if (mids.length === 1) plan.push(['MID', 'MID', 'MID', 'MID']);
    else plan.push(['MID', 'MID2', 'MID', 'MID'], ['AM', rows.at(-1) !== 3 && mids[1] === 3 ? 'AMW' : 'AM', 'AM', 'MID']);   // three forwards take the winger names
    plan.push(['FWD', 'FWD', 'FWD', 'FWD']);
    plan.forEach(([line, names, across, want], i) => {
      const n = rows[i];
      let got = NAMES[names][n];
      if (!got || got.some(g => g in out)) got = sideNames(names, n);
      const xs = ACROSS[across][n] || spread(n);
      got.forEach((slot, j) => { out[slot] = s(line, xs[j], 0, (slot === 'LW' || slot === 'RW') && line === 'AM' ? 'FWD' : want); });
    });
    if (Object.keys(out).length !== 11) out = null;
  }
  made.set(name, out);
  return out;
}
// Every formation name the site accepts: the presets, then the custom ones (any 10 outfield players across the lines).
export const FORMATIONS = new Proxy(BASE, {
  get: (t, k) => (typeof k !== 'string' || k in t ? t[k] : customFormation(k) || undefined),
  has: (t, k) => k in t || (typeof k === 'string' && customFormation(k) !== null),
});
export const isFormation = name => typeof name === 'string' && FORMATIONS[name] != null;
export function customNames() {
  const out = [];
  for (let d = 0; d <= 10; d++) for (let m = 0; m <= 10 - d; m++) {
    out.push(`${d}-${m}-${10 - d - m}`);
    for (let a = 1; a <= 10 - d - m; a++) out.push(`${d}-${m}-${a}-${10 - d - m - a}`);
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

// S-49: a free shape. Managers drag each outfield spot anywhere on the pitch; sheet.shape keeps where they stand ({ slot: [x, y] }: % across from
// the left touchline and % up from the own goal line, as the pitch draws them), or null for the formation's usual spots. How deep a spot stands
// puts it in a line (BANDS); the count in each line names the formation (e.g. 4-2-3-1) and its slots, left to right, so the lineup, slot names,
// wanted positions and out-of-position penalties work as before, and a sheet read without its shape still plays that formation.
export const BANDS = [['DEF', 'Defence', 0, 37], ['MID', 'Midfield', 37, 57.5], ['AM', 'Attacking midfield', 57.5, 71], ['FWD', 'Attack', 71, 100.01]];
export const SHAPE_AREA = { x: [5, 95], y: [16, 90] };
const bandOf = y => (BANDS.find(([, , lo, hi]) => y >= lo && y < hi) || BANDS.at(-1))[0];
const round1 = v => Math.round(v * 2) / 2;
// Where each slot stands: the shape's spot, else the formation's own.
export function spotsOf(formation, shape) {
  const out = {};
  for (const [slot, sl] of Object.entries(slotsOf(formation))) {
    const at = shape?.[slot];
    out[slot] = at ? { ...sl, x: at[0], y: at[1] } : sl;
  }
  return out;
}
// The formation that 10 outfield spots make ([{ key, x, y }]), and which of its slots each spot takes ({ key: slot }); null when the lines don't
// make a formation (any 10 outfield players does, S-49).
export function nameShape(points) {
  const by = { DEF: [], MID: [], AM: [], FWD: [] };
  for (const p of points) by[bandOf(p.y)].push(p);
  const name = [by.DEF.length, by.MID.length, by.AM.length || null, by.FWD.length].filter(n => n != null).join('-');
  if (points.length !== 10 || !isFormation(name)) return null;
  const slots = FORMATIONS[name], map = {};
  for (const line of ['DEF', 'MID', 'AM', 'FWD']) {
    const names = Object.entries(slots).filter(([, sl]) => sl.line === line).sort((a, b) => a[1].across - b[1].across).map(([n]) => n);
    [...by[line]].sort((a, b) => a.x - b.x || a.y - b.y).forEach((p, i) => { map[p.key] = names[i]; });
  }
  return { formation: name, map };
}
// A shape kept only if it is whole and its spots still make its own formation with the same slots; spots back on the formation's usual places
// are dropped (null = the usual shape).
export function cleanShape(formation, shape) {
  if (!shape || typeof shape !== 'object' || !FORMATIONS[formation]) return null;
  const outfield = Object.keys(slotsOf(formation)).filter(sl => sl !== 'GK');
  const pts = [], out = {};
  for (const slot of outfield) {
    const at = shape[slot];
    if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite)) return null;
    const x = round1(Math.min(SHAPE_AREA.x[1], Math.max(SHAPE_AREA.x[0], at[0]))), y = round1(Math.min(SHAPE_AREA.y[1], Math.max(SHAPE_AREA.y[0], at[1])));
    pts.push({ key: slot, x, y }); out[slot] = [x, y];
  }
  const named = nameShape(pts);
  if (!named || named.formation !== formation || pts.some(p => named.map[p.key] !== p.key)) return null;
  const usual = slotsOf(formation);
  return pts.every(p => Math.abs(usual[p.key].x - p.x) < 0.5 && Math.abs(usual[p.key].y - p.y) < 0.5) ? null : out;
}
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
    formation, shape: cleanShape(formation, row?.shape), lineup: full, tactics, bench: benchOf(full, squad),
    captain: pick(row?.captain), penalties: pick(row?.penalties), freekicks: pick(row?.freekicks), corners: pick(row?.corners),
    kit: ['home', 'away', 'special', 'special2', 'special3'].includes(row?.kit) ? row.kit : null,   // the kit worn (S-23); null = automatic
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

// `club` ({ code, colour, colour2 }) dresses each player's portrait (js/portrait.js) in the club's colours; the slot name moves to a small tag on it.
// `kits` ({ field, gk }: kitChest() pictures) dresses them in the club's real kit instead.
// `shape` (S-49) moves the spots; `shaping` shows the lines a spot's depth puts it in, while the manager moves them.
export function renderPitch(el, { formation, shape = null, lineup = {}, captain = null, players = [], editable = false, selected = null, onSlot = null, club = null, kits = null, shaping = false } = {}) {
  const f = FORMATIONS[formation] ? formation : DEFAULT_FORMATION;
  const byId = new Map(players.map(p => [String(p.id), p]));
  const tokens = Object.entries(spotsOf(f, shape)).map(([slot, sl]) => {
    const id = lineup[slot] != null ? String(lineup[slot]) : null, p = id ? byId.get(id) : null;
    const off = p && p.position !== sl.want, cap = p && String(captain) === id;
    const label = p ? `${slot}: ${p.number != null && p.number !== '' ? `number ${p.number}, ` : ''}${p.name}${cap ? ', captain' : ''}${off ? `, a ${POS_NAME[p.position] || 'player'} out of position` : ''}` : `${slot}: empty`;
    const cls = `pt-slot${p ? '' : ' empty'}${off ? ' off' : ''}${slot === selected ? ' sel' : ''}`;
    const inner = `<span class="pt-disc${p ? ' has-face' : ''}">${p ? `<span class="pt-face">${portrait(p, club && kits ? { ...club, chest: (sl.want === 'GK' && kits.gk) || kits.field } : club, undefined, true)}</span><b class="pt-slotl">${esc(slot)}</b>` : esc(slot)}${cap ? '<b class="pt-c" aria-hidden="true">C</b>' : ''}</span><span class="pt-name">${p ? `${p.number != null && p.number !== '' ? `<b class="pt-no">${esc(p.number)}</b> ` : ''}${esc(surname(p.name))}` : '&nbsp;'}</span>`;
    const pos = `left:${sl.x.toFixed(1)}%;bottom:${sl.y.toFixed(1)}%`;
    return editable
      ? `<button type="button" class="${cls}" data-slot="${esc(slot)}" style="${pos}" aria-label="${esc(label)}" aria-pressed="${slot === selected}">${inner}</button>`
      : `<div class="${cls}" style="${pos}" role="listitem" aria-label="${esc(label)}">${inner}</div>`;
  }).join('');
  const bands = shaping ? `<div class="pt-bands" aria-hidden="true">${BANDS.map(([k, label, lo, hi]) => `<span class="pt-band pt-band-${k}" style="bottom:${Math.max(lo, SHAPE_AREA.y[0] - 4)}%;height:${Math.min(hi, 100) - Math.max(lo, SHAPE_AREA.y[0] - 4)}%">${label}</span>`).join('')}</div>` : '';
  el.innerHTML = `<div class="pt${editable ? ' pt-edit' : ''}${shaping ? ' pt-shaping' : ''}">${LINES}${bands}<span class="pt-form">${esc(f)}</span>
    <div class="pt-xi"${editable ? '' : ' role="list" aria-label="Starting XI"'}>${tokens}</div></div>`;
  if (editable && onSlot) {
    el.querySelector('.pt-xi').onclick = e => { const b = e.target.closest('[data-slot]'); if (b) onSlot(b.dataset.slot); };
  }
}
