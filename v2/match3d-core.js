// V2: the 3D match as a renderer that a page drives. match3d.html (the test page) and the match page's player (js/viewer/player.js) both use it:
//   const m3 = await createMatch3D({ data, parent });   // data: the match file; parent: an element the canvas fills
//   m3.frame(t, dtReal, speed) -> the shot ({ kind, label, sceneT, ... }) drawn for match time t; m3.reset() after a seek; m3.destroy().
// Players are Mixamo's footballer with motion-captured moves (v2/blender/build_mixamo.py), animated from the match file alone; the camera is
// the TV director (v2/director.js). Options: params (URLSearchParams for the test views: q, demo, close, cam, shapes, v, tune), safeBottom(w, h)
// (pixels at the bottom covered by controls, kept clear of the picture's subject).
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import * as SkeletonUtils from './vendor/utils/SkeletonUtils.js';
import { makeDirector } from './director.js';

export async function createMatch3D({ data, parent, params = new URLSearchParams(), safeBottom = null }) {
const q = params;
const FR = data.frames, SC = FR.scale, ROWS = FR.data;
const NH = data.teams.home.lineup.length, NP = NH + data.teams.away.lineup.length;
const players = [...data.teams.home.lineup.map(p => ({ ...p, side: 0 })), ...data.teams.away.lineup.map(p => ({ ...p, side: 1 }))];
const T0 = ROWS[0][0] / 10, T1 = ROWS[ROWS.length - 1][0] / 10;
const W = (x, y) => [x - 52.5, y - 34];   // match metres (top-left origin) -> scene X, Z

// ---------- renderer, scene, camera ----------
// V2-5: two quality levels. 'low' (phones and tablets: a touch screen, or ?q=low) has no shadow maps (soft blobs under the players and ball
// instead), no antialiasing (the screen's density hides the edges), at most 1.5 pixels per CSS pixel, and the players' animation worked out at
// half rate in the wide shot. 'high' (desktop, or ?q=high) keeps everything.
const LOW = q.get('q') ? q.get('q') === 'low' : matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
let pr = Math.min(devicePixelRatio, LOW ? 1.5 : 2);
renderer.setPixelRatio(pr);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
parent.append(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1630, 140, 320);
const cam = new THREE.PerspectiveCamera(26, 16 / 9, 1, 600);
// On phones the control bar covers the bottom of the screen, so every shot is framed for the picture above it (SAFE px): the camera's
// picture is the screen less that strip, and the strip shows a little more of what's below.
let SAFE = 0;
function resize() {
  const w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight); SAFE = safeBottom ? safeBottom(w, h) : 0;
  renderer.setSize(w, h, false);
  cam.aspect = w / (h - SAFE);
  if (SAFE) cam.setViewOffset(w, h - SAFE, 0, 0, w, h); else cam.clearViewOffset();
  cam.updateProjectionMatrix();
}
const ro = new ResizeObserver(() => resize()); ro.observe(parent); resize();

// sky: a night gradient
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#050a18'); gr.addColorStop(0.55, '#0e2148'); gr.addColorStop(1, '#1c3566');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}

// lights: floodlit night
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1d3a1d, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
sun.position.set(-30, 70, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 45, bottom: -45, near: 10, far: 200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xb8ccff, 0.6); fill.position.set(40, 50, -40); scene.add(fill);

