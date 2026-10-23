// Goal of the week: plays one goal as a 5-second clip of the broadcast view (the same pictures as the match page's Full match), looping, on a canvas.
//   const stage = new ClipStage(canvas, season)       season: the league page's season (clubs, colours)
//   await stage.show(moment, { autoplay })            moment: a goalMoments() row; loads the match file and its pictures the first time
//   stage.play() / stage.pause() / stage.toggle()     stage.onState(playing) is called when it starts or stops
//   stage.destroy()
// One renderer per match is kept (the camera plans take a moment to build), so the five finalists of a round cost at most five builds.
import { loadMatchFile } from './match-file.js';
import { loadKits, matchKits } from './kits-data.js';
import { clipWindow } from './goal-wow.js';

export class ClipStage {
  constructor(canvas, season) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.season = season;
    this.rend = new Map(); this.m = null; this.playing = false; this.t = 0; this.onState = null;
    this._raf = requestAnimationFrame(ts => this.loop(ts));
  }

  async renderer(m) {
    if (this.rend.has(m.fixture)) return this.rend.get(m.fixture);
    const p = (async () => {
      const fx = this.season.fixtures.find(f => f.id === m.fixture);
      if (!fx) throw new Error('That match isn’t in the season.');
      const [file, hl, bc, kits] = await Promise.all([loadMatchFile(fx), import('./viewer/highlights.js'), import('./viewer/broadcast.js'), loadKits()]);
      if (!file?.frames?.data?.length) throw new Error('This match has no pictures.');
      const { buildKitArt } = await import('./viewer/player.js');
      const colour = code => this.season.teams.find(t => t.code === code)?.colour;
      const wear = matchKits(kits, fx.home, fx.away, { [fx.home]: colour(fx.home), [fx.away]: colour(fx.away) }, {});
      const teams = this.season.teams.filter(t => t.code === fx.home || t.code === fx.away);
      const { logoUrl } = await import('./dashboard-data.js');
      const [assets, kitArt] = await Promise.all([hl.loadAssets(teams), buildKitArt(wear, { home: logoUrl(fx.home), away: logoUrl(fx.away) })]);
      return new bc.BroadcastRenderer(file, { season: this.season, fixture: fx, assets, scale: Math.min(1, this.cv.width / 1920), kitArt });
    })();
    this.rend.set(m.fixture, p);
    p.catch(() => this.rend.delete(m.fixture));
    return p;
  }

  async show(m, { autoplay = true } = {}) {
    this.m = m; this.playing = false; this.ready = false;
    const key = m.key; this.key = key;
    const r = await this.renderer(m);
    if (this.key !== key || this._gone) return;   // another goal was picked while this one loaded
    this.r = r; [this.from, this.to] = clipWindow(m); this.t = this.from; this.ready = true; this.dirty = true;
    if (autoplay) this.play(); else this.set(false);
  }

  set(on) { this.playing = on; this.onState?.(on); }
  play() { if (!this.ready) return; if (this.t >= this.to - 0.02) this.t = this.from; this.set(true); }
  pause() { this.set(false); }
  toggle() { this.playing ? this.pause() : this.play(); }

  loop(ts) {
    this._raf = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min(0.25, (ts - (this._last || ts)) / 1000); this._last = ts;
    if (!this.ready || this._gone) return;
    if (this.playing) {
      this.t += dt;
      if (this.t >= this.to) { this.t = this.from; this.loops = (this.loops || 0) + 1; }   // a clip loops
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.g.drawImage(this.r.frame(this.t), 0, 0, this.cv.width, this.cv.height);
  }

  destroy() { this._gone = true; cancelAnimationFrame(this._raf); }
}

