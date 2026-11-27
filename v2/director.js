// V2-4: the 3D match's TV director (25 Nov 2026). The model is js/viewer/broadcast.js (the 2D viewer's director), moved into 3D.
//
//   const dir = makeDirector(data, { ballAt });
//   dir.shot(t, dtReal, aspect) -> { pos: [x, y, z], look: [x, y, z], fov, sceneT, label, kind }
//
// Scene coordinates: X = match x - 52.5, Z = match y - 34 (match metres, origin top-left), Y up. ballAt(t) -> { x, y, z, vx, vy } in match metres.
// fov is the vertical field of view in degrees, for the given aspect (width / height). sceneT is the match time the scene must show: the same as t,
// except during a replay, which shows earlier play. label is the on-screen tag for the shot ('REPLAY', 'REF CAM') or ''. kind names the shot.
//
// shot() is a pure function of t: the main camera's path and the list of cut-away shots are worked out once for the whole match, so seeking, live
// play and any frame rate give exactly the same picture (dtReal is accepted but not used).
//
// The house rule (the user, 1.37.1; B-35): the camera never gives away that something is about to happen.
//   - The main camera only uses where the ball is now and has been (smoothing runs forwards in time only, no looking ahead). It does NOT zoom in as
//     an attack nears the box: open play stays on the wide gantry shot. It widens for a fast ball (a long pass, a switch) once the ball is moving.
//   - Every cut comes after its moment: the scorer celebrating, then a replay in the stoppage; REF CAM once a card is shown; a replay of a save,
//     woodwork or big chance at the next stoppage. Set pieces get their camera as the ball is placed, and keep it a fixed time after the kick,
//     whatever happens, so the cut gives nothing away.

const CAM_DT = 0.1;                       // main camera path sample step (s)
const GANTRY = { x: 0, y: 22, z: 34 + 38 }; // the main TV camera: high in the main stand at the halfway line, beyond the near touchline (Z = +34)
const WIDTH = { base: 38, fast: 54 };     // metres across the picture: normal, and opened out for a fast ball
const PORTRAIT_WIDTH = 24;                // a phone held upright sees a narrower strip, so the players stay a readable size
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = x => x * x * (3 - 2 * x);
const S = (x, y) => [x - 52.5, y - 34];   // match metres -> scene X, Z

