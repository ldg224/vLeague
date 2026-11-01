// Goal of the week for Instagram: portrait 1080 x 1920 videos (Reels and Stories) of a goal, recorded in the browser from a canvas.
//   recordInstagram(season, m, { label, rank, n })              a nominee: the 5-second clip in the portrait frame (blurred fill, the picture centred), with the scorer beneath
//   recordInstagram(season, m, { label, winner: true })         the winner: branded intro, the clip with an animated details panel and a GOAL stamp, outro with the address
//   buildInstagram(season, m, opts) -> { duration, draw(time), destroy() }   the same thing as a timeline, so a frame can be drawn without recording
// Resolves { blob, ext } (MP4 where the browser can record it, else WebM). The tab has to stay in view while it records.
import { ClipStage } from './goal-clip.js';
import { loadMatchFile } from './match-file.js';
import { CLIP_BEFORE } from './goal-wow.js';

export const IG_W = 1080, IG_H = 1920;
const BAND_Y = 520, BAND_H = 608;   // the 16:9 picture, 1080 wide, kept clear of Instagram's top and bottom buttons

export async function buildInstagram(season, m, { label = '', winner = false, rank = 1, n = 5, width = 1280 } = {}) {
  const hl = await import('./viewer/highlights.js');
  const { lerp, easeOut, easeInOut, LIME, LIME2, YEL, DARK, FONT } = hl;
  try { await document.fonts?.load('900 40px Oswald'); } catch { /* the fallback font is fine */ }
  const W = IG_W, H = IG_H;
  const fx = season.fixtures.find(f => f.id === m.fixture);
  const team = code => season.teams.find(t => t.code === code);
  const nameOf = code => team(code)?.name || code;
  const colourOf = code => (/^#[0-9a-f]{6}$/i.test(team(code)?.colour || '') ? team(code).colour : YEL);
  const file = await loadMatchFile(fx).catch(() => null);
  const assistName = m.assist != null ? (file?.byId?.[m.assist]?.name || '') : '';
  const assets = await hl.loadAssets(season.teams.filter(t => t.code === fx.home || t.code === fx.away));
  const src = Object.assign(document.createElement('canvas'), { width, height: Math.round(width * 9 / 16) });
  const stage = new ClipStage(src, season);
  await stage.show(m, { autoplay: false });
  if (!stage.ready) { stage.destroy(); throw new Error('The goal’s pictures didn’t load.'); }
  const clipLen = stage.to - stage.from;

  const out = Object.assign(document.createElement('canvas'), { width: W, height: H }), c = out.getContext('2d');
  const blur = Object.assign(document.createElement('canvas'), { width: 36, height: 64 }), bc = blur.getContext('2d');
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const k = (t, at, len = 0.45) => easeOut(clamp01((t - at) / len));

  const txt = (str, x, y, { size = 40, weight = 800, colour = '#fff', align = 'left', italic = false, spacing = 0, alpha = 1, max = 0 } = {}) => {
    if (alpha <= 0) return;
    const font = s => `${italic ? 'italic ' : ''}${weight} ${s}px ${FONT}`;
    c.save(); c.globalAlpha = alpha; c.letterSpacing = `${spacing}px`; c.textAlign = align; c.fillStyle = colour;
    c.font = font(size);
    if (max) { const w = c.measureText(String(str)).width; if (w > max) c.font = font(size * max / w); }
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 14; c.fillText(String(str), x, y); c.restore();
  };
  const fit = (im, cx, cy, w, h) => {
    if (!im) return;
    const r = Math.min(w / im.width, h / im.height);
    c.drawImage(im, cx - im.width * r / 2, cy - im.height * r / 2, im.width * r, im.height * r);
  };
  const grad = (x0, x1) => { const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, YEL); g.addColorStop(1, LIME2); return g; };
  const crest = (cx, cy, s, a = 1) => { if (!assets.league) return; c.save(); c.globalAlpha = a; c.shadowColor = 'rgba(66,165,245,.6)'; c.shadowBlur = 50 * a; fit(assets.league, cx, cy, s, s); c.restore(); };

  const backdrop = (t, tint) => {
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * 0.8, H * 0.18, 0, W * 0.8, H * 0.18, H * 0.7);
    g.addColorStop(0, tint ? `${tint}66` : 'rgba(66,165,245,.30)'); g.addColorStop(1, 'rgba(6,26,56,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.5);
    for (let i = 0; i < 3; i++) {
      const w = lerp(0, H * 1.4, easeOut((t - 0.08 * i) / 0.7));
      c.fillStyle = i === 1 ? grad(-w / 2, w / 2) : `rgba(66,165,245,${0.07 + i * 0.04})`;
      c.fillRect(-w / 2, -330 + i * 210 + (i === 1 ? 80 : 0), w, i === 1 ? 16 : 70);
    }
    c.restore();
  };
  // The highlights' blue wipe across a cut: d = seconds from the cut.
  const wipe = d => {
    const len = 0.4; if (d < -len || d > len) return;
    const x = lerp(W * 1.9, -W * 1.4, easeInOut((d + len) / (2 * len)));
    c.save(); c.translate(x, 0); c.transform(1, 0, -0.35, 1, 0, 0);
    c.fillStyle = DARK; c.fillRect(0, 0, W * 0.9, H);
    c.fillStyle = grad(0, 140); c.fillRect(-60, 0, 60, H);
    c.fillStyle = 'rgba(66,165,245,.35)'; c.fillRect(-110, 0, 22, H);
    c.fillStyle = grad(W * 0.9, W * 0.9 + 40); c.fillRect(W * 0.9, 0, 40, H);
    c.restore();
    if (Math.abs(d) < len * 0.6) crest(W / 2, H / 2, 200, 1 - Math.abs(d) / (len * 0.6));
  };

  // ---- the clip scene: blurred fill, the picture, header, details
  const chips = (winner ? [
    m.dist != null ? `${m.dist} M OUT` : null, `${m.xg.toFixed(2)} xG`, m.subtype === 'volley' ? 'VOLLEY' : m.body === 'head' ? 'HEADER' : null,
    m.passes >= 6 ? `${m.passes}-PASS MOVE` : null, assistName ? `ASSIST ${assistName.split(' ').pop().toUpperCase()}` : null,
  ] : []).filter(Boolean);
  const [sh, sa] = m.score || [], mineFirst = m.team === fx.home;
  const scoreLine = m.score ? `${nameOf(fx.home).toUpperCase()} ${mineFirst ? sh : sa}–${mineFirst ? sa : sh} ${nameOf(fx.away).toUpperCase()}` : `${nameOf(fx.home).toUpperCase()} V ${nameOf(fx.away).toUpperCase()}`;
  const pill = (str, cx, cy, a, s) => {
    c.save(); c.font = `800 32px ${FONT}`; c.letterSpacing = '2px';
    const w = c.measureText(str).width + 56, h = 64;
    c.translate(cx, cy); c.scale(s, s); c.globalAlpha = a;
    c.fillStyle = grad(-w / 2, w / 2); c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, 32); c.fill();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(str, 0, 2);
    c.restore();
  };
  const pillW = str => { c.save(); c.font = `800 32px ${FONT}`; c.letterSpacing = '2px'; const w = c.measureText(str).width + 56; c.restore(); return w; };

  const clipScene = (t, fade) => {
    const col = colourOf(m.team), tc = Math.min(clipLen, t);
    const f = stage.r.frame(stage.from + tc);
    const s = Math.max(blur.width / f.width, blur.height / f.height);
    bc.drawImage(f, (blur.width - f.width * s) / 2, (blur.height - f.height * s) / 2, f.width * s, f.height * s);
    c.imageSmoothingQuality = 'high'; c.drawImage(blur, 0, 0, W, H);
    c.fillStyle = 'rgba(6,26,56,.66)'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, BAND_Y + BAND_H / 2, 0, W / 2, BAND_Y + BAND_H / 2, H * 0.55);
    g.addColorStop(0, `${col}33`); g.addColorStop(1, 'rgba(6,26,56,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.drawImage(f, 0, BAND_Y, W, BAND_H);
    c.fillStyle = grad(0, W); c.fillRect(0, BAND_Y - 6, W, 6); c.fillRect(0, BAND_Y + BAND_H, W, 6);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(0, BAND_Y + BAND_H + 6, W * tc / clipLen, 5);

    // header
    const h0 = k(t, 0.05); crest(W / 2, 318, 130 * (0.8 + 0.2 * h0), h0);
    txt('GOAL OF THE WEEK', W / 2, 438, { size: 76, weight: 900, italic: true, align: 'center', colour: LIME, spacing: 3, alpha: k(t, 0.15), max: 960 });
    if (label) txt(label.toUpperCase(), W / 2, 492, { size: 32, weight: 800, align: 'center', spacing: 6, colour: 'rgba(255,255,255,.8)', alpha: k(t, 0.3) });

    // the GOAL stamp at the moment of the goal
    const gt = tc - CLIP_BEFORE;
    if (winner && gt > 0 && gt < 0.9) {
      const pop = easeOut(gt / 0.2), a = 1 - clamp01((gt - 0.5) / 0.4);
      c.fillStyle = `rgba(100,181,246,${0.35 * (1 - clamp01(gt / 0.5))})`; c.fillRect(0, BAND_Y, W, BAND_H);
      c.save(); c.translate(W / 2, BAND_Y + BAND_H / 2); c.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop); c.translate(-W / 2, -(BAND_Y + BAND_H / 2));
      txt('GOAL!', W / 2, BAND_Y + BAND_H / 2 + 70, { size: 230, weight: 900, italic: true, align: 'center', alpha: a, spacing: 4 });
      c.restore();
    }

    // details
    const y0 = BAND_Y + BAND_H + 6, dg = c.createLinearGradient(0, y0, 0, H);
    dg.addColorStop(0, 'rgba(6,26,56,0)'); dg.addColorStop(0.25, 'rgba(6,26,56,.82)'); dg.addColorStop(1, 'rgba(6,26,56,.95)');
    c.fillStyle = dg; c.fillRect(0, y0, W, H - y0);
    const rise = a => (1 - a) * 40;
    const tag = k(t, 0.2), lg = k(t, 0.3), nm = k(t, 0.4), cl = k(t, 0.55), sc = k(t, 0.7);
    txt(winner ? 'WINNER' : `GOAL ${rank} OF ${n}`, 80, 1202 + rise(tag), { size: 38, weight: 900, colour: LIME, spacing: 8, alpha: tag });
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 30; c.globalAlpha = lg; fit(assets.logos[m.team], 190 - (1 - lg) * 200, 1345, 210, 210); c.restore();
    txt(String(m.scorerName).toUpperCase(), 330, 1340 + rise(nm), { size: 92, weight: 900, italic: true, alpha: nm, max: 670 });
    txt(`${nameOf(m.team).toUpperCase()}  ·  ${m.minute}′`, 330, 1402 + rise(cl), { size: 40, weight: 800, colour: LIME, spacing: 3, alpha: cl, max: 670 });
    txt(scoreLine, 330, 1460 + rise(sc), { size: 34, weight: 700, colour: 'rgba(255,255,255,.8)', spacing: 2, alpha: sc, max: 670 });
    if (chips.length) {
      const gap = 16, widths = chips.map(pillW), rows = [[]];
      let used = 0;
      chips.forEach((ch, i) => { if (used + widths[i] > 920 && rows.at(-1).length) { rows.push([]); used = 0; } rows.at(-1).push(i); used += widths[i] + gap; });
      rows.forEach((row, r) => {
        const total = row.reduce((s, i) => s + widths[i], 0) + gap * (row.length - 1);
        let x = (W - total) / 2;
        row.forEach(i => { const a = k(t, 0.95 + i * 0.1, 0.35); pill(chips[i], x + widths[i] / 2, 1560 + r * 80, a, 0.7 + 0.3 * a); x += widths[i] + gap; });
      });
    }
    if (fade) { const f2 = clamp01((t - (clipLen - 0.2)) / 0.2); if (f2 > 0) { c.fillStyle = `rgba(6,26,56,${f2 * 0.5})`; c.fillRect(0, 0, W, H); } }
  };

  const intro = t => {
    backdrop(t);
    const a = k(t, 0.1, 0.5); crest(W / 2, 700, 380 * (0.6 + 0.4 * a), a);
    txt('vLEAGUE', W / 2, 1010, { size: 130, weight: 900, align: 'center', spacing: 8, alpha: k(t, 0.35, 0.35) });
    txt('GOAL OF THE WEEK', W / 2, 1150, { size: 112, weight: 900, italic: true, align: 'center', colour: LIME, spacing: 3, alpha: k(t, 0.55, 0.35), max: 980 });
    if (label) txt(label.toUpperCase(), W / 2, 1240, { size: 44, weight: 800, align: 'center', spacing: 8, alpha: k(t, 0.75, 0.35) });
  };
  const outro = t => {
    backdrop(t, colourOf(m.team));
    const a = k(t, 0, 0.6); crest(W / 2, 560, 300 * (0.8 + 0.2 * a), a);
    txt('WINNER', W / 2, 860, { size: 52, weight: 900, align: 'center', colour: LIME, spacing: 12, alpha: k(t, 0.3) });
    txt(String(m.scorerName).toUpperCase(), W / 2, 980, { size: 110, weight: 900, italic: true, align: 'center', alpha: k(t, 0.4), max: 960 });
    txt(`${nameOf(m.team).toUpperCase()}  ·  ${m.minute}′`, W / 2, 1050, { size: 44, weight: 800, align: 'center', colour: 'rgba(255,255,255,.78)', spacing: 4, alpha: k(t, 0.55) });
    txt('vLEAGUE', W / 2, 1290, { size: 96, weight: 900, align: 'center', spacing: 6, alpha: k(t, 0.8) });
    txt('ldg224.github.io/vLeague', W / 2, 1370, { size: 42, weight: 900, align: 'center', colour: LIME, alpha: k(t, 1.0) });
  };

  const scenes = winner
    ? [{ dur: 1.7, draw: intro, wipeIn: false }, { dur: clipLen, draw: t => clipScene(t, false) }, { dur: 2.6, draw: outro, wipeOut: false, fadeOut: true }]
    : [{ dur: clipLen, draw: t => clipScene(t, false), wipeIn: false, wipeOut: false }];
  const duration = scenes.reduce((s, x) => s + x.dur, 0);

  return {
    duration, canvas: out,
    draw(time) {
      let at = 0;
      for (const s of scenes) {
        if (time < at + s.dur || s === scenes.at(-1)) {
          const t = Math.min(time - at, s.dur);
          s.draw(t);
          if (s.wipeIn !== false) wipe(t);
          if (s.wipeOut !== false) wipe(t - s.dur);
          if (s.fadeOut) { const fd = clamp01((t - (s.dur - 0.5)) / 0.5); if (fd > 0) { c.fillStyle = `rgba(0,0,0,${fd})`; c.fillRect(0, 0, W, H); } }
          return;
        }
        at += s.dur;
      }
    },
    destroy() { stage.destroy(); },
  };
}

export async function recordInstagram(season, m, opts = {}) {
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
  if (!type) throw new Error('This browser can’t record video.');
  const tl = await buildInstagram(season, m, opts);
  try {
    const rec = new MediaRecorder(tl.canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 10e6 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { rec.onstop = res; });
    tl.draw(0);
    rec.start();
    await new Promise(res => {
      const t0 = performance.now(), step = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= tl.duration) return res();
        tl.draw(t); requestAnimationFrame(step);
      };
      step();
    });
    rec.stop(); await done;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  } finally { tl.destroy(); }
}
