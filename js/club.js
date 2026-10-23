// My club: the club's information (facts, matches, best rated), then the team sheet as a form. Each row opens a menu: the starting XI
// (formation, pitch, players), captain and set-piece takers, tactics, kit. Saved to Supabase team_sheets; the deadline it counts for
// comes from deadlines, and Submit stores the sheet for a round. At a deadline the database copies each club's sheet for that week.
import { enterPlace, styleCards } from './shell.js';
import { esc, crestUrl } from './member.js';
import { db } from './auth.js';
import { tag, scopeNow } from './preseason.js';
import { SUPABASE_URL } from './config.js';
import { finished, logoUrl, kickoff, status, matchUrl } from './dashboard-data.js';
import { tableRows } from './league-table.js';
import { rating } from './places.js';
import { prefsNow, spoilerHidden } from './prefs.js';
import { kitSprite, kitChest, cleanDesign, kitName, FIELD_SLOTS } from './kit.js';
import { renderPitch, FORMATIONS, isFormation, positionPenalty, DEFAULT_FORMATION, TACTICS, STEPS, PRESETS, POS_ORDER, normaliseSheet, reshape, benchOf, autoLineup, fillLineup } from './pitch.js';import { portrait } from './portrait.js';


const PIECES = [['captain', 'Captain'], ['penalties', 'Penalties'], ['freekicks', 'Free kicks'], ['corners', 'Corners']];
const TZ = 'Australia/Melbourne';
const $ = (s, root = document) => root.querySelector(s);
const CHEV = '<svg class="piece-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

// ---------- Squad stats (0.5) ----------

function totals(season, now = new Date()) {
  const tot = {};
  for (const f of finished(season, now)) {
    for (const [id, p] of Object.entries(f.result.players || {})) {
      const t = tot[id] ??= { apps: 0, g: 0, a: 0, rsum: 0 };
      t.apps++; t.g += p.g || 0; t.a += p.a || 0; t.rsum += p.r || 0;
    }
  }
  return tot;
}

// ---------- Deadlines (league time: Melbourne) ----------