// A clip as a video file for the league's Instagram: the 5 seconds drawn once, in real time, onto a canvas and recorded by the browser (MP4 where the browser can,
// else WebM). Resolves { blob, ext }. Needs the tab in view (the browser only draws frames then).
export async function recordClip(season, m, { width = 1280 } = {}) {
  const cv = document.createElement('canvas'); cv.width = width; cv.height = Math.round(width * 9 / 16);
  const stage = new ClipStage(cv, season);
  try {
    await stage.show(m, { autoplay: false });
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!type) throw new Error('This browser can’t record video.');
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { rec.onstop = res; });
    stage.t = stage.from; stage.dirty = true;
    rec.start();
    stage.set(true);
    await new Promise(r => setTimeout(r, (stage.to - stage.from) * 1000 + 150));
    stage.set(false); rec.stop(); await done;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  } finally { stage.destroy(); }
}

// Several goals recorded back to back into one video (the five of the week, about a minute with the load gaps). onProgress(i, n) fires as each starts.
export async function recordClips(season, list, { width = 1280, onProgress } = {}) {
  const cv = document.createElement('canvas'); cv.width = width; cv.height = Math.round(width * 9 / 16);
  const stage = new ClipStage(cv, season);
  try {
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!type) throw new Error('This browser can’t record video.');
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { rec.onstop = res; });
    rec.start();
    for (let i = 0; i < list.length; i++) {
      onProgress?.(i, list.length);
      await stage.show(list[i], { autoplay: false });
      stage.t = stage.from; stage.dirty = true;
      stage.set(true);
      await new Promise(r => setTimeout(r, (stage.to - stage.from) * 1000 + 150));
      stage.set(false);
    }
    rec.stop(); await done;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  } finally { stage.destroy(); }
}

