// S-49: the Starting XI selector (rebuilt 25 Nov 2026, the user's approved mockup Plans/vLeague/mockups/xi-selector.html). One screen, one mode:
//   tap a player to change him (the squad shows who fits that spot first); tap a second player on the pitch to swap them;
//   drag a player onto grass to move his spot (the line he joins names the formation), onto a teammate to swap, onto the squad or bench to drop him;
//   drag from the squad or the bench onto a spot to put that player in.
// Smart own shapes (the user: "smart like real football", adjustable grid): a snap grid (Free / Fine / Medium / Coarse), a mirror switch that
// moves the opposite player with you, real position names from where a player stands (js/shape-smart.js roleOf, display only), and football
// advice about the shape (checks). The engine plays the drawn lanes, and each player's place ahead of or behind his line; the whole shape
// moves with the ball (desktop, s40-shots tactics.shape_slots).
//   mountXI(dialog, ctx) -> { draw() }. ctx: { sheet() -> the live sheet object, squad, avail, bans (Map id -> { reason }), byId, club,
//   kits() -> { field, gk } chest pictures, formOf(id) -> { avg, apps } | null, changed() -> saves and redraws the team sheet form }.
import { esc } from './member.js';
import { portrait } from './portrait.js';
import { FORMATIONS, spotsOf, nameShape, cleanShape, SHAPE_AREA, BANDS, reshape, autoLineup } from './pitch.js';
import { GRIDS, gridSize, snap, partnerOf, isCentral, mirrored, roleOf, checks } from './shape-smart.js';