// ---------- pitch ----------
function pitchTexture() {
  const P = 20, M = 6, c = document.createElement('canvas');   // 20 px a metre, 6 m of grass around the lines
  c.width = (105 + 2 * M) * P; c.height = (68 + 2 * M) * P;
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? '#2e6b2f' : '#377a36'; g.fillRect(i * c.width / 18, 0, c.width / 18 + 1, c.height); }
  // a little grain so it reads as grass
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6; }
  g.putImageData(img, 0, 0);
  g.translate(M * P, M * P); g.scale(P, P);
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 0.12; g.fillStyle = 'rgba(255,255,255,.92)';
  g.strokeRect(0, 0, 105, 68);
  g.beginPath(); g.moveTo(52.5, 0); g.lineTo(52.5, 68); g.stroke();
  g.beginPath(); g.arc(52.5, 34, 9.15, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(52.5, 34, 0.11, 0, Math.PI * 2); g.fill();
  for (const r of [false, true]) {
    const x0 = r ? 105 : 0, s = r ? -1 : 1;
    g.strokeRect(r ? 105 - 16.5 : 0, 34 - 20.16, 16.5, 40.32);
    g.strokeRect(r ? 105 - 5.5 : 0, 34 - 9.16, 5.5, 18.32);
    g.beginPath(); g.arc(x0 + s * 11, 34, 0.11, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x0 + s * 11, 34, 9.15, r ? Math.PI - 0.927 : -0.927, r ? Math.PI + 0.927 : 0.927); g.stroke();
    for (const y of [0, 68]) { g.beginPath(); g.arc(x0, y, 1, 0, Math.PI * 2); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { t, w: 105 + 2 * M, h: 68 + 2 * M };
}
{
  const { t, w, h } = pitchTexture();
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), new THREE.MeshLambertMaterial({ color: 0x245e28 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true; scene.add(apron);
}

// goals: posts, bar and a net
function goal(side) {
  const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 12);
  for (const z of [-3.66, 3.66]) { const m = new THREE.Mesh(post, white); m.position.set(0, 1.22, z); m.castShadow = true; g.add(m); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.44, 12), white); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; bar.castShadow = true; g.add(bar);
  const pts = [], D = 2.0;
  for (let z = -3.66; z <= 3.661; z += 0.25) pts.push(0, 2.44, z, -D, 2.0, z, -D, 2.0, z, -D, 0, z);
  for (let y = 0; y <= 2.44; y += 0.25) { const yb = Math.min(y, 2.0); pts.push(-D, yb, -3.66, -D, yb, 3.66, 0, y, -3.66, -D, yb, -3.66, 0, y, 3.66, -D, yb, 3.66); }
  for (let x = 0; x >= -D; x -= 0.25) pts.push(x, 2.44 + x * 0.22, -3.66, x, 2.44 + x * 0.22, 3.66);
  const net = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
  g.add(net);
  g.position.x = side ? 52.5 : -52.5; if (side) g.rotation.y = Math.PI;
  scene.add(g);
}
goal(0); goal(1);

// ---------- stadium: boards, stands, crowd, floodlights ----------
function boardTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64; const g = c.getContext('2d');
  const words = ['vLEAGUE', 'VIRTUAL FOOTBALL'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#0d2a66' : '#1e88e5'; g.fillRect(i * 256, 0, 256, 64);
    g.fillStyle = '#fff'; g.font = '900 30px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(words[i % 2], i * 256 + 128, 34);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function crowdTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#141c2e'; g.fillRect(0, 0, 1024, 256);
  const cols = ['#e8e8e8', '#1e88e5', '#ff6b9a', '#f4c542', '#2bb3a3', '#9aa7bd', '#c0392b', '#ffffff', '#273b5e'];
  for (let y = 4; y < 256; y += 8) for (let x = 2; x < 1024; x += 5) {
    if (Math.random() < 0.12) continue;
    g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(x + Math.random() * 1.5, y, 3, 4);
    g.fillStyle = '#e0b48f'; g.fillRect(x + 0.5, y - 2.5, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
{
  const bt = boardTexture(), crowd = crowdTexture();
  const boardMat = new THREE.MeshBasicMaterial({ map: bt });
  const boards = [[0, 39.5, 110, 0], [0, -39.5, 110, Math.PI], [-58.5, 0, 76, Math.PI / 2], [58.5, 0, 76, -Math.PI / 2]];
  for (const [x, z, len, ry] of boards) {
    const tex = bt.clone(); tex.repeat.set(len / 30, 1); tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, 0.45, z); m.rotation.y = ry + Math.PI; scene.add(m);
  }
  // three stands rising away from the pitch (none behind the camera, so it never blocks the view)
  const standMat = (rx, ry) => { const t = crowd.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return new THREE.MeshLambertMaterial({ map: t }); };
  const stand = (len, depth, rise, x, z, ry) => {
    const g = new THREE.Group();
    const tier = new THREE.Mesh(new THREE.PlaneGeometry(len, Math.hypot(depth, rise)), standMat(len / 25, 3));
    // the tier lies along the slope: a plane stands upright, so it turns back by 90 degrees less the slope; its front edge meets the ground at the
    // stand's front (it used to stand at 56 degrees with its front edge under the ground, leaving bare ground behind the boards)
    tier.rotation.x = -(Math.PI / 2 - Math.atan2(rise, depth)); tier.position.set(0, rise / 2 + 0.4, -depth / 2); g.add(tier);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, rise + 6, 1), new THREE.MeshLambertMaterial({ color: 0x1a2438 })); back.position.set(0, (rise + 6) / 2, -depth - 0.5); g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.6, depth * 0.8), new THREE.MeshLambertMaterial({ color: 0x2a3550 })); roof.position.set(0, rise + 6, -depth * 0.55); g.add(roof);
    g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  };
  stand(130, 24, 16, 0, -40, 0);   // fronts just behind the boards (39.5 and 58.5 m out)
  stand(84, 20, 13, -59, 0, Math.PI / 2);
  stand(84, 20, 13, 59, 0, -Math.PI / 2);
  // floodlight towers with glowing heads
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const [x, z] of [[-70, -50], [70, -50], [-70, 52], [70, 52]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 42, 8), new THREE.MeshLambertMaterial({ color: 0x3a4357 })); pole.position.set(x, 21, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 0.6), glow); head.position.set(x * 0.97, 43, z * 0.97); head.lookAt(0, 0, 0); scene.add(head);
  }
}

