// The matchday show on the live broadcast (S-34). A live match fills a one-hour slot: 45 minutes of football and 15 of this. While the show is on, the match
// clock holds still (js/dashboard-data.js, liveShow) and these scenes are drawn instead. Everything is worked out from the time alone, so someone arriving
// late sees the same picture as everyone else, and nothing here looks past the moment the match has reached.
//   drawShow(r, show, t): r is the BroadcastRenderer; show is { kind: 'pre' | 'half' | 'goal' | 'end', local, dur, goal }; t is the match-file time.
import { W, H, makeCam, clamp, lerp, easeOut, easeInOut, seg01, lastName, LIME } from './highlights.js';

const TAU = Math.PI * 2;
const PRE = [['warmup', 20], ['home', 22], ['away', 22], ['walkout', 25], ['anthem', 36], ['handshake', 15], ['ready', 10]];   // seconds of the 150 before kick-off

function fade(r, local, dur, len = 0.45) {
  const a = Math.max(1 - clamp(local / len, 0, 1), seg01(local, dur - len, dur));
  if (a > 0) { r.c.fillStyle = `rgba(0,0,0,${a})`; r.c.fillRect(0, 0, W, H); }
}

// A caption at the bottom left, as the broadcast's other tags.
function tag(r, left, right, a = 1) {
  const c = r.c, x = 70, y = H - 150;
  c.save(); c.globalAlpha = a;
  c.font = '900 26px Oswald, Figtree, system-ui, sans-serif';
  const lw = c.measureText(left).width + left.length * 2 + 54, rw = c.measureText(right).width + right.length * 2 + 64;
  r.pill(x, y, lw, 54, r.limeGrad(x, y, x + lw, y + 54), 10);
  r.text(left, x + lw / 2, y + 37, { size: 26, weight: 900, align: 'center', colour: '#fff', spacing: 2 });
  r.pill(x + lw + 10, y, rw, 54, 'rgba(6,26,56,0.88)', 10);
  r.text(right, x + lw + 32, y + 37, { size: 26, weight: 900, spacing: 2 });
  c.restore();
}

// Players (and the referee) on the pitch, far to near. pos(i, t) gives where the player with index i is; his speed comes from where he is a moment later.
function pitchScene(r, cam, sides, pos, t, { ball = null, faces = [52.5, 34, 0], ref = null, ars = [], after = null } = {}) {
  r.ballAt = faces; r.trail = [];
  r.drawPitch(cam); r.drawGoal(cam, 0); r.drawGoal(cam, 105);
  const items = [...sides[0], ...sides[1]].map(i => {
    const [x, y] = pos(i, t), [x2, y2] = pos(i, t + 0.1);
    return { i, x, y, vx: (x2 - x) * 10, vy: (y2 - y) * 10, lying: false, dive: null, d: cam.p(x, y)?.[2] ?? 0 };
  });
  if (ref) items.push({ ref: true, x: ref[0], y: ref[1], card: null, d: cam.p(ref[0], ref[1])?.[2] ?? 0 });
  for (const a of ars) items.push({ ar: true, x: a[0], y: a[1], d: cam.p(a[0], a[1])?.[2] ?? 0 });
  items.sort((a, b) => a.d - b.d);
  for (const it of items) { if (it.ref) r.drawReferee(cam, it, t); else if (it.ar) r.drawAssistant(cam, it); else r.drawPlayer(cam, it, false); }
  after?.(cam);
  for (const b of ball || []) r.drawBall(cam, { ball: [b[0], b[1], 0], inPlay: false, ballAlpha: 1 });
}

const sideIdx = r => [r.home.lineup.map(p => p.idx), r.away.lineup.map(p => p.idx)];
const isKeeper = (r, i) => r.gkIdx.has(i);