const PRESETS_SHOWN = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'];
const BLURB = { '4-3-3': 'Three up front, a holding midfielder', '4-4-2': 'Two strikers, two banks of four', '4-2-3-1': 'Two holders, three behind the striker', '3-5-2': 'Three centre-backs and wing-backs' };
const POS_WORD = { GK: 'keeper', DEF: 'defender', MID: 'midfielder', FWD: 'forward' };
const GROUPS = [['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['FWD', 'Forwards']];
const surname = n => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; };
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const ICON = {
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  tick: '<svg class="xb-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  mirror: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
};
// The pitch is drawn 68 wide by 88 deep (the whole length, a little compressed so it fits the screen): the markings are scaled the same way, so
// the centre circle stays round (the pitch box is the same 68:88 shape, css/xi-builder.css).
const LINES = '<svg class="xb-lines" viewBox="0 0 68 88" aria-hidden="true"><rect x="1" y="1" width="66" height="86"/><line x1="1" y1="44" x2="67" y2="44"/><circle cx="34" cy="44" r="7.6"/>'
  + '<rect x="13.84" y="1" width="40.32" height="13.8"/><rect x="24.84" y="1" width="18.32" height="4.6"/><rect x="13.84" y="73.2" width="40.32" height="13.8"/><rect x="24.84" y="82.4" width="18.32" height="4.6"/></svg>';

export function mountXI(dlg, ctx) {
  const { squad, avail, bans, byId, club } = ctx;
  let sel = null;            // { slot } or { player }: the first tap of a change
  let filter = 'ALL', menu = false, msg = '', sheetOpen = false;
  let grid = store.get('vleague-xi-grid', 'medium'), mirror = store.get('vleague-xi-mirror', 'off') === 'on';
  const S = () => ctx.sheet();
  const slotsNow = () => FORMATIONS[S().formation];
  const wantOf = slot => slotsNow()[slot]?.want;
  const slotOf = id => Object.keys(S().lineup).find(s => String(S().lineup[s]) === String(id)) || null;
  const face = (p, gk) => portrait(p, { code: club.code, colour: club.colour, colour2: club.colour2, chest: ctx.kits()?.[gk ? 'gk' : 'field'] || undefined }, undefined, true);
  const formBadge = (id, cls = 'xb-rt') => { const f = ctx.formOf(id); return f?.apps ? `<b class="${cls} ${f.avg >= 7 ? 'hi' : f.avg >= 6 ? 'mid' : 'lo'}">${f.avg.toFixed(1)}</b>` : ''; };

  dlg.className = 'dlg dlg-xi';
  dlg.innerHTML = `<div class="xb">
    <header class="xb-top"><h2 id="dlg-lineup-t">Starting XI</h2>
      <div class="xb-fm"><button type="button" class="xb-fpill" data-xb-menu aria-haspopup="true" aria-expanded="false"></button><div class="xb-menu" id="xb-menu" hidden></div></div>
      <span class="xb-warn" id="xb-warn"></span><span class="xb-sp"></span><div class="xb-meters" id="xb-meters"></div>
      <button type="button" class="xb-done" data-close>Done</button></header>
    <div class="xb-body">
      <section class="xb-left" aria-label="Pitch">
        <div class="xb-tools" id="xb-tools"></div>
        <div class="xb-pitch" id="xb-pitch"></div>
        <p class="xb-note" id="xb-note" aria-live="polite"></p>
        <div class="xb-bench" id="xb-bench"></div>
      </section>
      <section class="xb-squad" aria-label="Squad"><button type="button" class="xb-grab" data-xb-sheet aria-expanded="false"><i aria-hidden="true"></i><span>Squad</span></button><div class="xb-sq-head" id="xb-sq-head"></div>
        <div class="xb-cols" aria-hidden="true"><span>Player</span><span>ATT</span><span>DEF</span><span>Form</span><span></span></div>
        <ul class="xb-list" id="xb-list"></ul></section>
    </div></div>`;
  const $ = s => dlg.querySelector(s);

  // ---------- drawing ----------
  function spotsNow() { return spotsOf(S().formation, S().shape); }
  function outfield() { return Object.entries(spotsNow()).filter(([s]) => s !== 'GK').map(([slot, s]) => ({ slot, key: slot, x: s.x, y: s.y, line: s.line })); }

  function drawTop() {
    const s = S(), p = $('[data-xb-menu]');
    p.innerHTML = `<b>${esc(s.formation)}</b>${s.shape ? '<i>Own shape</i>' : ''}${ICON.chev}`;
    p.setAttribute('aria-expanded', menu);
    p.setAttribute('aria-label', `Formation ${s.formation}${s.shape ? ', own shape' : ''}. Change formation`);
    const xi = Object.keys(slotsNow()).map(sl => byId.get(String(s.lineup[sl]))).filter(Boolean);
    const off = Object.keys(slotsNow()).filter(sl => { const pl = byId.get(String(s.lineup[sl])); return pl && pl.position !== wantOf(sl); });
    $('#xb-warn').innerHTML = off.length ? `<span class="xb-warn-dot"></span>${off.length} out of position` : xi.length < 11 ? `<span class="xb-warn-dot"></span>${xi.length} of 11 picked` : '';
    const avg = k => (xi.length ? xi.reduce((a, pl) => a + (Number(pl[k]) || 0), 0) / 11 : 0);
    const meter = (label, v) => `<div class="xb-meter"><span>${label} <b>${v.toFixed(1)}</b></span><u style="--v:${Math.min(100, v * 10)}%"></u></div>`;
    $('#xb-meters').innerHTML = meter('Attack', avg('offense')) + meter('Defence', avg('defense'));
    drawMenu();
  }

  function drawMenu() {
    const m = $('#xb-menu'), s = S();
    m.hidden = !menu;
    if (!menu) return;
    const mini = f => Object.values(spotsOf(f, f === s.formation ? s.shape : null)).map(sp => `<i style="left:${sp.x}%;bottom:${sp.y}%"></i>`).join('');
    const rows = [];
    if (s.shape) rows.push(['own', 'Own shape', `Your spots · ${s.formation} lines`, true]);
    else if (!PRESETS_SHOWN.includes(s.formation)) rows.push([s.formation, s.formation, 'Your own lines', true]);
    for (const f of PRESETS_SHOWN) rows.push([f, f, BLURB[f], !s.shape && s.formation === f]);
    m.innerHTML = `<p class="xb-menu-h">Start from a formation</p>${rows.map(([k, name, blurb, on]) =>
      `<button type="button" class="xb-mrow${on ? ' on' : ''}" data-xb-f="${esc(k)}" aria-pressed="${on}"><span class="xb-mini" aria-hidden="true">${mini(k === 'own' ? s.formation : k)}</span><span><b>${esc(name)}</b><small>${esc(blurb)}</small></span>${on ? ICON.tick : ''}</button>`).join('')}
      <p class="xb-menu-foot">Or drag players anywhere on the pitch. Any shape with 3 to 5 at the back works.</p>`;
  }

  function drawTools() {
    $('#xb-tools').innerHTML = `<div class="xb-seg" role="radiogroup" aria-label="Snap grid"><span class="xb-seg-k">Grid</span>${GRIDS.map(([k, label]) => `<button type="button" role="radio" data-xb-grid="${k}" aria-checked="${grid === k}">${label}</button>`).join('')}</div>
      <button type="button" class="xb-switch" role="switch" data-xb-mirror aria-checked="${mirror}">${ICON.mirror}<span>Mirror</span><i aria-hidden="true"></i></button>
      ${S().shape ? '<button type="button" class="xb-link" data-xb-reset>Reset shape</button>' : ''}`;
  }

  function token(slot, sp) {
    const s = S(), id = s.lineup[slot], p = id ? byId.get(String(id)) : null, gk = slot === 'GK';
    const role = gk ? 'GK' : roleOf(sp.x, sp.y, sp.line);
    const style = `--x:${sp.x}%;--y:${sp.y}%`;
    if (!p) return `<button type="button" class="xb-tok empty${sel?.slot === slot ? ' sel' : ''}" data-tok="${slot}" style="${style}" aria-label="Empty spot, ${role}"><span class="xb-face">${ICON.plus}</span><span class="xb-nm"><small>${esc(role)}</small></span></button>`;
    const off = p.position !== wantOf(slot), cap = String(s.captain) === String(p.id);
    const cls = ['xb-tok', sel?.slot === slot && 'sel', off && 'oop', gk && 'gk'].filter(Boolean).join(' ');
    const label = `${p.name}, ${role}${off ? `, a ${POS_WORD[p.position]} out of position` : ''}${cap ? ', captain' : ''}`;
    return `<button type="button" class="${cls}" data-tok="${slot}" style="${style}" aria-label="${esc(label)}"><span class="xb-face">${face(p, gk)}${cap ? '<span class="xb-cap" aria-hidden="true">C</span>' : ''}</span>${formBadge(p.id)}`
      + `<span class="xb-nm">${esc(surname(p.name))}<small>${esc(role)}${off ? ` · a ${POS_WORD[p.position]}` : ''}</small></span></button>`;
  }

  function drawPitch() {
    const sp = spotsNow();
    const bands = BANDS.map(([k, label, lo, hi]) => `<div class="xb-band" data-band="${k}" style="bottom:${lo}%;height:${Math.min(100, hi) - lo}%"><span>${label}</span></div>`).join('');
    $('#xb-pitch').innerHTML = `${LINES}<div class="xb-bands" aria-hidden="true">${bands}</div>${Object.entries(sp).map(([slot, s]) => token(slot, s)).join('')}`;
    drawNote();
  }

  function drawNote() {
    const advice = msg ? [] : checks(outfield());
    $('#xb-note').innerHTML = msg ? `<b class="xb-bad">${esc(msg)}</b>`
      : sel?.slot ? `Changing <b>${esc(surname(byId.get(String(S().lineup[sel.slot]))?.name || sel.slot))}</b>. Tap a player in the squad, or a teammate on the pitch to swap.`
      : advice.length ? advice.slice(0, 2).map(a => `<span class="xb-tip">${esc(a.text)}</span>`).join('')
      : 'Where each player lines up. In a match the whole shape moves with the ball. <b>Tap</b> a player to change him, <b>drag</b> him to move his spot.';
  }

  function drawBench() {
    const inXI = new Set(Object.values(S().lineup).map(String));
    const bench = avail.filter(p => !inXI.has(String(p.id)));
    $('#xb-bench').innerHTML = `<h3>Bench <span>${bench.length}</span><span class="xb-sp"></span><button type="button" class="xb-link" data-xb-best>Pick best XI</button><button type="button" class="xb-link" data-xb-clear>Clear</button></h3>
      <div class="xb-bench-row" data-drop="bench">${bench.map(p => `<button type="button" class="xb-bp${sel?.player === String(p.id) ? ' sel' : ''}" data-pl="${esc(p.id)}"><span class="xb-face">${face(p, p.position === 'GK')}</span><span><b>${esc(surname(p.name))}</b><small>${esc(p.position)}</small></span></button>`).join('') || '<p class="xb-quiet">Everyone is in the XI.</p>'}</div>`;
  }

  function drawSquad() {
    const want = sel?.slot ? wantOf(sel.slot) : null, cur = sel?.slot ? String(S().lineup[sel.slot] || '') : '';
    const selP = cur ? byId.get(cur) : null, role = sel?.slot ? roleOf(spotsNow()[sel.slot].x, spotsNow()[sel.slot].y, spotsNow()[sel.slot].line) : '';
    $('#xb-sq-head').innerHTML = (sel?.slot
      ? `<div class="xb-picking"><span><b>${selP ? `Changing ${esc(surname(selP.name))}` : 'Filling the spot'}</b> · ${esc(sel.slot === 'GK' ? 'GK' : role)}<small>Tap a player to put him in.</small></span><button type="button" class="xb-link" data-xb-cancel>Cancel</button></div>`
      : sel?.player ? `<div class="xb-picking"><span><b>Moving ${esc(surname(byId.get(sel.player)?.name))}</b><small>Tap a spot on the pitch to put him there.</small></span><button type="button" class="xb-link" data-xb-cancel>Cancel</button></div>`
      : `<h3>Squad <span>${squad.length} players</span></h3>`)
      + `<div class="xb-chips" role="radiogroup" aria-label="Show">${['ALL', 'GK', 'DEF', 'MID', 'FWD'].map(k => `<button type="button" role="radio" data-xb-filter="${k}" aria-checked="${filter === k}">${k === 'ALL' ? 'All' : k}</button>`).join('')}</div>`;
    const shown = squad.filter(p => filter === 'ALL' || p.position === filter);
    const row = p => {
      const id = String(p.id), ban = bans.get(id), slot = slotOf(id), fits = want && p.position === want && !slot && !ban;
      const pill = ban ? `<span class="xb-pill ban" title="${esc(ban.reason)}">Banned</span>` : slot ? `<span class="xb-pill on${p.position !== wantOf(slot) ? ' oop' : ''}">${esc(slot)}</span>` : '<span class="xb-pill">Bench</span>';
      const n = v => `<span class="xb-num ${v >= 7 ? 'hi' : v < 5 ? 'lo' : ''}">${esc(v)}</span>`;
      return `<li><button type="button" class="xb-row${fits ? ' fit' : ''}${ban ? ' out' : ''}${sel?.player === id ? ' sel' : ''}" data-pl="${esc(id)}"${ban ? ' aria-disabled="true"' : ''}>
        <span class="xb-who"><span class="xb-face">${face(p, p.position === 'GK')}</span><span><b>${esc(p.name)}</b><small>${p.number != null && p.number !== '' ? `#${esc(p.number)} · ` : ''}${esc(p.position)}${ban ? ` · ${esc(ban.reason)}` : fits ? ' · Fits' : ''}</small></span></span>
        ${n(p.offense)}${n(p.defense)}<span class="xb-form">${formBadge(id, 'xb-fb') || '<span class="xb-none">–</span>'}</span>${pill}</button></li>`;
    };
    let html;
    if (want) {
      const best = shown.filter(p => p.position === want && String(p.id) !== cur && !bans.has(String(p.id))).sort((a, b) => Boolean(slotOf(a.id)) - Boolean(slotOf(b.id)) || (b.offense + b.defense) - (a.offense + a.defense));
      const rest = shown.filter(p => !best.includes(p));
      html = (best.length ? `<li class="xb-grp">Best for ${esc(sel.slot === 'GK' ? 'GK' : role)}</li>${best.map(row).join('')}` : '') + `<li class="xb-grp">${best.length ? 'Everyone else' : 'Squad'}</li>${rest.map(row).join('')}`;
    } else {
      html = GROUPS.filter(([k]) => shown.some(p => p.position === k)).map(([k, label]) => `<li class="xb-grp">${label}</li>${shown.filter(p => p.position === k).map(row).join('')}`).join('');
    }
    $('#xb-list').innerHTML = html;
    // On a phone the squad is a sheet at the bottom: a bar until a player is picked (or the bar is tapped), then it opens over the pitch.
    const open = Boolean(sel) || sheetOpen;
    dlg.querySelector('.xb').classList.toggle('picking', Boolean(sel));
    dlg.querySelector('.xb').classList.toggle('sheet-open', open);
    const g = $('[data-xb-sheet]'); g.setAttribute('aria-expanded', open); g.querySelector('span').textContent = open ? 'Hide squad' : `Squad · ${squad.length} players`;
  }

  function draw(focus) {
    drawTop(); drawTools(); drawPitch(); drawBench(); drawSquad();
    if (focus) dlg.querySelector(focus)?.focus();
  }

  // ---------- changes ----------
  function done(focus) { msg = ''; ctx.changed(); draw(focus); }
  function place(slot, id) {   // into a slot: from another slot they swap; from the bench, the slot's player goes to the bench
    const s = S(), from = slotOf(id), cur = s.lineup[slot];
    if (from === slot) return;
    if (from) { if (cur) s.lineup[from] = cur; else delete s.lineup[from]; }
    s.lineup[slot] = String(id);
  }
  function swap(a, b) { const s = S(), x = s.lineup[a], y = s.lineup[b]; if (y) s.lineup[a] = y; else delete s.lineup[a]; if (x) s.lineup[b] = x; else delete s.lineup[b]; }
  function setFormation(f) {
    const s = S();
    if (f === 'own' || (f === s.formation && !s.shape)) return;
    if (f !== s.formation) s.lineup = reshape(s.lineup, s.formation, f, avail);
    s.formation = f; s.shape = null; sel = null;
    done();
  }
  // Move spots: [{ slot, x, y }]. Snapped to the grid and kept apart; the lines they make name the formation. Returns the new slot of the first, or null (msg says why).
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  function planMove(moves) {
    const g = gridSize(grid);
    const at = new Map(moves.map(m => { const [x, y] = snap(clamp(m.x, SHAPE_AREA.x), clamp(m.y, SHAPE_AREA.y), g); return [m.slot, { x: clamp(x, SHAPE_AREA.x), y: clamp(y, SHAPE_AREA.y) }]; }));
    const pts = outfield().map(p => (at.has(p.slot) ? { ...p, ...at.get(p.slot) } : p));
    for (const [slot, a] of at) {
      const near = pts.find(p => p.slot !== slot && Math.hypot((p.x - a.x) * 0.68, (p.y - a.y) * 1.05) < 4);
      if (near) return { error: `Too close to ${near.slot}. Leave a little room between players.` };
    }
    const named = nameShape(pts);
    if (!named) return { error: 'That doesn’t make a formation. Keep 3 to 5 at the back, 1 to 3 up front and at most 5 in each midfield line.' };
    return { pts, named };
  }
  function movesFor(slot, x, y) {
    const moves = [{ slot, x, y }];
    if (mirror) {
      const partner = partnerOf(slot, Object.keys(slotsNow()));
      if (partner) { const [mx, my] = mirrored(x, y); moves.push({ slot: partner, x: mx, y: my }); }
      else if (isCentral(slot)) moves[0].x = 50;   // mirrored, a central player stays on the middle line
    }
    return moves;
  }
  function moveSpot(slot, x, y) {
    const plan = planMove(movesFor(slot, x, y));
    if (plan.error) { msg = plan.error; return null; }
    const s = S(), lineup = {}, shape = {};
    if (s.lineup.GK) lineup.GK = s.lineup.GK;
    for (const p of plan.pts) { const to = plan.named.map[p.slot]; if (s.lineup[p.slot]) lineup[to] = s.lineup[p.slot]; shape[to] = [p.x, p.y]; }
    // The captain and takers follow their players (they are ids, so nothing to rename).
    s.formation = plan.named.formation; s.lineup = lineup; s.shape = cleanShape(plan.named.formation, shape);
    return plan.named.map[slot];
  }

  // ---------- taps ----------
  function tapToken(slot) {
    const s = S();
    if (sel?.player) { place(slot, sel.player); sel = null; return done(`[data-tok="${slot}"]`); }
    if (sel?.slot === slot) sel = null;
    else if (sel?.slot) { swap(sel.slot, slot); sel = null; return done(`[data-tok="${slot}"]`); }
    else sel = { slot };
    msg = ''; draw(`[data-tok="${slot}"]`);
  }
  function tapPlayer(id) {
    if (bans.has(id)) return;
    if (sel?.slot) { const slot = sel.slot; place(slot, id); sel = null; return done(`[data-tok="${slot}"]`); }
    sel = sel?.player === id ? null : { player: id };
    msg = ''; draw(`[data-pl="${id}"]`);
  }

  dlg.addEventListener('click', e => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    const tok = t.closest('[data-tok]'), pl = t.closest('[data-pl]');
    if (t.closest('[data-xb-menu]')) { menu = !menu; drawTop(); if (menu) dlg.querySelector('.xb-mrow')?.focus(); return; }
    const f = t.closest('[data-xb-f]');
    if (f) { menu = false; setFormation(f.dataset.xbF); dlg.querySelector('[data-xb-menu]')?.focus(); return; }
    if (menu && !t.closest('#xb-menu')) { menu = false; drawTop(); }
    if (tok) return tapToken(tok.dataset.tok);
    if (pl) return tapPlayer(pl.dataset.pl);
    const g = t.closest('[data-xb-grid]');
    if (g) { grid = g.dataset.xbGrid; store.set('vleague-xi-grid', grid); drawTools(); dlg.querySelector(`[data-xb-grid="${grid}"]`)?.focus(); return; }
    if (t.closest('[data-xb-mirror]')) { mirror = !mirror; store.set('vleague-xi-mirror', mirror ? 'on' : 'off'); drawTools(); dlg.querySelector('[data-xb-mirror]')?.focus(); return; }
    if (t.closest('[data-xb-reset]')) { const s = S(); s.shape = null; sel = null; return done('[data-xb-menu]'); }
    const fl = t.closest('[data-xb-filter]');
    if (fl) { filter = fl.dataset.xbFilter; drawSquad(); dlg.querySelector(`[data-xb-filter="${filter}"]`)?.focus(); return; }
    if (t.closest('[data-xb-cancel]')) { sel = null; draw(); return; }
    if (t.closest('[data-xb-sheet]')) { if (sel) sel = null; else sheetOpen = !sheetOpen; drawSquad(); return; }
    if (t.closest('[data-xb-best]')) { S().lineup = autoLineup(S().formation, avail); sel = null; return done(); }
    if (t.closest('[data-xb-clear]')) { S().lineup = {}; sel = null; return done(); }
  });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (menu || sel)) { e.preventDefault(); menu = false; sel = null; draw(); return; }
    // Arrow keys move the focused player's spot (Shift for a bigger step); the grid sets the step.
    const tok = e.target.closest?.('[data-tok]'), d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (tok && d && tok.dataset.tok !== 'GK') {
      e.preventDefault();
      const stepBy = (gridSize(grid) || 1) * (e.shiftKey ? 3 : 1), at = spotsNow()[tok.dataset.tok];
      const to = moveSpot(tok.dataset.tok, at.x + d[0] * stepBy, at.y + d[1] * stepBy);
      if (to) done(`[data-tok="${to}"]`); else { drawNote(); }
      return;
    }
    if (menu && ['ArrowDown', 'ArrowUp'].includes(e.key) && e.target.closest('#xb-menu')) {
      e.preventDefault();
      const rows = [...dlg.querySelectorAll('.xb-mrow')], i = rows.indexOf(e.target.closest('.xb-mrow'));
      rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    }
  });

  // ---------- dragging ----------
  // From a pitch spot: onto grass moves the spot, onto a teammate swaps, onto the squad or bench drops him. From the squad or bench: onto a spot puts him in.
  let drag = null, dragged = false;
  const pitchEl = () => $('#xb-pitch');
  const pct = (e) => { const r = pitchEl().getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, (r.bottom - e.clientY) / r.height * 100, r]; };
  const tokenAt = (x, y, except) => { const el = document.elementFromPoint(x, y)?.closest('[data-tok]'); return el && el.dataset.tok !== except ? el : null; };
  dlg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const tok = e.target.closest('[data-tok]'), pl = e.target.closest('[data-pl]');
    if (!tok && !pl) return;
    if (pl && bans.has(pl.dataset.pl)) return;
    const hold = e.pointerType === 'touch' && !tok;   // the squad list still scrolls by touch: dragging from it starts with a short hold
    drag = { from: tok ? 'pitch' : 'list', slot: tok?.dataset.tok || null, id: tok ? S().lineup[tok.dataset.tok] : pl.dataset.pl, el: tok || pl, x: e.clientX, y: e.clientY, pid: e.pointerId, armed: !hold, live: false };
    if (hold) { const d = drag; setTimeout(() => { if (drag === d) d.armed = true; }, 280); }
    if (tok) tok.setPointerCapture?.(e.pointerId);
  });
  dlg.addEventListener('pointermove', e => {
    const d = drag; if (!d || e.pointerId !== d.pid) return;
    if (!d.live) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      if (!d.armed) { drag = null; return; }
      d.live = true; menu = false;
      dlg.querySelector('.xb').classList.add('dragging');
      if (d.from === 'list') { d.ghost = Object.assign(document.createElement('div'), { className: 'xb-ghost', innerHTML: d.el.querySelector('.xb-face')?.outerHTML || '' }); dlg.append(d.ghost); }
      else { d.el.classList.add('lift'); if (d.slot === 'GK') d.noMove = true; }
    }
    e.preventDefault();
    const over = tokenAt(e.clientX, e.clientY, d.slot);
    dlg.querySelectorAll('.drop').forEach(x => x !== over && x.classList.remove('drop'));
    over?.classList.add('drop');
    if (d.from === 'list') { d.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; return; }
    const [x, y, r] = pct(e), onPitch = x >= 0 && x <= 100 && y >= 0 && y <= 100;
    const offPitch = !onPitch && document.elementFromPoint(e.clientX, e.clientY)?.closest('.xb-squad, .xb-bench');
    dlg.querySelector('.xb-pitch').classList.toggle('drop-out', Boolean(offPitch));
    if (d.noMove || over || !onPitch) { d.el.style.left = ''; d.el.style.bottom = ''; d.el.style.transform = ''; if (!onPitch) { d.el.style.transform = `translate(calc(-50% + ${e.clientX - d.x}px), calc(50% + ${e.clientY - d.y}px))`; } setTip(null); return; }
    const g = gridSize(grid), [sx, sy] = snap(clamp(x, SHAPE_AREA.x), clamp(y, SHAPE_AREA.y), g);
    d.el.style.transform = ''; d.el.style.left = `${clamp(sx, SHAPE_AREA.x)}%`; d.el.style.bottom = `${clamp(sy, SHAPE_AREA.y)}%`;
    const plan = planMove(movesFor(d.slot, x, y));
    const band = BANDS.find(([, , lo, hi]) => clamp(sy, SHAPE_AREA.y) >= lo && clamp(sy, SHAPE_AREA.y) < hi) || BANDS.at(-1);
    dlg.querySelectorAll('.xb-band').forEach(b => b.classList.toggle('on', b.dataset.band === band[0]));
    const mv = plan.pts?.find(p => p.slot === d.slot);
    setTip(plan.error ? { bad: true, text: plan.error.startsWith('Too close') ? 'Too close' : 'Not a formation' } : { text: `${roleOf(mv.x, mv.y, band[0])}`, sub: `makes ${plan.named.formation}` }, sx, sy);
    // mirrored partner follows on screen
    const partner = mirror ? partnerOf(d.slot, Object.keys(slotsNow())) : null, pel = partner && dlg.querySelector(`[data-tok="${partner}"]`), pm = partner && plan.pts?.find(p => p.slot === partner);
    if (pel && pm) { pel.style.left = `${pm.x}%`; pel.style.bottom = `${pm.y}%`; pel.classList.add('follow'); }
  });
  function setTip(t, x, y) {
    let tip = dlg.querySelector('.xb-tipfly');
    if (!t) { tip?.remove(); return; }
    if (!tip) { tip = Object.assign(document.createElement('div'), { className: 'xb-tipfly' }); pitchEl().append(tip); }
    tip.className = `xb-tipfly${t.bad ? ' bad' : ''}`; tip.style.left = `${clamp(x, [20, 80])}%`; tip.style.bottom = `calc(${Math.min(y, 86)}% + 44px)`;
    tip.innerHTML = `${esc(t.text)}${t.sub ? ` <span>· ${esc(t.sub)}</span>` : ''}`;
  }
  const endDrag = e => {
    const d = drag; if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (!d.live) return;
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    d.ghost?.remove(); setTip(null);
    dlg.querySelector('.xb').classList.remove('dragging');
    dlg.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    if (e.type === 'pointercancel') return draw();
    const over = tokenAt(e.clientX, e.clientY, d.slot);
    if (d.from === 'list') { if (over) { place(over.dataset.tok, d.id); sel = null; return done(`[data-tok="${over.dataset.tok}"]`); } return draw(); }
    if (over) { swap(d.slot, over.dataset.tok); sel = null; return done(`[data-tok="${over.dataset.tok}"]`); }
    const [x, y] = pct(e), onPitch = x >= 0 && x <= 100 && y >= 0 && y <= 100;
    if (!onPitch) {
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest('.xb-squad, .xb-bench') && S().lineup[d.slot]) { delete S().lineup[d.slot]; sel = null; return done(); }
      return draw();
    }
    if (d.noMove) return draw();
    const to = moveSpot(d.slot, x, y);
    if (to) { sel = null; return done(`[data-tok="${to}"]`); }
    draw();
  };
  dlg.addEventListener('pointerup', endDrag);
  dlg.addEventListener('pointercancel', endDrag);
  dlg.addEventListener('touchmove', e => { if (drag?.live) e.preventDefault(); }, { passive: false });
  dlg.addEventListener('close', () => { sel = null; menu = false; msg = ''; sheetOpen = false; });

  return { draw };
}