// ---------- players: a jointed figure built from shapes, in the club's kit ----------
const hex = c => new THREE.Color(/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888');
function kitColours(side) {
  const team = side ? data.teams.away : data.teams.home, shirt = hex(team.colour);
  const lum = 0.299 * shirt.r + 0.587 * shirt.g + 0.114 * shirt.b;
  const shorts = lum > 0.55 ? new THREE.Color(0x1b2233) : new THREE.Color(0xf2f2f2);
  return { shirt, shorts, socks: shirt.clone() };
}
const GK_KITS = [{ shirt: new THREE.Color(0xd8e83a), shorts: new THREE.Color(0x1b2233), socks: new THREE.Color(0xd8e83a) }, { shirt: new THREE.Color(0xff8a2a), shorts: new THREE.Color(0x1b2233), socks: new THREE.Color(0xff8a2a) }];
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
const SKINS = [0xf1c7a5, 0xe0ac86, 0xc68a63, 0x8d5a3b, 0x5e3a24].map(c => mat(c));
const HAIR = [0x2a1d14, 0x4a3220, 0x111111, 0x8a5a2b, 0xc9a26a].map(c => mat(c));
const BOOT = mat(0x15161a);
const GEO = {
  torso: new THREE.CapsuleGeometry(0.17, 0.34, 4, 10),
  head: new THREE.SphereGeometry(0.115, 14, 12),
  hair: new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  upper: new THREE.CapsuleGeometry(0.058, 0.2, 3, 8),
  fore: new THREE.CapsuleGeometry(0.047, 0.2, 3, 8),
  shorts: new THREE.CylinderGeometry(0.18, 0.2, 0.26, 12),
  thigh: new THREE.CapsuleGeometry(0.075, 0.3, 3, 8),
  shin: new THREE.CapsuleGeometry(0.062, 0.3, 3, 8),
  boot: new THREE.BoxGeometry(0.1, 0.08, 0.26),
};
const hash = s => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
function mesh(geo, m, y = 0) { const x = new THREE.Mesh(geo, m); x.position.y = y; x.castShadow = true; return x; }
function figure(p) {
  const kit = p.slot === 'GK' ? GK_KITS[p.side] : kitColours(p.side), h = hash(p.id);
  const M = { shirt: mat(kit.shirt), shorts: mat(kit.shorts), socks: mat(kit.socks) }, skin = SKINS[h % 5], hair = HAIR[(h >> 3) % 5];
  const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.98; root.add(hips);
  const scale = 0.94 + ((h >> 6) % 12) / 100; root.scale.setScalar(scale);
  hips.add(mesh(GEO.shorts, M.shorts, -0.02));
  const chest = new THREE.Group(); hips.add(chest);
  const torso = mesh(GEO.torso, M.shirt, 0.36); torso.scale.set(1.18, 1, 0.72); chest.add(torso);
  const neck = new THREE.Group(); neck.position.y = 0.74; chest.add(neck);
  neck.add(mesh(GEO.head, skin, 0.08)); neck.add(mesh(GEO.hair, hair, 0.1));
  const arm = s => {
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.6, 0); chest.add(sh);
    sh.add(mesh(GEO.upper, M.shirt, -0.13));
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el); el.add(mesh(GEO.fore, p.slot === 'GK' ? M.shirt : skin, -0.12));
    return { sh, el };
  };
  const leg = s => {
    const hp = new THREE.Group(); hp.position.set(s * 0.1, -0.08, 0); hips.add(hp);
    hp.add(mesh(GEO.thigh, skin, -0.2));
    const kn = new THREE.Group(); kn.position.y = -0.42; hp.add(kn);
    kn.add(mesh(GEO.shin, M.socks, -0.19));
    const b = mesh(GEO.boot, BOOT, -0.4); b.position.z = 0.05; kn.add(b);
    return { hp, kn };
  };
  const L = { root, hips, chest, neck, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), phase: (h % 100) / 16, yaw: p.side ? -Math.PI / 2 : Math.PI / 2, last: null };
  scene.add(root);
  return L;
}
// V2-2: the footballer model made in Blender (v2/blender/build_player.py): one file, a copy per player, kit colours per region.
const model = q.has('shapes') ? null : await new GLTFLoader().loadAsync(new URL('./models/player.glb', import.meta.url).href).catch(e => { console.warn('model', e); return null; });
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperarm.L', 'upperarm.R', 'forearm.L', 'forearm.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R'];
const sideMat = new Map();
function kitMat(side, gk, part) {   // shared by the players of one side (and its keeper), so a squad is a handful of materials
  const key = `${side}${gk ? 'g' : ''}${part}`;
  if (!sideMat.has(key)) { const kit = gk ? GK_KITS[side] : kitColours(side); sideMat.set(key, new THREE.MeshStandardMaterial({ color: kit[part], roughness: part === 'shirt' ? 0.65 : 0.8 })); }
  return sideMat.get(key);
}
function modelFigure(p) {
  const h = hash(p.id), gk = p.slot === 'GK';
  const root = new THREE.Group(), body = SkeletonUtils.clone(model.scene);
  root.add(body);
  const skin = SKINS[h % 5], hair = HAIR[(h >> 3) % 5];
  body.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const n = o.material.name;
    o.material = n === 'skin' ? skin : n === 'hair' ? hair : n === 'boots' ? BOOT : kitMat(p.side, gk, n);
  });
  const B = {}; body.updateMatrixWorld(true);
  // each joint keeps its rest turn and its rest frame in the body's own axes (X left-right, Y up, Z forward), so a turn can be given in body axes
  body.traverse(o => { const n = BONES.find(b => b.replace('.', '') === o.name.replace('.', '')); if (o.isBone && n) { const w = o.getWorldQuaternion(new THREE.Quaternion()); B[n] = { b: o, rest: o.quaternion.clone(), w, wi: w.clone().invert() }; } });   // the loader drops the dot from 'thigh.L'
  root.scale.setScalar(0.94 + ((h >> 6) % 12) / 100);
  scene.add(root);
  return { root, B, model: true, phase: (h % 100) / 16, yaw: p.side ? -Math.PI / 2 : Math.PI / 2, last: null };
}
// V2-2 (Mixamo): the footballer with motion-captured movement (v2/blender/build_mixamo.py). Default; ?v=blender or ?shapes for the earlier ones.
const mocap = q.get('v') === 'blender' || q.has('shapes') ? null : await new GLTFLoader().loadAsync(new URL('./models/footballer.glb', import.meta.url).href).catch(e => { console.warn('footballer', e); return null; });
const CLIP = {};
if (mocap) {
  for (const c of mocap.animations) {
    // the runs are in place already; one-off moves keep their rise and fall but not their travel, since the match file says where he is
    for (const tr of c.tracks) if (/Hips\.position$/.test(tr.name)) { const v = tr.values; for (let k = 0; k < v.length; k += 3) { v[k] = v[0]; v[k + 2] = v[2]; } }
    CLIP[c.name] = c;
  }
}
// the speed (m/s) each run is drawn at, so the clip is sped up or slowed to his real pace and his feet don't slide
const GAIT = { idle: 0, walk: 1.4, jog: 3.4, run: 5.6, sprint: 7.6 };
const SIDE = { jog_back: 2.6, run_back: 4.2, jog_left: 2.8, jog_right: 2.8 };
let MOCAP_H = 1.8;
if (mocap) { const bb = new THREE.Box3().setFromObject(mocap.scene); MOCAP_H = bb.max.y - bb.min.y; }
// when in each kick, header or dive the touch happens: the moment the foot (or head) moves fastest
const CONTACT = {};
if (mocap) {
  const probe = SkeletonUtils.clone(mocap.scene), mx = new THREE.AnimationMixer(probe), wp = new THREE.Vector3();
  const bone = n => { let b = null; probe.traverse(o => { if (o.isBone && o.name.endsWith(n)) b = o; }); return b; };
  const RF = bone('RightFoot'), LF = bone('LeftFoot'), HD = bone('Head');
  for (const n of ['pass', 'shot', 'shot_run', 'chip', 'header', 'header_jump', 'tackle', 'tackle2', 'gk_dive', 'gk_dive2', 'gk_catch', 'gk_catch2', 'gk_drop_kick', 'gk_throw', 'throw_in', 'bicycle', 'receive']) {
    const c = CLIP[n]; if (!c) continue;
    const a = mx.clipAction(c); a.play(); let best = 0, at = c.duration / 2;
    const parts = /header|gk_|throw/.test(n) ? [HD] : [RF, LF];
    for (const B of parts) {
      let prev = null;
      for (let tt = 0; tt <= c.duration; tt += 1 / 30) {
        a.time = tt; mx.update(0); probe.updateMatrixWorld(true); B.getWorldPosition(wp);
        if (prev) { const v = wp.distanceTo(prev) * 30; if (v > best) { best = v; at = tt; } }
        prev = wp.clone();
      }
    }
    a.stop(); CONTACT[n] = at;
  }
}
const ONE = { header: 'header', throw: 'throw_in', dive: 'gk_dive', tackle: 'tackle', celebrate: 'celebrate' };
function oneShot(act, sp) {   // which clip plays for an action
  if (act.kind === 'kick') {
    if (['shot', 'clearance', 'penalty', 'goal_kick'].includes(act.ev)) return sp > 2.5 && CLIP.shot_run ? 'shot_run' : 'shot';
    if (act.high && CLIP.chip) return 'chip';
    return 'pass';
  }
  if (act.kind === 'dive') return CLIP.gk_dive ? 'gk_dive' : null;
  return CLIP[ONE[act.kind]] ? ONE[act.kind] : null;
}
function mocapFigure(p) {
  const h = hash(p.id), gk = p.slot === 'GK';
  const root = new THREE.Group(), body = SkeletonUtils.clone(mocap.scene);
  root.add(body);
  body.scale.multiplyScalar(1.8 / MOCAP_H * (0.95 + ((h >> 6) % 10) / 100));
  const skinTone = SKINS[h % 5].color, hairTone = HAIR[(h >> 3) % 5].color;
  const kit = gk ? GK_KITS[p.side] : kitColours(p.side);
  body.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const n = o.material.name, m = o.material.clone();
    // the textures are grey: the colour here is the kit (or skin, or hair); the lift brings the grey back to full strength
    const col = n === 'skin' ? skinTone : n === 'hair' ? hairTone : n === 'boots' ? new THREE.Color(0x222222) : kit[n] || new THREE.Color(0xffffff);
    m.color = col.clone().multiplyScalar(n === 'hair' ? 1.2 : 1.5);
    if (n === 'hair') { m.alphaTest = 0.4; m.transparent = false; }
    m.roughness = n === 'shirt' ? 0.7 : 0.85; m.metalness = 0;
    o.material = m;
  });
  let hipsBone = null; body.traverse(o => { if (o.isBone && !hipsBone && /Hips$/.test(o.name)) hipsBone = o; });
  const mixer = new THREE.AnimationMixer(body), A = {};
  for (const n of [...Object.keys(GAIT), ...Object.keys(SIDE), 'gk_idle']) if (CLIP[n]) { const a = mixer.clipAction(CLIP[n]); a.play(); a.setEffectiveWeight(0); A[n] = a; }
  scene.add(root);
  return { root, mixer, A, gk, mocap: true, hipsBone, W: {}, one: null, yaw: p.side ? -Math.PI / 2 : Math.PI / 2, phase: 0, last: null };
}
function mocapPose(L, t, dt, sp, vx, vy, act, skip = false, snap = false) {
  // half-rate animation: a skipped frame only banks its time; the next one plays it all (position and facing still move every frame)
  L.mdt = (L.mdt || 0) + dt;
  if (skip && !snap) return;
  dt = L.mdt; L.mdt = 0;
  // the run: blend the two gaits either side of his speed, in the direction he moves relative to where he faces
  const want = {};
  const f = vx * Math.sin(L.yaw) + vy * Math.cos(L.yaw), l = vx * Math.cos(L.yaw) - vy * Math.sin(L.yaw);
  let rate = 1;
  if (sp < 0.35) want[L.gk && L.A.gk_idle ? 'gk_idle' : 'idle'] = 1;
  else if (f < -Math.abs(l) * 0.8 && L.A.jog_back) { const n = sp > 3.6 && L.A.run_back ? 'run_back' : 'jog_back'; want[n] = 1; rate = sp / SIDE[n]; }
  else if (Math.abs(l) > Math.abs(f) * 1.2 && sp < 4.5 && L.A.jog_left) { const n = l > 0 ? 'jog_left' : 'jog_right'; want[n] = 1; rate = sp / SIDE[n]; }
  else {
    const g = Object.entries(GAIT);
    let k = g.findIndex(([, v]) => v >= sp); if (k < 0) k = g.length - 1; if (k === 0) k = 1;
    const [n0, v0] = g[k - 1], [n1, v1] = g[k], u = Math.min(1, Math.max(0, (sp - v0) / (v1 - v0)));
    want[n0] = 1 - u; want[n1] = u;
    rate = sp / ((v0 * (1 - u) + v1 * u) || 1);
  }
  // a one-off move (kick, header, dive...) takes over the body around the moment it happens, timed so the touch lands on the event
  let oneW = 0;
  const clip = act && oneShot(act, sp);
  if (clip && CLIP[clip]) {
    const c = CLIP[clip], local = t - (act.t - (CONTACT[clip] ?? 0.4));
    if (local >= 0 && local <= c.duration) {
      if (!L.one || L.one.clip !== clip) { if (L.one) L.one.a.stop(); const a = L.mixer.clipAction(c); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.timeScale = 0; L.one = { clip, a }; }
      L.one.a.time = local;
      oneW = Math.max(0, Math.min(1, local / 0.15, (c.duration - local) / 0.3));
      L.one.a.setEffectiveWeight(oneW);
    }
  }
  if (!oneW && L.one) { L.one.a.stop(); L.one = null; }
  // ease each gait's weight towards what it should be, so changes of pace blend
  const k = snap ? 1 : 1 - Math.exp(-dt * 8);   // just appeared (a cut, or back in the picture): take up the right gait at once
  for (const [n, a] of Object.entries(L.A)) {
    L.W[n] = (L.W[n] || 0) + ((want[n] || 0) - (L.W[n] || 0)) * k;
    a.setEffectiveWeight(L.W[n] * (1 - oneW));
    a.timeScale = Math.min(1.6, Math.max(0.55, rate));
  }
  L.mixer.update(dt);
}
const figs = players.map(p => (mocap ? mocapFigure(p) : model ? modelFigure(p) : figure(p)));
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
// a turn about the body's axes at that joint: local = rest x (W^-1 x D x W), W the joint's rest frame in body axes
const _d = new THREE.Quaternion();
const turn = (L, name, x, y, z) => { const j = L.B[name]; if (!j) return; _e.set(x, y, z, 'XYZ'); _d.setFromEuler(_e); _q.copy(j.wi).multiply(_d).multiply(j.w); j.b.quaternion.copy(j.rest).multiply(_q); };
// the model's own pose at rest (arms out in an A) is undone here so 0 means arms by the sides; signs found by looking (tune: ?tune=)
const TUNE = Object.assign({ armIn: 0.32, armX: 1, armZ: 1, legX: 1, kneeX: 1, spineX: 1 }, Object.fromEntries((q.get('tune') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; })));

