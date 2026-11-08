// B-33: every camera draws everyone on the pitch at one scale. The rules, checked for every camera the broadcast, highlights and matchday show use,
// swept over where it looks and how far it zooms, with figures all over the pitch and on both touchlines (where the assistant referees run):
//   1. One enlargement per shot: nobody is drawn bigger, for his distance, than the rest of the shot (a per-figure floor made the far assistant
//      referee three times life size on a wide shot, 1.36.0).
//   2. Perspective holds: someone farther from the camera is never drawn taller than someone nearer.
//   3. No shot enlarges its figures more than MAX_BOOST times life (beyond that they tower over the boards and goals).
//   4. The normal views (main camera, behind the goal, low 18-yard, reverse, cable) draw a player where they look at much the same size, so a cut
//      between them never makes the players jump in size. Close-ups (pitchside, the free-kick taker) are meant to be big and are left out of rule 4.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location ??= { hostname: 'localhost', search: '', href: 'http://localhost/' };
globalThis.document ??= { documentElement: { classList: { contains: () => false } } };
const { W, H, makeCam, makeCamAt, RIG, lerpCam, HighlightsRenderer } = await import('../js/viewer/highlights.js');
const figure = HighlightsRenderer.prototype.figure;
const MAX_BOOST = 1.8, MIN_FIGURE = 40;

// Everyone who can be on the pitch: a grid over it, plus both touchlines' assistant positions, plus behind each goal line.
const SPOTS = [];
for (let x = -2; x <= 107; x += 5.5) for (let y = -1.5; y <= 69.5; y += 4.25) SPOTS.push([x, y]);

// Every camera, swept. name -> list of cameras.
const sweep = (f, ...ranges) => { const out = []; const go = (i, a) => { if (i === ranges.length) { out.push(f(...a)); return; } for (const v of ranges[i]) go(i + 1, [...a, v]); }; go(0, []); return out; };
const steps = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
const CAMS = {
  gantry: sweep((x, y, w) => RIG.gantry(x, y, w), steps(10, 95, 6), steps(14, 54, 4), [27, 29, 34, 36, 44, 54, 60, 68]),
  goalHigh: sweep((g, x, y, w) => RIG.goalHigh(g, g ? x : 105 - x, y, w), [0, 105], steps(70, 100, 4), steps(10, 58, 4), [28, 34, 44]),
  low18: sweep((g, x, y, w) => RIG.low18(g, g ? x : 105 - x, y, w), [0, 105], steps(75, 100, 4), steps(14, 54, 4), [26, 30, 40]),
  reverse: sweep((x, y, w) => RIG.reverse(x, y, w), steps(10, 95, 5), steps(14, 54, 4), [30, 34, 44]),
  cable: sweep((x, y, d) => RIG.cable(x, y, d), steps(5, 100, 6), steps(4, 64, 5), [1, -1]),
  corner: sweep((g, cy, x, y) => makeCamAt([g + (g ? 16 : -16), cy, 21], [g ? x : 105 - x, y, 0], 42), [0, 105], [-16, 84], steps(80, 100, 3), steps(10, 58, 3)),
  spider: sweep((x, y) => makeCam(x, y, 30, 72, 52), steps(3, 102, 6), steps(3, 65, 5)),
  high: sweep((x, y) => makeCam(x, y, 40, 58, 40), steps(14, 91, 5), steps(18, 50, 3)),
  pitchside: sweep((x, y, w) => RIG.pitchside(x, y, w, 1.5), steps(4, 101, 5), steps(6, 62, 4), [8.5, 11, 16, 18, 22]),
  kicker: sweep((ex, ey, g) => RIG.kicker(g ? ex : 105 - ex, ey, g), steps(75, 95, 3), steps(5, 63, 4), [0, 105]),
  show: [makeCam(26.5, 34, 56, 28, 40), makeCam(52.5, 34, 56, 28, 40), makeCam(78.5, 34, 56, 28, 40), makeCam(52.5, 58, 30, 24, 40), makeCam(52.5, 36, 34, 24, 40),
    makeCam(38, 30, 24, 15, 36), makeCam(67, 30, 24, 15, 36), makeCam(52.5, 34, 37, 21, 40)],
  showToMain: steps(0, 1, 6).map(k => lerpCam(makeCam(52.5, 34, 37, 21, 40), RIG.gantry(52.5, 34, 36), k)),
};
const NORMAL = ['gantry', 'goalHigh', 'low18', 'reverse', 'cable'];

