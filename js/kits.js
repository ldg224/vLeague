// Kits (0.59, S-23 and S-20): design a club's home, away, goalkeeper and special kits on a 3D player.
// Built for phones first: the player stays at the top while four tabs (Style, Colours, Text, Logo) change it, everything is a big
// tap target, and there is a first-time tour. Undo and redo, "surprise me", copy from another kit, ready-made colour schemes, and a
// logo you drag straight on the shirt. A logo or uploaded design goes live as soon as it's saved (0.60.1; the office can take one down). Saved to Supabase club_kits (migration 0043).
// The shirt itself is drawn by js/kit.js, the same drawing the match views use. The office can pick any club.
import { enterPlace } from './shell.js';
import { esc, crestUrl, clubs } from './member.js';
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { contrast, isHex } from './club-colour.js';
import { startTour, tourSeen } from './tour.js';
import { SLOTS, PATTERNS, TEX_W, TEX_H, cleanDesign, startDesign, drawKit, drawKitFront, drawTemplate, kitSprite, kitName } from './kit.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const LOGO_MAX = 384, LOGO_BYTES = 240 * 1024, ART_BYTES = 1400 * 1024;
const kitLogoUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/kits/${path}` : '');
const image = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
const reduceMotion = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const STATUS = {
  pending: ['wait', 'Saved. It shows everywhere the next time anyone loads a page.'],
  approved: ['ok', 'Your logo is live. Everyone can see it.'],
  rejected: ['bad', 'The league office took this logo down. Upload a different one.'],
};
const ART_STATUS = {
  pending: ['wait', 'Saved. It shows everywhere the next time anyone loads a page.'],
  approved: ['ok', 'Your design is live. Everyone can see it.'],
  rejected: ['bad', 'The league office took this design down. Upload a different one.'],
};
const PALETTE = [
  ['#ffffff', 'White'], ['#e5e7eb', 'Silver'], ['#9ca3af', 'Grey'], ['#374151', 'Charcoal'], ['#0a0a0a', 'Black'], ['#e53935', 'Red'], ['#9b1c1c', 'Maroon'],
  ['#fb923c', 'Orange'], ['#f59e0b', 'Amber'], ['#facc15', 'Yellow'], ['#ffd966', 'Gold'], ['#84cc16', 'Lime'], ['#22c55e', 'Green'], ['#15803d', 'Forest green'],
  ['#065f46', 'Bottle green'], ['#14b8a6', 'Teal'], ['#06b6d4', 'Cyan'], ['#38bdf8', 'Sky blue'], ['#2563eb', 'Blue'], ['#1e3a8a', 'Navy'], ['#4338ca', 'Indigo'],
  ['#7c3aed', 'Purple'], ['#c026d3', 'Magenta'], ['#ec4899', 'Pink'], ['#f9a8d4', 'Light pink'], ['#92400e', 'Brown'], ['#d6c7a1', 'Sand'], ['#a7f3d0', 'Mint'],
];
const INK = [['', 'Auto'], ['#ffffff', 'White'], ['#0a0a0a', 'Black'], ['#ffd966', 'Gold'], ['#e53935', 'Red'], ['#2563eb', 'Blue']];
const LOGO_SPOTS = [['Left chest', 0.2, 0.34], ['Centre', 0.5, 0.4], ['Right chest', 0.8, 0.34], ['Belly', 0.5, 0.58]];
const TAB_ICON = {
  style: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a3 3 0 0 1-8 0z"/>',
  colours: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  logo: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
};
const COLOUR_ROLES = [['Main', 'The colour that fills most of the shirt'], ['Second', 'Used by the pattern (Plain doesn’t use it)'], ['Collar and hem', 'The thin trim at the neck and bottom']];

const ctx = await enterPlace('club');
if (ctx) {
  const { main, me } = ctx, office = me.profile?.role === 'office';
  const rows = await clubs().catch(() => []);
  const club = rows.find(c => c.code === ctx.club?.code) || (office ? rows[0] : null);
  if (!club) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Kits</h1><p class="empty">You need a club to design kits.</p>'; main.setAttribute('aria-busy', 'false'); }
  else await run({ main, office, rows, club });
}

async function run(init) {
  const { main, office, rows } = init;
  let club = init.club;
  const c = await db();
  let slot = 'home', tab = 'style', colourSlot = 0, kits = {}, imgs = { crest: null, logo: null, art: null }, logoBlob = null, logoPreview = '', artBlob = null, artPreview = '', saving = false, savedAt = '';
  const hist = {};   // slot -> { past: [json], future: [json], last: json }

  // ------------------------------------------------------------ the state of the current kit
  const blank = s => ({ design: startDesign(club, s), logo_path: null, logo_status: 'none', art_path: null, art_status: 'none', art: null, made: false, saved: null });
  const kit = () => (kits[slot] ||= blank(slot));
  const dj = k => JSON.stringify(k.design) + '|' + (k.logo_path || '') + '|' + (k.art_path || '') + '|' + (k === kits[slot] && logoBlob ? 'new' : '') + (k === kits[slot] && artBlob ? 'art' : '');
  const isDirty = k => (k.saved === null ? k.made : dj(k) !== k.saved);
  const dirty = () => isDirty(kit());
  const anyDirty = () => Object.values(kits).some(isDirty);

  async function load() {
    const { data } = await c.from('club_kits').select('*').eq('club', club.code);
    kits = {}; logoBlob = null; logoPreview = ''; artBlob = null; artPreview = '';
    for (const r of data || []) { const k = { design: cleanDesign(r.design), logo_path: r.logo_path, logo_status: r.logo_status, art_path: r.art_path || null, art_status: r.art_status || 'none', made: true }; k.saved = dj(k); kits[r.slot] = k; }
    imgs.crest = await image(crestUrl(club.crest_path));
    await Promise.all(Object.values(kits).map(async k => { k.art = await image(kitLogoUrl(k.art_path)); }));   // for the little pictures of every kit
  }
  // The current kit's pictures, including a new logo or design not saved yet.
  const loadLogo = async () => { [imgs.logo, imgs.art] = await Promise.all([image(logoPreview || kitLogoUrl(kit().logo_path)), artPreview ? image(artPreview) : kit().art]); };
  const picture = (k, size = 96) => kitSprite(k.design, { crest: imgs.crest, art: k === kits[slot] ? imgs.art : k.art }, size).toDataURL();

  // ------------------------------------------------------------ undo and redo
  const H = () => (hist[slot] ||= { past: [], future: [], last: JSON.stringify(kit().design) });
  let commitTimer = 0;
  function commit() {
    clearTimeout(commitTimer);
    const h = H(), now = JSON.stringify(kit().design);
    if (now === h.last) return;
    h.past.push(h.last); if (h.past.length > 60) h.past.shift();
    h.future = []; h.last = now;
  }
  const commitSoon = () => { clearTimeout(commitTimer); commitTimer = setTimeout(() => { commit(); drawBar(); }, 500); };
  function step(dir) {
    commit();
    const h = H(), from = dir < 0 ? h.past : h.future, to = dir < 0 ? h.future : h.past;
    if (!from.length) return;
    to.push(h.last); h.last = from.pop();
    kit().design = cleanDesign(JSON.parse(h.last)); kit().made = true;
    refresh();
  }

  // ------------------------------------------------------------ changing the design
  function edit(fn, { now = false, panel = false } = {}) {
    const k = kit(); fn(k.design); k.design = cleanDesign(k.design); k.made = true;
    stage.update(); drawChips(); drawBar(); drawStart(); drawPoster();
    if (now) commit(); else commitSoon();
    if (panel) drawPanel();
  }
  const setColour = (i, hex) => { if (isHex(hex)) edit(d => { d.colours[i] = hex.toLowerCase(); }, { now: true }); };
  function refresh() { stage.update(); drawChips(); drawStart(); drawPanel(); drawBar(); drawPoster(); }
  // The kit's name in giant letters behind the player, like a kit launch poster.
  function drawPoster() { const el = main.querySelector('#kt-poster'); if (el) el.textContent = kitName(slot, kit().design); }

  // ------------------------------------------------------------ colour ideas
  const schemes = () => {
    const a = isHex(club.colour) ? club.colour : '#1e88e5', b = isHex(club.colour2) ? club.colour2 : '#ffffff';
    return [['Club colours', [a, b, b]], ['Swapped', [b, a, a]], ['Club and white', [a, '#ffffff', '#ffffff']], ['Club and black', [a, '#0a0a0a', '#0a0a0a']],
      ['All white', ['#ffffff', a, a]], ['All black', ['#0a0a0a', a, a]], ['Gold trim', [a, '#ffd966', '#ffd966']], ['Night', ['#0b1220', '#2563eb', '#2563eb']], ['Neon', ['#a3e635', '#111111', '#111111']]];
  };
  function surprise() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)], pal = PALETTE.map(p => p[0]).filter(h => h !== '#9ca3af');
    let cols = Math.random() < 0.55 ? pick(schemes())[1].slice() : null;
    if (!cols) for (let i = 0; i < 40; i++) { const m = pick(pal), s = pick(pal); if (contrast(m, s) > 2.2) { cols = [m, s, Math.random() < 0.5 ? s : pick([m, '#0a0a0a', '#ffffff'])]; break; } }
    const pat = pick(PATTERNS.map(p => p[0]).filter(p => p !== 'plain' && p !== 'checks' && p !== 'custom'));
    edit(d => { d.pattern = pat; if (cols) d.colours = cols; }, { now: true, panel: true });
  }

  // ------------------------------------------------------------ the 3D stage
  const stage = (() => {
    let fit = 4.8, reveal = null, T, renderer, scene, cam, body, tex, tc, raf = 0, canvas, flat, az = 0.35, el = 0.1, dist = 4.8, goAz = null, spin = !reduceMotion(), idleAt = 0, ray, drag = null;
    const pointers = new Map(), pos = { x: 0, y: 0 };
    const spinBtn = () => main.querySelector('[data-spin]');
    const frame = () => {
      raf = 0;
      if (reveal) { const k = Math.min(1, (performance.now() - reveal.at) / 1400), e = 1 - (1 - k) ** 3; az = reveal.from + e * Math.PI * 2; if (k >= 1) reveal = null; }
      else if (goAz !== null) { const d = Math.atan2(Math.sin(goAz - az), Math.cos(goAz - az)); az += d * 0.2; if (Math.abs(d) < 0.003) { az = goAz; goAz = null; } }
      else if (spin && !document.hidden && Date.now() > idleAt) az += 0.006;
      cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
      cam.lookAt(0, -0.02, 0); renderer.render(scene, cam);
      if (reveal || goAz !== null || spin) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && renderer) raf = requestAnimationFrame(frame); };
    const hit = e => {   // the point on the shirt under the pointer, in shirt-drawing pixels
      const r = canvas.getBoundingClientRect();
      pos.x = ((e.clientX - r.left) / r.width) * 2 - 1; pos.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(pos, cam);
      const h = ray.intersectObject(body, false)[0];
      return h?.uv ? { px: h.uv.x * TEX_W, py: (1 - h.uv.y) * TEX_H } : null;
    };
    const logoBox = () => { const d = kit().design, s = d.logo.scale * TEX_H; return { cx: (0.35 + 0.3 * d.logo.x) * TEX_W, cy: d.logo.y * TEX_H, s }; };
    const onLogo = p => { if (!p || tab !== 'logo' || !imgs.logo) return false; const b = logoBox(); return Math.abs(p.px - b.cx) < b.s * 0.62 && Math.abs(p.py - b.cy) < b.s * 0.62; };
    // Without 3D (an old phone, or WebGL switched off): the front and the back side by side, in the player's rounded shape.
    const flatDraw = () => {
      const r = Math.min(2, devicePixelRatio || 1), W = Math.round(flat.clientWidth * r), Hh = Math.round(flat.clientHeight * r);
      if (!W || !Hh) return;
      if (flat.width !== W || flat.height !== Hh) { flat.width = W; flat.height = Hh; }
      const g = flat.getContext('2d'); g.clearRect(0, 0, W, Hh);
      const bh = Math.min(Hh * 0.72, (W * 0.42) / 0.47), bw = bh * 0.47, y = (Hh - bh) / 2 - 10 * r, gap = bw * 0.18;
      [['front', W / 2 - gap / 2 - bw, imgs], ['back', W / 2 + gap / 2, { ...imgs, logo: null }]].forEach(([s, x, im]) => {
        g.save(); g.beginPath(); g.roundRect(x, y, bw, bh, bw / 2); g.clip();
        drawKitFront(g, kit().design, im, x, y, bw, bh, s);
        const sh = g.createLinearGradient(x, 0, x + bw, 0); sh.addColorStop(0, 'rgba(0,0,0,.28)'); sh.addColorStop(0.35, 'rgba(255,255,255,.08)'); sh.addColorStop(1, 'rgba(0,0,0,.38)');
        g.fillStyle = sh; g.fillRect(x, y, bw, bh); g.restore();
        g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `700 ${13 * r}px Figtree, system-ui, sans-serif`; g.textAlign = 'center';
        g.fillText(s === 'front' ? 'Front' : 'Back', x + bw / 2, y + bh + 22 * r);
      });
    };
    return {
      async mount(cv, fl) {
        canvas = cv; flat = fl;
        try {
          T ||= await import(THREE_URL);
          renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
        } catch { renderer = null; }
        if (!renderer) { canvas.hidden = true; flat.hidden = false; main.querySelector('.kt-stage')?.classList.add('flat'); new ResizeObserver(() => flatDraw()).observe(flat); return; }
        renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
        scene = new T.Scene(); cam = new T.PerspectiveCamera(32, 1, 0.1, 50); ray = new T.Raycaster();
        scene.add(new T.HemisphereLight(0xffffff, 0x4a5568, 1.5));
        const sun = new T.DirectionalLight(0xffffff, 1.5); sun.position.set(2.5, 3, 4); scene.add(sun);
        const rim = new T.DirectionalLight(0x9ec5ff, 0.7); rim.position.set(-3, 2, -3); scene.add(rim);
        tc = document.createElement('canvas'); tc.width = TEX_W; tc.height = TEX_H;
        tex = new T.CanvasTexture(tc); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = T.RepeatWrapping; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
        const geo = new T.CapsuleGeometry(0.42, 0.95, 12, 40), P = geo.attributes.position, UV = geo.attributes.uv, half = 0.95 / 2 + 0.42;
        for (let i = 0; i < P.count; i++) UV.setY(i, (P.getY(i) + half) / (half * 2));   // down the shirt by height, so hoops stay level
        body = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: 0.78 }));
        body.position.y = -0.15; body.rotation.y = Math.PI; scene.add(body);   // the shirt's front (middle of the drawing) faces the camera
        const head = new T.Mesh(new T.SphereGeometry(0.27, 28, 18), new T.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.8 })); head.position.y = 0.92; scene.add(head);
        const disc = new T.Mesh(new T.CircleGeometry(0.85, 48), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })); disc.rotation.x = -Math.PI / 2; disc.position.y = -1.12; scene.add(disc);
        const resize = () => {
          const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
          renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
          // Fit the whole player (about 2.5 tall with the head, 1.1 wide) with a little air round him, whatever the stage's shape.
          const t = Math.tan((cam.fov / 2) * Math.PI / 180), need = Math.max(2.75, 1.5 / (w / h));
          const zoomed = dist / fit; fit = need / (2 * t); dist = fit * zoomed; kick();   // keep their zoom when the phone's address bar resizes the stage
        };
        new ResizeObserver(resize).observe(canvas); resize();
        canvas.addEventListener('pointerdown', e => {
          canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); idleAt = Date.now() + 4000;
          const p = pointers.size === 1 ? hit(e) : null;
          if (p && onLogo(p)) { const b = logoBox(); drag = { dx: b.cx - p.px, dy: b.cy - p.py }; canvas.classList.add('moving'); }
          else { spin = false; spinBtn()?.setAttribute('aria-pressed', 'false'); main.querySelector('.kt-hint')?.classList.add('gone'); }
        });
        const up = e => { pointers.delete(e.pointerId); if (drag) { drag = null; canvas.classList.remove('moving'); commit(); drawBar(); } };
        canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('pointermove', e => {
          const p = pointers.get(e.pointerId);
          if (!p) { if (tab === 'logo' && e.pointerType === 'mouse') canvas.classList.toggle('over-logo', onLogo(hit(e))); return; }
          if (drag) {
            const q = hit(e); if (q) edit(d => { d.logo.x = ((q.px + drag.dx) / TEX_W - 0.35) / 0.3; d.logo.y = (q.py + drag.dy) / TEX_H; });
            return;
          }
          if (pointers.size === 2) {
            const [a, b] = [...pointers.values()], before = Math.hypot(a[0] - b[0], a[1] - b[1]);
            pointers.set(e.pointerId, [e.clientX, e.clientY]);
            const [a2, b2] = [...pointers.values()], after = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
            dist = Math.min(fit * 1.5, Math.max(fit * 0.5, dist * before / (after || before)));
          } else { az -= (e.clientX - p[0]) * 0.012; el = Math.min(1.2, Math.max(-0.5, el + (e.clientY - p[1]) * 0.008)); pointers.set(e.pointerId, [e.clientX, e.clientY]); goAz = null; }
          kick();
        });
        canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(fit * 1.5, Math.max(fit * 0.5, dist * (1 + Math.sign(e.deltaY) * 0.08))); idleAt = Date.now() + 4000; kick(); }, { passive: false });
        canvas.addEventListener('webglcontextlost', e => e.preventDefault());
        canvas.addEventListener('webglcontextrestored', () => { tex.needsUpdate = true; kick(); });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
      },
      update() {
        if (!renderer) { if (flat) flatDraw(); return; }
        const g = tc.getContext('2d'); g.clearRect(0, 0, TEX_W, TEX_H); drawKit(g, kit().design, TEX_W, TEX_H, imgs); tex.needsUpdate = true; kick();
      },
      view(s) { if (!renderer) return; goAz = s === 'back' ? Math.PI : 0; el = 0.1; spin = false; spinBtn()?.setAttribute('aria-pressed', 'false'); kick(); },
      zoom(f) { dist = Math.min(fit * 1.5, Math.max(fit * 0.5, dist * f)); idleAt = Date.now() + 4000; kick(); },
      toggleSpin() { spin = !spin; idleAt = 0; kick(); return spin; },
      // Saved: the player turns once all the way round (the one big moment on the page). Not with reduced motion.
      reveal() { if (!renderer || reduceMotion()) return; reveal = { from: az, at: performance.now() }; kick(); },
    };
  })();

  // ------------------------------------------------------------ drawing the page
  function drawChips() {
    const el = main.querySelector('#kt-chips'); if (!el) return;
    el.innerHTML = SLOTS.map(([s, l]) => {
      const k = kits[s], made = k?.made;
      return `<button type="button" role="tab" class="kt-chip" data-slot="${s}" aria-selected="${s === slot}">
        ${made ? `<img alt="" src="${picture(k)}" width="30" height="52">` : '<span class="kt-chip-empty" aria-hidden="true">+</span>'}
        <span class="kt-chip-t"><b>${esc(made ? kitName(s, k.design) : l)}</b><small>${made ? (isDirty(k) ? 'Unsaved changes' : l) : 'Not made yet'}</small></span></button>`;
    }).join('');
  }

  function drawStart() {
    const el = main.querySelector('#kt-start'); if (!el) return;
    const k = kit(), show = !k.made && !k.saved, hasHome = kits.home?.made && slot !== 'home';
    el.hidden = !show;
    if (!show) return;
    const L = SLOTS.find(s => s[0] === slot)[1].toLowerCase();
    el.innerHTML = `<p><b>Your ${esc(L)} kit isn’t made yet.</b> It’s started in your club colours. Change anything to begin, or:</p>
      <div class="kt-start-btns">${hasHome ? '<button type="button" class="kt-btn" data-copy="home">Copy my Home kit</button><button type="button" class="kt-btn" data-copy="swap">Home kit, colours swapped</button>' : ''}<button type="button" class="kt-btn" data-surprise>Surprise me</button></div>`;
  }

  function drawBar() {
    const el = main.querySelector('#kt-bar'); if (!el) return;
    const h = hist[slot] || { past: [], future: [], last: '' }, pend = h.last !== JSON.stringify(kit().design), d = dirty();
    const say = saving ? 'Saving…' : d ? 'Unsaved changes' : kit().saved ? (savedAt ? `Saved ${savedAt}` : 'Saved') : 'Nothing to save yet';
    el.innerHTML = `<div class="kt-bar-in"><div class="kt-undo"><button type="button" class="kt-icon" data-undo aria-label="Undo" ${h.past.length || pend ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/></svg><span>Undo</span></button>
      <button type="button" class="kt-icon" data-redo aria-label="Redo" ${h.future.length ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5M20 12H10a6 6 0 0 0 0 12"/></svg><span>Redo</span></button></div>
      <span class="kt-state${d ? ' dirty' : ''}" role="status">${esc(say)}</span>
      <button type="button" class="kt-save" data-save ${d && !saving ? '' : 'disabled'}>Save this kit</button></div>`;
  }

  const tile = (p, label, d) => `<button type="button" class="kt-tile" data-pattern="${p}" aria-pressed="${d.pattern === p}"><canvas width="84" height="138" data-thumb="${p}" aria-hidden="true"></canvas><span>${label}</span></button>`;
  function paintThumbs() {
    for (const cv of main.querySelectorAll('canvas[data-thumb]')) {
      const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
      drawKitFront(g, { ...kit().design, pattern: cv.dataset.thumb, text: { name: '', number: '', colour: '' } }, { art: imgs.art }, 11, 4, 62, 130, 'front');
    }
  }
  const swatch = (hex, name, on, attrs) => `<button type="button" class="kt-sw${on ? ' on' : ''}" ${attrs} style="--c:${hex}" aria-label="${esc(name)}" aria-pressed="${on}" title="${esc(name)}"></button>`;

  // Design it in Photoshop (or anything): download the template, paint over it, upload the picture. It becomes the "Your own design" style.
  function ownHtml(k) {
    const st = ART_STATUS[k.art_status], has = !!(k.art_path || artPreview);
    return `<section class="kt-own"><p class="kt-sub">Design it yourself <span>In Photoshop or any drawing app</span></p>
      <ol class="kt-steps"><li><b>Download the template.</b> It’s the whole shirt laid out flat: the front in the middle, the back at both edges.</li>
        <li><b>Paint over it</b> on a layer underneath, then hide the template layer.</li>
        <li><b>Upload it here</b> as a PNG or JPG the same shape (${TEX_W * 2} × ${TEX_H * 2} is best).</li></ol>
      <div class="kt-row"><button type="button" class="kt-btn" data-template="guide">Download template</button><button type="button" class="kt-btn quiet" data-template="kit">Download this kit as a start</button></div>
      ${has ? `${artBlob ? '<p class="kt-pill wait">New design. Save to put it live.</p>' : st ? `<p class="kt-pill ${st[0]}">${esc(st[1])}</p>` : ''}
        <div class="kt-row"><label class="kt-btn kt-file">Replace design<input type="file" accept="image/png,image/jpeg,image/webp" data-art hidden></label>${k.design.pattern !== 'custom' ? '<button type="button" class="kt-btn" data-pattern="custom">Wear my design</button>' : ''}<button type="button" class="kt-btn quiet" data-art-clear>Remove design</button></div>`
      : '<label class="kt-drop" data-drop="art"><input type="file" accept="image/png,image/jpeg,image/webp" data-art hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"/></svg><b>Upload your design</b><span>Tap to choose it, or drop it here.</span></label>'}
      <p class="kt-note">The crest, logo and print are still added on top (turn them off in Logo and Text). It goes live for everyone when you save.</p></section>`;
  }

  function panelHtml() {
    const k = kit(), d = k.design;
    if (tab === 'style') return `<h2 class="kt-h">Pick a look</h2>
      <div class="kt-tiles">${PATTERNS.map(([p, l]) => tile(p, l, d)).join('')}</div>
      <div class="kt-row"><button type="button" class="kt-btn" data-surprise>Surprise me</button>${slot !== 'home' && kits.home?.made ? '<button type="button" class="kt-btn" data-copy="home">Copy my Home kit</button>' : ''}${slot !== 'away' && slot !== 'gk' && kits.away?.made ? '<button type="button" class="kt-btn" data-copy="away">Copy my Away kit</button>' : ''}<button type="button" class="kt-btn quiet" data-reset>Start over</button></div>
      ${ownHtml(k)}`;
    if (tab === 'colours') {
      const cur = d.colours[colourSlot], used = colourSlot !== 1 || d.pattern !== 'plain';
      const clubCols = [club.colour, club.colour2].filter(isHex).map(h => h.toLowerCase());
      return `<h2 class="kt-h">Colours</h2>
        <div class="kt-roles" role="radiogroup" aria-label="Which colour to change">${COLOUR_ROLES.map(([n, hint], i) => `<button type="button" role="radio" class="kt-role${i === colourSlot ? ' on' : ''}${i === 1 && d.pattern === 'plain' ? ' idle' : ''}" data-role="${i}" aria-checked="${i === colourSlot}" style="--c:${d.colours[i]}"><i></i><span><b>${n}</b><small>${esc(i === 1 && d.pattern === 'plain' ? 'Not used by Plain' : d.colours[i].toUpperCase())}</small></span></button>`).join('')}</div>
        ${used ? '' : '<p class="kt-note">Plain doesn’t use a second colour. Pick a pattern in Style to see it.</p>'}
        <p class="kt-sub">${esc(COLOUR_ROLES[colourSlot][0])} colour <span>${esc(COLOUR_ROLES[colourSlot][1])}</span></p>
        <div class="kt-palette">${clubCols.map(h => swatch(h, 'Club colour ' + h, h === cur, `data-colour="${h}"`)).join('')}${clubCols.length ? '<i class="kt-sep"></i>' : ''}${PALETTE.map(([h, n]) => swatch(h, n, h === cur, `data-colour="${h}"`)).join('')}</div>
        <div class="kt-custom"><label class="kt-pick"><span>Any colour</span><input type="color" data-colour-input value="${esc(cur)}"></label><label class="kt-hex"><span>Hex</span><input type="text" data-hex value="${esc(cur.toUpperCase())}" maxlength="7" spellcheck="false" autocapitalize="off" autocomplete="off"></label><button type="button" class="kt-btn" data-swap>Swap Main and Second</button></div>
        <p class="kt-sub">Ready-made colours <span>Changes all three at once</span></p>
        <div class="kt-schemes">${schemes().map(([n, cs], i) => `<button type="button" class="kt-scheme" data-scheme="${i}"><span class="dots">${cs.map(h => `<i style="background:${h}"></i>`).join('')}</span><b>${esc(n)}</b></button>`).join('')}</div>`;
    }
    if (tab === 'text') return `<h2 class="kt-h">Name and print</h2>
      <label class="kt-field"><span>Kit name</span><input type="text" data-kitname maxlength="24" value="${esc(d.name)}" placeholder="${esc(kitName(slot, null))}" autocomplete="off"><small>How this kit is listed when your team picks what to wear.</small></label>
      <div class="kt-two"><label class="kt-field"><span>Back name</span><input type="text" data-text="name" maxlength="14" value="${esc(d.text.name)}" placeholder="Optional" autocomplete="off" autocapitalize="characters"></label>
      <label class="kt-field"><span>Number</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-text="number" maxlength="2" value="${esc(d.text.number)}" placeholder="Optional" autocomplete="off"></label></div>
      <p class="kt-sub">Print colour</p><div class="kt-ink">${INK.map(([h, n]) => `<button type="button" class="kt-chipbtn${(d.text.colour || '') === h ? ' on' : ''}" data-ink="${h}" aria-pressed="${(d.text.colour || '') === h}">${h ? `<i style="background:${h}"></i>` : ''}${n}</button>`).join('')}</div>
      <p class="kt-note">Turn the player round with Back to see the print. In matches each player’s own shirt number is used.</p>`;
    // logo
    const st = STATUS[k.logo_status], has = !!(k.logo_path || logoPreview);
    return `<h2 class="kt-h">Logo and crest</h2>
      ${has ? `${logoBlob ? '<p class="kt-pill wait">New logo. Save to put it live.</p>' : st ? `<p class="kt-pill ${st[0]}">${esc(st[1])}</p>` : ''}
        <p class="kt-tip"><b>Drag the logo</b> on the shirt to move it.</p>
        <label class="kt-range"><span>Size</span><input type="range" min="8" max="34" value="${Math.round(d.logo.scale * 100)}" data-logo-scale aria-label="Logo size"></label>
        <p class="kt-sub">Quick places</p><div class="kt-ink">${LOGO_SPOTS.map(([n], i) => `<button type="button" class="kt-chipbtn" data-spot="${i}">${n}</button>`).join('')}</div>
        <div class="kt-row"><label class="kt-btn kt-file">Replace logo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-logo hidden></label><button type="button" class="kt-btn quiet" data-logo-clear>Remove logo</button></div>`
      : `<label class="kt-drop" data-drop><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-logo hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"/></svg><b>Add a logo</b><span>Tap to choose a picture, or drop one here.<br>PNG, JPG or WebP. A square picture with a clear background looks best.</span></label>`}
      <p class="kt-sub">Club crest</p>
      <label class="kt-check"><input type="checkbox" data-crest ${d.crest.show ? 'checked' : ''}><span>Show the club crest on the chest</span></label>
      <div class="kt-ink" ${d.crest.show ? '' : 'hidden'}>${[['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']].map(([v, n]) => `<button type="button" class="kt-chipbtn${d.crest.pos === v ? ' on' : ''}" data-crestpos="${v}" aria-pressed="${d.crest.pos === v}">${n}</button>`).join('')}</div>`;
  }
  function drawPanel() {
    const el = main.querySelector('#kt-panel'); if (!el) return;
    if (document.activeElement?.matches?.('[data-hex], [data-kitname], [data-text]') && el.contains(document.activeElement)) return;   // never rebuild a field someone is typing in
    el.innerHTML = panelHtml();
    if (tab === 'style') paintThumbs();
    main.querySelectorAll('.kt-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  }

  async function page() {
    main.innerHTML = `<div class="kits">
      <div class="kt-head"><div><h1 class="page-title" tabindex="-1">Kits</h1><p class="kt-club-name">${esc(club.name)}</p></div>
        <div class="kt-head-r">${office ? `<label class="kt-club">Club <select data-club>${rows.map(r => `<option value="${esc(r.code)}"${r.code === club.code ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>` : '<a class="kt-link" href="club.html">My club</a>'}
        <button type="button" class="kt-help" data-tour><b>?</b> How it works</button></div></div>
      ${office ? '<p class="kt-office" role="note"><b>League office.</b> You can design kits for any club. Managers can only change their own.</p>' : ''}
      <div class="kt-chips" id="kt-chips" role="tablist" aria-label="Which kit"></div>
      <div class="kt-work">
        <div class="kt-stage"><div class="kt-poster" aria-hidden="true"><span id="kt-poster"></span></div><canvas id="kt-3d" role="img" aria-label="3D preview of the kit. Drag to turn it, scroll or pinch to zoom."></canvas><canvas id="kt-flat" hidden role="img" aria-label="Front and back of the kit"></canvas>
          <p class="kt-hint">Drag to turn · pinch to zoom</p>
          <div class="kt-view" role="group" aria-label="Preview controls"><button type="button" data-view="front">Front</button><button type="button" data-view="back">Back</button><button type="button" data-spin aria-pressed="${!reduceMotion()}">Spin</button><button type="button" data-zoom="0.85" aria-label="Zoom in">+</button><button type="button" data-zoom="1.18" aria-label="Zoom out">−</button></div></div>
        <div class="kt-side"><div class="kt-start" id="kt-start" hidden></div>
          <div class="kt-tabs" role="tablist" aria-label="What to change">${[['style', 'Style'], ['colours', 'Colours'], ['text', 'Text'], ['logo', 'Logo']].map(([t, l]) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === tab}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICON[t]}</svg><span>${l}</span></button>`).join('')}</div>
          <div class="kt-panel" id="kt-panel" role="tabpanel"></div></div></div>
      <div class="kt-bar" id="kt-bar"></div>
      ${office ? '<section class="kt-approve" id="kt-approve"></section>' : ''}</div>`;
    await stage.mount(main.querySelector('#kt-3d'), main.querySelector('#kt-flat'));
    await loadLogo(); refresh(); if (office) approvals();
  }

  // ------------------------------------------------------------ logo
  async function chooseLogo(file) {
    try {
      if (!file || !/^image\//.test(file.type)) throw new Error('That isn’t a picture. Use a PNG, JPG or WebP.');
      const url = URL.createObjectURL(file), img = await image(url); URL.revokeObjectURL(url);
      if (!img) throw new Error('That picture couldn’t be read. Try a PNG or JPG.');
      // Fitted inside a square on a clear background and never stretched, so a round logo stays round on the shirt.
      const k = Math.min(1, LOGO_MAX / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = document.createElement('canvas'); cv.width = cv.height = LOGO_MAX;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, (LOGO_MAX - w) / 2, (LOGO_MAX - h) / 2, w, h);
      let blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (blob && blob.size > LOGO_BYTES) { const sm = document.createElement('canvas'); sm.width = sm.height = 256; sm.getContext('2d').drawImage(cv, 0, 0, 256, 256); blob = await new Promise(r => sm.toBlob(r, 'image/png')); }
      if (!blob || blob.size > LOGO_BYTES) throw new Error('That logo is too detailed. Try a simpler picture.');
      logoBlob = blob; logoPreview = URL.createObjectURL(blob);
      const kk = kit(); kk.made = true; kk.logo_status = 'none';
      await loadLogo(); tab = 'logo'; edit(() => {}, { now: true, panel: true });
    } catch (e) { toast(e.message || String(e), true); }
  }
  // A design painted on the template: fitted to the unrolled shirt (stretched if it isn't the template's shape, with a warning), and its
  // main colour taken from the chest, so the clash check and anyone who can't see it yet get the right colour.
  async function chooseArt(file) {
    try {
      if (!file || !/^image\//.test(file.type)) throw new Error('That isn’t a picture. Use a PNG or JPG.');
      const url = URL.createObjectURL(file), img = await image(url); URL.revokeObjectURL(url);
      if (!img) throw new Error('That picture couldn’t be read. Try a PNG or JPG.');
      const off = Math.abs((img.naturalWidth / img.naturalHeight) / (TEX_W / TEX_H) - 1) > 0.04;
      const cv = document.createElement('canvas'); cv.width = TEX_W; cv.height = TEX_H;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#ffffff'; g.fillRect(0, 0, TEX_W, TEX_H);
      g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, TEX_W, TEX_H);
      // The kit's colour (used for the scoreboard, the stats and the clash check) is the commonest colour on the front, not the
      // average: an average of stripes or a texture is a muddy colour that isn't on the shirt at all.
      const px = g.getImageData(TEX_W * 0.3, TEX_H * 0.25, TEX_W * 0.4, TEX_H * 0.5).data, bins = new Map();
      for (let i = 0; i < px.length; i += 16) {
        const k = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4), e = bins.get(k) || [0, 0, 0, 0];
        e[0]++; e[1] += px[i]; e[2] += px[i + 1]; e[3] += px[i + 2]; bins.set(k, e);
      }
      const top = [...bins.values()].sort((x, y) => y[0] - x[0])[0];
      const main = '#' + [top[1], top[2], top[3]].map(v => Math.round(v / top[0]).toString(16).padStart(2, '0')).join('');
      let blob = null;
      for (const q of [0.92, 0.82, 0.7]) { blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q)); if (blob && blob.size <= ART_BYTES) break; }
      if (!blob || blob.size > ART_BYTES) throw new Error('That design is too big to upload. Save it as a JPG and try again.');
      artBlob = blob; artPreview = URL.createObjectURL(blob);
      const kk = kit(); kk.made = true; kk.art_status = 'none';
      await loadLogo(); tab = 'style'; edit(d => { d.pattern = 'custom'; d.colours[0] = main; }, { now: true, panel: true });
      if (off) toast(`Your picture isn’t the template’s shape, so it was stretched to fit. Use ${TEX_W * 2} × ${TEX_H * 2} to avoid this.`, true);
    } catch (e) { toast(e.message || String(e), true); }
  }
  // The template to paint over, or this kit as it looks now (without the crest, logo and print the app adds), at twice the shirt's size.
  async function download(what) {
    const cv = document.createElement('canvas'); cv.width = TEX_W * 2; cv.height = TEX_H * 2;
    const g = cv.getContext('2d');
    if (what === 'guide') drawTemplate(g, cv.width, cv.height);
    else drawKit(g, { ...kit().design, text: { name: '', number: '', colour: '' }, crest: { show: false } }, cv.width, cv.height, { art: imgs.art });
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = what === 'guide' ? 'vleague-kit-template.png' : `${club.code.toLowerCase()}-${slot}-kit.png`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function toast(t, bad) { const el = main.querySelector('#kt-bar .kt-state'); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); } }

  async function save() {
    const k = kit(); saving = true; drawBar();
    try {
      let path = k.logo_path;
      if (logoBlob) {
        path = `${club.code.toLowerCase()}/${slot}-${Date.now().toString(36)}.png`;
        const up = await c.storage.from('kits').upload(path, logoBlob, { contentType: 'image/png', upsert: false });
        if (up.error) throw up.error;
      }
      let art = k.art_path;
      if (artBlob) {
        art = `${club.code.toLowerCase()}/${slot}-art-${Date.now().toString(36)}.jpg`;
        const up = await c.storage.from('kits').upload(art, artBlob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
      }
      const { data, error } = await c.from('club_kits').upsert({ club: club.code, slot, design: k.design, logo_path: path, art_path: art }, { onConflict: 'club,slot' }).select('*').single();
      if (error) throw error;
      Object.assign(k, { design: cleanDesign(data.design), logo_path: data.logo_path, logo_status: data.logo_status, art_path: data.art_path, art_status: data.art_status, made: true });
      if (artBlob) k.art = imgs.art;
      logoBlob = null; logoPreview = ''; artBlob = null; artPreview = ''; k.saved = dj(k);
      savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      await loadLogo();
    } catch (e) { saving = false; refresh(); toast(`Couldn’t save: ${e.message || e}`, true); return; }
    saving = false; refresh(); stage.reveal();
    const st = main.querySelector('.kt-stage'); st?.classList.remove('revealed'); void st?.offsetWidth; st?.classList.add('revealed');
  }

  // ------------------------------------------------------------ events
  main.addEventListener('click', async e => {
    const t = e.target;
    const s = t.closest('.kt-chips [data-slot]');
    if (s) { if (s.dataset.slot === slot) return; commit(); slot = s.dataset.slot; logoBlob = null; logoPreview = ''; artBlob = null; artPreview = ''; await loadLogo(); refresh(); return; }
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; drawPanel(); main.querySelector('.kt-hint')?.classList.add('gone'); return; }
    const p = t.closest('[data-pattern]'); if (p) { edit(d => { d.pattern = p.dataset.pattern; }, { now: true, panel: true }); return; }
    const sw = t.closest('[data-colour]'); if (sw) { setColour(colourSlot, sw.dataset.colour); drawPanel(); return; }
    const ro = t.closest('[data-role]'); if (ro) { colourSlot = +ro.dataset.role; drawPanel(); return; }
    const sc = t.closest('[data-scheme]'); if (sc) { const cs = schemes()[+sc.dataset.scheme][1]; edit(d => { d.colours = cs.slice(); }, { now: true, panel: true }); return; }
    if (t.closest('[data-swap]')) { edit(d => { d.colours = [d.colours[1], d.colours[0], d.colours[2]]; }, { now: true, panel: true }); return; }
    if (t.closest('[data-surprise]')) { surprise(); return; }
    const cp = t.closest('[data-copy]');
    if (cp) {
      const src = kits[cp.dataset.copy === 'swap' ? 'home' : cp.dataset.copy]; if (!src) return;
      edit(d => { const n = cleanDesign(JSON.parse(JSON.stringify(src.design))); Object.assign(d, n, { name: '' }); if (cp.dataset.copy === 'swap') d.colours = [n.colours[1], n.colours[0], n.colours[2]]; }, { now: true, panel: true }); return;
    }
    if (t.closest('[data-reset]')) { if (!confirm('Start this kit over from your club colours?')) return; edit(d => { Object.assign(d, startDesign(club, slot)); }, { now: true, panel: true }); return; }
    const ik = t.closest('[data-ink]'); if (ik) { edit(d => { d.text.colour = ik.dataset.ink; }, { now: true, panel: true }); return; }
    const sp = t.closest('[data-spot]'); if (sp) { const [, x, y] = LOGO_SPOTS[+sp.dataset.spot]; edit(d => { d.logo.x = x; d.logo.y = y; }, { now: true }); return; }
    const cpos = t.closest('[data-crestpos]'); if (cpos) { edit(d => { d.crest.pos = cpos.dataset.crestpos; }, { now: true, panel: true }); return; }
    if (t.closest('[data-logo-clear]')) { logoBlob = null; logoPreview = ''; const k = kit(); k.logo_path = null; k.logo_status = 'none'; imgs.logo = null; edit(() => {}, { now: true, panel: true }); return; }
    const tp = t.closest('[data-template]'); if (tp) { download(tp.dataset.template); return; }
    if (t.closest('[data-art-clear]')) { artBlob = null; artPreview = ''; const k = kit(); k.art_path = null; k.art_status = 'none'; k.art = null; imgs.art = null; edit(d => { if (d.pattern === 'custom') d.pattern = 'plain'; }, { now: true, panel: true }); return; }
    if (t.closest('[data-undo]')) { step(-1); return; }
    if (t.closest('[data-redo]')) { step(1); return; }
    if (t.closest('[data-save]')) { await save(); return; }
    const v = t.closest('[data-view]'); if (v) { stage.view(v.dataset.view); return; }
    const z = t.closest('[data-zoom]'); if (z) { stage.zoom(+z.dataset.zoom); return; }
    const sn = t.closest('[data-spin]'); if (sn) { sn.setAttribute('aria-pressed', String(stage.toggleSpin())); return; }
    if (t.closest('[data-tour]')) { tour(); return; }
    const ap = t.closest('[data-approve]');
    if (ap) {
      await c.from('club_kits').update({ [`${ap.dataset.what}_status`]: ap.dataset.approve }).eq('club', ap.dataset.forClub).eq('slot', ap.dataset.forSlot); approvals();
      if (ap.dataset.forClub === club.code && !anyDirty()) { await load(); await loadLogo(); refresh(); }
    }
  });
  main.addEventListener('input', e => {
    const t = e.target;
    // Keep the colour row (its dot and code) in step while a colour is being picked or typed, without rebuilding the panel.
    const showRole = hex => { const r = main.querySelectorAll('.kt-role')[colourSlot]; if (!r) return; r.style.setProperty('--c', hex); const sm = r.querySelector('small'); if (sm && !r.classList.contains('idle')) sm.textContent = hex.toUpperCase(); };
    if (t.matches('[data-colour-input]')) { edit(d => { d.colours[colourSlot] = t.value.toLowerCase(); }); main.querySelector('[data-hex]').value = t.value.toUpperCase(); showRole(t.value); }
    else if (t.matches('[data-hex]')) {
      let v = t.value.trim(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { edit(d => { d.colours[colourSlot] = v.toLowerCase(); }, { now: true }); main.querySelector('[data-colour-input]').value = v.toLowerCase(); showRole(v); }
    }
    else if (t.matches('[data-kitname]')) edit(d => { d.name = t.value; });
    else if (t.matches('[data-text]')) edit(d => { d.text[t.dataset.text] = t.value; });
    else if (t.matches('[data-logo-scale]')) edit(d => { d.logo.scale = t.value / 100; });
  });
  main.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-crest]')) edit(d => { d.crest.show = t.checked; }, { now: true, panel: true });
    else if (t.matches('[data-logo]')) chooseLogo(t.files?.[0]);
    else if (t.matches('[data-art]')) chooseArt(t.files?.[0]);
    else if (t.matches('[data-club]')) {
      if (anyDirty() && !confirm('You have unsaved changes. Switch club and lose them?')) { t.value = club.code; return; }
      club = rows.find(r => r.code === t.value); slot = 'home'; for (const k of Object.keys(hist)) delete hist[k];
      await load(); await loadLogo(); main.querySelector('.kt-club-name').textContent = club.name; refresh();
    }
    else if (t.matches('[data-hex], [data-kitname], [data-text]')) drawPanel();
  });
  for (const ev of ['dragover', 'drop']) main.addEventListener(ev, e => {
    const zone = e.target.closest('[data-drop]'); if (!zone) return;
    e.preventDefault(); if (ev === 'drop') (zone.dataset.drop === 'art' ? chooseArt : chooseLogo)(e.dataTransfer?.files?.[0]);
  });
  main.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input[type=text]')) { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
  });
  window.addEventListener('beforeunload', e => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------ the office: recent uploads (they go live at once; the office can take one down)
  async function approvals() {
    const box = document.getElementById('kt-approve'); if (!box) return;
    const { data } = await c.from('club_kits').select('*').or('logo_path.not.is.null,art_path.not.is.null').order('updated_at', { ascending: false }).limit(30);
    const items = (data || []).flatMap(r => [r.logo_path && ['logo', 'Logo', r.logo_path, r.logo_status, 64, 64, r], r.art_path && ['art', 'Whole-kit design', r.art_path, r.art_status, 128, 87, r]].filter(Boolean));
    box.innerHTML = `<h2>Uploaded logos and designs</h2><p class="kt-note">These go live as soon as a club saves them. Take one down if it shouldn’t be there.</p>${items.length ? `<ul>${items.map(([what, label, path, status, w, h, r]) => { const down = status === 'rejected';
      return `<li><a href="${esc(kitLogoUrl(path))}" target="_blank" rel="noopener"><img src="${esc(kitLogoUrl(path))}" alt="${esc(label)}, open full size" width="${w}" height="${h}"></a><span><b>${esc(rows.find(x => x.code === r.club)?.name || r.club)}</b> · ${esc(SLOTS.find(s => s[0] === r.slot)?.[1] || r.slot)} kit · ${label}${down ? ' · <b>taken down</b>' : ''}</span>
      <button type="button" class="kt-btn${down ? '' : ' quiet'}" data-approve="${down ? 'approved' : 'rejected'}" data-what="${what}" data-for-club="${esc(r.club)}" data-for-slot="${esc(r.slot)}">${down ? 'Put back' : 'Take down'}</button></li>`; }).join('')}</ul>` : '<p class="quiet">Nothing uploaded yet.</p>'}`;
  }

  // ------------------------------------------------------------ the first-time tour (js/tour.js)
  const STEPS = () => [
    { title: 'Design your kits', text: 'This is where you make your club’s shirts. It takes about a minute to see everything.', tip: 'Use Next or your arrow keys. Press Esc to leave.' },
    { target: '#kt-chips', title: 'Four kits', text: 'Every club can have a <b>Home</b>, <b>Away</b>, <b>Goalkeeper</b> and <b>Special</b> kit. Tap one to work on it. The little picture shows how it looks now.' },
    { target: '.kt-stage', title: 'Your player', text: 'This is your kit on a player. <b>Drag</b> to turn the player round, <b>pinch</b> or scroll to zoom, or use Front and Back.' },
    { target: '.kt-tabs', tab: 'style', title: 'Four tabs', text: '<b>Style</b> picks the pattern, <b>Colours</b> changes the colours, <b>Text</b> names your kit and sets the back print, and <b>Logo</b> adds a picture. Everything changes the player straight away.' },
    { target: ['.kt-tile:nth-child(1)', '.kt-tile:nth-child(2)', '.kt-tile:nth-child(3)'], tab: 'style', title: 'Pick a look', text: 'Tap any pattern. The little pictures use your colours. Not sure? Press <b>Surprise me</b>.' },
    { target: '.kt-roles', tab: 'colours', title: 'Colours', text: 'Choose <b>Main</b>, <b>Second</b> or <b>Collar and hem</b>, then tap a colour. <b>Ready-made colours</b> below changes all three at once.' },
    { target: ['.kt-drop', '.kt-tip'], tab: 'logo', title: 'Add a logo', text: 'Upload a picture, then <b>drag it on the shirt</b> to place it and use the slider to size it.' },
    { target: '.kt-bar', tab: 'style', title: 'Undo, redo and save', text: 'Made a mistake? <b>Undo</b>. When it looks right, press <b>Save this kit</b>.' },
    { target: '#kt-chips', title: 'Wearing it in a match', text: 'In <b>My club</b>, on your team sheet, there’s a <b>Kit</b> box where you choose which kit the team wears. Leave it on Automatic and we pick the away kit if the colours clash.' },
    { target: '.kt-help', title: 'You’re ready', text: 'That’s everything. Press <b>How it works</b> any time to see this again.' },
  ];
  async function tour() {
    await startTour(STEPS(), { key: 'kits', before: async s => { if (s.tab && s.tab !== tab) { tab = s.tab; drawPanel(); await new Promise(r => setTimeout(r, 60)); } } });
    main.querySelector('.kt-help')?.classList.remove('glow');
  }

  await load();
  await page();
  main.setAttribute('aria-busy', 'false');
  if (!tourSeen('kits') && !office) setTimeout(tour, 900);
  else if (!tourSeen('kits')) main.querySelector('.kt-help')?.classList.add('glow');
}