// ball
const ball = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#fafafa'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#1e2a44';
  for (let i = 0; i < 12; i++) { g.beginPath(); const x = (i % 6) * 44 + (i > 5 ? 22 : 0), y = i > 5 ? 90 : 36; for (let k = 0; k < 5; k++) { const a = k * 1.2566; g.lineTo(x + 11 * Math.cos(a), y + 11 * Math.sin(a)); } g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 }));
  m.castShadow = true; scene.add(m); return m;
})();

// ---------- reading the match file ----------
function rowAt(t) {   // index of the last frame at or before t
  const ds = t * 10; let lo = 0, hi = ROWS.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ROWS[m][0] <= ds) lo = m; else hi = m - 1; }
  return lo;
}
const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
const crd = (p0, p1, p2, p3, u) => 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u * u);
function sample(t, col) {   // smooth position and velocity (m, m/s) of one column pair
  const i = rowAt(t), a = ROWS[Math.max(0, i - 1)], b = ROWS[i], c = ROWS[Math.min(ROWS.length - 1, i + 1)], d = ROWS[Math.min(ROWS.length - 1, i + 2)];
  const dt = Math.max(0.1, (c[0] - b[0]) / 10), u = Math.min(1, Math.max(0, (t - b[0] / 10) / dt));
  // a jump of more than 8 m in one frame is a restart being set up: don't smooth through it
  const jump = (k) => Math.abs(c[k] - b[k]) / SC > 8;
  const one = k => (jump(k) ? (u < 0.5 ? b[k] : c[k]) / SC : cr(a[k], b[k], c[k], d[k], u) / SC);
  const v = k => (jump(k) ? 0 : crd(a[k], b[k], c[k], d[k], u) / SC / dt);
  return [one(col), one(col + 1), v(col), v(col + 1)];
}
const ballAt = t => { const [x, y, vx, vy] = sample(t, 1), i = rowAt(t), b = ROWS[i], c = ROWS[Math.min(ROWS.length - 1, i + 1)]; const u = Math.min(1, (t - b[0] / 10) / 0.2); return { x, y, z: ((b[3] + (c[3] - b[3]) * u) / SC), vx, vy }; };