// Warm-ups: each club in its own half, a passing circle, the others running shuttles, the keeper moving across his goal.
function warmup(r, local, dur, t0) {
  const sides = sideIdx(r), start = r.fr.at(t0).players, homeRight = start[sides[0][0]][0] > 52.5;
  const place = (side, i, u) => {
    const dir = (side === 0) === homeRight ? 1 : -1, outfield = sides[side].filter(j => !isKeeper(r, j)), k = outfield.indexOf(i);
    if (isKeeper(r, i)) return [dir > 0 ? 101 : 4, 34 + 6 * Math.sin(u * 0.7 + side)];
    if (k < 6) { const a = TAU * k / 6 + u * 0.02; return [52.5 + dir * 26 + 8.5 * Math.cos(a), 34 + 8.5 * Math.sin(a)]; }
    return [52.5 + dir * (7 + 8 * (1 + Math.sin(u * 0.55 + k))), 13 + (k - 6) * 3.2];
  };
  const pos = (i, u) => place(sides[0].includes(i) ? 0 : 1, i, u);
  const ball = [0, 1].map(side => {
    const ring = sides[side].filter(j => !isKeeper(r, j)).slice(0, 6); if (ring.length < 2) return null;
    const n = local / 1.5, f = Math.floor(n), a = ring[(f * 2) % ring.length], b = ring[((f + 1) * 2) % ring.length];
    const pa = pos(a, local), pb = pos(b, local), k = easeInOut(n - f);
    return [lerp(pa[0], pb[0], k), lerp(pa[1], pb[1], k)];
  }).filter(Boolean);
  const cam = makeCam(52.5 + 26 * Math.sin(local * 0.09), 34, 56, 28, 40);
  pitchScene(r, cam, sides, pos, local, { ball });
  r.bug(t0);
  tag(r, 'WARM-UPS', `${r.home.code} V ${r.away.code}  ·  KICK-OFF SOON`, seg01(local, 0.4, 1));
}

// A player's face and shoulders, in his kit's colour.
function portrait(r, q, colour, cx, cy, R, bottom) {
  const c = r.c, main = r.kitOf({ i: q.idx })?.main || (r.gkIdx.has(q.idx) ? (q.idx < r.nHome ? '#f5b042' : '#a855f7') : colour), w = R * 2.7, top = cy + R * 0.82;
  c.fillStyle = main; c.beginPath(); c.roundRect(cx - w / 2, top, w, Math.max(R * 0.4, bottom - top), [R, R, 0, 0]); c.fill();
  r.drawHead(cx, cy, R, 0);
}

// Starting line-up and introductions: the club's XI, each player called out in turn.
function lineupCard(r, team, colour, local, dur) {
  const c = r.c, L = team.lineup, step = dur / Math.max(1, L.length), now = clamp(Math.floor(local / step), 0, L.length - 1), p = L[now];
  r.bg(0.88);
  c.save(); c.globalAlpha = 0.75;
  const g = c.createLinearGradient(0, 0, W * 0.62, 0); g.addColorStop(0, colour); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
  r.stripes(local, 0.3);
  c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 40; r.logoAt(team, 380, 330, 340); c.restore();
  r.text(team.name.toUpperCase(), 380, 590, { size: 62, weight: 900, align: 'center', italic: true, shadow: 16 });
  r.text(`STARTING XI  ·  ${team.formation || ''}`, 380, 640, { size: 28, weight: 800, align: 'center', colour: 'rgba(255,255,255,.8)', spacing: 4 });
  // Whoever is being introduced.
  const k = easeOut((local - now * step) / 0.5), captain = q => team.captain != null && String(team.captain) === String(q.id);
  r.pill(90, 700, 700, 200, 'rgba(6,26,56,0.88)', 18);
  r.text(r.shirtNo(p.id), 170, 830, { size: 96, weight: 900, align: 'center', colour: LIME, alpha: k });
  c.save(); c.globalAlpha = k; c.beginPath(); c.roundRect(90, 700, 700, 200, 18); c.clip(); portrait(r, p, colour, 305, 765, 44, 900); c.restore();
  r.text(lastName(p.name).toUpperCase(), 385, 800, { size: 54, weight: 900, italic: true, alpha: k });
  r.text(`${p.slot || p.position || ''}${captain(p) ? '  ·  CAPTAIN' : ''}`, 387, 850, { size: 28, weight: 800, colour: 'rgba(255,255,255,.75)', spacing: 3, alpha: k });
  // The XI.
  const x = 860, top = 110, row = 80;
  L.forEach((q, i) => {
    const y = top + i * row, on = i === now, shown = easeOut((local - i * 0.08) / 0.4), xx = x + (1 - shown) * 80;
    c.save(); c.globalAlpha = shown;
    r.pill(xx, y, 950, row - 10, on ? 'rgba(255,255,255,0.96)' : 'rgba(6,26,56,0.72)', 12);
    if (!on) { c.fillStyle = colour; c.fillRect(xx, y, 6, row - 10); }
    const ink = on ? '#061a38' : '#fff';
    r.text(r.shirtNo(q.id), xx + 60, y + 48, { size: 34, weight: 900, align: 'center', colour: on ? '#061a38' : LIME });
    c.save(); c.beginPath(); c.roundRect(xx, y, 950, row - 10, 12); c.clip(); portrait(r, q, colour, xx + 135, y + 28, 17, y + row - 10); c.restore();
    r.text(`${q.name.toUpperCase()}${captain(q) ? '  (C)' : ''}`, xx + 180, y + 48, { size: 32, weight: 900, colour: ink });
    r.text(q.slot || q.position || '', xx + 920, y + 47, { size: 26, weight: 800, align: 'right', colour: on ? '#061a38' : 'rgba(255,255,255,.7)' });
    c.restore();
  });
}

