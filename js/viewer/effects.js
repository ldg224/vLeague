// Match viewer effects worked out from the saved match file (S-10), for the highlights and the broadcast view. Pure: no canvas, so it is tested on its own
// (tests/viewer-effects.test.mjs) and works on matches saved before it existed.
//   const fx = buildEffects(data, frames)     frames: { at(t) -> { players: [[x, y]...], vel: [[vx, vy]...] } }
//   fx.diveAt(i, t)     null, or { k (0 upright .. 1 fully out), lift (metres off the ground), dx, dy (the way he goes, metres), dist } for a keeper diving at t
//   fx.headGone(i, t)   true from the moment a player commits a foul that is a STRAIGHT red (not a second yellow): his head has come off
//   fx.heads(t)         the loose heads at t: [{ i, x, y, z, rot, alpha }], bouncing then rolling to a stop, then fading
// A dive is read from where the keeper really goes: after a shot on target (saved, scored or off the woodwork) he moves 1.1 m or more between a
// moment after the strike and the save or goal. Short steps stay steps.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GRAVITY = 9.8, HEAD_R = 0.27, ROLL_FRICTION = 2.0, HEAD_LIFE = 7, FADE = 1.2;
export const DIVE_MIN = 1.1, DIVE_REACT = 0.15, DIVE_UP = 0.28;

// A small repeatable random number source: the same player and foul always lose their head the same way.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The path of a head knocked off at (x, y) moving (vx, vy): [[x, y, z, spin]] every 1/60 s. It pops up, bounces about three times losing speed,
// then rolls on the grass until friction stops it.
export function headPath(x, y, vx, vy, seed) {
  const r = rng(seed), a = r() * Math.PI * 2, h = 3.0 + r() * 2.5;
  let hx = vx * 0.5 + Math.cos(a) * h, hy = vy * 0.5 + Math.sin(a) * h, z = 1.7, vz = 4.6 + r() * 1.6, spin = 0, dir = r() < 0.5 ? -1 : 1;
  const dt = 1 / 60, out = [];
  for (let s = 0; s < HEAD_LIFE * 60; s++) {
    out.push([x, y, z, spin]);
    vz -= GRAVITY * dt; z += vz * dt;
    if (z <= HEAD_R) {
      z = HEAD_R;
      if (vz < -0.9) { vz = -vz * 0.5; hx *= 0.85; hy *= 0.85; } else vz = 0;
    }
    const sp = Math.hypot(hx, hy);
    if (z <= HEAD_R + 1e-6 && vz === 0 && sp > 0) { const k = Math.max(0, sp - ROLL_FRICTION * dt) / sp; hx *= k; hy *= k; }
    x += hx * dt; y += hy * dt;
    spin += dir * Math.hypot(hx, hy) * dt / HEAD_R;
  }
  return out;
}

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

  // ---- heads: a straight red, from the foul that earns it (the card follows a few seconds later, so the head is the warning)
  const losses = [];
  for (const c of events) {
    if (c.type !== 'card' || c.card !== 'red') continue;   // not a second yellow ('second_yellow') and not a yellow
    const i = idxOf[c.player]; if (i == null) continue;
    const foul = [...events].reverse().find(f => f.type === 'foul' && f.player === c.player && f.t <= c.t + 0.01 && c.t - f.t < 3);
    const t0 = foul ? foul.t : Math.max(0, c.t - 0.8), p = fr.at(t0), v = p.vel?.[i] || [0, 0];
    losses.push({ i, t0, path: headPath(p.players[i][0], p.players[i][1], v[0], v[1], i * 977 + Math.round(t0 * 10)) });
  }
  const headGone = (i, t) => losses.some(l => l.i === i && t >= l.t0);
  const heads = t => {
    const out = [];
    for (const l of losses) {
      const e = t - l.t0; if (e < 0 || e > HEAD_LIFE) continue;
      const [x, y, z, rot] = l.path[Math.min(l.path.length - 1, Math.floor(e * 60))];
      out.push({ i: l.i, x, y, z, rot, alpha: clamp((HEAD_LIFE - e) / FADE, 0, 1) });
    }
    return out;
  };
  return { diveAt, headGone, heads, dives, losses };
}