// events that move bodies
const idx = Object.fromEntries(players.map((p, i) => [p.id, i]));
// who is on the pitch: a backup keeper (lineup entry with sub: true, engine 0.4.1) sits on the bench until his 'substitution' event;
// the player he replaces, and anyone sent off, leaves at that moment
const ON_AT = players.map(p => (p.sub ? Infinity : -Infinity)), OFF_AT = players.map(() => Infinity);
{
  const ix = Object.fromEntries(players.map((p, i) => [p.id, i]));
  for (const e of data.events) {
    if (e.type === 'substitution') { if (ix[e.player] != null) ON_AT[ix[e.player]] = e.t; if (ix[e.off] != null) OFF_AT[ix[e.off]] = Math.min(OFF_AT[ix[e.off]], e.t); }
    else if (e.type === 'card' && (e.card === 'red' || e.card === 'second_yellow' || e.colour === 'red') && ix[e.player] != null) OFF_AT[ix[e.player]] = Math.min(OFF_AT[ix[e.player]], e.t + 4);
  }
}
const onPitch = (i, t) => t >= ON_AT[i] && t < OFF_AT[i];
const KICKS = ['pass', 'shot', 'clearance', 'goal_kick', 'corner', 'free_kick', 'penalty', 'kickoff'];
const acts = players.map(() => []);
for (const e of data.events) {
  const i = idx[e.player]; if (i == null) continue;
  if (KICKS.includes(e.type) && !(e.type === 'pass' && e.subtype === 'throw_in')) {
    const head = e.header || e.body === 'head';
    const dir = e.end_x != null ? [e.end_x - e.x, (e.end_y ?? e.y) - e.y] : null;
    acts[i].push({ t: e.t, kind: head ? 'header' : 'kick', ev: e.type, high: e.height === 'high' || e.subtype === 'lob', dir, power: e.type === 'shot' || e.type === 'clearance' || e.height === 'high' ? 1 : 0.6 });
  } else if (e.type === 'throw_in') acts[i].push({ t: e.t, kind: 'throw' });
  else if (e.type === 'save') acts[i].push({ t: e.t, kind: 'dive', caught: e.result === 'caught' });
  else if (e.type === 'tackle') acts[i].push({ t: e.t, kind: 'tackle' });
}
for (const e of data.events) if (e.type === 'goal' && !e.own_goal && idx[e.scorer] != null) acts[idx[e.scorer]].push({ t: e.t + 0.6, kind: 'celebrate' });
const actAt = (i, t) => acts[i].find(a => t > a.t - (mocap ? 1.6 : 0.45) && t < a.t + (a.kind === 'celebrate' ? 5 : a.kind === 'dive' ? 1.6 : mocap ? 1.4 : 0.5));