// The walk-out: the two clubs in single file from the tunnel on the near touchline, behind the referee, to a line across the halfway line.
const LINE_Y = 38;
function linedUp(sides, side, i) { const k = sides[side].indexOf(i); return [52.5 + (side ? 1 : -1) * (4 + k * 1.7), LINE_Y]; }
const officials = y => [[52.5 - 1.7, y], [52.5 + 1.7, y]];
function walkPos(sides, i, u) {
  const side = sides[0].includes(i) ? 0 : 1, k = sides[side].indexOf(i), S = 2.6;
  const a = [52.5 + (side ? 1 : -1) * 2.6, 76], b = [a[0], LINE_Y + 2.5], e = linedUp(sides, side, i);
  const leg1 = a[1] - b[1], leg2 = Math.hypot(e[0] - b[0], e[1] - b[1]);
  const s = Math.max(0, (u - 1.5 - k * 1.05) * S);
  if (s < leg1) return [a[0], a[1] - s];
  if (s < leg1 + leg2) { const f = (s - leg1) / leg2; return [lerp(b[0], e[0], f), lerp(b[1], e[1], f)]; }
  return e;
}
function walkout(r, local, dur, t0) {
  const sides = sideIdx(r), k = dur / 45, u = local / k, f = easeInOut(clamp(u / 34, 0, 1));
  const cam = makeCam(52.5, lerp(58, 36, f), lerp(30, 34, f), 24, 40);
  const oy = Math.max(LINE_Y, 76 - u * 2.6);
  pitchScene(r, cam, sides, (i, x) => walkPos(sides, i, x / k), local, { faces: [52.5, 90, 0], ref: [52.5, oy], ars: officials(oy) });
  r.bug(t0);
  tag(r, 'WALK-OUT', `${r.home.name.toUpperCase()} AND ${r.away.name.toUpperCase()}`, seg01(local, 0.4, 1));
}

// The Australian flag: the Union Jack in the corner, the Commonwealth Star under it, the Southern Cross on the fly. Drawn, so it needs no image.
function star(c, x, y, R, points, inner = 0.45) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / points, q = i % 2 ? R * inner : R; c[i ? 'lineTo' : 'moveTo'](x + q * Math.cos(a), y + q * Math.sin(a)); }
  c.closePath(); c.fill();
}
function flag(r, x, y, w) {
  const c = r.c, h = w / 2, cw = w / 2, ch = h / 2;
  c.save(); c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 24; c.fillStyle = '#00247d'; c.fillRect(x, y, w, h); c.restore();
  c.save(); c.beginPath(); c.rect(x, y, cw, ch); c.clip();
  const cross = (col, lw) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.lineTo(x + cw, y + ch); c.moveTo(x + cw, y); c.lineTo(x, y + ch); c.stroke(); };
  cross('#fff', ch / 5); cross('#cf142b', ch / 15);
  c.fillStyle = '#fff'; c.fillRect(x + cw / 2 - ch / 6, y, ch / 3, ch); c.fillRect(x, y + ch / 2 - ch / 6, cw, ch / 3);
  c.fillStyle = '#cf142b'; c.fillRect(x + cw / 2 - ch / 10, y, ch / 5, ch); c.fillRect(x, y + ch / 2 - ch / 10, cw, ch / 5);
  c.restore();
  c.fillStyle = '#fff';
  star(c, x + cw / 2, y + h * 0.75, h * 0.15, 7);
  for (const [fx, fy] of [[0.75, 0.83], [0.625, 0.47], [0.75, 0.17], [0.87, 0.39]]) star(c, x + w * fx, y + h * fy, h * 0.075, 7);
  star(c, x + w * 0.81, y + h * 0.56, h * 0.045, 5);
}
const VERSE = ['Australians all let us rejoice,', 'For we are one and free;', 'We\u2019ve golden soil and wealth for toil;', 'Our home is girt by sea;', 'Our land abounds in nature\u2019s gifts',
  'Of beauty rich and rare;', 'In history\u2019s page, let every stage', 'Advance Australia Fair.', 'In joyful strains then let us sing,', 'Advance Australia Fair.'];
