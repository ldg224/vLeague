// Player rig prototype (the link-only tester page player-designs.html): one 3D skeleton, posed by animations or by dragging its joints, drawn in four
// candidate designs that all wear the real kit template (js/kit.js: the shirt is the unrolled kit texture seen at the player's turn, with his print).
//   x = the player's right, y = up, z = the way he faces (metres). The camera turns round him (theta, as kit.js: 0 = he faces us, PI/2 = he faces our right)
//   and looks down at `elev`.
import { drawKitFront, drawPrint, cleanDesign } from './kit.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const wave = (t, a, b) => Math.sin(TAU * t + (b || 0)) * a;

// ---------------------------------------------------------------- vectors
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rotAxis = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c); return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd]; };
// 3x3 matrices as arrays of rows
const mm = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const Rx = a => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };   // +a tips the top forward (towards +z)? (y -> -z): we use -a below
const Ry = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const Rz = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
// lean forward by a: the body's up (0,1,0) tips towards +z
const lean = a => Rx(a);   // Rx(a) maps (0,1,0) to (0, cos a, sin a)

// ---------------------------------------------------------------- the pose
// Angles in radians. Arms and legs: swing = forward (+) / back (-), raise = out to the side; bend = elbow / knee. Spine: lean forward, side (towards
// his right +), twist (chest turns to his left +). root: where the pelvis is (x, z on the ground, y = lift), its tilt (pitch forward, roll to his right) and turn.
export const POSE_KEYS = ['spine', 'neck', 'lArm', 'rArm', 'lLeg', 'rLeg'];
export function restPose() {
  return {
    root: { x: 0, y: 0, z: 0, pitch: 0, roll: 0, yaw: 0, ground: true },
    spine: { lean: 0.03, side: 0, twist: 0 }, neck: { lean: 0, side: 0, turn: 0 },
    lArm: { swing: 0.05, raise: 0.12, bend: 0.25 }, rArm: { swing: 0.05, raise: 0.12, bend: 0.25 },
    lLeg: { swing: 0, raise: 0.03, bend: 0.06, foot: 0 }, rLeg: { swing: 0, raise: 0.03, bend: 0.06, foot: 0 },
  };
}
export const clonePose = p => JSON.parse(JSON.stringify(p));
export function mixPose(a, b, k) {
  const out = clonePose(a);
  for (const part of Object.keys(out)) for (const key of Object.keys(out[part])) if (typeof out[part][key] === 'number') out[part][key] = lerp(a[part][key], b[part][key] ?? a[part][key], k);
  out.root.ground = k < 0.5 ? a.root.ground : b.root.ground;
  return out;
}
// Joint limits (a real body), used by the drag tool and to keep animations honest.
export const LIMITS = {
  'spine.lean': [-0.45, 1.2], 'spine.side': [-0.5, 0.5], 'spine.twist': [-0.9, 0.9],
  'neck.lean': [-0.6, 0.7], 'neck.side': [-0.5, 0.5], 'neck.turn': [-1.2, 1.2],
  'lArm.swing': [-1.1, 3.1], 'lArm.raise': [-0.2, 3.0], 'lArm.bend': [0, 2.6], 'rArm.swing': [-1.1, 3.1], 'rArm.raise': [-0.2, 3.0], 'rArm.bend': [0, 2.6],
  'lLeg.swing': [-0.8, 2.0], 'lLeg.raise': [-0.3, 1.2], 'lLeg.bend': [0, 2.5], 'lLeg.foot': [-0.6, 0.8],
  'rLeg.swing': [-0.8, 2.0], 'rLeg.raise': [-0.3, 1.2], 'rLeg.bend': [0, 2.5], 'rLeg.foot': [-0.6, 0.8],
  'root.pitch': [-1.6, 1.6], 'root.roll': [-1.7, 1.7],
};