// ---------- animating a figure ----------
const ease = x => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function pose(L, i, t, dtReal, B, ov) {
  const [x, y, vx, vy] = ov?.s ? ov.s : sample(t, 6 + i * 2), [X, Z] = W(x, y), sp = Math.hypot(vx, vy);
  L.root.position.set(X, 0, Z);
  const act = ov?.s ? ov.act : actAt(i, t);
  // facing: the way he runs when he's moving; otherwise the ball; a kick faces where it goes
  let want = sp > 1.2 ? Math.atan2(vx, vy) : Math.atan2(B.x - x, B.y - y);
  if (act?.dir && Math.abs(t - act.t) < 0.4) want = Math.atan2(act.dir[0], act.dir[1]);
  if (L.last == null) L.yaw = want; else L.yaw += angDiff(L.yaw, want) * Math.min(1, dtReal * (sp > 4 ? 6 : 4));
  L.root.rotation.y = L.yaw;
  if (L.mocap) { mocapPose(L, t, L.last == null ? 0 : Math.min(0.25, Math.abs(t - L.last)), sp, vx, vy, act, ov?.skip, L.last == null); L.last = t; return; }
  // running: the stride cycle moves with the ground he covers, so feet don't slide
  const a = Math.min(1, sp / 7.5), stride = 1.5 + 0.18 * sp;
  if (L.last != null) L.phase += Math.min(3, Math.abs(t - L.last) * sp) / stride * Math.PI * 2;
  L.last = t;
  const s = Math.sin(L.phase), c2 = Math.cos(L.phase);
  const runA = 0.15 + 0.75 * a;
  let thL = s * runA * (sp > 0.3 ? 1 : 0.1), thR = -thL;
  let knL = 0.1 + Math.max(0, -Math.cos(L.phase - 0.6)) * (0.3 + 1.3 * a), knR = 0.1 + Math.max(0, Math.cos(L.phase - 0.6)) * (0.3 + 1.3 * a);
  let shL = -s * (0.2 + 0.7 * a), shR = s * (0.2 + 0.7 * a), elL = -0.35 - 0.9 * a, elR = elL, sideL = 0.12, sideR = -0.12;
  let lean = 0.06 + 0.22 * a, hipY = 0.98 - 0.04 * a + Math.abs(c2) * 0.05 * a, roll = 0, rootY = 0, headTilt = 0;
  if (act) {
    const k = (t - (act.t - 0.45)) / 0.45;   // 0 .. 1 up to the moment of the touch, then beyond
    if (act.kind === 'kick') {
      // plant, swing back, strike through, follow through
      const back = k < 1 ? ease(Math.min(1, k * 1.6)) : 0, fwd = k < 1 ? ease(Math.max(0, (k - 0.55) / 0.45)) : Math.max(0, 1 - (k - 1) * 0.9);
      thR = lerp(thR, -0.7 * act.power, back) * (1 - fwd) + fwd * 1.25 * act.power;
      knR = lerp(knR, 1.4, back) * (1 - fwd) + fwd * 0.15;
      thL = lerp(thL, 0.15, Math.max(back, fwd)); knL = lerp(knL, 0.3, Math.max(back, fwd));
      shL = lerp(shL, -0.6, Math.max(back, fwd)); sideL = lerp(sideL, 0.9, Math.max(back, fwd)); sideR = lerp(sideR, -0.5, Math.max(back, fwd));
      lean = lerp(lean, -0.12, fwd);
    } else if (act.kind === 'header') {
      const j = Math.sin(Math.min(1, Math.max(0, (k - 0.3) / 1.0)) * Math.PI);
      rootY = j * 0.45; knL = knR = 0.2 + 0.6 * j; thL = thR = 0.2 * j; shL = shR = -0.9 * j; sideL = 0.5; sideR = -0.5;
      headTilt = k > 0.9 && k < 1.3 ? 0.5 : -0.2 * j; lean = -0.15 * j;
    } else if (act.kind === 'throw') {
      const j = Math.min(1, k * 1.5); shL = shR = lerp(0, -3.0, j) + (k > 1 ? 0.8 : 0); elL = elR = -1.2 * (k < 1 ? 1 : 0.3); sideL = 0.1; sideR = -0.1;
    } else if (act.kind === 'dive') {
      const j = ease(Math.min(1, Math.max(0, (k - 0.6) / 0.6)));
      const toBall = Math.sign(angDiff(L.yaw, Math.atan2(B.x - x, B.y - y)) || 1);
      roll = -toBall * 1.35 * j; rootY = Math.sin(j * Math.PI) * 0.5 + j * 0.15; shL = shR = -2.8 * j; elL = elR = -0.2; sideL = 0.25; sideR = -0.25; thL = thR = 0.2 * j;
    } else if (act.kind === 'tackle') {
      const j = Math.sin(Math.min(1, k * 0.9) * Math.PI);
      thR = 1.2 * j; knR = 0.1; thL = -0.3 * j; knL = 1.2 * j; lean = -0.5 * j; hipY -= 0.45 * j; shL = -0.4; sideL = 0.7 * j;
    } else if (act.kind === 'celebrate') {
      const ck = (t - act.t + 0.45);
      shL = shR = -2.9; elL = elR = -0.3 + Math.sin(ck * 9) * 0.25; sideL = 0.35; sideR = -0.35; rootY = Math.abs(Math.sin(ck * 5)) * 0.18 * (ck < 2.5 ? 1 : 0);
    }
  }
  if (L.model) {
    const T = TUNE;
    L.root.position.y = (hipY - 0.98) + rootY;
    // the same turns as the figures built from shapes; the thighs and spine carry the hips' lean back out so the legs stay under him
    turn(L, 'hips', lean * 0.5, 0, roll);
    turn(L, 'spine', lean * 0.35, Math.sin(L.phase) * 0.12 * a, 0);
    turn(L, 'chest', lean * 0.15, 0, 0);
    turn(L, 'neck', (-lean * 1.1 + headTilt) * 0.5, 0, 0);
    turn(L, 'head', (-lean * 1.1 + headTilt) * 0.5, 0, 0);
    turn(L, 'thigh.L', -thL * T.legX - lean * 0.5, 0, 0.03); turn(L, 'thigh.R', -thR * T.legX - lean * 0.5, 0, -0.03);
    turn(L, 'shin.L', knL * T.kneeX, 0, 0); turn(L, 'shin.R', knR * T.kneeX, 0, 0);
    turn(L, 'upperarm.L', shL * T.armX, 0, (sideL - T.armIn) * T.armZ); turn(L, 'upperarm.R', shR * T.armX, 0, (sideR + T.armIn) * T.armZ);
    turn(L, 'forearm.L', elL * T.armX, 0, 0); turn(L, 'forearm.R', elR * T.armX, 0, 0);
    return;
  }
  L.hips.position.y = hipY + rootY;
  L.hips.rotation.set(lean, 0, roll);
  L.chest.rotation.set(lean * 0.4, Math.sin(L.phase) * 0.12 * a, 0);
  L.neck.rotation.set(-lean * 1.1 + headTilt, 0, 0);
  L.legL.hp.rotation.set(-thL, 0, 0.03); L.legR.hp.rotation.set(-thR, 0, -0.03);
  L.legL.kn.rotation.set(knL, 0, 0); L.legR.kn.rotation.set(knR, 0, 0);
  L.armL.sh.rotation.set(shL, 0, sideL); L.armR.sh.rotation.set(shR, 0, sideR);
  L.armL.el.rotation.set(elL, 0, 0); L.armR.el.rotation.set(elR, 0, 0);
}