function anthem(r, local, dur) {
  const sides = sideIdx(r), f = easeInOut(clamp(local / dur, 0, 1));
  const cam = makeCam(lerp(38, 67, f), LINE_Y - 7, 24, 15, 36);
  pitchScene(r, cam, sides, i => linedUp(sides, sides[0].includes(i) ? 0 : 1, i), local, { faces: [52.5, 90, 0], ref: [52.5, LINE_Y], ars: officials(LINE_Y) });
  const a = seg01(local, 0.1, 0.5) * (1 - seg01(local, dur - 0.4, dur));
  const step = dur / VERSE.length, n = clamp(Math.floor(local / step), 0, VERSE.length - 1), u = local - n * step;
  r.c.save(); r.c.globalAlpha = a;
  flag(r, W - 420, 70, 340);
  r.text('AUSTRALIAN NATIONAL ANTHEM', W / 2, H - 215, { size: 40, weight: 900, align: 'center', spacing: 6, shadow: 16 });
  r.pill(W / 2 - 560, H - 190, 1120, 86, 'rgba(6,26,56,0.88)', 14);
  r.text(VERSE[n], W / 2, H - 134, { size: 36, weight: 700, align: 'center', alpha: seg01(u, 0, 0.4) * (1 - seg01(u, step - 0.4, step)) });
  r.c.restore();
}

// Handshakes: the two clubs pair off along the halfway line and shake hands, one pair after another, and the referee shakes hands with his assistants.
const OFFICIALS_Y = LINE_Y + 4;
const pairAt = (sides, side, i) => { const k = sides[side].indexOf(i); return [52.5 + (k - 5) * 3.1 + (side ? 0.55 : -0.55), LINE_Y]; };
function shakeArms(r, cam, a, b, bob) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p = cam.p(m[0], m[1], 1); if (!p) return;
  const z = 1 + bob * 0.09, w = Math.max(3, p[2] * 0.13);
  r.line(cam, [[a[0], a[1], 1.15], [m[0], m[1], z], [b[0], b[1], 1.15]], w, '#e8b894');
  const q = cam.p(m[0], m[1], z);
  if (q) { r.c.fillStyle = '#e8b894'; r.c.beginPath(); r.c.arc(q[0], q[1], w * 0.85, 0, TAU); r.c.fill(); }
}
function handshake(r, local, dur, t0) {
  const sides = sideIdx(r), k = dur / 15, u = local / k, move = v => easeInOut(clamp(v / 2.5, 0, 1));
  const pos = (i, x) => { const side = sides[0].includes(i) ? 0 : 1, a = linedUp(sides, side, i), b = pairAt(sides, side, i), f = move(x / k); return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]; };
  const oy = lerp(LINE_Y, OFFICIALS_Y, move(u)), ars = officials(oy), refAt = [52.5, oy];
  pitchScene(r, makeCam(52.5, LINE_Y - 3, 37, 21, 40), sides, pos, local, { faces: [52.5, 90, 0], ref: refAt, ars, after: cam => {
    const n = Math.min(sides[0].length, sides[1].length);
    for (let j = 0; j < n; j++) { const v = u - 2.8 - j * 0.75; if (v > 0 && v < 2.6) shakeArms(r, cam, pos(sides[0][j], local), pos(sides[1][j], local), Math.sin(v * 13)); }
    const v = u - 3; if (v > 0 && v < 5) shakeArms(r, cam, refAt, ars[0], Math.sin(v * 13)); else if (v >= 5 && v < 10) shakeArms(r, cam, refAt, ars[1], Math.sin(v * 13));
  } });
  r.bug(t0);
  tag(r, 'HANDSHAKES', `${r.home.code} AND ${r.away.code}`, seg01(local, 0.3, 0.8));
}

