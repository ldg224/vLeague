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
      const [assets, kitArt] = await Promise.all([hl.loadAssets(teams), buildKitArt(wear)]);
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
