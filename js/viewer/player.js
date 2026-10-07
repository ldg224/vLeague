// The match page's player: highlights after full time, the broadcast view of the whole match
// (live or replay), the top-down tactical view, and downloads (highlights MP4, full match video
// sped up, match file). Renderers live in js/highlights.js and js/broadcast.js; this file only
// plays them onto the page. Nothing here runs until a match is live or finished.

import { liveSimTime, liveSpeed, clockAt, addedAt } from './data.js';
import { esc, statusPill } from './ui.js';
import { Replay } from './replay.js';

const W = 1920, H = 1080;
const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// Picture quality steps. It starts at what the screen can show (a phone doesn't need 1920 pixels across), then moves down a step
// only if frames really are slow, and back up when they are fast again, so a hiccup never leaves the picture blurry.
const LADDER = [1, 0.85, 0.7, 0.58, 0.46, 0.36];
function startScale() {
  const box = document.getElementById('mp-stage')?.getBoundingClientRect();
  const need = ((box?.width || innerWidth) * Math.min(devicePixelRatio || 1, 2)) / W;
  return LADDER.filter(s => s >= Math.min(1, need)).pop() ?? 1;
}

export function playerCard(st) {
  const tabs = st === 'ft' ? [['highlights', 'Highlights'], ['broadcast', 'Full match'], ['tactical', 'Tactical']] : [['broadcast', 'Broadcast'], ['tactical', 'Tactical']];
  return `<section class="gc-card replay-card mp" id="mp">
    <div class="mp-head"><h2 class="card-title mp-title">${st === 'live' ? `Live match${statusPill('live')}` : 'Match centre'}</h2>
      <div class="mp-tabs" role="tablist">${tabs.map(([k, l], i) => `<button role="tab" data-view="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
      ${st === 'ft' ? '<button class="ctl mp-dl-btn" data-dl aria-expanded="false">⬇ Download</button>' : ''}</div>
    <div class="mp-dl" hidden></div>
    <div class="mp-screen" id="mp-screen">
    <div class="mp-stage" id="mp-stage">
      <canvas class="mp-canvas" id="mp-canvas" width="1280" height="720" aria-label="Match video"></canvas>
      <canvas class="mp-tactical" id="pitch" width="1110" height="740" aria-label="Tactical view" hidden></canvas>
      <div class="replay-caption" id="caption"></div>
      <button class="mp-big" id="mp-big" hidden aria-label="Play">▶</button>
      <div class="mp-msg" id="mp-msg">Loading match…</div>
    </div>
    <div class="mp-controls">
      <button class="ctl" id="mp-play">Play</button>
      <span class="mp-extra" id="mp-extra"></span>
      <span class="replay-clock" id="mp-time">0:00</span>
      <div class="mp-seek"><input type="range" id="mp-seek" min="0" max="1" step="0.05" value="0" aria-label="Position"><div class="mp-marks" id="mp-marks"></div></div>
      <button class="ctl" id="mp-full" aria-label="Full screen" title="Full screen">⛶</button>
    </div>
    </div>
  </section>`;
}

export class MatchPlayer {
  // ctx: { S, FX, st, data (the match file), timeline (element whose .tl-row[data-t] rows jump the video) }
  constructor(ctx) {
    Object.assign(this, ctx);
    this.el = document.getElementById('mp');
    this.$ = s => this.el.querySelector(s);
    this.el.classList.toggle('mp-live', this.st === 'live');   // a live match is a broadcast: no play, pause, seek or speed
    this.cv = this.$('#mp-canvas'); this.g = this.cv.getContext('2d');
    this.view = null; this.r = {}; this.playing = false; this.t = 0; this.speed = 1;
    this.scale = this.bestScale = startScale(); this.cost = []; this.slow = this.fast = 0; this.holdUntil = performance.now() + 3000; this.dirty = true; this.exporting = false;
    this.names = Object.fromEntries(this.data.players.map(p => [p.id, p.name]));
    this.wire();
    this.ready = this.load();
  }

  async load() {
    try {
      this.hl = await import('./highlights.js');
      this.bc = await import('./broadcast.js').catch(() => null);
      const teams = this.S.teams.filter(t => t.code === this.FX.home || t.code === this.FX.away);
      this.assets = await this.hl.loadAssets(teams);
    } catch (e) {
      this.hl = null;   // no graphics: tactical view still works
      console.warn('Match graphics unavailable', e);
    }
    if (!this.bc?.BroadcastRenderer) this.el.querySelector('[data-view="broadcast"]').hidden = true;
    if (!this.hl) this.el.querySelector('[data-view="highlights"]')?.setAttribute('hidden', '');
    const first = [...this.el.querySelectorAll('[data-view]')].find(b => !b.hidden)?.dataset.view || 'tactical';
    this.show(first);
    this._raf = requestAnimationFrame(ts => this.loop(ts));
  }

  destroy() { cancelAnimationFrame(this._raf); this.tactical?.destroy(); this.ro?.disconnect(); }

  // ---------- renderers ----------

  renderer(view) {
    const have = this.r[view];
    if (have) { have.setScale(this.scale); return have; }   // a quality change only resizes the picture, it never rebuilds the camera plans
    const opts = { season: this.S, fixture: this.FX, assets: this.assets, scale: this.scale };
    return (this.r[view] = view === 'highlights' ? new this.hl.HighlightsRenderer(this.data, opts) : new this.bc.BroadcastRenderer(this.data, opts));
  }
  range() {   // [min, max] of the current view's time
    if (this.view === 'highlights') return [0, this.renderer('highlights').duration];
    const r = this.view === 'broadcast' ? this.renderer('broadcast') : this.tactical;
    const max = this.st === 'live' ? Math.min(r.t1, liveSimTime(this.FX, this.S)) : r.t1;
    return [r.t0, max];
  }

  show(view) {
    const prevT = this.view && this.view !== 'highlights' ? this.t : null;
    this.view = view; this.holdUntil = performance.now() + 2500; this.cost = [];   // a new view's first frames are slow; don't judge by them
    this.el.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
    const tac = view === 'tactical';
    this.cv.hidden = tac; this.$('#pitch').hidden = !tac; this.$('#caption').hidden = !tac;
    this.$('#mp-msg').hidden = true;
    if (tac) {
      if (!this.tactical) this.makeTactical();
      if (prevT != null) this.tactical.seek(prevT);
      else if (this.st === 'live') this.tactical.seek(liveSimTime(this.FX, this.S));
      this.t = this.tactical.t;
    } else {
      if (this.tactical?.playing) this.tactical.pause();
      const [a] = this.range();
      this.t = view === 'highlights' ? 0 : prevT ?? (this.st === 'live' ? liveSimTime(this.FX, this.S) : a);
    }
    this.playing = this.st === 'live' && view !== 'highlights';
    this.follow = this.playing;   // watching live: the picture is locked to the live time
    if (tac && this.playing) this.tactical.play();
    this.speed = view === 'highlights' ? 1 : this.st === 'live' ? liveSpeed(this.FX, this.S) : this.speed > 1 ? this.speed : 4;
    if (tac) this.tactical.speed = this.speed;
    this.controls();
    this.dirty = true;
  }

  makeTactical() {
    const shown = this.data.events.filter(e => ['goal', 'shot', 'save', 'card', 'penalty', 'woodwork', 'offside'].includes(e.type)), n = this.names;
    const label = e => e.type === 'goal' ? `GOAL! ${n[e.scorer] || ''}${e.own_goal ? ' (OG)' : ''} · ${e.score.join('-')}`
      : e.type === 'shot' ? `Shot · ${n[e.player]} · ${e.outcome}` : e.type === 'save' ? `Save · ${n[e.player]}`
      : e.type === 'card' ? `${e.card === 'yellow' ? '🟨' : '🟥'} ${n[e.player]}` : e.type === 'woodwork' ? 'Off the woodwork!' : e.type === 'penalty' ? 'Penalty!' : `Offside · ${n[e.player]}`;
    const cap = this.$('#caption');
    this.tactical = new Replay(this.$('#pitch'), this.data, {
      onFrame: t => {
        if (this.view !== 'tactical' || !this.tactical) return;   // the first frame is drawn inside the constructor
        this.t = t; if (this.st === "live") this.tactical.speed = liveSpeed(this.FX, this.S, t); this.syncUi();
        const recent = shown.filter(e => e.t <= t && t - e.t < 4).pop();
        cap.classList.toggle('show', !!recent);
        if (recent) cap.textContent = `${recent.minute}' ${label(recent)}`;
      },
    });
    if (this.st === 'live') this.tactical.maxT = () => liveSimTime(this.FX, this.S);
  }

  // ---------- controls ----------

  controls() {
    const live = this.st === 'live' && this.view !== 'highlights';
    this.$('#mp-extra').innerHTML = this.view === 'highlights' ? ''
      : live ? '<button class="ctl live" id="mp-live">● Live</button>'
      : `<select class="ctl" id="mp-speed" aria-label="Speed">${[1, 2, 4, 8, 16, 40].map(v => `<option value="${v}"${v === this.speed ? ' selected' : ''}>${v}x</option>`).join('')}</select>`;
    const seek = this.$('#mp-seek'), [a, b] = this.fullRange();
    seek.min = a; seek.max = b;
    this._marks = null;
    this.syncUi();
  }
  // Seek-bar dots. While a match is live, only what has already happened (no spoilers).
  drawMarks() {
    const [a, b] = this.fullRange(), now = this.st === 'live' && this.view !== 'highlights' ? liveSimTime(this.FX, this.S) : Infinity;
    const list = this.marks().filter(m => m.t <= now);
    if (this._marks === list.length) return;
    this._marks = list.length;
    this.$('#mp-marks').innerHTML = list.map(m => `<i class="mk mk-${m.type}${m.card ? ' mk-' + m.card : ''}" style="left:${((m.t - a) / (b - a || 1)) * 100}%" title="${esc(m.label)}"></i>`).join('');
  }
  fullRange() {
    if (this.view === 'highlights') return this.range();
    const r = this.view === 'broadcast' ? this.renderer('broadcast') : this.tactical;
    return [r.t0, r.t1];
  }
  marks() {
    if (this.view === 'highlights') {
      return this.renderer('highlights').segs.filter(s => s.type === 'clip').map(s => ({ t: s.start, type: s.clip.kind === 'goal' ? 'goal' : ['yellow', 'red'].includes(s.clip.kind) ? 'card' : 'chance',
        label: s.clip.kind === 'goal' ? `Goal: ${this.names[s.clip.e.scorer] || ''}` : s.clip.kind }));
    }
    if (this.view === 'broadcast' && this.renderer('broadcast').markers) return this.renderer('broadcast').markers;
    return this.data.events.filter(e => e.type === 'goal' || e.type === 'card').map(e => ({ t: e.t, type: e.type, card: e.card === 'second_yellow' ? 'second_yellow' : e.card === 'red' ? 'red' : undefined, label: e.type === 'goal' ? `${e.minute}' ${this.names[e.scorer] || ''}` : `${e.minute}' ${this.names[e.player] || ''}` }));
  }
  syncUi() {
    this.drawMarks();
    const [a, b] = this.fullRange(), playing = this.view === 'tactical' ? this.tactical?.playing : this.playing;
    this.$('#mp-play').textContent = playing ? 'Pause' : 'Play';
    this.$('#mp-seek').value = this.t;
    const extra = addedAt(this.data.periods, this.t);
    this.$('#mp-time').textContent = this.view === 'highlights' ? `${mmss(this.t)} / ${mmss(b)}` : `${clockAt(this.data.periods, this.t)}${extra ? ` +${extra}` : ''}`;
    const big = this.$('#mp-big');
    big.hidden = playing || this.view === 'tactical';
    big.textContent = this.view === 'highlights' && this.t >= b - 0.05 ? '↻' : '▶';
    const lv = this.$('#mp-live');
    if (lv) lv.classList.toggle('behind', liveSimTime(this.FX, this.S) - this.t > 5);
    this.$('#mp-seek').style.setProperty('--pos', `${((this.t - a) / (b - a || 1)) * 100}%`);
  }

  play() {
    if (this.view === 'tactical') { this.tactical.play(); return this.syncUi(); }
    const [, b] = this.range();
    if (this.t >= b - 0.05 && this.view === 'highlights') this.t = 0;
    this.playing = true; this.syncUi();
  }
  pause() { if (this.view === 'tactical') this.tactical.pause(); this.playing = false; this.follow = false; this.syncUi(); }
  seek(t) {
    if (this.view === 'tactical') { this.tactical.seek(t); this.t = this.tactical.t; return this.syncUi(); }
    const [a, b] = this.range();
    this.holdUntil = performance.now() + 1500; this.cost = [];   // the first frames after a jump are slow; don't judge by them
    this.t = Math.max(a, Math.min(t, b)); this.dirty = true;
    this.follow = this.st === 'live' && this.view !== 'highlights' && this.t >= liveSimTime(this.FX, this.S) - 2;   // seeking back stops following live
    this.syncUi();
  }
  // A timeline row: jump there in the full-match view.
  jump(tSim) {
    if (this.st === 'live') return;
    if (this.view === 'highlights') this.show(this.bc?.BroadcastRenderer ? 'broadcast' : 'tactical');
    this.seek(tSim - 6); this.play();
  }

  wire() {
    this.el.addEventListener('click', e => {
      const v = e.target.closest('[data-view]');
      if (this.st === 'live' && e.target.closest('#mp-play, #mp-big, #mp-live, .mp-canvas')) return;   // nothing to control while live
      if (v) { this.pause(); return this.show(v.dataset.view); }
      if (e.target.closest('#mp-play, #mp-big')) return (this.view === 'tactical' ? this.tactical?.playing : this.playing) ? this.pause() : this.play();
      if (e.target.closest("#mp-live")) { this.seek(liveSimTime(this.FX, this.S)); return this.play(); }
      if (e.target.closest('#mp-full')) return this.fullscreen();
      // Full screen with the controls hidden: the first tap only brings them back.
      if (this._tapWoke && e.target.closest('.mp-stage')) { this._tapWoke = false; return; }
      if (e.target.closest('[data-dl]')) return this.toggleDownloads();
      if (e.target.closest('.mp-canvas') && this.view !== 'tactical') return this.playing ? this.pause() : this.play();
    });
    this.el.addEventListener('input', e => { if (e.target.id === 'mp-seek' && this.st !== 'live') this.seek(+e.target.value); });
    this.el.addEventListener('change', e => {
      if (e.target.id === 'mp-speed') { this.speed = +e.target.value; if (this.tactical) this.tactical.speed = this.speed; }
    });
    this.timeline?.addEventListener('click', e => { const r = e.target.closest('.tl-row'); if (r) this.jump(+r.dataset.t); });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.$('#mp-stage'));
    const onFs = () => this.setFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    // Controls fade while playing full screen; any movement, touch or key brings them back.
    const scr = this.$('#mp-screen');
    scr.addEventListener('pointerdown', () => { this._tapWoke = this.fsWake(); }, { passive: true });
    for (const ev of ['pointermove', 'keydown']) scr.addEventListener(ev, () => this.fsWake(), { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.fsFake) this.setFs(false); });
  }

  // Full screen covers the picture and the controls (#mp-screen). Where the Fullscreen API
  // isn't available for page elements (Safari on iPhone only allows it for <video>), or it's
  // refused, the player becomes a fixed layer over the whole page instead.
  fullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (this.fsFake) return this.setFs(false);
    const scr = this.$('#mp-screen'), req = scr.requestFullscreen || scr.webkitRequestFullscreen;
    const fake = () => { this.fsFake = true; this.setFs(true); };
    if (!req || document.fullscreenEnabled === false) return fake();
    try {
      const p = req.call(scr);
      if (p?.catch) p.catch(fake);
    } catch { fake(); }
    screen.orientation?.lock?.('landscape').catch(() => {});
  }

  setFs(on) {
    const scr = this.$('#mp-screen'), btn = this.$('#mp-full');
    if (!on) this.fsFake = false;
    scr.classList.toggle('mp-fs', on);
    document.body.classList.toggle('mp-fs-open', on);
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    btn.title = on ? 'Exit full screen (Esc)' : 'Full screen';
    btn.textContent = on ? '✕' : '⛶';
    this.fsWake();
    this.resize();
  }

  // Show the controls again and restart the hide timer. Returns true if they were hidden.
  fsWake() {
    const scr = this.$('#mp-screen'), was = scr.classList.contains('mp-idle');
    scr.classList.remove('mp-idle');
    clearTimeout(this._idle);
    if (scr.classList.contains('mp-fs')) this._idle = setTimeout(() => {
      const playing = this.view === 'tactical' ? this.tactical?.playing : this.playing;
      if (playing && !scr.contains(document.activeElement?.closest?.('.mp-controls') || null)) scr.classList.add('mp-idle');
      else this.fsWake();
    }, 3000);
    return was;
  }

  resize() {
    const box = this.$('#mp-stage').getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    // Full screen may be taller or wider than 16:9; draw for the part the picture actually fills.
    const fit = Math.min(box.width, box.height ? box.height * W / H : box.width);
    const w = Math.max(320, Math.min(Math.round(fit * dpr), Math.round(W * this.scale)));
    const h = Math.round(w * H / W);
    if (this.cv.width !== w) { this.cv.width = w; this.cv.height = h; this.dirty = true; }
  }

  // ---------- frame loop ----------

  loop(ts) {
    this._raf = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min(0.25, ((ts - (this._last || ts)) / 1000)); this._last = ts;
    if (this.view === 'tactical' || !this.hl) return;
    if (this.playing) {
      const [, b] = this.range();
      // Following live, the picture shows exactly the live moment (the same time the score, clock and
      // timeline on the page use). Adding up frame times drifted behind (slow first frames, a tab in
      // the background), so the page showed goals before the video did.
      if (this.follow && this.st === 'live' && this.view !== 'highlights') this.t = liveSimTime(this.FX, this.S);
      else this.t += dt * (this.st === "live" && this.view !== "highlights" ? liveSpeed(this.FX, this.S, this.t) : this.speed);
      if (this.t >= b) { this.t = b; if (this.view === 'highlights' || this.st !== 'live') this.playing = false; }
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const r = this.renderer(this.view), t0 = performance.now();
    const src = r.frame(this.t);
    this.g.drawImage(src, 0, 0, this.cv.width, this.cv.height);
    this.adapt(performance.now() - t0);
    this.syncUi();
  }
  // Quality follows how the frames are really coping. One hiccup (a garbage collection, a seek, a switch of view, a hidden tab) never
  // counts: it takes two slow stretches of about a second each to step down, three fast ones to step back up, and never above
  // what the screen needs.
  adapt(ms) {
    if (!this.playing || document.hidden) { this.cost = []; return; }
    if (performance.now() < this.holdUntil) return;
    this.cost.push(ms);
    if (this.cost.length < 60) return;
    const s = [...this.cost].sort((a, b) => a - b), p75 = s[Math.floor(s.length * 0.75)];
    this.cost = [];
    const i = Math.max(0, LADDER.findIndex(q => Math.abs(q - this.scale) < 1e-6));
    if (p75 > 24 && i < LADDER.length - 1) { this.slow++; this.fast = 0; if (this.slow >= 2) this.setQuality(LADDER[i + 1]); }
    else if (p75 < 11 && i > 0 && LADDER[i - 1] <= this.bestScale + 1e-6) { this.fast++; this.slow = 0; if (this.fast >= 3) this.setQuality(LADDER[i - 1]); }
    else this.slow = this.fast = 0;
  }
  setQuality(s) {
    this.scale = s; this.slow = this.fast = 0; this.holdUntil = performance.now() + 4000;
    for (const r of Object.values(this.r)) r.setScale?.(s);
    this.resize(); this.dirty = true;
  }

  // ---------- downloads ----------

  toggleDownloads() {
    const box = this.$('.mp-dl'), btn = this.$('[data-dl]');
    if (!box.hidden && !this.exporting) { box.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    box.hidden = false; btn.setAttribute('aria-expanded', 'true');
    if (this.exporting) return;
    const can = this.hl?.supported?.(), fx = this.FX, dur = this.data.periods.length ? this.fullMatchSeconds() : 5400;
    const est = sp => `${mmss(dur / sp)} long · about ${Math.round(dur / sp * 3.2 / 8)} MB`;
    box.innerHTML = `<div class="mp-dl-grid">
      <div class="mp-dl-item"><b>🎬 Highlights video</b><span>MP4, 1080p, about 3 minutes. Made in your browser: takes 2–3 minutes.</span>
        <button class="ctl" data-export="highlights"${can ? '' : ' disabled'}>Download highlights</button></div>
      <div class="mp-dl-item"><b>📺 Full match video</b><span>The whole match, sped up, 720p. Made in your browser: allow 5–15 minutes.</span>
        <span class="mp-dl-row"><select class="ctl" id="mp-dl-speed">${[4, 8, 16].map(v => `<option value="${v}"${v === 8 ? ' selected' : ''}>${v}x speed · ${est(v)}</option>`).join('')}</select>
        <button class="ctl" data-export="full"${can ? '' : ' disabled'}>Download</button></span></div>
      <div class="mp-dl-item"><b>📄 Match file</b><span>The raw match data (.json.gz). Tiny and instant.</span>
        <a class="ctl" href="${esc(this.fileUrl || '#')}" download="${esc(this.fileBase())}.json.gz">Download match file</a></div>
    </div>
    ${can ? '' : '<p class="mp-dl-note">Videos need Chrome or Edge on a computer. On this device you can still watch everything above.</p>'}
    <div class="mp-dl-progress" hidden><div class="mp-bar"><span></span></div><p class="mp-dl-status"></p><button class="ctl" data-cancel>Cancel</button></div>`;
    box.querySelectorAll('[data-export]').forEach(b => { b.onclick = () => this.exportVideo(b.dataset.export); });
    box.querySelector('[data-cancel]').onclick = () => { this.cancelled = true; };
  }
  fullMatchSeconds() { const fr = this.data.frames.data; return (fr[fr.length - 1][0] - fr[0][0]) / 10; }
  fileBase() {
    const f = this.FX, r = f.result || {};
    return `${f.stage ? f.stage : `Week ${f.week}`} - ${f.home} ${r.home ?? ''}-${r.away ?? ''} ${f.away}`.replace(/[\\/:*?"<>|]/g, '-');
  }

  async exportVideo(kind) {
    const box = this.$('.mp-dl'), prog = box.querySelector('.mp-dl-progress'), bar = prog.querySelector('.mp-bar span'), status = prog.querySelector('.mp-dl-status');
    const speed = +(box.querySelector('#mp-dl-speed')?.value || 8);
    const name = `${this.fileBase()} ${kind === 'highlights' ? 'Highlights' : `Full match ${speed}x`}.mp4`;
    let handle = null;
    if (window.showSaveFilePicker) {   // stream straight to disk (needed for the long full-match file)
      try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] }); }
      catch { return; }   // picker cancelled
    }
    this.exporting = true; this.cancelled = false;
    box.querySelectorAll('[data-export], #mp-dl-speed').forEach(b => { b.disabled = true; });
    prog.hidden = false; status.textContent = 'Preparing…'; bar.style.width = '0%';
    const guard = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', guard);
    const started = performance.now();
    try {
      let source, opts = {};
      if (kind === 'highlights') {
        source = new this.hl.HighlightsRenderer(this.data, { season: this.S, fixture: this.FX, assets: this.assets, scale: 1 });
      } else {
        source = this.fullMatchSource(speed);
        opts = { fps: 30 };
      }
      const blob = await this.hl.exportVideo(source, {
        ...opts, fileHandle: handle, isCancelled: () => this.cancelled,
        onProgress: (phase, frac) => {
          bar.style.width = `${Math.round(frac * 100)}%`;
          const secs = (performance.now() - started) / 1000, left = frac > 0.03 ? secs / frac - secs : null;
          status.textContent = `${phase} ${Math.round(frac * 100)}%${left ? ` · about ${Math.max(1, Math.round(left / 60))} min left` : ''}`;
        },
      });
      source.destroy?.();
      if (blob) {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
      }
      bar.style.width = '100%';
      status.textContent = `✓ Saved “${name}” (${Math.round((performance.now() - started) / 1000)} s).`;
    } catch (e) {
      status.textContent = e.message === 'Cancelled' ? 'Cancelled.' : `Couldn’t make the video: ${e.message}`;
    } finally {
      removeEventListener('beforeunload', guard);
      this.exporting = false;
      box.querySelectorAll('[data-export], #mp-dl-speed').forEach(b => { b.disabled = false; });
    }
  }

  // The full match as a video source for exportVideo: output time T -> match time t0 + T * speed, at 720p.
  fullMatchSource(speed) {
    if (this.bc?.BroadcastRenderer) {
      const r = new this.bc.BroadcastRenderer(this.data, { season: this.S, fixture: this.FX, assets: this.assets, scale: 1280 / 1920 });
      return { duration: (r.t1 - r.t0) / speed, frame: T => r.frame(r.t0 + T * speed) };
    }
    // Fallback: the tactical view drawn on its own canvas.
    const cv = document.createElement('canvas'); cv.width = 1110; cv.height = 740;
    const rp = new Replay(cv, this.data);
    rp.pause();
    return { duration: (rp.t1 - rp.t0) / speed, frame: T => { rp.seek(rp.t0 + T * speed); return cv; }, destroy: () => rp.destroy() };
  }
}