// Into position: from the handshakes to where each player kicks off, the camera settling on the broadcast's own shot, so the match follows on without a jump.
function ready(r, local, dur, t0) {
  const sides = sideIdx(r), kick = r.fr.at(t0), span = dur * 0.85, f = easeInOut(clamp(local / span, 0, 1));
  const [cx, cy, cd] = r.camAt(t0);
  const cam = makeCam(lerp(52.5, cx, f), lerp(LINE_Y - 3, cy, f), lerp(37, cd, f), lerp(21, 28, f), 40);
  const pos = (i, u) => { const v = easeInOut(clamp(u / span, 0, 1)), a = pairAt(sides, sides[0].includes(i) ? 0 : 1, i), b = kick.players[i]; return [lerp(a[0], b[0], v), lerp(a[1], b[1], v)]; };
  const end = r.assistants(kick, t0), from = officials(OFFICIALS_Y), ars = from.map((a, n) => (end[n] ? [lerp(a[0], end[n].x, f), lerp(a[1], end[n].y, f)] : a));
  pitchScene(r, cam, sides, pos, local, { ball: [[kick.ball[0], kick.ball[1]]], faces: [kick.ball[0], kick.ball[1], 0], ref: [lerp(52.5, kick.ball[0], f), lerp(OFFICIALS_Y, kick.ball[1] + 6, f)], ars });
  r.bug(t0);
  tag(r, 'KICK-OFF', r.look().big.toUpperCase(), seg01(local, 0.4, 1));
  const a = 1 - clamp(local / 0.4, 0, 1);
  if (a > 0) { r.c.fillStyle = `rgba(0,0,0,${a})`; r.c.fillRect(0, 0, W, H); }
}

function preMatch(r, show, t0) {
  const k = show.dur / 150;
  let at = show.local;
  for (const [scene, secs] of PRE) {
    const d = secs * k;
    if (at > d && scene !== 'ready') { at -= d; continue; }
    if (scene === 'warmup') warmup(r, at, d, t0);
    else if (scene === 'home') lineupCard(r, r.home, r.hc, at, d);
    else if (scene === 'away') lineupCard(r, r.away, r.ac, at, d);
    else if (scene === 'walkout') walkout(r, at, d, t0);
    else if (scene === 'anthem') anthem(r, at, d);
    else if (scene === 'handshake') handshake(r, at, d, t0);
    else ready(r, at, d, t0);
    if (scene !== 'ready') fade(r, at, d, 0.4);
    return;
  }
}

// Team numbers for the first half only, from the match's own events up to half-time: the file's team stats are for the whole match and would give the second half away.
function firstHalf(r, end) {
  const code = [r.home.code, r.away.code], ev = r.d.events.filter(e => e.t <= end);
  const count = (type, side, test = () => true) => ev.filter(e => e.type === type && e.team === code[side] && test(e)).length;
  const both = f => [f(0), f(1)];
  return [
    ['POSSESSION %', r.possAt(end)],
    ['xG', both(s => +ev.filter(e => e.type === 'shot' && e.team === code[s]).reduce((a, e) => a + (e.xg || 0), 0).toFixed(2))],
    ['SHOTS', both(s => count('shot', s))],
    ['ON TARGET', both(s => count('shot', s, e => e.on_target))],
    ['CORNERS', both(s => count('corner', s))],
    ['FOULS', both(s => count('foul', s))],
  ];
}
function statBars(r, rows, top, gap, t) {
  const c = r.c;
  rows.forEach(([label, [h, a]], i) => {
    const y = top + i * gap, b = easeOut((t - 0.4 - i * 0.12) / 0.7), tot = h + a || 1, bw = 760 * b;
    r.text(label, W / 2, y, { size: 24, weight: 800, align: 'center', colour: 'rgba(255,255,255,.7)', spacing: 3, alpha: b });
    r.text(String(h), W / 2 - 430, y + 34, { size: 36, weight: 900, align: 'right', alpha: b });
    r.text(String(a), W / 2 + 430, y + 34, { size: 36, weight: 900, alpha: b });
    r.pill(W / 2 - 390, y + 14, 780, 18, 'rgba(255,255,255,0.08)', 9);
    if (bw * h / tot > 1) { c.fillStyle = r.hc; c.beginPath(); c.roundRect(W / 2 - bw / 2, y + 14, bw * h / tot, 18, 9); c.fill(); }
    if (bw * a / tot > 1) { c.fillStyle = r.ac; c.beginPath(); c.roundRect(W / 2 - bw / 2 + bw * h / tot, y + 14, bw * a / tot, 18, 9); c.fill(); }
  });
}
const mmss = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function halfTime(r, show) {
  const end = r.d.periods[0].end_t, sc = r.scoreAt(end - 0.01), t = show.local;
  r.bg(0.86); r.stripes(t, 0.4);
  const k = easeOut(t / 0.6);
  r.text('HALF-TIME', W / 2, 110, { size: 50, weight: 900, align: 'center', colour: LIME, spacing: 12, alpha: k });
  r.scoreLine(sc, 310, k);
  const seen = r.goals.filter(g => g.t <= end);
  const list = side => seen.filter(g => (g.team === (side ? r.away.code : r.home.code)) !== !!g.own_goal).map(g => `${lastName(r.names[g.scorer])} ${g.minute}'${g.own_goal ? ' (OG)' : ''}`);
  const a = easeOut((t - 0.6) / 0.6);
  list(0).slice(0, 4).forEach((s, i) => r.scorerLine(s, W / 2 - 700, 480 + i * 38, { alpha: a }));
  list(1).slice(0, 4).forEach((s, i) => r.scorerLine(s, W / 2 + 700, 480 + i * 38, { alpha: a }));
  statBars(r, firstHalf(r, end), 470, 84, t);
  r.text(`SECOND HALF IN ${mmss(show.dur - t)}`, W / 2, H - 50, { size: 30, weight: 900, align: 'center', spacing: 5, colour: 'rgba(255,255,255,.85)', alpha: k });
  fade(r, t, show.dur);
}