// ---------------------------------------------------------------- the skeleton
// dims: the design's proportions (metres). A real 1.85 m player by default.
export const DIMS = { hip: 0.98, hipW: 0.1, spine: 0.47, shoulderW: 0.2, neck: 0.07, head: 0.115, upper: 0.29, fore: 0.26, hand: 0.08, thigh: 0.45, shin: 0.43, foot: 0.24 };
// Limb direction from swing and raise. side = +1 his right, -1 his left. Down (0,-1,0), raised out to his side, then swung forward.
function limbDir(swing, raise, side) {
  let v = [side * Math.sin(raise), -Math.cos(raise), 0];
  const c = Math.cos(swing), s = Math.sin(swing);
  v = [v[0], v[1] * c - v[2] * s, -v[1] * s + v[2] * c];   // down swings to +z (forward) for +swing
  return v;
}
export function solveSkeleton(pose, dims = DIMS) {
  const d = { ...DIMS, ...dims }, r = pose.root;
  const R0 = mm(mm(Ry(r.yaw), lean(r.pitch)), Rz(-r.roll));
  const pelvis = [r.x, d.hip + r.y, r.z];
  const Rs = mm(mm(mm(R0, Ry(pose.spine.twist)), lean(pose.spine.lean)), Rz(-pose.spine.side));
  const at = (M, o, v) => add(o, mv(M, v));
  const J = { pelvis };
  J.chest = at(Rs, pelvis, [0, d.spine * 0.82, 0]);
  J.neck = at(Rs, pelvis, [0, d.spine + d.neck * 0.3, 0]);
  const Rh = mm(mm(mm(Rs, lean(pose.neck.lean)), Rz(-pose.neck.side)), Ry(pose.neck.turn));
  J.head = at(Rh, J.neck, [0, d.neck * 0.7 + d.head, 0]);
  J.headR = Rh;
  for (const [k, sd] of [['r', 1], ['l', -1]]) {
    const arm = pose[k + 'Arm'], leg = pose[k + 'Leg'];
    const sh = at(Rs, pelvis, [sd * d.shoulderW, d.spine - 0.03, 0]);
    const up = mv(Rs, limbDir(arm.swing, arm.raise, sd));
    const fwd = mv(Rs, [0, 0, 1]), upw = mv(Rs, [0, 1, 0]);
    let ax = cross(up, fwd); if (Math.hypot(...ax) < 0.35) ax = add(ax, mul(cross(up, upw), -(0.35 - Math.hypot(...ax))));
    ax = norm(ax);
    const fore = rotAxis(up, ax, arm.bend);
    const el = add(sh, mul(up, d.upper)), wr = add(el, mul(fore, d.fore)), hand = add(wr, mul(fore, d.hand));
    Object.assign(J, { [k + 'Sh']: sh, [k + 'El']: el, [k + 'Wr']: wr, [k + 'Hand']: hand });
    const hip = at(R0, pelvis, [sd * d.hipW, -0.04, 0]);
    const th = mv(R0, limbDir(leg.swing, leg.raise, sd)), back = mv(R0, [0, 0, -1]);
    let kx = cross(th, back); if (Math.hypot(...kx) < 0.3) kx = add(kx, mul(cross(th, mv(R0, [0, 1, 0])), 0.3)); kx = norm(kx);
    const shin = rotAxis(th, kx, leg.bend), foot = norm(rotAxis(shin, kx, -Math.PI / 2 + leg.foot));
    const kn = add(hip, mul(th, d.thigh)), an = add(kn, mul(shin, d.shin)), toe = add(an, mul(foot, d.foot * 0.78)), heel = add(an, mul(foot, -d.foot * 0.22));
    Object.assign(J, { [k + 'Hip']: hip, [k + 'Kn']: kn, [k + 'An']: an, [k + 'Toe']: toe, [k + 'Heel']: heel });
  }
  if (r.ground) {   // stand on the ground: the lowest foot point touches it
    const low = Math.min(J.lAn[1] - 0.05, J.rAn[1] - 0.05, J.lToe[1] - 0.03, J.rToe[1] - 0.03, J.lHeel[1] - 0.04, J.rHeel[1] - 0.04);
    for (const k of Object.keys(J)) if (Array.isArray(J[k]) && J[k].length === 3 && typeof J[k][0] === 'number') J[k] = [J[k][0], J[k][1] - low, J[k][2]];
  }
  J.dims = d;
  return J;
}

// ---------------------------------------------------------------- the camera
export function makeView({ theta = 0, elev = 15 * D2R, scale = 200, ox = 0, oy = 0 }) {
  const ct = Math.cos(theta), st = Math.sin(theta), ce = Math.cos(elev), se = Math.sin(elev);
  return {
    theta, scale,
    p(v) {   // -> [x, y, depth (bigger = nearer us)]
      const X = st * v[2] - ct * v[0], dep = ct * v[2] + st * v[0];
      return [ox + X * scale, oy - (v[1] * ce - dep * se) * scale, dep * ce + v[1] * se];
    },
  };
}

