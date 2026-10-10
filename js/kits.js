// Kits (0.58, S-23 and S-20): design a club's home, away, goalkeeper and special kits on a 3D player you can turn and zoom.
// A kit is a pattern, three colours, name and number, the club crest and an optional uploaded logo (a logo goes live once the office
// approves it). Saved to Supabase club_kits (migration 0043). The shirt itself is drawn by js/kit.js, the same drawing the match views use.
// The office picks any club and approves or rejects logos at the bottom of the page.
import { enterPlace } from './shell.js';
import { esc, crestUrl, clubs } from './member.js';
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { SLOTS, PATTERNS, cleanDesign, startDesign, drawKit, kitName } from './kit.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const LOGO_MAX = 256, LOGO_BYTES = 240 * 1024;
const kitLogoUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/kits/${path}` : '');
const image = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
const STATUS = { none: '', pending: 'Logo waiting for the office to approve it. Only you and the office see it until then.', approved: 'Logo approved.', rejected: 'The office did not approve this logo. Choose a different one.' };

const ctx = await enterPlace('club');
if (ctx) {
  const { main, me } = ctx, office = me.profile?.role === 'office';
  const rows = await clubs().catch(() => []);
  let club = rows.find(c => c.code === ctx.club?.code) || (office ? rows[0] : null);
  if (!club) { main.innerHTML = '<h1 class="page-title" tabindex="-1">Kits</h1><p class="empty">You need a club to design kits.</p>'; main.setAttribute('aria-busy', 'false'); }
  else await run({ main, office, rows, club });
}

async function run(init) {
  const { main, office, rows } = init;
  let club = init.club;
  const c = await db();
  let slot = 'home', kits = {}, imgs = { crest: null, logo: null }, dirty = false, logoBlob = null, logoPreview = '';
  const get = () => kits[slot] || (kits[slot] = { design: startDesign(club, slot), logo_path: null, logo_status: 'none', fresh: true });

  async function load() {
    const { data } = await c.from('club_kits').select('slot, design, logo_path, logo_status').eq('club', club.code);
    kits = Object.fromEntries((data || []).map(r => [r.slot, { design: cleanDesign(r.design), logo_path: r.logo_path, logo_status: r.logo_status }]));
    imgs.crest = await image(crestUrl(club.crest_path));
  }

  // ------------------------------------------------------------ the page
  const swatch = (i, label) => `<label class="kt-sw"><span>${label}</span><input type="color" data-colour="${i}" value="${esc(get().design.colours[i])}"></label>`;
  function controls() {
    const k = get(), d = k.design;
    return `<div class="kt-tabs" role="tablist" aria-label="Kit">${SLOTS.map(([s, l]) => `<button type="button" role="tab" data-slot="${s}" aria-selected="${s === slot}"><span data-tab-label>${esc(kits[s]?.design.name || l)}</span>${kits[s] && !kits[s].fresh ? '' : ' <i>new</i>'}</button>`).join('')}</div>
      <fieldset><legend>Name</legend><label class="kt-name">Kit name <input type="text" data-kitname maxlength="24" value="${esc(d.name)}" placeholder="${esc(kitName(slot, null))}"></label>
        <p class="kt-note">Shown when your team picks which kit to wear. Leave it blank to use "${esc(kitName(slot, null))}".</p></fieldset>
      <fieldset><legend>Pattern</legend><div class="kt-patterns">${PATTERNS.map(([p, l]) => `<button type="button" data-pattern="${p}" aria-pressed="${d.pattern === p}">${l}</button>`).join('')}</div></fieldset>
      <fieldset><legend>Colours</legend><div class="kt-colours">${swatch(0, 'Main')}${swatch(1, 'Second')}${swatch(2, 'Collar and hem')}</div></fieldset>
      <fieldset><legend>Name and number</legend><div class="kt-text">
        <label>Name <input type="text" data-text="name" maxlength="14" value="${esc(d.text.name)}" placeholder="Optional"></label>
        <label>Number <input type="text" inputmode="numeric" data-text="number" maxlength="2" value="${esc(d.text.number)}" placeholder="Optional"></label>
        <label class="kt-sw"><span>Text colour</span><input type="color" data-text="colour" value="${esc(d.text.colour || '#ffffff')}"></label></div></fieldset>
      <fieldset><legend>Crest and logo</legend>
        <label class="kt-check"><input type="checkbox" data-crest ${d.crest.show ? 'checked' : ''}> Show the club crest on the chest</label>
        <div class="kt-logo"><label class="btn-ghost kt-file">Choose a logo<input type="file" accept="image/*" data-logo hidden></label>
          ${k.logo_path || logoPreview ? '<button type="button" class="link-btn" data-logo-clear>Remove logo</button>' : ''}</div>
        <p class="kt-note" id="kt-logo-note">${esc(logoBlob ? 'New logo chosen. It goes to the office for approval when you save.' : STATUS[k.logo_status] || '')}</p>
        ${k.logo_path || logoPreview ? `<label>Logo size <input type="range" min="8" max="30" value="${Math.round(d.logo.scale * 100)}" data-logo-scale></label>
          <label>Logo height <input type="range" min="20" max="60" value="${Math.round(d.logo.y * 100)}" data-logo-y></label>` : ''}</fieldset>
      <div class="kt-actions"><button type="button" class="btn" data-save>Save this kit</button><span class="kt-saved" id="kt-saved" role="status"></span></div>`;
  }
  async function paintPage() {
    main.innerHTML = `<div class="kits"><div class="kt-titlebar"><h1 class="page-title" tabindex="-1">Kits</h1>
        ${office ? `<label class="kt-club">Club <select data-club>${rows.map(r => `<option value="${esc(r.code)}"${r.code === club.code ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>` : `<a class="link-btn" href="club.html">Back to My club</a>`}</div>
      <div class="kt-grid"><div class="kt-controls" id="kt-controls">${controls()}</div>
        <div class="kt-stage"><canvas id="kt-3d" aria-label="3D preview of the kit. Drag to turn it, scroll or pinch to zoom."></canvas>
          <div class="kt-stage-bar"><button type="button" class="btn-ghost" data-view="front">Front</button><button type="button" class="btn-ghost" data-view="back">Back</button><span>Drag to turn · scroll or pinch to zoom</span></div></div></div>
      ${office ? '<section class="kt-approve" id="kt-approve"></section>' : ''}</div>`;
    await stage.mount(document.getElementById('kt-3d'));
    await refreshLogoImage(); stage.update(); if (office) approvals();
  }
  const reControls = () => { document.getElementById('kt-controls').innerHTML = controls(); };

  // ------------------------------------------------------------ the 3D stage
  const stage = (() => {
    let T, renderer, scene, cam, body, tex, tc, raf = 0, az = 0.25, el = 0.12, dist = 3.6, goAz = null;
    const pointers = new Map();
    const render = () => {
      raf = 0;
      if (goAz !== null) { az += (goAz - az) * 0.18; if (Math.abs(goAz - az) < 0.002) { az = goAz; goAz = null; } else raf = requestAnimationFrame(render); }
      cam.position.set(Math.sin(az) * Math.cos(el) * dist, 0.1 + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
      cam.lookAt(0, 0, 0); renderer.render(scene, cam);
    };
    const kick = () => { if (!raf && renderer) raf = requestAnimationFrame(render); };
    return {
      async mount(canvas) {
        T ||= await import(THREE_URL);
        renderer?.dispose();
        renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
        scene = new T.Scene(); cam = new T.PerspectiveCamera(35, 1, 0.1, 50);
        scene.add(new T.HemisphereLight(0xffffff, 0x445566, 1.6));
        const sun = new T.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 3, 4); scene.add(sun);
        tc = document.createElement('canvas'); tc.width = 1024; tc.height = 512;
        tex = new T.CanvasTexture(tc); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = T.RepeatWrapping; tex.anisotropy = 4;
        const geo = new T.CapsuleGeometry(0.42, 0.95, 12, 32), pos = geo.attributes.position, uv = geo.attributes.uv, half = 0.95 / 2 + 0.42;
        for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) + half) / (half * 2));   // down the shirt by height, so hoops stay level
        body = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
        body.position.y = -0.15; body.rotation.y = Math.PI; scene.add(body);   // the shirt's front (middle of the drawing) faces the camera at the start
        const head = new T.Mesh(new T.SphereGeometry(0.27, 24, 16), new T.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.8 })); head.position.y = 0.92; scene.add(head);
        const disc = new T.Mesh(new T.CircleGeometry(0.8, 40), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })); disc.rotation.x = -Math.PI / 2; disc.position.y = -1.12; scene.add(disc);
        const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); kick(); };
        new ResizeObserver(resize).observe(canvas); resize();
        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
        canvas.addEventListener('pointerup', e => pointers.delete(e.pointerId)); canvas.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
        canvas.addEventListener('pointermove', e => {
          const p = pointers.get(e.pointerId); if (!p) return;
          if (pointers.size === 2) {
            const [a, b] = [...pointers.values()], before = Math.hypot(a[0] - b[0], a[1] - b[1]);
            pointers.set(e.pointerId, [e.clientX, e.clientY]);
            const [a2, b2] = [...pointers.values()], after = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
            dist = Math.min(7, Math.max(2, dist * before / (after || before)));
          } else { az -= (e.clientX - p[0]) * 0.012; el = Math.min(1.2, Math.max(-0.5, el + (e.clientY - p[1]) * 0.008)); pointers.set(e.pointerId, [e.clientX, e.clientY]); goAz = null; }
          kick();
        });
        canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(7, Math.max(2, dist * (1 + Math.sign(e.deltaY) * 0.08))); kick(); }, { passive: false });
      },
      update() { if (!tc) return; const g = tc.getContext('2d'); g.clearRect(0, 0, 1024, 512); drawKit(g, get().design, 1024, 512, { crest: imgs.crest, logo: imgs.logo }); tex.needsUpdate = true; kick(); },
      view(side) { goAz = side === 'back' ? Math.PI : 0; el = 0.12; kick(); },
    };
  })();

  // You always see your own logo, approved or not.
  async function refreshLogoImage() { imgs.logo = await image(logoPreview || kitLogoUrl(get().logo_path)); }

  // ------------------------------------------------------------ editing
  const say = (t, bad) => { const s = document.getElementById('kt-saved'); if (s) { s.textContent = t; s.classList.toggle('bad', !!bad); } };
  const edit = fn => { fn(get().design); get().design = cleanDesign(get().design); dirty = true; stage.update(); say(''); };

  async function chooseLogo(file) {
    const note = document.getElementById('kt-logo-note');
    try {
      if (!file || !/^image\//.test(file.type)) throw new Error('That is not a picture. Use a PNG, JPG or WebP.');
      const url = URL.createObjectURL(file), img = await image(url); URL.revokeObjectURL(url);
      if (!img) throw new Error('That picture could not be read.');
      const k = LOGO_MAX / Math.max(img.naturalWidth, img.naturalHeight), w = Math.max(1, Math.round(img.naturalWidth * Math.min(1, k))), h = Math.max(1, Math.round(img.naturalHeight * Math.min(1, k)));
      const cv = document.createElement('canvas'); cv.width = LOGO_MAX; cv.height = LOGO_MAX;
      cv.getContext('2d').drawImage(img, (LOGO_MAX - w) / 2, (LOGO_MAX - h) / 2, w, h);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob || blob.size > LOGO_BYTES) throw new Error('That logo is too detailed. Try a simpler picture.');
      logoBlob = blob; logoPreview = URL.createObjectURL(blob); dirty = true;
      await refreshLogoImage(); reControls(); stage.update();
    } catch (e) { if (note) note.textContent = e.message; }
  }

  async function save() {
    const k = get(); say('Saving…');
    try {
      let path = k.logo_path;
      if (logoBlob) {
        path = `${club.code.toLowerCase()}/${slot}-${Date.now().toString(36)}.png`;
        const up = await c.storage.from('kits').upload(path, logoBlob, { contentType: 'image/png', upsert: false });
        if (up.error) throw up.error;
      }
      const { data, error } = await c.from('club_kits').upsert({ club: club.code, slot, design: k.design, logo_path: path }, { onConflict: 'club,slot' }).select('slot, design, logo_path, logo_status').single();
      if (error) throw error;
      kits[slot] = { design: cleanDesign(data.design), logo_path: data.logo_path, logo_status: data.logo_status };
      logoBlob = null; logoPreview = ''; dirty = false; reControls(); say(data.logo_path && data.logo_status === 'pending' ? 'Saved. The logo is waiting for the office.' : 'Saved.');
    } catch (e) { say(`Could not save: ${e.message || e}`, true); }
  }

  main.addEventListener('click', async e => {
    const t = e.target;
    const s = t.closest('[data-slot]'); if (s) { if (dirty && !confirm('Leave this kit without saving?')) return; slot = s.dataset.slot; logoBlob = null; logoPreview = ''; dirty = false; await refreshLogoImage(); reControls(); stage.update(); return; }
    const p = t.closest('[data-pattern]'); if (p) { edit(d => { d.pattern = p.dataset.pattern; }); reControls(); return; }
    if (t.closest('[data-save]')) { save(); return; }
    const v = t.closest('[data-view]'); if (v) { stage.view(v.dataset.view); return; }
    if (t.closest('[data-logo-clear]')) { logoBlob = null; logoPreview = ''; get().logo_path = null; get().logo_status = 'none'; dirty = true; imgs.logo = null; reControls(); stage.update(); return; }
    const ap = t.closest('[data-approve]'); if (ap) { await c.from('club_kits').update({ logo_status: ap.dataset.approve }).eq('club', ap.dataset.club).eq('slot', ap.dataset.slot); approvals(); return; }
  });
  main.addEventListener('input', async e => {
    const t = e.target;
    if (t.dataset.kitname !== undefined) { edit(d => { d.name = t.value; }); const lab = main.querySelector(`[data-slot="${slot}"] [data-tab-label]`); if (lab) lab.textContent = get().design.name || SLOTS.find(s => s[0] === slot)[1]; }
    else if (t.dataset.colour !== undefined) edit(d => { d.colours[+t.dataset.colour] = t.value; });
    else if (t.dataset.text) edit(d => { d.text[t.dataset.text] = t.value; });
    else if (t.dataset.logoScale !== undefined) edit(d => { d.logo.scale = t.value / 100; });
    else if (t.dataset.logoY !== undefined) edit(d => { d.logo.y = t.value / 100; });
  });
  main.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-crest]')) edit(d => { d.crest.show = t.checked; });
    else if (t.matches('[data-logo]')) chooseLogo(t.files?.[0]);
    else if (t.matches('[data-club]')) { club = rows.find(r => r.code === t.value); slot = 'home'; logoBlob = null; logoPreview = ''; dirty = false; await load(); await refreshLogoImage(); reControls(); stage.update(); }
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------ the office: logos waiting for approval
  async function approvals() {
    const box = document.getElementById('kt-approve'); if (!box) return;
    const { data } = await c.from('club_kits').select('club, slot, logo_path').eq('logo_status', 'pending').order('updated_at');
    box.innerHTML = `<h2>Logos waiting for approval</h2>${(data || []).length ? `<ul>${data.map(r => `<li><img src="${esc(kitLogoUrl(r.logo_path))}" alt="" width="64" height="64"> <b>${esc(rows.find(x => x.code === r.club)?.name || r.club)}</b> · ${esc(SLOTS.find(s => s[0] === r.slot)?.[1] || r.slot)} kit
      <button type="button" class="btn" data-approve="approved" data-club="${esc(r.club)}" data-slot="${esc(r.slot)}">Approve</button>
      <button type="button" class="btn-ghost" data-approve="rejected" data-club="${esc(r.club)}" data-slot="${esc(r.slot)}">Reject</button></li>`).join('')}</ul>` : '<p class="quiet">Nothing waiting.</p>'}`;
  }

  await load();
  await paintPage();
  main.setAttribute('aria-busy', 'false');
}
