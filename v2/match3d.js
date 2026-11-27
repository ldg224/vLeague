// V2 test page for the 3D match (v2/match3d.html): the renderer is v2/match3d-core.js; this page adds its own score bug, REPLAY tag, goal caption
// and controls. ?file=<match file> (default match.json), ?t=<seconds> to start at, ?debug or ?perf for the frame-rate readout, and the core's
// test views (?q=low|high, ?demo, ?close=<i>, ?cam=follow, ?shapes, ?v=blender).
import { createMatch3D } from './match3d-core.js';

const q = new URLSearchParams(location.search);
const data = await (await fetch(q.get('file') || 'match.json')).json();
// on phones the control bar covers the bottom 90 px: shots are framed above it
const m3 = await createMatch3D({ data, parent: document.getElementById('stage'), params: q, safeBottom: w => (w <= 600 ? 90 : 0) });
const { T0, T1, stats } = m3;

// ---------- HUD, clock, controls ----------
const code = s => (s ? data.teams.away : data.teams.home).code;
const colourBar = s => `<i style="background:${(s ? data.teams.away : data.teams.home).colour}"></i>`;
document.getElementById('bug-h').innerHTML = `${colourBar(0)}${code(0)}`;
document.getElementById('bug-a').innerHTML = `${colourBar(1)}${code(1)}`;
const goals = data.events.filter(e => e.type === 'goal');
const half2 = data.periods?.[1]?.start_t ?? Infinity;
function clock(t) { const base = t >= half2 ? 45 * 60 + (t - half2) : t; const m = Math.floor(base / 60), s = Math.floor(base % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
const byId = Object.fromEntries((data.players || []).map(p => [p.id, p]));
let t = Number(q.get('t') || 110), speed = 1, playing = true;
const seek = document.getElementById('seek');
seek.oninput = () => { t = T0 + (T1 - T0) * seek.value; m3.reset(); };
document.getElementById('play').onclick = e => { playing = !playing; e.target.textContent = playing ? 'Pause' : 'Play'; };
for (const b of document.querySelectorAll('[data-sp]')) b.onclick = () => { speed = Number(b.dataset.sp); document.querySelectorAll('[data-sp]').forEach(x => x.setAttribute('aria-pressed', x === b)); };
document.getElementById('goal').onclick = () => { const g = goals.find(e => e.t > t + 2) || goals[0]; if (g) { t = g.t - 9; m3.reset(); } };

// ---------- loop ----------
// the frame-rate readout is for testing only: shown with ?debug or ?perf
const DEBUG = q.has('debug') || q.has('perf');
const fpsEl = document.getElementById('fps'), capEl = document.getElementById('cap'), tagEl = document.getElementById('tag');
let lastMs = performance.now(), shownFps = 0;
function loop(ms) {
  const dtReal = Math.min(0.1, (ms - lastMs) / 1000); lastMs = ms;
  if (playing) t = Math.min(T1, t + dtReal * speed);
  const shot = m3.frame(t, dtReal, speed);
  tagEl.textContent = shot.label || ''; tagEl.style.display = shot.label ? 'block' : 'none';
  const sc = goals.filter(g => g.t <= t).at(-1)?.score || [0, 0];
  document.getElementById('bug-s').textContent = `${sc[0]}–${sc[1]}`;
  document.getElementById('bug-c').textContent = clock(t);
  const g = shot.kind !== 'replay' && goals.find(e => t >= e.t && t < e.t + 6);
  capEl.style.display = g ? 'block' : 'none';
  if (g) capEl.textContent = `GOAL! ${byId[g.scorer]?.name || ''} ${g.score[0]}–${g.score[1]}`;
  seek.value = (t - T0) / (T1 - T0);
  if (DEBUG && stats.fps && stats.fps !== shownFps) { shownFps = stats.fps; fpsEl.textContent = `${stats.fps} fps · ${stats.draws} draws · ${(stats.tris / 1000).toFixed(0)}k tris · ×${stats.pr}`; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__v2 = { setT: v => { t = v; m3.reset(); }, pause: () => { playing = false; }, play: () => { playing = true; }, director: m3.director, shots: m3.shots, stats, scene: m3.scene, cam: m3.cam, get t() { return t; } };
