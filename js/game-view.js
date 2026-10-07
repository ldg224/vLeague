// The match viewer's picture (0.35): a top-down broadcast of a match file, drawn on a canvas. No page code beyond the canvas it is given.
//
//   const view = createView(canvas, data, { colours: { CODE: '#hex' } });
//   view.paint(at, { follow })    // draw the match at `at` seconds; follow = the camera zooms in on the ball
//   view.resize()                 // call when the canvas's size on screen changes
// Pitch with mowing stripes, line markings, nets and penalty spots; kit-coloured players (a team with a near-identical colour gets a
// light kit), a ring and a name on the player with the ball, a ball with a shadow and a short trail, and a smooth follow camera.
const PITCH = { w: 105, h: 68 };

const rgb = hex => { const n = parseInt(String(hex).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const lum = hex => { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; };
const HEX = /^#[0-9a-f]{6}$/i;

export function createView(cv, data, { colours = {} } = {}) {
  const ctx = cv.getContext('2d'), fi = data.fi;
  const home = data.teams.home.code, away = data.teams.away.code;
  const pick = (code, fallback) => (HEX.test(colours[code] || '') ? colours[code] : HEX.test(data.teams[code === home ? 'home' : 'away'].colour || '') ? data.teams[code === home ? 'home' : 'away'].colour : fallback);
  let hc = pick(home, '#38bdf8'), ac = pick(away, '#f43f5e');
  if (dist(hc, ac) < 90) ac = lum(hc) > 140 ? '#1f2937' : '#f8fafc';   // two near-identical colours: the away side wears a plain light or dark kit
  const kit = { [home]: hc, [away]: ac };
  const ink = c => (lum(c) > 150 ? '#0b1220' : '#ffffff');
  let dpr = 1, W = 0, H = 0, cam = { x: PITCH.w / 2, y: PITCH.h / 2, z: 1 };

  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = Math.max(320, Math.round(r.width * dpr)); H = Math.round(W * PITCH.h / PITCH.w);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }

  // The frame row nearest `t` seconds and the blend toward the next.
  function frame(t) {
    const fr = data.frames.data, tt = t * 10;
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (fr[m][0] <= tt) lo = m; else hi = m - 1; }
    const a = fr[lo], b = fr[Math.min(lo + 1, fr.length - 1)];
    return { a, b, k: b[0] > a[0] ? Math.min(1, Math.max(0, (tt - a[0]) / (b[0] - a[0]))) : 0 };
  }
  const at = (f, i) => (f.a[i] + (f.b[i] - f.a[i]) * f.k) / 10;

  function pitchArt(s) {   // metres -> pixels: scale s, camera cam
    const X = x => (x - cam.x) * s + W / 2, Y = y => (y - cam.y) * s + H / 2;
    const left = X(0), top = Y(0), pw = PITCH.w * s, ph = PITCH.h * s;
    ctx.fillStyle = '#0f3d22'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, top, 0, top + ph); g.addColorStop(0, '#22733f'); g.addColorStop(1, '#1b6234');
    ctx.fillStyle = g; ctx.fillRect(left - 5 * s, top - 5 * s, pw + 10 * s, ph + 10 * s);
    for (let i = 0; i < 15; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.045)'; ctx.fillRect(left + i * pw / 15, top, pw / 15 + 1, ph); }
    ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = Math.max(1.5, .22 * s);
    ctx.strokeRect(left, top, pw, ph);
    ctx.beginPath(); ctx.moveTo(X(52.5), top); ctx.lineTo(X(52.5), top + ph); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(52.5), Y(34), 9.15 * s, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(52.5), Y(34), .35 * s, 0, 7); ctx.fill();
    for (const dir of [1, -1]) {
      const gx = dir > 0 ? 0 : PITCH.w, sgn = dir;
      ctx.strokeRect(X(gx), Y(34 - 20.16), 16.5 * s * sgn, 40.32 * s);
      ctx.strokeRect(X(gx), Y(34 - 9.16), 5.5 * s * sgn, 18.32 * s);
      ctx.beginPath(); ctx.arc(X(gx + 11 * sgn), Y(34), .3 * s, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(X(gx + 11 * sgn), Y(34), 9.15 * s, sgn > 0 ? -0.93 : Math.PI - 0.93 + 0, sgn > 0 ? 0.93 : Math.PI + 0.93); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(sgn > 0 ? X(gx) - 2.4 * s : X(gx), Y(34 - 3.66), 2.4 * s, 7.32 * s);   // the net behind the goal line
      ctx.fillStyle = 'rgba(255,255,255,.88)';
    }
    for (const [cx, cy, a0] of [[0, 0, 0], [PITCH.w, 0, Math.PI / 2], [PITCH.w, PITCH.h, Math.PI], [0, PITCH.h, Math.PI * 1.5]]) { ctx.beginPath(); ctx.arc(X(cx), Y(cy), 1 * s, a0, a0 + Math.PI / 2); ctx.stroke(); }
    return { X, Y };
  }

  function paint(t, { follow = false } = {}) {
    if (!W) resize();
    const f = frame(t), bx = at(f, fi.ball_x), by = at(f, fi.ball_y), inPlay = f.a[fi.in_play];
    // The camera eases toward the ball (or the middle of the pitch), and zooms in when following.
    const z = follow ? 1.9 : 1, tx = follow ? bx : PITCH.w / 2, ty = follow ? by : PITCH.h / 2;
    cam.z += (z - cam.z) * .08; cam.x += (tx - cam.x) * (follow ? .12 : .1); cam.y += (ty - cam.y) * (follow ? .12 : .1);
    const s = W / PITCH.w * cam.z, halfW = W / 2 / s, halfH = H / 2 / s;
    cam.x = Math.max(halfW - 4, Math.min(PITCH.w + 4 - halfW, cam.x)); cam.y = Math.max(halfH - 4, Math.min(PITCH.h + 4 - halfH, cam.y));
    if (cam.z < 1.02 && !follow) { cam.x = PITCH.w / 2; cam.y = PITCH.h / 2; }
    const { X, Y } = pitchArt(s);
    const holder = f.a[fi.holder], r = Math.max(5, 1.15 * s);
    // players: shadow, kit disc with a contrasting edge, goalkeepers marked
    for (const p of data.players) {
      const x = X(at(f, fi[`p${p.idx}_x`])), y = Y(at(f, fi[`p${p.idx}_y`])), c = kit[p.team], has = p.idx === holder;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + r * .25, y + r * .45, r * 1.05, r * .6, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, has ? r * 1.2 : r, 0, 7); ctx.fillStyle = c; ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * .22); ctx.strokeStyle = has ? '#ffffff' : ink(c) === '#ffffff' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.6)'; ctx.stroke();
      if (p.position === 'GK') { ctx.beginPath(); ctx.arc(x, y, r * .5, 0, 7); ctx.fillStyle = ink(c); ctx.fill(); }
      if (has) { const pulse = (performance.now() % 1200) / 1200; ctx.beginPath(); ctx.arc(x, y, r * (1.5 + pulse * .9), 0, 7); ctx.strokeStyle = `rgba(255,255,255,${.55 * (1 - pulse)})`; ctx.lineWidth = 2; ctx.stroke(); }
    }
    // the ball: a short trail, a shadow that grows with height, then the ball
    if (inPlay) {
      for (let i = 6; i >= 1; i--) {
        const g = frame(Math.max(0, t - i * .12)); ctx.beginPath(); ctx.arc(X(at(g, fi.ball_x)), Y(at(g, fi.ball_y)), Math.max(2, .38 * s), 0, 7);
        ctx.fillStyle = `rgba(255,255,255,${.05 + (6 - i) * .03})`; ctx.fill();
      }
      const bz = at(f, fi.ball_z), br = Math.max(3.2, .52 * s), px = X(bx), py = Y(by);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(px + bz * s * .25, py + br * .5, br * (1 + bz * .1), br * .55, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px, py - bz * s * .55, br, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = '#111'; ctx.stroke();
    }
    // the name of whoever has the ball
    if (holder >= 0 && data.byIdx[holder]) {
      const p = data.byIdx[holder], x = X(at(f, fi[`p${p.idx}_x`])), y = Y(at(f, fi[`p${p.idx}_y`])) - r * 2.1, label = p.name;
      ctx.font = `700 ${Math.max(11, 0.017 * W)}px "Figtree", sans-serif`; ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 14, h = Math.max(18, 0.03 * W);
      ctx.fillStyle = 'rgba(8,12,20,.82)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h + 3, w, h, 6); ctx.fill();
      ctx.fillStyle = kit[p.team]; ctx.fillRect(x - w / 2, y - h + 3, 4, h);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + 2, y - h * .25);
    }
    return { holder, inPlay: !!inPlay, kit };
  }

  resize();
  return { paint, resize, kit };
}