// ---------- ?demo: one player for each movement in a row, looping, to check the animation ----------
const DEMO = q.has('demo');
const DEMOS = [['stand', 0], ['jog', 3.4], ['sprint', 7.6], ['kick', 0, 'kick'], ['header', 0, 'header'], ['throw', 0, 'throw'], ['dive', 0, 'dive'], ['tackle', 0, 'tackle'], ['celebrate', 0, 'celebrate']];
function demo(now, dtReal) {
  DEMOS.forEach(([, v, kind], k) => {
    const side = q.has('side'), L = figs[k], x = side ? 52.5 : 44 + k * 2.2, y = side ? 30 + (k - 4) * 2.6 : 30, loop = 3.2, tt = now % loop;
    const act = kind ? { kind, t: kind === 'celebrate' ? now - tt + 0.6 : now - tt + 1.0, dir: kind === 'kick' ? [0, 1] : null, power: 1 } : null;
    L.yaw = 0; pose(L, k, now, dtReal, { x, y: y + 10 }, { s: [x, y, 0, v], act }); L.yaw = 0; L.root.rotation.y = 0;
    L.root.position.set(x - 52.5, L.root.position.y, y - 34);
  });
  for (let k = DEMOS.length; k < NP; k++) figs[k].root.visible = false;
}

// ---------- broadcast camera: the TV director (V2-4, v2/director.js) ----------
// The director picks the shot for match time t (main gantry, celebration, REF CAM, replays, set pieces) and the scene time to draw: during a
// replay that is earlier play, so the players and ball are drawn at sceneT while the clock and score stay live. ?cam=follow keeps the old camera.
const director = q.get('cam') === 'follow' ? null : makeDirector(data, { ballAt });
const camT = new THREE.Vector3(0, 0, 0), camP = new THREE.Vector3(0, 24, 92);
function followCamera(B, dtReal) {
  const [bx, bz] = W(B.x, B.y);
  const portrait = cam.aspect < 1;
  const tx = Math.max(-36, Math.min(36, bx + B.vx * 0.6)), tz = bz * 0.55 + 2;
  const k = 1 - Math.exp(-dtReal * 1.8);
  camT.x += (tx - camT.x) * k; camT.z += (tz - camT.z) * k; camT.y = 0.5;
  const px = camT.x * (portrait ? 0.92 : 0.78), pz = portrait ? 70 : 92, py = portrait ? 30 : 26;
  camP.x += (px - camP.x) * k; camP.y = py; camP.z = pz;
  cam.position.copy(camP); cam.lookAt(camT);
}
function setFov(f) { if (Math.abs(cam.fov - f) > 1e-3) { cam.fov = f; cam.updateProjectionMatrix(); } }
// Returns the shot for match time t: { sceneT, label, kind }. Test views (?demo, ?close) override the camera but keep the live scene.
function camera(t, dtReal) {
  if (DEMO && q.has('side')) { cam.position.set(14, 1.6, -4); cam.lookAt(0.3, 0.9, -4); setFov(55); return { sceneT: t, label: '', kind: 'test' }; }
  if (DEMO) { cam.position.set(-8.5 + 8.8, 3.2, -4 + 12); cam.lookAt(-8.5 + 8.8, 0.9, -4); setFov(50); return { sceneT: t, label: '', kind: 'test' }; }
  if (q.has('close')) {   // a close look at one player (?close=<index>), to judge the figures
    const f = figs[Number(q.get('close')) || 0].root.position;
    cam.position.set(f.x + 4.5, 2.2, f.z + 5.5); cam.lookAt(f.x, 1.0, f.z); setFov(40); return { sceneT: t, label: '', kind: 'test' };
  }
  if (!director) { followCamera(ballAt(t), dtReal); setFov(cam.aspect < 1 ? 30 : 16); return { sceneT: t, label: '', kind: 'follow' }; }
  const s = director.shot(t, dtReal, cam.aspect);
  cam.position.set(...s.pos); cam.lookAt(...s.look); setFov(s.fov);
  return s;
}