// ---------------------------------------------------------------- animations
// Each gives a pose for t seconds in (loops where it should).
const A = {};
const P = () => restPose();
A.idle = t => { const p = P(), b = Math.sin(t * 1.6); p.spine.lean = 0.04 + b * 0.012; p.lArm.bend = 0.3 + b * 0.04; p.rArm.bend = 0.28 - b * 0.04; p.spine.side = Math.sin(t * 0.5) * 0.03; p.lLeg.raise = 0.06; p.rLeg.raise = 0.06; p.lLeg.bend = p.rLeg.bend = 0.1; p.neck.turn = Math.sin(t * 0.35) * 0.3; return p; };
const gait = (t, per, { hip = 0.5, back = 0.4, knee = 1.4, kneeStance = 0.25, arm = 0.5, elbow = 1.3, leanF = 0.12, bob = 0.04, air = 0 }) => {
  const p = P(), ph = (t / per) % 1;
  for (const [k, off] of [['l', 0], ['r', 0.5]]) {
    const q = (ph + off) % 1, sw = Math.sin(q * TAU);   // +: leg forward
    const leg = p[k + 'Leg'];
    leg.swing = sw > 0 ? sw * hip : sw * back;
    // knee: bent most as the leg swings through (q 0.6..0.9), a little on landing
    leg.bend = kneeStance + Math.max(0, Math.sin((q - 0.55) * TAU)) * knee * (q > 0.5 ? 1 : 0.2) + Math.max(0, -Math.cos(q * TAU)) * 0.15;
    leg.foot = Math.cos(q * TAU) * 0.25;
    const armK = k === 'l' ? 'rArm' : 'lArm';   // arms swing with the opposite leg
    p[armK].swing = sw * arm; p[armK].bend = elbow + sw * 0.15; p[armK].raise = 0.12;
  }
  p.spine.lean = leanF; p.spine.twist = Math.sin(ph * TAU) * 0.12;
  p.root.ground = true;   // the lowest foot on the grass (bob comes from the legs themselves)
  return p;
};
A.walk = t => { const p = gait(t, 1.1, { hip: 0.42, back: 0.3, knee: 0.9, kneeStance: 0.08, arm: 0.35, elbow: 0.35, leanF: 0.04, bob: 0.025 }); p.root.ground = true; return p; };
A.jog = t => gait(t, 0.72, { hip: 0.7, back: 0.45, knee: 1.6, kneeStance: 0.3, arm: 0.6, elbow: 1.45, leanF: 0.14, bob: 0.06 });
A.sprint = t => gait(t, 0.56, { hip: 1.05, back: 0.6, knee: 2.0, kneeStance: 0.32, arm: 1.0, elbow: 1.5, leanF: 0.26, bob: 0.08 });
A.kick = t => {   // a shot with the right foot: plant, wind up, strike, follow through
  const T = t % 2.2, p = P(), w = ease(seg(T, 0.2, 0.75)), s = ease(seg(T, 0.75, 0.95)), f = ease(seg(T, 0.95, 1.35)), back = ease(seg(T, 1.5, 2.1));
  const r = p.rLeg, l = p.lLeg;
  r.swing = lerp(lerp(lerp(0, -0.75, w), 1.0, s), 1.45, f); r.swing = lerp(r.swing, 0, back);
  r.bend = lerp(lerp(lerp(0.1, 1.9, w), 0.15, s), 0.35, f); r.bend = lerp(r.bend, 0.1, back);
  r.foot = lerp(0, 0.55, Math.max(w, s) * (1 - back));
  l.swing = lerp(0, 0.15, w) * (1 - back); l.bend = lerp(0.1, 0.35, Math.max(w, s)) * (1 - back) + 0.1 * back;
  p.spine.lean = lerp(lerp(0.05, 0.22, w), -0.12, s); p.spine.lean = lerp(p.spine.lean, lerp(p.spine.lean, 0.05, 1), back);
  p.spine.twist = lerp(lerp(0, 0.35, w), -0.25, s) * (1 - back);
  p.lArm.raise = lerp(0.15, 1.25, Math.max(w, s)) * (1 - back) + 0.15 * back; p.lArm.swing = lerp(0, 0.45, s) * (1 - back);
  p.rArm.raise = lerp(0.15, 0.7, Math.max(w, s)) * (1 - back) + 0.15 * back; p.rArm.swing = lerp(0, -0.5, Math.max(w, s)) * (1 - back);
  p.lArm.bend = p.rArm.bend = 0.4;
  p.neck.lean = lerp(0.1, 0.35, w) * (1 - back);
  return p;
};
A.pass = t => {   // a side-foot pass: the foot turned out, a short swing
  const T = t % 1.8, p = P(), w = ease(seg(T, 0.2, 0.6)), s = ease(seg(T, 0.6, 0.8)), back = ease(seg(T, 1.1, 1.6));
  p.rLeg.swing = lerp(lerp(0, -0.45, w), 0.55, s) * (1 - back); p.rLeg.raise = lerp(0.03, 0.35, Math.max(w, s)) * (1 - back) + 0.03 * back;
  p.rLeg.bend = lerp(lerp(0.1, 0.9, w), 0.2, s) * (1 - back) + 0.1 * back;
  p.lLeg.bend = 0.25; p.spine.lean = 0.12; p.neck.lean = 0.3 * (1 - back);
  p.lArm.raise = lerp(0.15, 0.7, Math.max(w, s)) * (1 - back) + 0.15; p.rArm.raise = 0.35; p.lArm.bend = p.rArm.bend = 0.5;
  return p;
};
A.header = t => {   // crouch, jump, arms up, nod the ball, land
  const T = t % 2, p = P(), c = ease(seg(T, 0.1, 0.45)) * (1 - ease(seg(T, 0.45, 0.6))), up = Math.sin(Math.PI * seg(T, 0.5, 1.25)), nod = Math.sin(Math.PI * seg(T, 0.8, 1.05)), land = ease(seg(T, 1.25, 1.4)) * (1 - ease(seg(T, 1.5, 1.9)));
  p.root.ground = false; p.root.y = up * 0.55 - c * 0.18 - land * 0.12;
  for (const k of ['lLeg', 'rLeg']) { p[k].bend = 0.15 + c * 1.1 + up * 0.5 + land * 0.8; p[k].swing = c * 0.5 + land * 0.4 - up * 0.1; p[k].foot = up * 0.5; }
  p.rLeg.bend += up * 0.4;
  for (const k of ['lArm', 'rArm']) { p[k].swing = up * 1.4 - c * 0.5; p[k].raise = 0.3 + up * 0.6; p[k].bend = 0.6 + up * 0.4; }
  p.spine.lean = c * 0.35 - up * 0.25 + nod * 0.55 + land * 0.2; p.neck.lean = -up * 0.3 + nod * 0.5;
  return p;
};
A.slide = t => {   // a sliding tackle: down on his side, the leading leg out straight
  const T = t % 2.2, p = P(), k = ease(seg(T, 0.15, 0.55)), out = ease(seg(T, 1.5, 2.0));
  const v = k * (1 - out);
  p.root.ground = false; p.root.pitch = -1.2 * v; p.root.y = -0.62 * v; p.root.roll = 0.25 * v;
  p.rLeg.swing = lerp(0, 1.45, v); p.rLeg.bend = 0.05; p.rLeg.foot = 0.3 * v;
  p.lLeg.swing = lerp(0, 0.9, v); p.lLeg.bend = lerp(0.1, 1.9, v); p.lLeg.raise = 0.2 * v;
  p.lArm.swing = -0.6 * v; p.lArm.raise = 0.9 * v; p.lArm.bend = 0.4; p.rArm.raise = 0.6 * v; p.rArm.swing = 0.3 * v; p.rArm.bend = 0.6;
  p.spine.lean = 0.5 * v; p.neck.lean = 0.5 * v;
  return p;
};
A.armsup = t => {   // celebration: jumping on the spot, arms up in a V
  const T = t % 0.9, p = P(), j = Math.max(0, Math.sin(Math.PI * seg(T, 0.15, 0.75)));
  p.root.ground = false; p.root.y = j * 0.32 - (1 - j) * 0.04;
  for (const k of ['lArm', 'rArm']) { p[k].raise = 2.55 + Math.sin(t * 7) * 0.08; p[k].swing = 0.3; p[k].bend = 0.25; }
  for (const k of ['lLeg', 'rLeg']) { p[k].bend = 0.3 + (1 - j) * 0.6 + j * 0.4; p[k].swing = (1 - j) * 0.25 + j * 0.15; p[k].foot = j * 0.5; }
  p.spine.lean = -0.18 + (1 - j) * 0.15; p.neck.lean = -0.35;
  return p;
};
A.kneeslide = t => {   // on his knees, leaning back, arms wide, still sliding
  const T = t % 3, p = P(), k = ease(seg(T, 0.1, 0.5)), out = ease(seg(T, 2.5, 2.95)), v = k * (1 - out);
  p.root.ground = false; p.root.y = -0.48 * v; p.root.pitch = -0.1 * v;
  for (const s of ['lLeg', 'rLeg']) { p[s].swing = 0.15 * v; p[s].bend = 1.95 * v + 0.05; p[s].foot = -0.5 * v; p[s].raise = 0.15 * v; }
  for (const s of ['lArm', 'rArm']) { p[s].raise = lerp(0.15, 1.9, v); p[s].swing = 0.4 * v; p[s].bend = 0.2 + Math.sin(t * 9) * 0.05 * v; }
  p.spine.lean = -0.4 * v; p.neck.lean = -0.45 * v;
  return p;
};
A.aeroplane = t => {   // running with arms out like wings, banking
  const p = gait(t, 0.66, { hip: 0.75, back: 0.5, knee: 1.6, kneeStance: 0.3, arm: 0, elbow: 0, leanF: 0.12, bob: 0.06 });
  const bank = Math.sin(t * 1.4) * 0.35;
  for (const k of ['lArm', 'rArm']) { p[k].raise = 1.5; p[k].swing = -0.1; p[k].bend = 0.08; }
  p.spine.side = bank; p.neck.side = -bank * 0.5;
  return p;
};
A.fistpump = t => {   // feet apart, fist pumping, the other arm pulled down
  const p = P(), k = (Math.sin(t * 8) + 1) / 2;
  p.lLeg.raise = 0.25; p.rLeg.raise = 0.25; p.lLeg.bend = p.rLeg.bend = 0.35;
  p.rArm.raise = 0.6; p.rArm.swing = lerp(0.8, 2.3, k); p.rArm.bend = lerp(1.9, 0.5, k);
  p.lArm.raise = 0.35; p.lArm.swing = -0.3; p.lArm.bend = 1.9;
  p.spine.lean = -0.1; p.spine.twist = 0.2; p.neck.lean = -0.3;
  return p;
};
A.dive = t => {   // a keeper's dive to his right: off the ground, stretched out, arms leading
  const T = t % 2.4, p = P(), go = ease(seg(T, 0.2, 0.6)), fall = ease(seg(T, 0.6, 1.0)), up = ease(seg(T, 1.6, 2.3));
  const v = Math.max(go, fall) * (1 - up);
  p.root.ground = false; p.root.roll = 1.35 * v; p.root.y = lerp(0, 0.35, go) * (1 - fall) - fall * 0.62 * (1 - up); p.root.x = 1.1 * v;
  for (const k of ['lArm', 'rArm']) { p[k].raise = lerp(0.2, 2.8, v); p[k].swing = 0.35 * v; p[k].bend = 0.15; }
  p.lArm.raise = lerp(0.2, 2.5, v);
  p.lLeg.raise = 0.35 * v; p.lLeg.bend = 0.3 + 0.4 * v; p.rLeg.bend = 0.2; p.rLeg.raise = 0.1 * v;
  p.spine.side = 0.2 * v; p.neck.side = 0.3 * v;
  return p;
};
export const ANIMS = [
  ['idle', 'Idle'], ['walk', 'Walk'], ['jog', 'Run'], ['sprint', 'Sprint'], ['kick', 'Shoot'], ['pass', 'Pass'], ['header', 'Header'], ['slide', 'Slide tackle'],
  ['armsup', 'Celebrate: jump'], ['kneeslide', 'Celebrate: knee slide'], ['aeroplane', 'Celebrate: aeroplane'], ['fistpump', 'Celebrate: fist pump'], ['dive', 'Keeper dive'],
];
export const animate = (name, t) => (A[name] || A.idle)(t);