export function makeDirector(data, { ballAt }) {
  const P = data.periods || [];
  const t0 = P[0]?.start_t ?? 0, t1 = P.at(-1)?.end_t ?? (data.frames?.data?.at(-1)?.[0] ?? 0) / 10;
  const half2 = P[1]?.start_t ?? Infinity;
  const ev = data.events || [];
  const fr = frames(data);

  // ---------------- main camera: aim and width along the whole match, forwards only ----------------
  const n = Math.ceil((t1 - t0) / CAM_DT) + 1, X = new Float32Array(n), Z = new Float32Array(n), D = new Float32Array(n);
  const tAt = i => t0 + i * CAM_DT, iHalf = Math.round((half2 - t0) / CAM_DT);
  for (let i = 0; i < n; i++) {
    const b = ballAt(tAt(i)), [bx, bz] = S(b.x, b.y), speed = Math.hypot(b.vx || 0, b.vy || 0);
    // A camera operator leads a moving ball a touch (its velocity now, not where it will be), and stays over the pitch.
    X[i] = clamp(bx + (b.vx || 0) * 0.25, -40, 40);
    Z[i] = clamp(bz * 0.92 + (b.vy || 0) * 0.15, -24, 26);
    D[i] = speed > 16 ? lerp(WIDTH.base, WIDTH.fast, clamp((speed - 16) / 10, 0, 1)) : WIDTH.base;
  }
  const smooth = (A, tau) => { const a = 1 - Math.exp(-CAM_DT / tau); for (let i = 1; i < n; i++) if (i !== iHalf) A[i] = lerp(A[i - 1], A[i], a); };
  smooth(X, 0.7); smooth(Z, 1.0); smooth(D, 1.2);
  smooth(X, 0.25); smooth(Z, 0.3); smooth(D, 0.4);
  // Never lose the ball: where the smoothing lags too far behind the ball now, pull the aim over (and open out if that's not enough).
  for (let i = 0; i < n; i++) {
    const b = ballAt(tAt(i)), [bx, bz] = S(b.x, b.y), hx = D[i] * 0.34, hz = D[i] * 0.2;
    if (bx > X[i] + hx) X[i] = bx - hx; else if (bx < X[i] - hx) X[i] = bx + hx;
    if (bz > Z[i] + hz) Z[i] = bz - hz; else if (bz < Z[i] - hz) Z[i] = bz + hz;
  }
  smooth(X, 0.12); smooth(Z, 0.12);
  const mainAt = t => {
    const u = clamp((t - t0) / CAM_DT, 0, n - 1), i = Math.floor(u), j = Math.min(i + 1, n - 1), k = j === iHalf ? 0 : u - i;
    return [lerp(X[i], X[j], k), lerp(Z[i], Z[j], k), lerp(D[i], D[j], k)];
  };

  // ---------------- cut-aways, each after its moment ----------------
  const shots = [];
  const stops = stoppages(fr), stopAfter = t => stops.find(s => s[1] > t + 0.5 && s[0] >= t - 0.2);
  const kickoffs = ev.filter(e => e.type === 'kickoff' || e.type === 'period_end');
  const goalEnd = e => ((e.x ?? ballAt(e.t).x) > 52.5 ? 105 : 0);
  const replay = (e, prio, before, after, win) => {
    if (!win) return;
    const avail = win.to - win.from; let r1 = e.t + after, r0 = e.t - before;
    if (r1 - r0 > avail) r0 = r1 - avail;
    if (r1 - r0 < 2.5) return;
    shots.push({ kind: 'replay', prio, from: win.from, to: win.from + (r1 - r0), r0, goalX: goalEnd(e), e });
  };
  for (const g of ev.filter(e => e.type === 'goal')) {
    shots.push({ kind: 'celebrate', prio: 0, from: g.t + 1.2, to: g.t + 6.6, player: g.own_goal ? null : g.scorer, e: g });
    const ko = kickoffs.find(k => k.t > g.t);
    replay(g, 1, 9, 1.5, ko && { from: g.t + 7.4, to: ko.t - 1 });
  }
  // Cards: REF CAM on the player booked, from the card to a few seconds after.
  for (const c of ev.filter(e => e.type === 'card')) shots.push({ kind: 'refcam', prio: 2, from: c.t + 0.2, to: c.t + 3.6, player: c.player, e: c });
  // Fouls that matter (a card or a penalty follows): a low close-up where it happened, once the whistle has gone.
  for (const f of ev.filter(e => e.type === 'foul')) {
    const pen = ev.find(e => e.type === 'penalty' && e.t > f.t && e.t < f.t + 15);
    if (pen) shots.push({ kind: 'foul', prio: 3, from: f.t + 0.6, to: f.t + 3.4, player: f.on, e: f });
  }
  // Big chances that weren't goals: a replay from behind the goal at the next stoppage (within 30 s).
  for (const s of ev.filter(e => e.type === 'shot' && e.outcome !== 'goal')) {
    const big = s.subtype === 'penalty' || s.outcome === 'saved' || s.outcome === 'woodwork' || (s.xg ?? 0) >= 0.25;
    const stop = big && stopAfter(s.t);
    if (!stop || stop[0] - s.t > 30) continue;
    replay(s, s.outcome === 'saved' ? 2 : 3, 3.5, 1.3, { from: stop[0] + 0.8, to: stop[1] - 0.8 });
  }
  // Set pieces: from behind the taker (penalty, free kick near goal) or high behind the goal (corner), from as the ball is placed to 4.5 s after the kick.
  const attacking = (team, t) => { const p = [...P].reverse().find(q => q.start_t <= t + 1e-6) || P[0]; return (team === data.teams?.home?.code) === (p?.home_attacks !== 'left') ? 105 : 0; };
  for (const e of ev) {
    if (e.type === 'corner') shots.push({ kind: 'corner', prio: 4, from: e.t - 1.2, to: e.t + 4.5, goalX: (e.x ?? 0) > 52.5 ? 105 : 0, e });
    else if (e.type === 'penalty' || e.type === 'free_kick') {
      const gx = attacking(e.team, e.t), x = e.x ?? (gx ? 94 : 11), y = e.y ?? 34;
      if (e.type === 'free_kick' && (Math.hypot(x - gx, y - 34) > 32 || Math.abs(y - 34) > 24)) continue;
      shots.push({ kind: 'kicker', prio: 4, from: e.t - 1.2, to: e.t + 4.5, goalX: gx, e: { ...e, x, y } });
    }
  }
  // Placing: set pieces first (their camera never depends on what happens after the kick), then by priority; a shot that clashes with one already
  // placed is cut short from where the other starts, or dropped if that leaves under 1.5 s.
  const placed = [];
  const order = [...shots.filter(s => s.prio === 4).sort((a, b) => a.from - b.from), ...shots.filter(s => s.prio !== 4).sort((a, b) => a.prio - b.prio || a.from - b.from)];
  for (const s of order) {
    let ok = true;
    for (const p of placed) {
      if (s.to <= p.from || s.from >= p.to) continue;
      if (s.from < p.from && p.from - s.from >= 1.5) { s.to = p.from; continue; }
      ok = false; break;
    }
    if (ok) placed.push(s);
  }
  placed.sort((a, b) => a.from - b.from);
  const shotAt = t => { for (const s of placed) { if (s.from > t) break; if (t < s.to) return s; } return null; };

  // ---------------- cameras ----------------
  const vfov = (width, dist, aspect) => 2 * Math.atan((width / aspect) / 2 / dist) * 180 / Math.PI;
  const out = (pos, look, fov, sceneT, label, kind) => ({ pos, look, fov: clamp(fov, 4, 70), sceneT, label, kind });

  function gantry(t, aspect) {
    let [x, z, w] = mainAt(t);
    let pos;
    if (aspect < 1) {
      // Upright phones see a narrow strip: a lower camera that tracks along the near side, square on to the play, with the ball kept well inside
      // the narrower picture (where the ball is now, nothing ahead).
      w = Math.min(w, PORTRAIT_WIDTH) * (w > WIDTH.base + 1 ? 1.25 : 1);
      const b = ballAt(t), [bx, bz] = S(b.x, b.y), hx = w * 0.3, hz = w * 0.45;
      x = clamp(x, bx - hx, bx + hx); z = clamp(z, bz - hz, bz + hz);
      pos = [x, 24, 34 + 13];   // high and close: an upright picture is mostly pitch, not sky
    } else pos = [GANTRY.x + x * 0.12, GANTRY.y, GANTRY.z];
    const look = [x, 0.5, z];
    const dist = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
    return out(pos, look, vfov(w, dist, aspect), t, '', 'main');
  }
  // Close on one player, low, from the near side (celebration, REF CAM, a foul).
  function closeUp(id, t, aspect, back = 7, height = 2.4, fallback) {
    const p = fr.player(id, t) || fallback || [ballAt(t).x, ballAt(t).y];
    const [px, pz] = S(p[0], p[1]);
    return out([px + 2.5, height, pz + back], [px, 1.1, pz], vfov(aspect < 1 ? 5 : 8, Math.hypot(2.5, height - 1.1, back), aspect), t, '', 'close');
  }
  // High behind a goal, looking at the ball and leaning towards the goal (replays, corners).
  function behindGoal(goalX, bx, by, aspect, width = 34, height = 11) {
    const gx = goalX ? 52.5 : -52.5, sx = goalX ? 1 : -1;
    const pos = [gx + sx * 16, height, 0];
    const [lx, lz] = S(lerp(bx, goalX, 0.3), lerp(by, 34, 0.3));
    const look = [lx, 0.5, lz];
    return { pos, look, fov: vfov(aspect < 1 ? width * 0.65 : width, Math.hypot(pos[0] - lx, height, lz), aspect) };
  }

  function shot(t, dtReal = 0, aspect = 16 / 9) {
    const s = shotAt(t);
    if (!s) return gantry(t, aspect);
    if (s.kind === 'celebrate') return { ...closeUp(s.player, t, aspect, 7, 2.2), kind: 'celebrate' };
    if (s.kind === 'refcam') return { ...closeUp(s.player, t, aspect, 5.5, 1.9), label: 'REF CAM', kind: 'refcam' };
    if (s.kind === 'foul') return { ...closeUp(s.player, t, aspect, 6, 1.6, [s.e.x, s.e.y]), kind: 'foul' };
    if (s.kind === 'replay') {
      const st = s.r0 + (t - s.from), b = ballAt(st), c = behindGoal(s.goalX, b.x, b.y, aspect, clamp(14 + Math.hypot(b.x - s.goalX, b.y - 34) * 0.5, 20, 40), 8);
      return out(c.pos, c.look, c.fov, st, 'REPLAY', 'replay');
    }
    if (s.kind === 'corner') { const b = ballAt(t), c = behindGoal(s.goalX, lerp(b.x, s.goalX ? 94 : 11, 0.45), lerp(b.y, 34, 0.45), aspect, 44); return out(c.pos, c.look, c.fov, t, '', 'corner'); }
    if (s.kind === 'kicker') {
      // From behind the taker, along the line to goal, turning with the ball once it's struck.
      const e = s.e, b = ballAt(t), [ex, ez] = S(e.x, e.y), [gx, gz] = S(s.goalX, 34), ux = gx - ex, uz = gz - ez, l = Math.hypot(ux, uz) || 1;
      const pos = [ex - ux / l * 9, 3.2, ez - uz / l * 9], [bx, bz] = S(b.x, b.y), k = t > e.t ? ease(clamp((t - e.t) / 0.8, 0, 1)) : 0;
      const look = [lerp(lerp(ex, gx, 0.45), bx, k * 0.5), 1, lerp(lerp(ez, gz, 0.45), bz, k * 0.5)];
      return out(pos, look, vfov(aspect < 1 ? 20 : 30, Math.hypot(look[0] - pos[0], 2.2, look[2] - pos[2]), aspect), t, '', 'kicker');
    }
    return gantry(t, aspect);
  }

  return { shot, shots: placed, t0, t1 };
}