// What each figure in a shot is drawn at: its life-size height at that spot (the taller of head-to-feet and 1.85 m at the camera's scale, as
// figure() measures it), what figure() draws, and whether it is on screen and fully shown.
const shot = cam => SPOTS.map(([x, y]) => {
  const p = cam.p(x, y); if (!p) return null;
  const hd = cam.p(x, y, 1.85), life = Math.max(hd ? p[1] - hd[1] : 0, 1.85 * p[2]);
  const f = figure.call(null, cam, p, x, y);
  const on = p[0] > 0 && p[0] < W && p[1] > 0 && p[1] - f.h < H && f.alpha > 0.98;
  return { x, y, s: p[2], life, h: f.h, k: f.k, on };
}).filter(q => q?.on);

for (const [name, cams] of Object.entries(CAMS)) {
  test(`${name}: one scale for everyone in the shot, perspective holds, never more than ${MAX_BOOST}x life (${cams.length} shots)`, () => {
    for (const cam of cams) {
      const fs = shot(cam), where = `${name} camera at [${cam.C.map(v => v.toFixed(1))}] looking at [${cam.T.map(v => v.toFixed(1))}], fov ${cam.fov.toFixed(1)}`;
      const b = cam.boost ?? 1;
      for (const f of fs) {
        if (f.k < 1) continue;                                  // held at the shot's limit (right by the lens): smaller than life-times-boost, fine
        if (f.h <= MIN_FIGURE + 1e-6) continue;                 // the smallest anyone is drawn: tiny, can't tower over anything
        const m = f.h / f.life;
        assert.ok(m <= b * 1.01, `${where}: figure at (${f.x}, ${f.y}) drawn ${f.h.toFixed(0)} px, ${m.toFixed(2)}x life, more than the shot's ${b.toFixed(2)}x`);   // rule 1
        assert.ok(m <= MAX_BOOST * 1.01, `${where}: figure at (${f.x}, ${f.y}) ${m.toFixed(2)}x life`);   // rule 3
      }
      // rule 2: a farther figure (smaller scale) is never drawn taller than a nearer one (5% for the camera's tilt)
      const byDepth = fs.slice().sort((a, b) => a.s - b.s);
      for (let i = 0; i < byDepth.length; i++) for (let j = i + 1; j < byDepth.length; j++) {
        const far = byDepth[i], near = byDepth[j];
        if (far.s < near.s * 0.97) assert.ok(far.h <= near.h * 1.05 + 1, `${where}: (${far.x}, ${far.y}) is farther but drawn ${far.h.toFixed(0)} px, taller than (${near.x}, ${near.y}) at ${near.h.toFixed(0)} px`);
      }
      assert.ok(b >= 1 && b <= MAX_BOOST + 1e-9, `${where}: boost ${cam.boost}`);
    }
  });
}

test('the normal views draw a player where they look at much the same size (no size jump on a cut)', () => {
  const sizes = {};
  for (const name of NORMAL) for (const cam of CAMS[name]) {
    const [tx, ty] = cam.T, p = cam.p(tx, ty); const f = figure.call(null, cam, p, tx, ty);
    (sizes[name] ||= []).push(f.h);
  }
  const all = Object.values(sizes).flat(), lo = Math.min(...all), hi = Math.max(...all);
  const report = Object.entries(sizes).map(([n, v]) => `${n} ${Math.min(...v).toFixed(0)}-${Math.max(...v).toFixed(0)}`).join(', ');
  assert.ok(lo >= 85 && hi <= 140, `a player where the camera looks: ${report} px (want 85-140 at 1080p)`);
});
