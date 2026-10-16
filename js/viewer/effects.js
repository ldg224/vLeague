// Match viewer effects worked out from the saved match file (S-10), for the highlights and the broadcast view. Pure: no canvas, so it is tested on its own
// (tests/viewer-effects.test.mjs) and works on matches saved before it existed.
//   const fx = buildEffects(data, frames)     frames: { at(t) -> { players: [[x, y]...], vel: [[vx, vy]...] } }
//   fx.diveAt(i, t)     null, or { k (0 upright .. 1 fully out), lift (metres off the ground), dx, dy (the way he goes, metres), dist } for a keeper diving at t
// A dive is read from where the keeper really goes: after a shot on target (saved, scored or off the woodwork) he moves 1.1 m or more between a
// moment after the strike and the save or goal. Short steps stay steps.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const DIVE_MIN = 1.1, DIVE_REACT = 0.15, DIVE_UP = 0.28;

export function buildEffects(d, fr) {
  const events = d.events || [], players = d.players || [], home = d.teams?.home?.code, idxOf = Object.fromEntries(players.map(p => [p.id, p.idx]));
  const gkOf = {}; for (const p of players) if (p.slot === 'GK') gkOf[p.team] = p.idx;
  const posAt = (i, t) => fr.at(t).players[i];

  // ---- dives
  const dives = [];
  for (const s of events) {
    if (s.type !== 'shot' || !s.on_target || !['saved', 'goal', 'woodwork'].includes(s.outcome)) continue;
    const idx = gkOf[s.team === home ? d.teams.away.code : home];
    if (idx == null) continue;
    const end = events.find(x => x.t >= s.t && x.t <= s.t + 3 && ['save', 'goal', 'woodwork'].includes(x.type));
    const t0 = s.t + DIVE_REACT, t1 = Math.max(t0 + 0.3, end ? end.t : s.t + 1.2);
    const a = posAt(idx, t0), b = posAt(idx, t1), dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy);
    if (dist >= DIVE_MIN) dives.push({ idx, t0, t1, dx: dx / dist, dy: dy / dist, dist });
  }
  const diveAt = (i, t) => {
    for (const v of dives) {
      if (v.idx !== i || t < v.t0 || t > v.t1 + 0.9) continue;
      const up = clamp((t - v.t0) / DIVE_UP, 0, 1), down = 1 - clamp((t - (v.t1 + 0.35)) / 0.5, 0, 1), k = Math.min(up * up * (3 - 2 * up), down);
      const air = clamp((t - v.t0) / (v.t1 - v.t0 + 0.2), 0, 1);
      return { k, lift: t <= v.t1 + 0.2 ? 0.45 * Math.sin(Math.PI * air) * clamp(v.dist / 3, 0.3, 1) : 0, dx: v.dx, dy: v.dy, dist: v.dist };
    }
    return null;
  };

  return { diveAt, dives };
}