// The restart after a goal: another look at it, the score, and the teams going back for the kick-off.
function restart(r, show, t) {
  const g = r.goals.find(e => show.goal && Math.abs(e.t - show.goal.t) < 0.5);
  if (!g) { r.frame(t); return; }
  const loop = 15, u = show.local % loop, ts = Math.min(g.t - 8 + u, t);
  const [x, y, dist] = r.camAt(ts);
  r.drawScene(makeCam(x, y, dist, 28, 40), ts);
  r.bug(t);
  r.replayTag(u, { e: g });
  fade(r, u, loop, 0.3);
  const left = show.dur - show.local;
  if (left < 9) r.momentPanel('BACK FOR THE RESTART', r.scoreAt(g.t + 0.01), seg01(9 - left, 0, 0.5) * (1 - seg01(9 - left, 8.5, 9)), false);
}

// Full time: the final score and the match stats, the player of the match, then goodbye.
function fullTime(r, show) {
  const left = show.dur - show.local, bye = Math.min(20, show.dur * 0.25);
  if (left <= bye) {
    const u = bye - left, k = easeOut(u / 0.8);
    r.bg(0.9);
    if (r.A.league) { r.c.save(); r.c.globalAlpha = k; r.leagueFit(W / 2, 330, 240, 240); r.c.restore(); }
    r.text('THANKS FOR WATCHING', W / 2, 560, { size: 76, weight: 900, align: 'center', spacing: 4, alpha: k });
    r.text(`${r.home.name.toUpperCase()} ${r.d.result.home}-${r.d.result.away} ${r.away.name.toUpperCase()}`, W / 2, 640, { size: 34, weight: 800, align: 'center', colour: 'rgba(255,255,255,.8)', alpha: easeOut((u - 0.4) / 0.6) });
    r.text('HIGHLIGHTS AND THE FULL MATCH ARE COMING UP', W / 2, 710, { size: 30, weight: 900, align: 'center', colour: LIME, spacing: 3, alpha: easeOut((u - 0.8) / 0.6) });
    fade(r, u, bye, 0.8);
    return;
  }
  const cycle = 50, u = show.local % cycle;
  if (u < 32) { r.drawFulltime(u); fade(r, u, 32, 0.4); }
  else { r.drawMotm(u - 32); fade(r, u - 32, cycle - 32, 0.4); }
}

export function drawShow(r, show, t) {
  if (show.kind === 'pre') preMatch(r, show, r.t0);
  else if (show.kind === 'half') halfTime(r, show);
  else if (show.kind === 'goal') restart(r, show, t);
  else fullTime(r, show);
}