// ---------------------------------------------------------------- dragging joints
// Which angles a dragged joint moves (closest first), so the chain bends the way a body would.
export const HANDLES = {
  pelvis: ['root.x', 'root.y'],
  chest: ['spine.lean', 'spine.side'], head: ['neck.lean', 'neck.side', 'spine.lean'],
  lEl: ['lArm.swing', 'lArm.raise'], rEl: ['rArm.swing', 'rArm.raise'],
  lHand: ['lArm.bend', 'lArm.swing', 'lArm.raise'], rHand: ['rArm.bend', 'rArm.swing', 'rArm.raise'],
  lKn: ['lLeg.swing', 'lLeg.raise'], rKn: ['rLeg.swing', 'rLeg.raise'],
  lAn: ['lLeg.bend', 'lLeg.swing', 'lLeg.raise'], rAn: ['rLeg.bend', 'rLeg.swing', 'rLeg.raise'],
  lToe: ['lLeg.foot'], rToe: ['rLeg.foot'],
};
const getP = (p, path) => { const [a, b] = path.split('.'); return p[a][b]; };
const setP = (p, path, v) => { const [a, b] = path.split('.'); const L = LIMITS[path]; p[a][b] = L ? clamp(v, L[0], L[1]) : v; };
// Move the angles in HANDLES[joint] until the joint is drawn at (sx, sy) (or as near as the limits allow).
export function dragTo(pose, joint, sx, sy, view, dims) {
  if (joint === 'pelvis') {   // move the whole player on the screen plane
    const J = solveSkeleton(pose, dims), q = view.p(J.pelvis), ct = Math.cos(view.theta), st = Math.sin(view.theta);
    const dx = (sx - q[0]) / view.scale, dy = -(sy - q[1]) / view.scale;
    pose.root.x += -ct * dx; pose.root.z += st * dx;
    if (!pose.root.ground) pose.root.y += dy; else if (dy > 0.05) { pose.root.ground = false; pose.root.y += dy; }
    return;
  }
  const params = HANDLES[joint]; if (!params) return;
  const err = () => { const q = view.p(solveSkeleton(pose, dims)[joint]); return Math.hypot(q[0] - sx, q[1] - sy); };
  let e = err(), step = 0.25;
  for (let it = 0; it < 60 && step > 0.002 && e > 0.5; it++) {
    let better = false;
    for (const path of params) {
      const v = getP(pose, path);
      for (const d of [step, -step]) {
        setP(pose, path, v + d); const e2 = err();
        if (e2 < e - 1e-3) { e = e2; better = true; break; }
        setP(pose, path, v);
      }
    }
    if (!better) step /= 2;
  }
}