// Formatters follow the 12/24-hour clock setting.
const h12 = () => prefsNow().clock !== '24';
const dayTime = { format: d => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: h12() }).format(d) };
const dateTime = { format: d => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: h12() }).format(d) };
const tidy = s => s.replace(/\s/g, ' ').replace(/ (am|pm)$/i, (m, x) => ` ${x.toLowerCase()}`).replace(',', '');
const when = (d, now = new Date()) => tidy((d > now && d - now < 6 * 86400000 ? dayTime : dateTime).format(d));
function left(d, now = new Date()) {
  const m = Math.max(0, Math.ceil((d - now) / 60000)), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min left` : `${m} min left`;
}
const ok = p => p.then(r => r, () => ({ data: null, error: true }));
const narrow = () => matchMedia('(max-width: 899px)').matches;   // pitch above the lists (club.css)

// ---------- Page ----------

const ctx = await enterPlace('club');
if (ctx) {
  const { main, club, season, me } = ctx;
  if (!club) {
    main.innerHTML = '<h1 class="page-title">My club</h1><p class="empty">Your account isn’t linked to a club yet.</p>';
  } else {
    document.title = `${club.name} | vLeague`;
    main.classList.add('club-main');
    const squad = (season?.players || []).filter(p => p.team === club.code)
      .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || a.name.localeCompare(b.name));
    const crest = club.crest_path ? crestUrl(club.crest_path) : logoUrl(club.code);
    const manager = club.manager_name || me.profile?.display_name || '';

    main.innerHTML = `<div class="club">
      <section class="lg-card club-head" aria-label="${esc(club.name)}"><span class="club-hollow" aria-hidden="true">${esc(club.short_name || club.name)}</span>
        <img class="club-crest" src="${esc(crest)}" alt="" onerror="this.remove()">
        <div class="club-name"><h1>${esc(club.name)}</h1>
          ${club.motto ? `<p class="club-motto">${esc(club.motto)}</p>` : ''}</div>
        <nav class="club-acts" aria-label="Club pages"><a href="team.html?c=${esc(club.code)}">Team page</a><a href="kits.html">Kits</a><a href="setup.html?edit">Edit club</a></nav>
      </section>
      <section class="lg-card club-facts" aria-label="Club facts"><dl>
        ${manager ? `<div><dt>Manager</dt><dd>${esc(manager)}</dd></div>` : ''}${club.stadium ? `<div><dt>Ground</dt><dd>${esc(club.stadium)}</dd></div>` : ''}
        <div><dt>Position</dt><dd id="f-pos">–</dd></div><div><dt>Points</dt><dd id="f-pts">–</dd></div><div><dt>Played</dt><dd id="f-p">–</dd></div><div><dt>Form</dt><dd id="f-form">–</dd></div>
      </dl></section>
      <section id="sheet"><p class="quiet">Loading…</p></section>
    </div>`;

    if (!season || !squad.length) {
      $('#sheet').innerHTML = `<div class="sect"><p class="empty">${season ? 'No players yet.' : 'The squad didn’t load. <a href="club.html">Try again</a>'}</p></div>`;
    } else {
      await teamSheet($('#sheet'), { club, squad, userId: me.user.id, season });
    }
    styleCards();
  }
  main.setAttribute('aria-busy', 'false');
}

// ---------- Team sheet ----------

// A first sheet comes with a captain and takers already picked from the XI, and saves itself straight away, so a
// manager who only looks still has a team in.
function suggestPieces(sheet, byId) {
  const WIDE = ['LW', 'RW', 'LM', 'RM', 'LB', 'RB', 'LWB', 'RWB'];
  const xi = Object.entries(sheet.lineup).map(([slot, id]) => ({ slot, p: byId.get(id) })).filter(x => x.p);
  const best = (list, score) => [...list].sort((a, b) => score(b.p) - score(a.p))[0]?.p.id;
  const att = p => p.offense;
  const outfield = xi.filter(x => x.p.position !== 'GK');
  sheet.captain = best(xi, p => p.offense + p.defense) ?? null;
  sheet.penalties = best(outfield, att) ?? null;
  sheet.freekicks = best(outfield.filter(x => x.p.position === 'MID'), att) ?? sheet.penalties;
  sheet.corners = best(outfield.filter(x => WIDE.includes(x.slot)), att) ?? sheet.freekicks;
  for (const k of ['captain', 'penalties', 'freekicks', 'corners']) if (sheet[k] != null) sheet[k] = String(sheet[k]);
}

async function teamSheet(box, { club, squad, userId, season }) {
  const c = await db();
  const byId = new Map(squad.map(p => [String(p.id), p]));
  const [rowRes, dlRes, kitRes, subRes] = await Promise.all([
    ok(c.from('team_sheets').select('*').eq('club', club.code).maybeSingle()),
    ok(c.from('deadlines').select('*').order('locks_at')),
    ok(c.from('club_kits').select('*').eq('club', club.code)),
    ok(c.from('submitted_sheets').select('week, sheet, submitted_at').eq('club', club.code)),
  ]);
  const kitRows = (kitRes.error ? [] : kitRes.data || []).filter(k => FIELD_SLOTS.includes(k.slot) || k.slot === 'gk');   // the goalkeeper kit is only drawn, never picked
  const kitsMade = Object.fromEntries(kitRows.filter(k => k.slot !== 'gk').map(k => [k.slot, cleanDesign(k.design)]));   // the club's outfield kits (none until the kits table exists)
  const kitArt = Object.fromEntries(await Promise.all(kitRows.filter(k => k.art_path).map(k => new Promise(res => {   // its own whole-kit designs, approved or not
    const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res([k.slot, i]); i.onerror = () => res([k.slot, null]); i.src = `${SUPABASE_URL}/storage/v1/object/public/kits/${k.art_path}`;
  }))));
  // The club's real kit on the portraits in the pitch: the kit this sheet wears (automatic = home) for outfield players, the goalkeeper kit for the keeper.
  const gkDesign = kitRows.find(k => k.slot === 'gk')?.design;
  const chestMemo = new Map();
  const chestOf = (key, design, art) => { if (!design) return ''; if (!chestMemo.has(key)) chestMemo.set(key, kitChest(cleanDesign(design), { art })); return chestMemo.get(key); };
  const pitchKits = () => { const wear = sheet.kit && kitsMade[sheet.kit] ? sheet.kit : 'home'; return { field: chestOf(wear, kitsMade[wear], kitArt[wear]), gk: chestOf('gk', gkDesign, kitArt.gk) }; };
  let deadlines = dlRes.error ? [] : dlRes.data || [];   // no table yet (or it didn't load) = no deadline set
  let sheet = normaliseSheet(rowRes.data, squad);
  if (!rowRes.data && !rowRes.error) suggestPieces(sheet, byId);
  let saved = rowRes.data ? JSON.stringify(sheet) : null;   // what the database has; null = never saved
  let state = rowRes.error ? 'error-load' : rowRes.data ? 'saved' : 'new';   // 'new' saves at once (below)
  let savedAt = rowRes.data?.updated_at ? new Date(rowRes.data.updated_at) : null;
  let sel = null;   // { slot } or { player }: the first tap of a move
  let timer = null, saving = false, again = false;
  // SUBMIT (0.63): the sheet submitted for each upcoming round. Without one, a round uses the latest draft, as before.
  const submitted = new Map((subRes.error ? [] : subRes.data || []).map(s => [s.week, s]));
  let picking = false, pickWeek = null, subBusy = false, subMsg = '';

  box.innerHTML = `<div class="ts">
    <div class="ts-grid">
      <section class="lg-card ts-form" aria-label="Team sheet">
        <div class="lg-card-head"><h2>Team sheet</h2><p class="ts-deadline" id="deadline"></p></div>
        <ul class="fm-rows" id="fm-rows"></ul>
        <div class="fm-foot">
          ${subRes.error ? '' : '<div class="ts-submit" id="submit"></div>'}
          <div class="ts-save" id="save" aria-live="polite"></div>
        </div>
      </section>
      <div class="ts-over-right" id="ov-cards"></div>
    </div>

    <dialog autofocus tabindex="-1" class="dlg dlg-wide" id="dlg-lineup" aria-labelledby="dlg-lineup-t">
      <div class="dlg-head"><h2 id="dlg-lineup-t">Starting XI</h2><button type="button" class="dlg-done" data-close>Done</button></div>
      <div class="dlg-body dlg-edit">
        <div class="dlg-pitch">
          <div class="formations sc-toggle" role="radiogroup" aria-label="Formation" id="fm-pills"></div>
          <div class="fb" id="fb" hidden></div>
          <div id="pitch" class="ts-pitch"></div>
          <p class="ts-pick" id="pick" hidden></p>
          <div class="ts-oop" id="oop" hidden></div>
          <div class="ts-clear" id="clear"></div>
        </div>
        <div class="pls-sect" id="pp-players"><div class="sect-head"><h2 id="pls-title">Players</h2><button type="button" class="link-btn pls-close" data-cancel>Cancel</button></div><ul class="pls" id="players"></ul></div>
      </div>
    </dialog>
    <dialog autofocus tabindex="-1" class="dlg" id="dlg-piece" aria-labelledby="dlg-piece-t">
      <div class="dlg-head"><h2 id="dlg-piece-t">Captain</h2><button type="button" class="dlg-done dlg-quiet" data-close>Cancel</button></div>
      <div class="dlg-body"><ul class="pk" id="piece-list"></ul></div>
    </dialog>
    <dialog autofocus tabindex="-1" class="dlg" id="dlg-tactics" aria-labelledby="dlg-tactics-t">
      <div class="dlg-head"><h2 id="dlg-tactics-t">Tactics</h2><button type="button" class="dlg-done" data-close>Done</button></div>
      <div class="dlg-body" id="tactics"></div>
    </dialog>
    <dialog autofocus tabindex="-1" class="dlg" id="dlg-kit" aria-labelledby="dlg-kit-t">
      <div class="dlg-head"><h2 id="dlg-kit-t">Kit</h2><button type="button" class="dlg-done" data-close>Done</button></div>
      <div class="dlg-body"><div id="kitpick"></div><p class="ts-more"><a class="link-btn" href="kits.html">Design kits</a></p></div>
    </dialog>
  </div>`;

  // ----- the club's information (shown once) -----

  const hiddenIds = new Set((season.fixtures || []).filter(f => spoilerHidden(f, season)).map(f => f.id));
  const ordinal = n => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
  const chipsOf = form => (form.length ? `<span class="tb-form" role="img" aria-label="Last ${form.length}: ${form.join(', ')}">${form.map((o, i) => `<abbr class="res-${o}${i === form.length - 1 ? ' is-latest' : ''}" title="${o}">${o}</abbr>`).join('')}</span>` : '');
  function fixtureRow(f, now) {
    const home = f.home === club.code, opp = home ? f.away : f.home, k = kickoff(f), st = status(f, season, now), done = st === 'ft' && f.result;
    const mine = done ? (home ? f.result.home : f.result.away) : null, theirs = done ? (home ? f.result.away : f.result.home) : null;
    const right = done ? (hiddenIds.has(f.id) ? '<span class="ov-hidden">Hidden</span>' : `<span class="ov-score res-${mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'}">${mine}–${theirs}</span>`) : st === 'live' ? '<span class="ov-live">Live</span>' : `<span class="ov-when">${k ? esc(when(k, now)) : 'TBC'}</span>`;
    return `<a class="ov-fx" href="${esc(matchUrl(f))}"><img src="${esc(crestOf(opp))}" alt="" width="24" height="24" onerror="this.style.visibility='hidden'"><span class="ov-fx-name"><b>${esc(teamName(opp))}</b><small>${home ? 'Home' : 'Away'}${f.round ? ` · ${esc(f.round)}` : ''}</small></span>${right}</a>`;
  }
  function drawInfo(now = new Date()) {
    const scope = scopeNow(season, now), rows = tableRows(season, { hidden: hiddenIds, now, scope }), me = rows.find(r => r.team.code === club.code);
    if (me) {
      const set = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
      set('#f-pos', `${ordinal(me.rank)} <small>of ${rows.length}</small>${scope === 'preseason' ? tag : ''}`); set('#f-pts', String(me.pts));
      set('#f-p', `${me.p} <small>${me.w}W ${me.d}D ${me.l}L</small>`); set('#f-form', chipsOf(me.form) || '–');
    }
    const mineFx = (season.fixtures || []).filter(f => !f.test && !f.postponed && kickoff(f) && (f.home === club.code || f.away === club.code)).sort((a, b) => kickoff(a) - kickoff(b));
    const past = mineFx.filter(f => status(f, season, now) === 'ft' && f.result).slice(-3).reverse(), next = mineFx.filter(f => status(f, season, now) !== 'ft').slice(0, 3);
    const games = [...next, ...past].map(f => fixtureRow(f, now)).join('') || '<p class="quiet">No matches yet.</p>';
    const tot = totals(hiddenIds.size ? { ...season, fixtures: season.fixtures.map(f => (hiddenIds.has(f.id) ? { ...f, result: null } : f)) } : season);
    const best = squad.map(p => ({ p, t: tot[String(p.id)] })).filter(x => x.t?.apps).sort((a, b) => b.t.rsum / b.t.apps - a.t.rsum / a.t.apps).slice(0, 3);
    const top = best.length ? best.map(({ p, t }) => `<div class="ov-row"><span class="ov-pl"><i class="pos-${esc(p.position)}">${esc(p.position)}</i>${esc(p.name)}</span><b>${rating(t.rsum / t.apps)}<small>${t.g} G · ${t.a} A</small></b></div>`).join('') : '<p class="quiet">No matches played yet.</p>';
    $('#ov-cards', box).innerHTML = `<section class="lg-card ov-games" aria-label="Matches"><div class="lg-card-head"><h2>Matches</h2></div>${games}</section>
      <section class="lg-card" aria-label="Best rated"><div class="lg-card-head"><h2>Best rated</h2></div><div class="ov-rows">${top}</div></section>`;
  }

  // ----- the form: one row per thing to fill in; a row opens its menu -----

  const dlg = id => $(`#dlg-${id}`, box);
  const openDlg = id => { const d = dlg(id); if (d && !d.open) { d.showModal(); d.focus({ preventScroll: true }); } };
  let pieceKey = null;
  const nameOf = id => (id != null && byId.get(String(id))?.name) || '';
  function drawForm() {
    const slots = Object.keys(FORMATIONS[sheet.formation]), n = filled();
    const oop = slots.filter(sl => sheet.lineup[sl] && byId.get(String(sheet.lineup[sl])) && byId.get(String(sheet.lineup[sl])).position !== wantOf(sl)).length;
    const preset = Object.keys(PRESETS).find(k => TACTICS.every(t => PRESETS[k][t.key] === sheet.tactics[t.key])) || 'Custom';
    const kitLabel = sheet.kit && kitsMade[sheet.kit] ? kitName(sheet.kit, kitsMade[sheet.kit]) : 'Automatic';
    const rows = [
      ['lineup', 'Starting XI', `${n} of ${slots.length} · ${sheet.formation}${oop ? ` · ${oop} out of position` : ''}`, n === slots.length],
      ...PIECES.map(([k, label]) => [`piece:${k}`, label, nameOf(sheet[k]) || 'Not set', Boolean(sheet[k])]),
      ['tactics', 'Tactics', preset, true],
      ['kit', 'Kit', kitLabel, true],
    ];
    $('#fm-rows', box).innerHTML = rows.map(([k, label, v, ok]) => `<li><button type="button" class="fm-row" data-open="${esc(k)}"><i class="fm-dot${ok ? ' ok' : ''}" aria-hidden="true"></i><span class="fm-k">${esc(label)}</span><span class="fm-v${ok ? '' : ' todo'}">${esc(v)}</span></button></li>`).join('');
  }
  function drawPieceList() {
    const label = PIECES.find(([k]) => k === pieceKey)?.[1] || '';
    $('#dlg-piece-t', box).textContent = label;
    const xi = Object.keys(FORMATIONS[sheet.formation]).map(slot => ({ slot, p: byId.get(String(sheet.lineup[slot])) })).filter(x => x.p);
    $('#piece-list', box).innerHTML = [`<li><button type="button" class="pk-row" data-set="" aria-pressed="${!sheet[pieceKey]}"><span class="pk-name">Not set</span></button></li>`,
      ...xi.map(({ slot, p }) => `<li><button type="button" class="pk-row" data-set="${esc(p.id)}" aria-pressed="${String(sheet[pieceKey]) === String(p.id)}"><span class="pk-pos pos-${esc(p.position)}">${esc(p.position)}</span><span class="pk-name">${esc(p.name)}<small>${esc(slot)}</small></span></button></li>`)].join('');
  }
  for (const d of box.querySelectorAll('dialog')) {
    d.addEventListener('close', () => { sel = null; redraw(); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });   // a tap on the dim area
  }

  // ----- drawing -----

  const slotOf = id => Object.keys(sheet.lineup).find(s => sheet.lineup[s] === id) || null;
  const wantOf = slot => FORMATIONS[sheet.formation][slot]?.want;

  // Formations (S-30): the four presets, the club's own shape when it isn't one of them, and a Custom button that opens the builder.
  // The builder sets how many players stand in each line (they must add up to 10 outfield players) and names the shape, e.g. 4-1-4-1.
  const LINES = [['d', 'Defenders', 3, 5], ['m', 'Midfielders', 1, 5], ['a', 'Attacking midfielders', 0, 5], ['f', 'Forwards', 1, 3]];
  let fbOpen = false, fb = { d: 4, m: 3, a: 0, f: 3 };
  const fbName = () => [fb.d, fb.m, fb.a || null, fb.f].filter(n => n != null).join('-');
  const fbFrom = name => { const n = name.split('-').map(Number); return n.length === 3 ? { d: n[0], m: n[1], a: 0, f: n[2] } : { d: n[0], m: n[1], a: n[2], f: n[3] }; };
  function drawFormations() {
    const presets = Object.keys(FORMATIONS), own = presets.includes(sheet.formation) ? [] : [sheet.formation];
    $('#fm-pills', box).innerHTML = [...presets, ...own].map(f => `<button type="button" role="radio" data-f="${esc(f)}" aria-checked="${f === sheet.formation}">${esc(f)}</button>`).join('')
      + `<button type="button" role="radio" aria-checked="false" class="fb-open" data-fb-toggle aria-expanded="${fbOpen}" aria-controls="fb">Custom</button>`;
    const el = $('#fb', box); el.hidden = !fbOpen;
    if (!fbOpen) return;
    const total = fb.d + fb.m + fb.a + fb.f, name = fbName(), ok = total === 10 && isFormation(name);
    const left = 10 - total;
    el.innerHTML = `<p class="fb-t">Build your own shape</p>
      <ul class="fb-rows">${LINES.map(([k, label, lo, hi]) => `<li><span>${label}</span><span class="fb-step"><button type="button" data-fb="${k}-" aria-label="Fewer ${label.toLowerCase()}"${fb[k] <= lo ? ' disabled' : ''}>&minus;</button><b aria-live="polite">${fb[k]}</b><button type="button" data-fb="${k}+" aria-label="More ${label.toLowerCase()}"${fb[k] >= hi || left <= 0 ? ' disabled' : ''}>+</button></span></li>`).join('')}</ul>
      <p class="fb-sum${ok ? '' : ' bad'}">${ok ? `${esc(name)}: 10 outfield players` : left > 0 ? `${left} more outfield player${left === 1 ? '' : 's'} to place` : `Take off ${-left} outfield player${left === -1 ? '' : 's'}`}</p>
      <div class="fb-go"><button type="button" class="link-btn" data-fb-cancel>Cancel</button><button type="button" class="btn-primary" data-fb-apply${ok && name !== sheet.formation ? '' : ' disabled'}>${ok ? `Use ${esc(name)}` : 'Use this shape'}</button></div>`;
  }
  function setFormation(f) {
    if (f === sheet.formation) return;
    sheet.lineup = reshape(sheet.lineup, sheet.formation, f, squad);
    sheet.formation = f; sel = null;
    changed(); redraw(`[data-f="${f}"]`);
  }

  function drawPitch() {
    renderPitch($('#pitch', box), { ...sheet, players: squad, editable: true, selected: sel?.slot || null, onSlot, club, kits: pitchKits() });
    drawFormations();
    // S-25: a player out of position loses rating in the match, more the further the slot is from his own (positionPenalty).
    const off = Object.keys(FORMATIONS[sheet.formation]).map(sl => ({ sl, p: byId.get(String(sheet.lineup[sl])) })).filter(x => x.p && x.p.position !== wantOf(x.sl))
      .map(x => ({ ...x, pen: positionPenalty(wantOf(x.sl), x.p.position) }));
    const oop = $('#oop', box); oop.hidden = !off.length;
    oop.innerHTML = off.length ? `<b>Out of position: lower match rating</b><ul>${off.map(x => `<li><span>${esc(x.p.name)} (${esc(x.p.position)} at ${esc(x.sl)})</span><b>&minus;${x.pen}</b></li>`).join('')}</ul>` : ''
    const pick = $('#pick', box), p = sel?.player && byId.get(sel.player);
    pick.hidden = !sel;
    box.querySelector('.ts').classList.toggle('picking', Boolean(sel?.slot));
    $('#pls-title', box).textContent = sel?.slot ? `Pick for ${sel.slot}` : 'Players';
    if (sel) pick.innerHTML = `<span>${sel.slot ? `Pick a player for <b>${esc(sel.slot)}</b>` : `Pick a place for <b>${esc(p?.name || '')}</b>`}</span><button type="button" class="link-btn" data-cancel>Cancel</button>`;
  }

  // Clear all positions: everyone back to the list to redo the XI, with an undo until the next change.
  let cleared = null, undoMsg = 'Positions cleared.';
  function drawClear() {
    $('#clear', box).innerHTML = cleared
      ? `<span>${undoMsg}</span> <button type="button" class="link-btn" data-unclear>Undo</button>`
      : `<button type="button" class="link-btn" data-best>Pick best XI</button><button type="button" class="link-btn" data-clear${filled() ? '' : ' disabled'}>Clear all positions</button>`;
  }

  function drawPlayers() {
    const want = sel?.slot ? wantOf(sel.slot) : null;
    const list = want ? [...squad].sort((a, b) => (b.position === want) - (a.position === want)) : squad;
    $('#players', box).innerHTML = list.map(p => {
      const id = String(p.id), slot = slotOf(id), off = slot && p.position !== wantOf(slot), on = sel?.player === id;
      return `<li><button type="button" class="pl${slot ? ' in' : ''}${on ? ' sel' : ''}${want && p.position === want ? ' fits' : ''}" data-id="${esc(id)}" aria-pressed="${on}">
        <span class="pl-pos pos-${esc(p.position)}">${esc(p.position)}</span>
        <span class="pl-name"><span class="pl-pic">${portrait(p, club, undefined, true)}</span>${esc(p.name)}<small>${p.number != null && p.number !== '' ? `#${esc(p.number)}` : ''}</small></span>
        <span class="pl-rts"><span class="rt rt-${Number(p.offense) || 5}" title="Attack">${esc(p.offense)}</span><span class="rt rt-${Number(p.defense) || 5}" title="Defence">${esc(p.defense)}</span></span>
        <span class="pl-slot${off ? ' off' : ''}"${off ? ` title="Out of position: match rating drops by ${positionPenalty(wantOf(slot), p.position)}"` : ''}>${slot ? esc(slot) : 'Bench'}</span></button></li>`;
    }).join('');
  }

  // Which kit the team wears (S-23): automatic, or one of the club's own kits, each shown by the name the club gave it.
  function drawKit() {
    const made = FIELD_SLOTS.filter(s => kitsMade[s]);
    $('#kitpick', box).innerHTML = made.length
      ? `<div class="kitpick" role="radiogroup" aria-label="Kit for the match">
          <button type="button" role="radio" data-kit="" aria-checked="${!sheet.kit}"><b>Automatic</b><small>Home kit; the away kit if the colours clash</small></button>
          ${made.map(s => `<button type="button" role="radio" data-kit="${s}" aria-checked="${sheet.kit === s}"><img alt="" src="${kitSprite({ ...kitsMade[s], text: { name: '', number: '', colour: '' } }, { art: kitArt[s] }, 64).toDataURL()}" width="30" height="52"><b>${esc(kitName(s, kitsMade[s]))}</b></button>`).join('')}</div>`
      : '<p class="quiet">No kits designed yet. Your team plays in its club colours.</p>';
  }

  const word = (t, v) => (v === 0.5 ? 'Balanced' : v === 0 ? `Very ${t.lo.toLowerCase()}` : v === 1 ? `Very ${t.hi.toLowerCase()}` : v < 0.5 ? t.lo : t.hi);
  const STYLE_NOTE = { Balanced: 'No strong lean. Safe in any match.', Possession: 'Short passes, wide and high. Keep the ball.', 'High press': 'Win it back high up the pitch.', Counter: 'Sit back, then break fast with direct passes.', 'Park the bus': 'Deep and narrow. Make it hard to score.' };
  function drawTactics() {
    const preset = Object.keys(PRESETS).find(n => TACTICS.every(t => PRESETS[n][t.key] === sheet.tactics[t.key]));
    $('#tactics', box).innerHTML = `<p class="tac-sub">Style</p>
      <ul class="pk">${Object.keys(PRESETS).map(n => `<li><button type="button" class="pk-row" data-preset="${esc(n)}" aria-pressed="${n === preset}"><span class="pk-name">${esc(n)}<small>${esc(STYLE_NOTE[n] || '')}</small></span></button></li>`).join('')}</ul>
      <p class="tac-sub tac-fine">Fine-tune${preset ? '' : ' <b>Custom</b>'}</p>
      ${TACTICS.map(t => `<div class="tac"><div class="tac-head"><span id="tac-${t.key}">${t.label}</span><b>${word(t, sheet.tactics[t.key])}</b></div>
        <div class="dots" data-dial="${t.key}" style="--v:${sheet.tactics[t.key]}" role="radiogroup" aria-labelledby="tac-${t.key}"><i class="thumb" aria-hidden="true"></i>${STEPS.map(v => `<button type="button" role="radio" data-tac="${t.key}" data-v="${v}" aria-checked="${sheet.tactics[t.key] === v}" aria-label="${esc(word(t, v))}"></button>`).join('')}</div>
        <div class="tac-ends" aria-hidden="true"><span>${t.lo}</span><span>${t.hi}</span></div></div>`).join('')}`;
  }

  function drawSave() {
    const el = $('#save', box), t = savedAt ? tidy(dayTime.format(savedAt)) : '';
    el.className = `ts-save is-${state}`;
    el.innerHTML = {
      dirty: '<span>Unsaved changes</span>',
      new: '<span>Saving…</span>',
      saving: '<span>Saving…</span>',
      saved: `<span>Saved${t ? ` ${esc(t)}` : ''}</span>`,
      error: '<span>Couldn’t save</span><button type="button" class="save-btn" data-save>Try again</button>',
      'error-load': '<span>Your saved sheet didn’t load</span>',
    }[state];
  }

  const wk = w => season?.rounds?.[w]?.label || `Week ${w}`;

  const crestOf = code => (code === club.code && club.crest_path ? crestUrl(club.crest_path) : logoUrl(code));

  function drawDeadline(now = new Date()) {
    const next = deadlines.find(d => new Date(d.locks_at) > now), el = $('#deadline', box);
    if (!next) { el.textContent = 'No deadline set'; return; }
    const at = new Date(next.locks_at), m = Math.ceil((at - now) / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    const count = d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
    el.className = `ts-deadline${m < 1440 ? ' soon' : ''}`;
    el.innerHTML = `<span>Locks ${esc(when(at, now))}</span><b>${esc(count)}</b>`;
  }

  // ----- submitting (0.63) -----
  // The rounds this club plays that haven't locked, soonest first, each with its match.
  const upcoming = (now = new Date()) => deadlines.filter(d => d.week !== 99 && !d.locked_at && new Date(d.locks_at) > now).map(d => {
    const fx = (season?.fixtures || []).find(f => f.week === d.week && !f.postponed && (f.home === club.code || f.away === club.code));
    return fx ? { week: d.week, locks: new Date(d.locks_at), fx } : null;
  }).filter(Boolean).sort((a, b) => a.locks - b.locks);
  const bodyOf = () => { const b = JSON.parse(JSON.stringify(sheet)); if (b.kit == null) delete b.kit; return b; };
  const sameAsNow = s => s && JSON.stringify(normaliseSheet(s.sheet, squad)) === JSON.stringify(normaliseSheet(bodyOf(), squad));
  const teamName = code => season?.teams?.find(x => x.code === code)?.name || code;
  const filled = () => Object.keys(FORMATIONS[sheet.formation]).filter(s => sheet.lineup[s]).length;

  function drawSubmit(now = new Date()) {
    const el = $('#submit', box); if (!el) return;
    const rounds = upcoming(now), next = rounds[0];
    if (!next) { el.innerHTML = '<p class="ts-sub-line">No upcoming round to submit for yet.</p>'; return; }
    const s = submitted.get(next.week), same = sameAsNow(s);
    const line = s ? (same ? `<b>Submitted</b> for ${esc(wk(next.week))} · ${esc(tidy(dayTime.format(new Date(s.submitted_at))))}`
      : `<b>Changed since you submitted</b> for ${esc(wk(next.week))}. Submit again to use these changes.`)
      : `<b>Not submitted</b> for ${esc(wk(next.week))} yet. If you don’t, your latest saved sheet is used.`;
    const cls = s ? (same ? 'is-done' : 'is-changed') : 'is-todo';
    if (!picking) {
      // Already submitted and unchanged: say so, and offer the next round's sheet instead of asking again.
      if (s && same) {
        const after = rounds.find(r => !submitted.has(r.week));
        el.innerHTML = `<p class="ts-sub-line ${cls} ts-sub-done" role="status"><b>SUBMITTED</b> for ${esc(wk(next.week))} · ${esc(tidy(dayTime.format(new Date(s.submitted_at))))}${subMsg ? ` <span class="ts-sub-msg">${esc(subMsg)}</span>` : ''}</p>`
          + (after ? `<button type="button" class="ts-submit-btn" data-sub-open data-sub-week="${after.week}">Submit ${esc(wk(after.week))} instead</button>` : '');
        return;
      }
      el.innerHTML = `<button type="button" class="ts-submit-btn" data-sub-open>Submit team sheet</button><p class="ts-sub-line ${cls}" role="status">${line}${subMsg ? ` <span class="ts-sub-msg">${esc(subMsg)}</span>` : ''}</p>`;
      return;
    }
    pickWeek = rounds.some(r => r.week === pickWeek) ? pickWeek : next.week;
    const xi = filled(), slots = Object.keys(FORMATIONS[sheet.formation]).length;
    el.innerHTML = `<fieldset class="ts-rounds"><legend>Which round is this team sheet for?</legend>
      ${rounds.map(r => {
        const home = r.fx.home === club.code, opp = home ? r.fx.away : r.fx.home, k = kickoff(r.fx), sub = submitted.get(r.week);
        return `<label class="ts-round${pickWeek === r.week ? ' on' : ''}${season?.rounds?.[r.week]?.preseason ? ' ps-row' : ''}"><input type="radio" name="sub-week" value="${r.week}" ${pickWeek === r.week ? 'checked' : ''}>
          <span class="ts-round-main"><b>${esc(wk(r.week))}${season?.rounds?.[r.week]?.preseason ? tag : ''}</b><span>${home ? 'v' : 'at'} ${esc(teamName(opp))}${k ? ` · ${esc(when(k, now))}` : ''}</span><small>Locks ${esc(when(r.locks, now))}</small></span>
          <span class="ts-round-state">${sub ? `Submitted<button type="button" class="link-btn" data-withdraw="${r.week}">Withdraw</button>` : 'Not submitted'}</span></label>`;
      }).join('')}</fieldset>
      ${xi < slots ? `<p class="ts-sub-warn">Your XI has ${xi} of ${slots} players. Empty spots are filled automatically.</p>` : ''}
      <div class="ts-sub-actions"><button type="button" class="ts-submit-btn" data-sub-go aria-label="Submit for ${esc(wk(pickWeek))}" ${subBusy ? 'disabled' : ''}>${subBusy ? 'Submitting…' : 'Submit'}</button><button type="button" class="link-btn" data-sub-cancel>Cancel</button></div>
      ${subMsg ? `<p class="ts-sub-msg" role="alert">${esc(subMsg)}</p>` : ''}`;
  }

  async function submitFor(week) {
    subBusy = true; subMsg = ''; drawSubmit();
    const body = bodyOf();
    const { data, error } = await ok(c.rpc('submit_team_sheet', { p_week: week, p_sheet: body }));
    subBusy = false;
    if (error) { subMsg = /locked|play in that round|deadline|linked|complete/.test(error.message) ? error.message : 'That didn’t submit. Check your connection and try again.'; drawSubmit(); return; }
    submitted.set(week, { week, sheet: body, submitted_at: data || new Date().toISOString() });
    picking = false; subMsg = week === upcoming()[0]?.week ? '' : `Also submitted for ${wk(week)}.`;   // the next round's line already says it
    drawSubmit();
    $('#submit .ts-submit-btn', box)?.focus();
  }
  async function withdraw(week) {
    const { error } = await ok(c.rpc('withdraw_team_sheet', { p_week: week }));
    if (error) { subMsg = /locked/.test(error.message) ? error.message : 'That didn’t withdraw. Try again.'; drawSubmit(); return; }
    submitted.delete(week); subMsg = `Withdrawn: ${wk(week)} will use your latest saved sheet.`; drawSubmit();
  }

  // ----- changes -----

  function changed() {
    cleared = null;   // any later change ends the undo
    // The captain and set-piece takers must be in the XI; the bench is everyone else.
    const inXI = new Set(Object.values(sheet.lineup));
    for (const [k] of PIECES) if (sheet[k] && !inXI.has(sheet[k])) sheet[k] = null;
    sheet.bench = benchOf(sheet.lineup, squad);
    if (state === 'saving') { again = true; return; }
    state = saved && JSON.stringify(sheet) === saved ? 'saved' : 'dirty';
    drawSave(); if (!picking) drawSubmit(); drawForm();
    clearTimeout(timer);
    if (state === 'dirty') timer = setTimeout(save, 1200);
  }

  async function save() {
    clearTimeout(timer);
    if (saving) { again = true; return; }
    saving = true; again = false; state = 'saving'; drawSave();
    const snap = JSON.stringify(sheet);
    const body = JSON.parse(snap);
    if (body.kit == null && !(rowRes.data && 'kit' in rowRes.data)) delete body.kit;   // until the kit column exists (migration 0044), a sheet without a kit pick saves exactly as before
    const { error } = await ok(c.from('team_sheets').upsert({ club: club.code, ...body, updated_by: userId }, { onConflict: 'club' }));
    saving = false;
    if (error) { state = 'error'; drawSave(); return; }
    saved = snap; savedAt = new Date();
    state = JSON.stringify(sheet) === saved ? 'saved' : 'dirty';
    drawSave();
    if (state === 'dirty') timer = setTimeout(save, again ? 0 : 1200);
    again = false;
  }

  // Put a player in a slot: from another slot they swap; from the bench, the slot's player goes to the bench.
  function place(slot, id) {
    const from = slotOf(id), cur = sheet.lineup[slot];
    if (from === slot) return;
    if (from) { if (cur) sheet.lineup[from] = cur; else delete sheet.lineup[from]; }
    sheet.lineup[slot] = id;
  }

  function redraw(focus) {
    drawPitch(); drawPlayers(); drawKit(); drawClear(); drawForm();
    box.querySelector(focus)?.focus();
  }

  function onSlot(slot) {
    if (sel?.player) { place(slot, sel.player); sel = null; changed(); }
    else if (sel?.slot === slot) sel = null;
    else if (sel?.slot) {   // two slots: swap them
      const a = sheet.lineup[sel.slot], b = sheet.lineup[slot];
      if (b) sheet.lineup[sel.slot] = b; else delete sheet.lineup[sel.slot];
      if (a) sheet.lineup[slot] = a; else delete sheet.lineup[slot];
      sel = null; changed();
    } else sel = { slot };
    redraw(`.pt-slot[data-slot="${slot}"]`);
    if (sel?.slot && narrow()) $('#pp-players', box).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // DRAG AND DROP (S-01): drag a player from the list or a pitch spot onto a spot to place or swap them,
  // or a pitch player onto the list to bench them. Pointer events, so it works by touch too; a tap still picks.
  let drag = null, dragged = false;
  const dropAt = (x, y) => { const el = document.elementFromPoint(x, y); return el?.closest('.pt-slot[data-slot]') || el?.closest('#players'); };
  box.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const from = e.target.closest('.pl, .pt-slot[data-slot]:not(.empty)');
    if (!from || !box.contains(from)) return;
    const slot = from.dataset.slot || null, id = slot ? sheet.lineup[slot] : from.dataset.id;
    if (!id) return;
    // By touch, the player list still scrolls: a drag from it starts with a short hold.
    const hold = e.pointerType === 'touch' && !slot;
    drag = { id, slot, x: e.clientX, y: e.clientY, ghost: null, over: null, pid: e.pointerId, armed: !hold };
    if (hold) { const d = drag; setTimeout(() => { if (drag === d) { d.armed = true; from.classList.add('held'); } }, 300); }
  });
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      if (!drag.armed) { drag = null; return; }   // moved before the hold: it's a scroll
      box.querySelector('.held')?.classList.remove('held');
      const p = byId.get(drag.id);
      drag.ghost = Object.assign(document.createElement('div'), { className: 'ts-ghost', textContent: p?.name || '' });
      (box.querySelector('dialog[open]') || document.body).append(drag.ghost); box.classList.add('dragging');
      try { e.target.releasePointerCapture?.(e.pointerId); } catch {}
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    drag.cx = e.clientX; drag.cy = e.clientY;
    hover();
    if (!drag.scroller) scrollNearEdge(drag);
  });
  function hover() {
    const over = dropAt(drag.cx, drag.cy);
    if (over !== drag.over) { drag.over?.classList.remove('drop'); over?.classList.add('drop'); drag.over = over; }
  }
  // Near the top or bottom of the screen the page scrolls, so a spot that's off screen can still be reached.
  function scrollNearEdge(d) {
    const EDGE = 50, step = () => {
      if (drag !== d || !d.ghost) { d.scroller = null; return; }
      const h = innerHeight, v = d.cy < EDGE ? -(EDGE - d.cy) : d.cy > h - EDGE ? EDGE - (h - d.cy) : 0;
      if (v) { (box.querySelector('dialog[open] .dlg-body') || window).scrollBy(0, Math.round(v / 3)); hover(); }
      d.scroller = requestAnimationFrame(step);
    };
    d.scroller = requestAnimationFrame(step);
  }
  // On touch, stop the page scrolling once a drag has started.
  box.addEventListener('touchmove', e => { if (drag?.armed) e.preventDefault(); }, { passive: false });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    box.querySelector('.held')?.classList.remove('held');
    if (!d.ghost) return;
    cancelAnimationFrame(d.scroller);
    d.ghost.remove(); box.classList.remove('dragging'); d.over?.classList.remove('drop');
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    if (e.type === 'pointercancel') return;
    const to = dropAt(e.clientX, e.clientY);
    if (!to) return;
    sel = null;
    if (to.id === 'players') {   // back to the bench
      if (!d.slot) return;
      delete sheet.lineup[d.slot]; changed(); redraw();
    } else if (to.dataset.slot !== d.slot) { place(to.dataset.slot, d.id); changed(); redraw(); }
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);
  // A drag ends in a click on whatever it started on; that click shouldn't also pick.
  box.addEventListener('click', e => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  // The tactics dials: drag the dot along its line (it snaps to the nearest of five on release); a tap or the arrow keys also work.
  let dial = null;
  function dialAt(e) {
    const r = dial.el.getBoundingClientRect(), v = Math.min(1, Math.max(0, (e.clientX - r.left - r.width * 0.1) / (r.width * 0.8)));
    dial.el.style.setProperty('--v', v);
    const snapped = STEPS[Math.round(v * 4)];
    if (snapped !== sheet.tactics[dial.key]) {
      sheet.tactics[dial.key] = snapped; changed();
      const t = TACTICS.find(x => x.key === dial.key), head = dial.el.closest('.tac').querySelector('.tac-head b');
      head.textContent = word(t, snapped);
      dial.el.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-checked', Number(b.dataset.v) === snapped));
    }
  }
  box.addEventListener('pointerdown', e => {
    const el = e.target.closest('.dots'); if (!el || e.button !== 0) return;
    dial = { el, key: el.dataset.dial, pid: e.pointerId }; el.classList.add('drag'); el.setPointerCapture(e.pointerId); dialAt(e);
  });
  box.addEventListener('pointermove', e => { if (dial && e.pointerId === dial.pid) dialAt(e); });
  const dialEnd = e => { if (!dial || e.pointerId !== dial.pid) return; const k = dial.key; dial = null; drawTactics(); };
  box.addEventListener('pointerup', dialEnd); box.addEventListener('pointercancel', dialEnd);
  box.addEventListener('keydown', e => {
    const b = e.target.closest?.('[data-tac]'); if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = Math.min(4, Math.max(0, STEPS.indexOf(sheet.tactics[b.dataset.tac]) + (e.key === 'ArrowRight' ? 1 : -1)));
    sheet.tactics[b.dataset.tac] = STEPS[i]; changed(); drawTactics(); box.querySelector(`[data-tac="${b.dataset.tac}"][data-v="${STEPS[i]}"]`)?.focus();
  });

  box.addEventListener('click', e => {
    const t = e.target;
    const op = t.closest('[data-open]');
    if (op) {
      const k = op.dataset.open;
      if (k === 'lineup') { sel = null; redraw(); openDlg('lineup'); }
      else if (k.startsWith('piece:')) { pieceKey = k.slice(6); drawPieceList(); openDlg('piece'); }
      else if (k === 'tactics') { drawTactics(); openDlg('tactics'); }
      else if (k === 'kit') { drawKit(); openDlg('kit'); }
      return;
    }
    if (t.closest('[data-close]')) { t.closest('dialog').close(); return; }
    const st0 = t.closest('[data-set]');
    if (st0) { sheet[pieceKey] = st0.dataset.set || null; changed(); t.closest('dialog').close(); return; }
    const f = t.closest('[data-f]'), pl = t.closest('.pl'), pr = t.closest('[data-preset]'), st = t.closest('[data-tac]'), fbs = t.closest('[data-fb]');
    if (t.closest('[data-fb-toggle]')) {
      fbOpen = !fbOpen; if (fbOpen) fb = fbFrom(sheet.formation);
      drawFormations(); box.querySelector(fbOpen ? '[data-fb="d+"]:not([disabled]), [data-fb="d-"]' : '[data-fb-toggle]')?.focus();
    } else if (t.closest('[data-fb-cancel]')) { fbOpen = false; drawFormations(); box.querySelector('[data-fb-toggle]')?.focus(); }
    else if (t.closest('[data-fb-apply]')) { const name = fbName(); if (isFormation(name)) { fbOpen = false; setFormation(name); } }
    else if (fbs) {
      const [k, dir] = [fbs.dataset.fb[0], fbs.dataset.fb[1] === '+' ? 1 : -1], [, , lo, hi] = LINES.find(l => l[0] === k);
      fb[k] = Math.min(hi, Math.max(lo, fb[k] + dir)); drawFormations();
      box.querySelector(`[data-fb="${k}${dir > 0 ? '+' : '-'}"]:not([disabled])`)?.focus();
    } else if (f) {
      fbOpen = false; setFormation(f.dataset.f);
    } else if (pl) {
      const id = pl.dataset.id, hadSlot = Boolean(sel?.slot);
      if (hadSlot) { place(sel.slot, id); sel = null; changed(); }
      else sel = sel?.player === id ? null : { player: id };
      redraw(`.pl[data-id="${id}"]`);
      if ((sel?.player || hadSlot) && narrow()) $('#pitch', box).scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.closest('[data-cancel]')) { sel = null; redraw(); }
    else if (pr) { sheet.tactics = { ...PRESETS[pr.dataset.preset] }; changed(); drawTactics(); box.querySelector(`[data-preset="${pr.dataset.preset}"]`)?.focus(); }
    else if (st) { sheet.tactics[st.dataset.tac] = Number(st.dataset.v); changed(); drawTactics(); box.querySelector(`[data-tac="${st.dataset.tac}"][data-v="${st.dataset.v}"]`)?.focus(); }
    else if (t.closest('[data-kit]')) { sheet.kit = t.closest('[data-kit]').dataset.kit || null; changed(); drawKit(); drawPitch(); box.querySelector(`[data-kit="${sheet.kit || ''}"]`)?.focus(); }
    else if (t.closest('[data-clear]')) {
      const was = { lineup: { ...sheet.lineup }, ...Object.fromEntries(PIECES.map(([k]) => [k, sheet[k]])) };
      sheet.lineup = {}; sel = null; changed(); cleared = was; undoMsg = 'Positions cleared.'; redraw('[data-unclear]');
    } else if (t.closest('[data-best]')) {
      const was = { lineup: { ...sheet.lineup }, ...Object.fromEntries(PIECES.map(([k]) => [k, sheet[k]])) };
      sheet.lineup = autoLineup(sheet.formation, squad); sel = null; changed(); cleared = was; undoMsg = 'Best XI picked.'; redraw('[data-unclear]');
    } else if (t.closest('[data-unclear]')) {
      Object.assign(sheet, cleared); cleared = null; changed(); redraw('[data-clear]');
    }
    else if (t.closest('[data-save]')) save();
    else if (t.closest('[data-sub-open]')) { picking = true; subMsg = ''; const w = Number(t.closest('[data-sub-open]').dataset.subWeek); if (w) pickWeek = w; drawSubmit(); $('#submit input[name="sub-week"]:checked', box)?.focus(); }
    else if (t.closest('[data-sub-cancel]')) { picking = false; subMsg = ''; drawSubmit(); $('#submit .ts-submit-btn', box)?.focus(); }
    else if (t.closest('[data-sub-go]')) submitFor(pickWeek);
    else if (t.closest('[data-withdraw]')) { e.preventDefault(); withdraw(Number(t.closest('[data-withdraw]').dataset.withdraw)); }
  });
  box.addEventListener('change', e => {
    if (e.target.name === 'sub-week') { pickWeek = Number(e.target.value); drawSubmit(); $('#submit input[name="sub-week"]:checked', box)?.focus(); return; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sel) { sel = null; redraw(); } });
  // Leaving the page: send what's waiting rather than lose it.
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'dirty') save(); });

  drawPitch(); drawPlayers(); drawKit(); drawClear(); drawTactics(); drawSave(); drawDeadline(); drawSubmit(); drawForm(); drawInfo();
  if (state === 'new') save();

  // The deadline counts down; once one passes, read the deadlines again until the database has locked that week.
  setInterval(async () => {
    if (document.hidden) return;
    const now = new Date();
    if (deadlines.some(d => new Date(d.locks_at) <= now && !d.locked_at)) {
      const r = await ok(c.from('deadlines').select('*').order('locks_at'));
      if (!r.error) deadlines = r.data || [];
    }
    drawDeadline(now); if (!picking) drawSubmit(now);
  }, 30000);
}