// ---------------- the match file's frames ----------------
// frames.data rows: [t * scale, ball x, ball y, ball z, holder, in_play, p0 x, p0 y, p1 x, ...] (match metres * scale).
function frames(data) {
  const F = data.frames?.data || [], sc = data.frames?.scale || 10, ids = (data.players || []).map(p => p.id);
  const col = Object.fromEntries(ids.map((id, i) => [id, 6 + 2 * i]));
  const idx = t => { let lo = 0, hi = F.length - 1; const ds = t * sc; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (F[m][0] <= ds) lo = m; else hi = m - 1; } return lo; };
  return {
    rows: F, scale: sc,
    player(id, t) {
      const c = col[id]; if (c == null || !F.length) return null;
      const i = idx(t), a = F[i], b = F[Math.min(F.length - 1, i + 1)];
      if (a[c] == null) return null;
      const k = b[0] > a[0] ? clamp((t * sc - a[0]) / (b[0] - a[0]), 0, 1) : 0;
      return [lerp(a[c], b[c] ?? a[c], k) / sc, lerp(a[c + 1], b[c + 1] ?? a[c + 1], k) / sc];
    },
  };
}
// Stretches with the ball out of play: [from, to] in seconds.
function stoppages(fr) {
  const out = [], F = fr.rows;
  for (let i = 0, start = null; i < F.length; i++) {
    const dead = !F[i][5];
    if (dead && start == null) start = F[i][0] / fr.scale;
    if ((!dead || i === F.length - 1) && start != null) { out.push([start, F[i][0] / fr.scale]); start = null; }
  }
  return out;
}