// The five of the week as one edited video, in the league's highlights style: a branded intro, then for each goal a title card (big number, scorer, club) and its
// 5-second clip with a lower-third, the highlights' blue wipe across every cut, and an outro with the address. Recorded in real time from a canvas (MP4 where the
// browser can, else WebM), so the tab has to stay in view. The next goal's pictures load while the current one plays, so the gaps hide behind the title cards.
// label: the round's name ("Round 7"). onProgress(i, n) fires as each goal's title card starts.
export async function recordReel(season, list, { width = 1280, label = '', onProgress } = {}) {
  const hl = await import('./viewer/highlights.js');
  const { lerp, easeOut, easeInOut, LIME, LIME2, YEL, DARK, FONT } = hl;
  const W = 1920, H = 1080, n = list.length;
  const mk = () => Object.assign(document.createElement('canvas'), { width, height: Math.round(width * 9 / 16) });
  const out = mk(), src = mk(), c = out.getContext('2d'), sc = width / W;
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
  if (!type) throw new Error('This browser can’t record video.');
  const team = code => season.teams.find(t => t.code === code);
  const nameOf = code => team(code)?.name || code;
  const colourOf = code => (/^#[0-9a-f]{6}$/i.test(team(code)?.colour || '') ? team(code).colour : YEL);
  const assets = await hl.loadAssets(season.teams.filter(t => list.some(m => m.home === t.code || m.away === t.code)));
  const stage = new ClipStage(src, season);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // Everything below draws in 1920 x 1080 units; scene() scales the canvas once for the whole frame.
  const txt = (str, x, y, { size = 40, weight = 800, colour = '#fff', align = 'left', italic = false, spacing = 0, alpha = 1 } = {}) => {
    if (alpha <= 0) return;
    c.save(); c.globalAlpha = alpha; c.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`; c.letterSpacing = `${spacing}px`;
    c.textAlign = align; c.fillStyle = colour; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 14; c.fillText(String(str), x, y); c.restore();
  };
  const fit = (im, cx, cy, w, h) => {
    if (!im) return;
    const r = Math.min(w / im.width, h / im.height), dw = im.width * r, dh = im.height * r;
    c.drawImage(im, cx - dw / 2, cy - dh / 2, dw, dh);
  };
  const grad = (x0, x1) => { const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, YEL); g.addColorStop(1, LIME2); return g; };
  const backdrop = (t, tint) => {
    c.fillStyle = DARK; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, W * 0.8);
    g.addColorStop(0, tint ? `${tint}66` : 'rgba(66,165,245,.28)'); g.addColorStop(1, 'rgba(6,26,56,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.35);
    for (let i = 0; i < 3; i++) {
      const w = lerp(0, W * 1.6, easeOut((t - 0.08 * i) / 0.8));
      c.fillStyle = i === 1 ? grad(-w / 2, w / 2) : `rgba(66,165,245,${0.07 + i * 0.04})`;
      c.fillRect(-w / 2, -260 + i * 170 + (i === 1 ? 70 : 0), w, i === 1 ? 14 : 60);
    }
    c.restore();
  };
  const crest = (cx, cy, s, a = 1) => { if (!assets.league) return; c.save(); c.globalAlpha = a; c.shadowColor = 'rgba(66,165,245,.6)'; c.shadowBlur = 50 * a; fit(assets.league, cx, cy, s, s); c.restore(); };
  // The highlights' wipe across a cut: d = seconds from the cut.
  const wipe = d => {
    const len = 0.4; if (d < -len || d > len) return;
    const x = lerp(W * 1.25, -W * 0.6, easeInOut((d + len) / (2 * len)));
    c.save(); c.translate(x, 0); c.transform(1, 0, -0.35, 1, 0, 0);
    c.fillStyle = DARK; c.fillRect(0, 0, W * 0.9, H);
    c.fillStyle = grad(0, 140); c.fillRect(-60, 0, 60, H);
    c.fillStyle = 'rgba(66,165,245,.35)'; c.fillRect(-110, 0, 22, H);
    c.fillStyle = grad(W * 0.9, W * 0.9 + 40); c.fillRect(W * 0.9, 0, 40, H);
    c.restore();
    if (Math.abs(d) < len * 0.6) crest(W / 2, H / 2, 160, 1 - Math.abs(d) / (len * 0.6));
  };

  const intro = t => {
    backdrop(t);
    const k = easeOut((t - 0.3) / 0.8); crest(W / 2, H / 2 - 190, 260 * (0.6 + 0.4 * k), k);
    txt('vLEAGUE', W / 2, H / 2 + 60, { size: 96, weight: 900, align: 'center', spacing: 6, alpha: easeOut((t - 0.8) / 0.6) });
    txt('GOAL OF THE WEEK', W / 2, H / 2 + 190, { size: 120, weight: 900, align: 'center', italic: true, colour: LIME, spacing: 4, alpha: easeOut((t - 1.1) / 0.6) });
    txt(`${label ? `${label.toUpperCase()}  ·  ` : ''}THE TOP ${n}`, W / 2, H / 2 + 270, { size: 38, weight: 800, align: 'center', spacing: 6, alpha: easeOut((t - 1.6) / 0.6) });
  };
  const title = (t, i, m) => {
    backdrop(t, colourOf(m.team));
    const k = easeOut(t / 0.6);
    txt(String(i + 1), W * 0.27, H / 2 + 230 - (1 - k) * 80, { size: 760, weight: 900, italic: true, align: 'center', colour: 'rgba(255,255,255,.08)', alpha: k });
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40; c.globalAlpha = k; fit(assets.logos[m.team], W * 0.27 - (1 - k) * 300, H / 2 - 30, 360, 360); c.restore();
    txt(`GOAL ${i + 1} OF ${n}`, W * 0.52, H / 2 - 110, { size: 40, weight: 800, colour: LIME, spacing: 8, alpha: easeOut((t - 0.2) / 0.5) });
    txt(String(m.scorerName).toUpperCase(), W * 0.52, H / 2 + 20, { size: 110, weight: 900, italic: true, alpha: easeOut((t - 0.3) / 0.5) });
    txt(`${nameOf(m.team).toUpperCase()}  ·  ${m.minute}′`, W * 0.52, H / 2 + 100, { size: 44, weight: 800, colour: 'rgba(255,255,255,.75)', spacing: 4, alpha: easeOut((t - 0.5) / 0.5) });
  };
  const play = (t, i, m, d) => {
    c.drawImage(stage.r.frame(Math.min(stage.to, stage.from + t)), 0, 0, W, H);
    const col = colourOf(m.team), k = easeOut((t - 0.35) / 0.5) * (1 - easeOut((t - (d - 0.9)) / 0.4));
    if (k > 0) {
      c.save(); c.translate(-(1 - k) * 900, 0);
      c.fillStyle = 'rgba(6,26,56,.9)'; c.beginPath(); c.moveTo(70, H - 250); c.lineTo(1120, H - 250); c.lineTo(1060, H - 90); c.lineTo(70, H - 90); c.closePath(); c.fill();
      c.fillStyle = col; c.fillRect(70, H - 250, 16, 160);
      c.fillStyle = grad(86, 1120); c.fillRect(86, H - 250, 1034, 6);
      txt(String(i + 1), 150, H - 124, { size: 100, weight: 900, italic: true, colour: LIME });
      txt(String(m.scorerName).toUpperCase(), 240, H - 160, { size: 62, weight: 900, italic: true });
      txt(`${nameOf(m.team).toUpperCase()}  ·  ${nameOf(m.home)} v ${nameOf(m.away)}  ·  ${m.minute}′`, 240, H - 108, { size: 28, weight: 700, colour: 'rgba(255,255,255,.78)', spacing: 2 });
      c.restore();
    }
    txt('GOAL OF THE WEEK', 70, 84, { size: 32, weight: 900, italic: true, spacing: 5, alpha: 0.9 });
    if (assets.league) { c.globalAlpha = 0.75; fit(assets.league, W - 100, 90, 80, 80); c.globalAlpha = 1; }
  };
  const outro = t => {
    backdrop(t);
    const k = easeOut(t / 0.8); crest(W / 2, 330, 220 * (0.8 + 0.2 * k), k);
    txt('vLEAGUE', W / 2, 560, { size: 90, weight: 900, align: 'center', spacing: 6, alpha: k });
    txt('VOTE FOR YOUR GOAL OF THE WEEK', W / 2, 650, { size: 36, weight: 800, align: 'center', colour: 'rgba(255,255,255,.75)', spacing: 4, alpha: easeOut((t - 0.5) / 0.6) });
    txt('ldg224.github.io/vLeague', W / 2, 720, { size: 40, weight: 900, align: 'center', colour: LIME, alpha: easeOut((t - 0.8) / 0.6) });
  };

  // One scene of the edit: draw(t, dur) for dur seconds, with the wipe across the cuts at its start and end (the last one fades to black instead).
  const scene = (dur, draw, { wipeIn = true, wipeOut = true } = {}) => new Promise(res => {
    const t0 = performance.now(), step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= dur) return res();
      c.save(); c.scale(sc, sc);
      draw(t, dur);
      if (wipeIn) wipe(t);
      if (wipeOut) wipe(t - dur);
      else { const fade = clamp01((t - (dur - 0.5)) / 0.5); if (fade > 0) { c.fillStyle = `rgba(0,0,0,${fade})`; c.fillRect(0, 0, W, H); } }
      c.restore();
      requestAnimationFrame(step);
    };
    step();
  });

  try {
    const rec = new MediaRecorder(out.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => { rec.onstop = res; });
    c.fillStyle = DARK; c.fillRect(0, 0, out.width, out.height);
    rec.start();
    stage.renderer(list[0]).catch(() => {});
    await scene(3.6, intro, { wipeIn: false });
    for (let i = 0; i < n; i++) {
      const m = list[i];
      onProgress?.(i, n);
      const loaded = stage.show(m, { autoplay: false });
      await scene(1.9, t => title(t, i, m));
      await loaded;
      if (!stage.ready) throw new Error('A goal’s pictures didn’t load.');
      if (list[i + 1]) stage.renderer(list[i + 1]).catch(() => {});
      await scene(stage.to - stage.from, (t, d) => play(t, i, m, d));
    }
    await scene(3.6, outro, { wipeOut: false });
    rec.stop(); await done;
    return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  } finally { stage.destroy(); }
}