// ---------- per frame ----------
const stats = { upd: 0, rend: 0, q: LOW ? 'low' : 'high' };
// soft round shadows for the low level: one draw for all the players and the ball
if (LOW) scene.matrixWorldAutoUpdate = false;   // the low level updates the scene's matrices itself, once a frame, before placing the blobs
const blobs = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }), NP + 1);
  m.frustumCulled = false; m.renderOrder = 1; m.visible = LOW; scene.add(m); return m;
})();
const _hp = new THREE.Vector3(), _m = new THREE.Matrix4(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(new THREE.Vector3(), 1.6);
function blob(k, x, z, r) { _m.makeScale(r, 1, r).setPosition(x, 0.02, z); blobs.setMatrixAt(k, _m); }
let frame = 0, acc = 0, n = 0, slow = 0, lastScene = null, lastKind = '';
const reset = () => { figs.forEach(f => (f.last = null)); lastScene = null; };
function draw(t, dtReal, speed = 1) {
  const u0 = performance.now();
  // the camera first: it says which moment the scene shows (a replay shows earlier play)
  const shot = camera(t, dtReal), st = shot.sceneT;
  // a cut that jumps the scene in time (into or out of a replay): players take up their pose at once instead of blending from the old moment
  const jumped = lastScene == null || Math.abs(st - lastScene) > 1 || (shot.kind === 'replay') !== (lastKind === 'replay');
  if (jumped) figs.forEach(f => (f.last = null));
  lastScene = st; lastKind = shot.kind;
  const B = ballAt(st), [bx, bz] = W(B.x, B.y);
  ball.position.set(bx, 0.11 + Math.max(0, B.z), bz);
  ball.rotation.x += B.vy * dtReal * speed / 0.11 * 0.5; ball.rotation.z -= B.vx * dtReal * speed / 0.11 * 0.5;
  if (DEMO) { demo(performance.now() / 1000, dtReal); if (LOW) scene.updateMatrixWorld(); }
  else {
    // only players in the picture are animated and drawn (the skinned meshes can't cull themselves: their bounds don't follow the animation)
    cam.updateMatrixWorld(); _fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const half = LOW && !['celebrate', 'refcam', 'foul', 'close', 'test'].includes(shot.kind);   // close-ups keep full-rate movement
    let nb = 0; frame++;
    for (let i = 0; i < NP; i++) {
      const L = figs[i]; let on = onPitch(i, st);
      if (on) { const [x, y] = sample(st, 6 + i * 2), [X, Z] = W(x, y); _sph.center.set(X, 0.9, Z); on = _fr.intersectsSphere(_sph); }
      L.root.visible = on;
      if (on) pose(L, i, st, jumped ? 1 : dtReal * Math.max(1, speed), B, half ? { skip: (i + frame) & 1 } : null);
      else L.last = null;
    }
    if (LOW) {
      // blobs go under each body's hips, not the match-file spot: one-off moves (a slide tackle, a dive) carry the body away from it
      scene.updateMatrixWorld();
      for (let i = 0; i < NP; i++) { const L = figs[i]; if (!L.root.visible) continue; if (L.hipsBone) { L.hipsBone.getWorldPosition(_hp); blob(nb++, _hp.x, _hp.z, 1.1); } else blob(nb++, L.root.position.x, L.root.position.z, 1.1); }
      blob(nb++, bx, bz, 0.5 / (1 + Math.max(0, B.z) * 0.25)); blobs.count = nb; blobs.instanceMatrix.needsUpdate = true; }
  }
  const u1 = performance.now();
  renderer.render(scene, cam);
  const u2 = performance.now();
  stats.upd += ((u1 - u0) - stats.upd) * 0.05; stats.rend += ((u2 - u1) - stats.rend) * 0.05;
  acc += dtReal; n++;
  if (acc > 1) {
    const fps = n / acc; acc = 0; n = 0;
    slow = fps < 45 ? slow + 1 : 0;
    if (slow >= 2 && pr > 1) { pr = Math.max(1, pr - 0.5); renderer.setPixelRatio(pr); resize(); slow = 0; }
    Object.assign(stats, { fps: Math.round(fps), draws: renderer.info.render.calls, tris: renderer.info.render.triangles, pr });
  }
  return shot;
}
function destroy() {
  ro.disconnect();
  scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; for (const x of Array.isArray(m) ? m : m ? [m] : []) { x.map?.dispose?.(); x.dispose?.(); } });
  renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
}
return { canvas: renderer.domElement, frame: draw, reset, resize, destroy, director, shots: director?.shots || [], stats, scene, cam, T0, T1, low: LOW };
}