// ---------------------------------------------------------------- drawing
const rgbOf = c => {   // '#rrggbb' or 'rgb(r,g,b)'
  const m = String(c).match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const n = parseInt(String(c).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const shade = (hex, k) => {   // k < 1 darker, > 1 lighter (towards white)
  const [r, g, b] = rgbOf(hex);
  const f = c => Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
export const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#9a6646', '#6e4630', '#4a2f22'];
export const HAIRS = ['#2b2118', '#1a1410', '#5a3a22', '#a8743c', '#d8b26a', '#0d0d0f'];

// A tapered limb from a to b (screen points), widths wa, wb (px), with round ends.
function limb(c, a, b, wa, wb, fill, opt = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-3, nx = -dy / L, ny = dx / L;
  c.beginPath();
  c.moveTo(a[0] + nx * wa / 2, a[1] + ny * wa / 2); c.lineTo(b[0] + nx * wb / 2, b[1] + ny * wb / 2);
  c.arc(b[0], b[1], wb / 2, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
  c.lineTo(a[0] - nx * wa / 2, a[1] - ny * wa / 2);
  c.arc(a[0], a[1], wa / 2, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) + Math.PI, true);
  c.closePath();
  if (opt.grad) {   // round shading across the limb
    const g = c.createLinearGradient(a[0] + nx * wa / 2, a[1] + ny * wa / 2, a[0] - nx * wa / 2, a[1] - ny * wa / 2);
    g.addColorStop(0, shade(fill, 1.18)); g.addColorStop(0.45, fill); g.addColorStop(1, shade(fill, 0.62));
    c.fillStyle = g;
  } else c.fillStyle = fill;
  c.fill();
  if (opt.line) { c.lineWidth = opt.line; c.strokeStyle = opt.lineCol || '#111'; c.stroke(); }
}

// The shirt: the kit texture seen at his turn, cut to the torso's shape and laid along the spine.
const kitCanvas = document.createElement('canvas');
function shirt(c, kit, print, view, J, pose, shape, opt) {
  const ne = view.p(J.neck), pe = view.p(J.pelvis), ls = view.p(J.lSh), rs = view.p(J.rSh), lh = view.p(J.lHip), rh = view.p(J.rHip);
  const turn = view.theta + pose.spine.twist * 0.8;
  const ang = Math.atan2(ne[0] - pe[0], -(ne[1] - pe[1]));   // spine's lean on screen
  const len = Math.hypot(ne[0] - pe[0], ne[1] - pe[1]);
  // how wide the chest looks from here: a flattened oval (40 cm across, 24 deep)
  const s = view.scale, wide = Math.sqrt((0.46 * Math.cos(turn)) ** 2 + (0.27 * Math.sin(turn)) ** 2) * s * shape.chest;
  const waist = wide * shape.waist, top = len * shape.top, bot = len * shape.bottom;
  const w = Math.ceil(wide * 1.1), h = Math.ceil(top + bot);
  if (w < 2 || h < 2) return;
  kitCanvas.width = w; kitCanvas.height = h;
  const k = kitCanvas.getContext('2d');
  // the texture's collar (v 0.04) to hem (v 0.97) over the shirt, as drawKitFront lays the whole texture over its box
  const vh = h / 0.93, vy = -0.04 * vh;
  drawKitFront(k, kit.design, kit.imgs, 0, vy, w, vh, turn);
  if (print) drawPrint(k, print, 0, vy, w, vh, turn);
  if (opt.shadeShirt) {   // round shading: lit from the upper left
    const g = k.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
    k.fillStyle = g; k.globalCompositeOperation = 'source-atop'; k.fillRect(0, 0, w, h); k.globalCompositeOperation = 'source-over';
  }
  c.save();
  c.translate(ne[0], ne[1]); c.rotate(ang);
  c.beginPath(); shape.path(c, wide, waist, top, bot);
  c.save(); c.clip();
  c.drawImage(kitCanvas, -w / 2, -top * 0.04, w, h);
  c.restore();
  if (opt.line) { c.lineWidth = opt.line; c.strokeStyle = opt.lineCol || '#111'; c.stroke(); }
  c.restore();
  return { ang, wide, waist, len };
}

// Torso shapes, drawn from the neck (0, 0) down the spine (+y), in px.
const SHAPES = {
  capsule: { chest: 1.0, waist: 1.0, top: 0.0, bottom: 1.12, path: (c, w, wa, t, b) => c.roundRect(-w / 2, -t, w, t + b, w / 2) },
  athletic: { chest: 1.05, waist: 0.74, top: 0.0, bottom: 1.06, path: (c, w, wa, t, b) => {
    c.moveTo(-w * 0.18, -w * 0.02); c.quadraticCurveTo(-w * 0.5, -w * 0.02, -w * 0.52, b * 0.16);
    c.quadraticCurveTo(-w * 0.44, b * 0.55, -wa / 2, b * 0.98); c.lineTo(wa / 2, b * 0.98);
    c.quadraticCurveTo(w * 0.44, b * 0.55, w * 0.52, b * 0.16); c.quadraticCurveTo(w * 0.5, -w * 0.02, w * 0.18, -w * 0.02); c.closePath();
  } },
  chunky: { chest: 0.98, waist: 0.78, top: 0.02, bottom: 1.05, path: (c, w, wa, t, b) => {   // rounded shoulders, tapering a little to the waist
    const r = w * 0.3, rb = wa * 0.16;
    c.moveTo(-w / 2 + r, -t); c.lineTo(w / 2 - r, -t); c.quadraticCurveTo(w / 2, -t, w / 2, -t + r);
    c.lineTo(wa / 2, b - rb); c.quadraticCurveTo(wa / 2, b, wa / 2 - rb, b); c.lineTo(-wa / 2 + rb, b); c.quadraticCurveTo(-wa / 2, b, -wa / 2, b - rb);
    c.lineTo(-w / 2, -t + r); c.quadraticCurveTo(-w / 2, -t, -w / 2 + r, -t); c.closePath();
  } },
};

// The four designs: proportions (dims), limb widths (metres), and how they're drawn.
export const DESIGNS = [
  { key: 'classic', name: 'Classic+', note: 'Today’s rounded body, kept, with simple arms and legs added. The smallest change.',
    dims: { head: 0.125, upper: 0.27, fore: 0.24, thigh: 0.43, shin: 0.42, shoulderW: 0.19 }, shape: SHAPES.capsule,
    w: { upper: [0.11, 0.09], fore: [0.085, 0.07], thigh: [0.15, 0.12], shin: [0.11, 0.08], neck: 0 }, face: 'dots', grad: false, shadeShirt: false },
  { key: 'athletic', name: 'Athletic', note: 'Real proportions: broad shoulders, a narrow waist, tapered limbs, a neck, hands and boots. Flat colour.',
    dims: {}, shape: SHAPES.athletic,
    w: { upper: [0.115, 0.085], fore: [0.085, 0.062], thigh: [0.17, 0.11], shin: [0.115, 0.075], neck: 0.1 }, face: 'simple', grad: false, shadeShirt: false, depthTint: true },
  { key: 'broadcast', name: 'Broadcast', note: 'The athletic build with light and shade, as a TV camera sees it: round limbs, a lit shirt, ears, varied skin and hair.',
    dims: { head: 0.112 }, shape: SHAPES.athletic,
    w: { upper: [0.12, 0.088], fore: [0.088, 0.064], thigh: [0.175, 0.112], shin: [0.118, 0.076], neck: 0.105 }, face: 'shaded', grad: true, shadeShirt: true, depthTint: true, rim: true },
  { key: 'bold', name: 'Bold', note: 'A stylised look: big head, strong body, thick limbs and an outline. Reads clearly when players are small on screen.',
    dims: { head: 0.158, spine: 0.44, upper: 0.25, fore: 0.22, thigh: 0.39, shin: 0.37, shoulderW: 0.185, hipW: 0.09, hip: 0.87 }, shape: SHAPES.chunky,
    w: { upper: [0.112, 0.092], fore: [0.092, 0.078], thigh: [0.15, 0.118], shin: [0.115, 0.095], neck: 0.072 }, face: 'big', grad: false, shadeShirt: false, line: 0.018 },
];

// Kit colours for the parts the texture doesn't cover: sleeves (the shirt's main colour), shorts and socks (picked on the page).
export function partColours(design, shortsPick = 'third', socksPick = 'main') {
  const d = cleanDesign(design), [main, second, third] = d.colours;
  const pick = k => ({ main, second, third }[k] || main);
  return { sleeve: main, cuff: second, shorts: pick(shortsPick), socks: pick(socksPick), band: second, boots: '#15171c' };
}

// Draw one player. kit = { design, imgs }, look = { skin, hair, print, shorts, socks }.
export function drawPlayer(c, design, pose, view, kit, look, { nodes = false, hover = null } = {}) {
  const J = solveSkeleton(pose, design.dims), s = view.scale, q = k => view.p(J[k]);
  const col = partColours(kit.design, look.shorts, look.socks);
  const W = design.w, L = design.line ? design.line * s : 0, lineCol = '#0e0f12';
  const O = { grad: design.grad, line: L, lineCol };
  // shadow on the grass
  const g0 = view.p([J.pelvis[0], 0, J.pelvis[2]]), lift = Math.max(0, J.pelvis[1] - J.dims.hip);
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(g0[0], g0[1], s * 0.38 / (1 + lift), s * 0.11 / (1 + lift), 0, 0, TAU); c.fill();
  // parts, far to near
  const parts = [];
  const dep = (...k) => k.reduce((a, x) => a + q(x)[2], 0) / k.length;
  // Each arm and each leg is one piece: with an outline, every shape of it is drawn first as a dark silhouette a little bigger, then filled, so the outline
  // runs round the whole limb with no seams at the elbow, knee or sleeve.
  const piece = shapes => () => {
    if (L) for (const [a, b, wa, wb] of shapes) limb(c, a, b, wa + 2 * L, wb + 2 * L, lineCol);
    for (const [a, b, wa, wb, fill] of shapes) limb(c, a, b, wa, wb, fill, { grad: design.grad });
  };
  const at = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  for (const sd of ['l', 'r']) {
    const tint = c => (design.depthTint && q(sd + 'Sh')[2] < q(sd === 'l' ? 'rSh' : 'lSh')[2] - 0.05 ? shade(c, 0.82) : c);
    const hip = q(sd + 'Hip'), kn = q(sd + 'Kn'), an = q(sd + 'An'), sh = q(sd + 'Sh'), el = q(sd + 'El'), wr = q(sd + 'Wr'), hand = q(sd + 'Hand');
    const sockTop = at(kn, an, 0.18);
    const leg = [
      [hip, kn, W.thigh[0] * s, W.thigh[1] * s, tint(look.skin)],
      [kn, sockTop, W.shin[0] * s, W.shin[0] * s * 0.95, tint(look.skin)],
      [sockTop, an, W.shin[0] * s * 0.98, W.shin[1] * s, tint(col.socks)],
      [q(sd + 'Heel'), q(sd + 'Toe'), W.shin[1] * s * 1.15, W.shin[1] * s * 0.9, tint(col.boots)],
      [hip, at(hip, kn, 0.42), W.thigh[0] * s * 1.12, W.thigh[0] * s * 1.05, tint(col.shorts)],
    ];
    if (!L) leg.splice(3, 0, [sockTop, at(sockTop, an, 0.12), W.shin[0] * s, W.shin[0] * s * 0.95, tint(col.band)]);
    const arm = [
      [sh, el, W.upper[0] * s, W.upper[1] * s, tint(look.skin)],
      [el, wr, W.fore[0] * s, W.fore[1] * s, tint(look.skin)],
      [wr, hand, W.fore[1] * s * 1.15, W.fore[1] * s * 1.25, tint(shade(look.skin, 0.96))],
      [sh, at(sh, el, 0.48), W.upper[0] * s * 1.06, W.upper[0] * s, tint(col.sleeve)],   // a short sleeve, just wider than the arm
    ];
    if (L) { parts.push({ d: dep(sd + 'Hip', sd + 'Kn', sd + 'An') - 0.06, f: piece(leg) }); parts.push({ d: dep(sd + 'Sh', sd + 'El', sd + 'Wr') + 0.02, f: piece(arm) }); }
    else {   // without an outline, the upper and lower halves sort separately (a forearm across the body, an upper arm behind it)
      parts.push({ d: dep(sd + 'Hip', sd + 'Kn') - 0.06, f: piece([leg[0], leg[leg.length - 1]]) });
      parts.push({ d: dep(sd + 'Kn', sd + 'An') - 0.06, f: piece(leg.slice(1, leg.length - 1)) });
      parts.push({ d: dep(sd + 'Sh', sd + 'El') + 0.02, f: piece([arm[0], arm[3]]) });
      parts.push({ d: dep(sd + 'El', sd + 'Wr') + 0.03, f: piece([arm[1], arm[2]]) });
    }
  }
  parts.push({ d: dep('pelvis', 'chest'), f: () => {
    // shorts round the hips, then the shirt
    const lh = q('lHip'), rh = q('rHip'), pe = q('pelvis');
    limb(c, lh, rh, W.thigh[0] * s * 1.3, W.thigh[0] * s * 1.3, col.shorts, O);
    shirt(c, kit, look.print, view, J, pose, design.shape, { shadeShirt: design.shadeShirt, line: L, lineCol });
  } });
  // The head (and neck) go on top of the shirt, unless he's bent over with his back to us and the head is really behind him.
  const hd = dep('head'), cd = dep('chest');
  parts.push({ d: hd < cd - 0.12 ? hd : Math.max(hd, cd) + 0.05, f: () => {
    if (W.neck) {   // from just above the collar to under the chin, so it never shows through the shirt or the face
      const n = q('neck'), h = q('head'), a = [lerp(n[0], h[0], 0.2), lerp(n[1], h[1], 0.2)], b = [lerp(n[0], h[0], 0.55), lerp(n[1], h[1], 0.55)];
      limb(c, a, b, W.neck * s, W.neck * s, shade(look.skin, 0.9), O);
    }
    head(c, design, q('head'), J.dims.head * s, view, pose, look, L);
  } });
  parts.sort((a, b) => a.d - b.d);
  for (const p of parts) p.f();
  if (nodes) for (const k of Object.keys(HANDLES)) {
    const p = q(k), on = hover === k;
    c.beginPath(); c.arc(p[0], p[1], on ? 9 : 6, 0, TAU);
    c.fillStyle = on ? '#64b5f6' : 'rgba(255,255,255,0.9)'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#0d47a1'; c.stroke();
  }
  return J;
}

function head(c, design, p, R, view, pose, look, L) {
  const turn = view.theta + pose.spine.twist + pose.neck.turn, cs = Math.cos(turn), sn = Math.sin(turn);
  const [x, y] = p;
  // neck shadow under the chin
  if (design.face === 'shaded') { const g = c.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R * 1.05); g.addColorStop(0, shade(look.skin, 1.12)); g.addColorStop(0.7, look.skin); g.addColorStop(1, shade(look.skin, 0.7)); c.fillStyle = g; }
  else c.fillStyle = look.skin;
  // ears (side on and front)
  if (design.face === 'shaded' || design.face === 'simple') for (const sd of [-1, 1]) { const k = Math.sin(turn + sd * Math.PI / 2); if (k > -0.3) { c.beginPath(); c.ellipse(x - sd * R * 0.98 * Math.cos(turn) * 1, y + R * 0.08, R * 0.16, R * 0.24, 0, 0, TAU); c.fill(); } }
  c.beginPath(); c.ellipse(x, y, R * (design.face === 'big' ? 1.05 : 0.92), R, 0, 0, TAU); c.fill();
  if (L) { c.lineWidth = L; c.strokeStyle = '#0e0f12'; c.stroke(); }
  // hair: a cap over the top, falling over the back of the head as he turns away
  c.save(); c.beginPath(); c.ellipse(x, y, R * (design.face === 'big' ? 1.05 : 0.92), R, 0, 0, TAU); c.clip();
  const back = clamp((-cs + 0.15) / 0.75, 0, 1);
  c.fillStyle = look.hair;
  c.beginPath(); c.ellipse(x + sn * R * 0.1, y - R * 0.55 + back * R * 0.55, R * 1.2, R * (0.62 + back * 0.6), 0, 0, TAU); c.fill();
  if (design.face === 'shaded') { const g = c.createLinearGradient(x, y - R, x, y + R); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.18)'); c.fillStyle = g; c.fillRect(x - R, y - R, 2 * R, 2 * R); }
  c.restore();
  if (cs < -0.15) return;
  // the face, slid round with his turn
  const fx = x - sn * R * 0.55, eyeY = y + R * (design.face === 'big' ? 0.12 : 0.05), k = Math.max(0.2, cs);
  c.fillStyle = '#16161a';
  const er = design.face === 'big' ? R * 0.15 : design.face === 'dots' ? R * 0.11 : R * 0.09;
  for (const sd of [-1, 1]) {
    const ex = fx + sd * R * 0.36 * k;
    if (design.face === 'big') { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(ex, eyeY, er * 1.2 * k, er * 1.35, 0, 0, TAU); c.fill(); c.fillStyle = '#16161a'; c.beginPath(); c.ellipse(ex - sn * er * 0.3, eyeY + er * 0.15, er * 0.7 * k, er * 0.85, 0, 0, TAU); c.fill(); }
    else { c.beginPath(); c.ellipse(ex, eyeY, er * k, er * 1.2, 0, 0, TAU); c.fill(); }
    if (design.face === 'shaded' || design.face === 'simple') { c.strokeStyle = shade(look.hair, 0.9); c.lineWidth = Math.max(1, R * 0.07); c.beginPath(); c.moveTo(ex - R * 0.14 * k, eyeY - R * 0.22); c.lineTo(ex + R * 0.14 * k, eyeY - R * 0.25); c.stroke(); }
  }
  if (design.face !== 'dots') { c.strokeStyle = design.face === 'big' ? '#5b2a22' : '#7a4a3a'; c.lineWidth = Math.max(1, R * 0.07); c.beginPath(); c.arc(fx, y + R * 0.38, R * 0.24 * k, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
  if (design.face === 'shaded') { c.fillStyle = shade(look.skin, 0.82); c.beginPath(); c.ellipse(fx - sn * R * 0.1, y + R * 0.22, R * 0.08 * k, R * 0.1, 0, 0, TAU); c.fill(); }
}
