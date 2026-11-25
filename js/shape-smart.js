// S-49: the helpers that make the Starting XI's own-shape builder "smart like real football" (the user, 25 Nov 2026). Logic only, no DOM.
// Spots are { x, y } in % of the pitch as js/pitch.js draws them: x across from the left touchline, y up from the team's own goal line.
//   GRIDS, snap(x, y, grid)        -> the snap grid sizes the manager can choose, and a spot snapped to one (grid 0 = free)
//   partnerOf(slot, slots)         -> the slot that mirrors this one (LB <-> RB, LCM <-> RCM ...), or null for a central one
//   mirrored(x, y)                 -> the mirror spot across the pitch's middle
//   roleOf(x, y, line)             -> the real football position a spot reads as (LB, LWB, CB, CDM, CM, LM, CAM, LW, ST ...), display only
//   checks(spots)                  -> plain advice about a shape: [{ kind, text }] (never blocks a move)
// How the engine plays a drawn shape (s40-shots, tactics.shape_slots): each player keeps his drawn lane across the pitch, and how far ahead of
// or behind his own line he stands; the gaps between the lines are the engine's (a compact block that moves with the ball). So the checks here
// are about lanes and the back line, not the gaps between lines.

export const GRIDS = [['off', 'Free', 0], ['fine', 'Fine', 2.5], ['medium', 'Medium', 5], ['coarse', 'Coarse', 10]];
export const gridSize = key => (GRIDS.find(g => g[0] === key) || GRIDS[2])[2];

const step = (v, g) => (g ? Math.round(v / g) * g : Math.round(v * 2) / 2);
export const snap = (x, y, grid) => [step(x, grid), step(y, grid)];

// Left and right slot names pair up by their first letter; the rest (CB, CDM, CM, CAM, ST, GK) are central.
export function partnerOf(slot, slots) {
  if (!/^[LR]/.test(slot)) return null;
  const other = (slot[0] === 'L' ? 'R' : 'L') + slot.slice(1);
  return slots.includes(other) ? other : null;
}
export const isCentral = slot => !/^[LR]/.test(slot);
export const mirrored = (x, y) => [100 - x, y];

// The position a spot reads as. Bands as js/pitch.js BANDS: DEF < 37, MID < 57.5, AM < 71, FWD above. Wide = outside the width of the box.
export function roleOf(x, y, line) {
  const side = x < 50 ? 'L' : 'R', wide = x < 24 || x > 76, flank = x < 33 || x > 67;
  if (line === 'GK') return 'GK';
  if (line === 'DEF') return wide ? (y >= 30 ? `${side}WB` : `${side}B`) : 'CB';
  if (line === 'MID') return wide ? `${side}M` : y < 45 ? 'CDM' : 'CM';
  if (line === 'AM') return flank ? `${side}W` : 'CAM';
  return wide ? `${side}W` : 'ST';
}

const LINES = ['DEF', 'MID', 'AM', 'FWD'];
// spots: [{ slot, x, y, line }] for the ten outfield players.
export function checks(spots) {
  const out = [];
  const by = Object.fromEntries(LINES.map(l => [l, spots.filter(s => s.line === l)]));
  // A back line that isn't level: the deepest defender keeps everyone onside.
  const ys = by.DEF.map(s => s.y);
  if (ys.length >= 3 && Math.max(...ys) - Math.min(...ys) > 9) out.push({ kind: 'line', text: 'Your back line isn’t level. The deepest defender plays every forward onside.' });
  // Bunching: two players closer than about 7 m.
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const a = spots[i], b = spots[j];
    if (Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05) < 7) { out.push({ kind: 'crowd', text: `${a.slot} and ${b.slot} are crowding the same space.` }); i = spots.length; break; }
  }
  // Width: nobody out wide ahead of the back line means crosses and switches of play are rare.
  const ahead = spots.filter(s => s.line !== 'DEF');
  const left = spots.some(s => s.x < 24), right = spots.some(s => s.x > 76);
  if (ahead.length && !ahead.some(s => s.x < 24 || s.x > 76) && !(left && right)) out.push({ kind: 'narrow', text: 'Nobody is wide ahead of the defence. Expect few crosses: width comes from the full-backs only.' });
  else if (!left || !right) out.push({ kind: 'side', text: `Nobody covers the ${left ? 'right' : 'left'} flank.` });
  // A lone forward far ahead of the next player.
  if (by.FWD.length === 1 && !by.AM.length && by.MID.length && by.FWD[0].y - Math.max(...by.MID.map(s => s.y)) > 30) out.push({ kind: 'isolated', text: 'Your striker is isolated. An attacking midfielder would give him support.' });
  return out;
}
