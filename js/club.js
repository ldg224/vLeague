// My club (0.6): the team sheet (formation, the XI on a pitch, set pieces, tactics) saved to Supabase team_sheets,
// the deadline it counts for (deadlines) and the last locked sheet (week_sheets); and the squad with season totals.
// Every save is kept by the database; at a week's deadline it copies each club's last save into week_sheets.
import { enterPlace } from './shell.js';
import { esc, crestUrl } from './member.js';
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { finished, logoUrl, kickoff } from './dashboard-data.js';
import { rating } from './places.js';
import { prefsNow, spoilerHidden, revealScore } from './prefs.js';
import { kitSprite, cleanDesign, kitName, FIELD_SLOTS } from './kit.js';
import { renderPitch, FORMATIONS, TACTICS, STEPS, PRESETS, POS_ORDER, normaliseSheet, reshape, benchOf } from './pitch.js';

const POS_NAME = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const PIECES = [['captain', 'Captain'], ['penalties', 'Penalties'], ['freekicks', 'Free kicks'], ['corners', 'Corners']];
const TZ = 'Australia/Melbourne';
const $ = (s, root = document) => root.querySelector(s);

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

// Spoiler-free results (0.7): the stats leave out results the account hasn't revealed.
function statsHtml(season, squad) {
  if (!squad.length) return '<p class="empty">No players yet.</p>';
  const hidden = (season.fixtures || []).filter(f => spoilerHidden(f, season)).map(f => f.id);
  const seen = hidden.length ? { ...season, fixtures: season.fixtures.map(f => (hidden.includes(f.id) ? { ...f, result: null } : f)) } : season;
  const tot = totals(seen);
  return `<table class="squad">
    <thead><tr><th scope="col" class="pos"><abbr title="Position">Pos</abbr></th><th scope="col" class="who">Player</th><th scope="col"><abbr title="Appearances">Apps</abbr></th><th scope="col"><abbr title="Goals">G</abbr></th><th scope="col"><abbr title="Assists">A</abbr></th><th scope="col"><abbr title="Average rating">Avg</abbr></th></tr></thead>
    <tbody>${squad.map(p => {
      const t = tot[String(p.id)] || { apps: 0, g: 0, a: 0 };
      return `<tr><td class="pos"><abbr title="${esc(POS_NAME[p.position] || p.position || '')}">${esc(p.position || '')}</abbr></td>
        <th scope="row" class="who">${esc(p.name)}</th><td>${t.apps}</td><td>${t.g}</td><td>${t.a}</td>
        <td class="avg">${t.apps ? rating(t.rsum / t.apps) : '–'}</td></tr>`;
    }).join('')}</tbody>
  </table>${hidden.length ? `<p class="spoil">${hidden.length === 1 ? '1 result' : `${hidden.length} results`} hidden · <button type="button" class="link-btn" data-reveal-all="${esc(hidden.join(' '))}">Show all</button></p>` : ''}`;
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
      <header class="club-head">
        <img class="club-crest" src="${esc(crest)}" alt="" onerror="this.remove()">
        <div class="club-name"><h1>${esc(club.name)}</h1>
          <p>${club.motto ? `<i>${esc(club.motto)}</i><br>` : ''}${[manager, club.stadium].filter(Boolean).map(x => `<span class="cl-meta">${esc(x)}</span>`).join(' · ')}</p></div>
        <a class="edit-club" href="kits.html">Kits</a>
        <a class="edit-club" href="setup.html?edit">Edit club</a>
      </header>
      <div class="club-tabs" role="tablist" aria-label="My club">
        <button type="button" role="tab" id="tab-sheet" aria-controls="sheet" aria-selected="true">Team sheet</button>
        <button type="button" role="tab" id="tab-squad" aria-controls="squad" aria-selected="false" tabindex="-1">Squad</button>
      </div>
      <section id="sheet" role="tabpanel" aria-labelledby="tab-sheet"><p class="quiet">Loading…</p></section>
      <section id="squad" role="tabpanel" aria-labelledby="tab-squad" hidden>
        <div class="sect" id="stats">${season ? statsHtml(season, squad) : '<p class="empty">The squad didn’t load. <a href="club.html">Try again</a></p>'}</div>
      </section>
    </div>`;

    // Tabs, remembered in the URL hash.
    const tabs = [...main.querySelectorAll('[role="tab"]')];
    const showTab = id => {
      for (const t of tabs) {
        const on = t.getAttribute('aria-controls') === id;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
      }
    };
    const tablist = main.querySelector('.club-tabs');
    tablist.addEventListener('click', e => {
      const t = e.target.closest('[role="tab"]');
      if (!t) return;
      const id = t.getAttribute('aria-controls');
      showTab(id);
      history.replaceState(null, '', id === 'squad' ? '#squad' : location.pathname + location.search);
    });
    tablist.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const next = tabs[(tabs.indexOf(document.activeElement) + 1) % tabs.length];
      next.focus(); next.click();
    });
    if (location.hash === '#squad') showTab('squad');
    main.querySelector('#stats').addEventListener('click', async e => {
      const b = e.target.closest('[data-reveal-all]');
      if (!b) return;
      await revealScore(b.dataset.revealAll.split(' '));
      main.querySelector('#stats').innerHTML = statsHtml(season, squad);
    });

    if (!season || !squad.length) {
      $('#sheet').innerHTML = `<div class="sect"><p class="empty">${season ? 'No players yet.' : 'The squad didn’t load. <a href="club.html">Try again</a>'}</p></div>`;
    } else {
      await teamSheet($('#sheet'), { club, squad, userId: me.user.id, season });
    }
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
  const kitRows = (kitRes.error ? [] : kitRes.data || []).filter(k => FIELD_SLOTS.includes(k.slot));
  const kitsMade = Object.fromEntries(kitRows.map(k => [k.slot, cleanDesign(k.design)]));   // the club's outfield kits (none until the kits table exists)
  const kitArt = Object.fromEntries(await Promise.all(kitRows.filter(k => k.art_path).map(k => new Promise(res => {   // its own whole-kit designs, approved or not
    const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res([k.slot, i]); i.onerror = () => res([k.slot, null]); i.src = `${SUPABASE_URL}/storage/v1/object/public/kits/${k.art_path}`;
  }))));
  let deadlines = dlRes.error ? [] : dlRes.data || [];   // no table yet (or it didn't load) = no deadline set
  let sheet = normaliseSheet(rowRes.data, squad);
  if (!rowRes.data && !rowRes.error) suggestPieces(sheet, byId);
  let saved = rowRes.data ? JSON.stringify(sheet) : null;   // what the database has; null = never saved
  let state = rowRes.error ? 'error-load' : rowRes.data ? 'saved' : 'new';   // 'new' saves at once (below)
  let savedAt = rowRes.data?.updated_at ? new Date(rowRes.data.updated_at) : null;
  let sel = null;   // { slot } or { player }: the first tap of a move
  let timer = null, saving = false, again = false, lockedKey = null;
  // SUBMIT (0.63): the sheet submitted for each upcoming round. Without one, a round uses the latest draft, as before.
  const submitted = new Map((subRes.error ? [] : subRes.data || []).map(s => [s.week, s]));
  let picking = false, pickWeek = null, subBusy = false, subMsg = '';

  box.innerHTML = `<div class="ts">
    <div class="ts-bar"><p class="ts-deadline" id="deadline"></p><div class="ts-save" id="save" aria-live="polite"></div></div>
    ${subRes.error ? '' : '<section class="ts-submit" id="submit" aria-label="Submit your team sheet"></section>'}
    <div class="ts-grid">
      <div class="ts-left">
        <div class="formations" role="radiogroup" aria-label="Formation">${Object.keys(FORMATIONS).map(f => `<button type="button" role="radio" data-f="${f}">${f}</button>`).join('')}</div>
        <div id="pitch" class="ts-pitch"></div>
        <div class="ts-clear" id="clear"></div>
        <p class="ts-pick" id="pick" hidden></p>
      </div>
      <div class="ts-right">
        <section class="sect pls-sect"><div class="sect-head"><h2 id="pls-title">Players</h2><button type="button" class="link-btn pls-close" data-cancel>Cancel</button></div><ul class="pls" id="players"></ul></section>
        <section class="sect"><div class="sect-head"><h2>Set pieces</h2></div><div class="pieces" id="pieces"></div></section>
        <section class="sect"><div class="sect-head"><h2>Kit</h2><a class="link-btn" href="kits.html">Design kits</a></div><div id="kitpick"></div></section>
        <section class="sect"><div class="sect-head"><h2>Tactics</h2></div><div id="tactics"></div></section>
      </div>
    </div>
    <div id="locked"></div>
  </div>`;

  // ----- drawing -----

  const slotOf = id => Object.keys(sheet.lineup).find(s => sheet.lineup[s] === id) || null;
  const wantOf = slot => FORMATIONS[sheet.formation][slot]?.want;

  function drawPitch() {
    renderPitch($('#pitch', box), { ...sheet, players: squad, editable: true, selected: sel?.slot || null, onSlot });
    for (const b of box.querySelectorAll('.formations button')) b.setAttribute('aria-checked', b.dataset.f === sheet.formation);
    const pick = $('#pick', box), p = sel?.player && byId.get(sel.player);
    pick.hidden = !sel;
    box.querySelector('.ts').classList.toggle('picking', Boolean(sel?.slot));
    $('#pls-title', box).textContent = sel?.slot ? `Pick for ${sel.slot}` : 'Players';
    if (sel) pick.innerHTML = `<span>${sel.slot ? `Pick a player for <b>${esc(sel.slot)}</b>` : `Pick a place for <b>${esc(p?.name || '')}</b>`}</span><button type="button" class="link-btn" data-cancel>Cancel</button>`;
  }

  // Clear all positions: everyone back to the list to redo the XI, with an undo until the next change.
  let cleared = null;
  function drawClear() {
    $('#clear', box).innerHTML = cleared
      ? `<span>Positions cleared.</span> <button type="button" class="link-btn" data-unclear>Undo</button>`
      : `<button type="button" class="link-btn" data-clear${filled() ? '' : ' disabled'}>Clear all positions</button>`;
  }

  function drawPlayers() {
    const want = sel?.slot ? wantOf(sel.slot) : null;
    const list = want ? [...squad].sort((a, b) => (b.position === want) - (a.position === want)) : squad;
    $('#players', box).innerHTML = list.map(p => {
      const id = String(p.id), slot = slotOf(id), off = slot && p.position !== wantOf(slot), on = sel?.player === id;
      return `<li><button type="button" class="pl${slot ? ' in' : ''}${on ? ' sel' : ''}${want && p.position === want ? ' fits' : ''}" data-id="${esc(id)}" aria-pressed="${on}">
        <span class="pl-pos">${esc(p.position)}</span>
        <span class="pl-name">${esc(p.name)}<small>#${esc(p.number ?? "")} · Att <span class="rt rt-${Number(p.offense) || 5}">${esc(p.offense)}</span> · Def <span class="rt rt-${Number(p.defense) || 5}">${esc(p.defense)}</span></small></span>
        <span class="pl-slot${off ? ' off' : ''}"${off ? ` title="Out of position"` : ''}>${slot ? esc(slot) : 'Bench'}</span></button></li>`;
    }).join('');
  }

  function drawPieces() {
    const xi = Object.keys(FORMATIONS[sheet.formation]).map(slot => ({ slot, p: byId.get(sheet.lineup[slot]) })).filter(x => x.p);
    $('#pieces', box).innerHTML = PIECES.map(([key, label]) => `<label class="piece"><span>${label}</span>
      <select data-piece="${key}"><option value="">Not set</option>${xi.map(({ slot, p }) => `<option value="${esc(p.id)}"${String(sheet[key]) === String(p.id) ? ' selected' : ''}>${esc(p.name)} (${esc(slot)})</option>`).join('')}</select></label>`).join('');
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
  function drawTactics() {
    const preset = Object.keys(PRESETS).find(n => TACTICS.every(t => PRESETS[n][t.key] === sheet.tactics[t.key]));
    const open = !preset || $('#tactics details', box)?.open;
    $('#tactics', box).innerHTML = `<div class="presets">${Object.keys(PRESETS).map(n => `<button type="button" data-preset="${esc(n)}" aria-pressed="${n === preset}">${esc(n)}</button>`).join('')}</div>
      <details class="custom"${open ? ' open' : ''}><summary>Custom${preset ? '' : ' <b>on</b>'}</summary>${TACTICS.map(t => `<div class="tac"><div class="tac-head"><span id="tac-${t.key}">${t.label}</span><b>${word(t, sheet.tactics[t.key])}</b></div>
        <div class="steps" role="radiogroup" aria-labelledby="tac-${t.key}">${STEPS.map(v => `<button type="button" role="radio" data-tac="${t.key}" data-v="${v}" aria-checked="${sheet.tactics[t.key] === v}" aria-label="${esc(word(t, v))}"></button>`).join('')}</div>
        <div class="tac-ends" aria-hidden="true"><span>${t.lo}</span><span>${t.hi}</span></div></div>`).join('')}</details>`;
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

  function drawDeadline(now = new Date()) {
    const next = deadlines.find(d => new Date(d.locks_at) > now), el = $('#deadline', box);
    if (!next) { el.textContent = 'No deadline set'; return; }
    const at = new Date(next.locks_at);
    el.innerHTML = `Counts for <b>${esc(wk(next.week))}</b> · locks ${esc(when(at, now))}${at - now < 86400000 ? ` · <span class="left">${esc(left(at, now))}</span>` : ''}`;
  }

  // The last week that locked: the sheet the database copied for it (or why there's none).
  async function drawLocked(now = new Date()) {
    const last = [...deadlines].reverse().find(d => new Date(d.locks_at) <= now), el = $('#locked', box);
    if (!last) { el.innerHTML = ''; lockedKey = null; return; }
    const key = `${last.week}:${last.locked_at}`;
    if (key === lockedKey) return;
    lockedKey = key;
    const { data, error } = await ok(c.from('week_sheets').select('*').eq('week', last.week).eq('club', club.code).maybeSingle());
    const open = el.querySelector('details')?.open ? ' open' : '';
    let body;
    if (data) body = `<div class="locked-pitch"></div>${data.saved_at ? `<p class="quiet">Saved ${esc(tidy(dateTime.format(new Date(data.saved_at))))}</p>` : ''}`;
    else if (!last.locked_at || error) body = '<p class="quiet">Locking…</p>';
    else body = '<p class="quiet">No sheet was saved before the deadline, so the team was picked automatically.</p>';
    el.innerHTML = `<details class="sect locked"${open}><summary><span>${esc(wk(last.week))} team sheet</span><span class="lock-tag">Locked</span></summary>${body}</details>`;
    if (data) renderPitch($('.locked-pitch', el), { ...normaliseSheet(data, squad), players: season.players });
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
      el.innerHTML = `<button type="button" class="ts-submit-btn" data-sub-open>Submit team sheet</button><p class="ts-sub-line ${cls}" role="status">${line}${subMsg ? ` <span class="ts-sub-msg">${esc(subMsg)}</span>` : ''}</p>`;
      return;
    }
    pickWeek = rounds.some(r => r.week === pickWeek) ? pickWeek : next.week;
    const xi = filled(), slots = Object.keys(FORMATIONS[sheet.formation]).length;
    el.innerHTML = `<fieldset class="ts-rounds"><legend>Which round is this team sheet for?</legend>
      ${rounds.map(r => {
        const home = r.fx.home === club.code, opp = home ? r.fx.away : r.fx.home, k = kickoff(r.fx), sub = submitted.get(r.week);
        return `<label class="ts-round${pickWeek === r.week ? ' on' : ''}"><input type="radio" name="sub-week" value="${r.week}" ${pickWeek === r.week ? 'checked' : ''}>
          <span class="ts-round-main"><b>${esc(wk(r.week))}</b><span>${home ? 'v' : 'at'} ${esc(teamName(opp))}${k ? ` · ${esc(when(k, now))}` : ''}</span><small>Locks ${esc(when(r.locks, now))}</small></span>
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
    drawSave(); if (!picking) drawSubmit();
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
    drawPitch(); drawPlayers(); drawPieces(); drawKit(); drawClear();
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
      document.body.append(drag.ghost); box.classList.add('dragging');
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
      if (v) { scrollBy(0, Math.round(v / 3)); hover(); }
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

  box.addEventListener('click', e => {
    const t = e.target;
    const f = t.closest('[data-f]'), pl = t.closest('.pl'), pr = t.closest('[data-preset]'), st = t.closest('[data-tac]');
    if (f) {
      if (f.dataset.f === sheet.formation) return;
      sheet.lineup = reshape(sheet.lineup, sheet.formation, f.dataset.f, squad);
      sheet.formation = f.dataset.f; sel = null;
      changed(); redraw(`[data-f="${f.dataset.f}"]`);
    } else if (pl) {
      const id = pl.dataset.id;
      if (sel?.slot) { place(sel.slot, id); sel = null; changed(); }
      else sel = sel?.player === id ? null : { player: id };
      redraw(`.pl[data-id="${id}"]`);
      if (sel?.player && narrow()) $('#pitch', box).scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.closest('[data-cancel]')) { sel = null; redraw(); }
    else if (pr) { sheet.tactics = { ...PRESETS[pr.dataset.preset] }; changed(); drawTactics(); box.querySelector(`[data-preset="${pr.dataset.preset}"]`)?.focus(); }
    else if (st) { sheet.tactics[st.dataset.tac] = Number(st.dataset.v); changed(); drawTactics(); box.querySelector(`[data-tac="${st.dataset.tac}"][data-v="${st.dataset.v}"]`)?.focus(); }
    else if (t.closest('[data-kit]')) { sheet.kit = t.closest('[data-kit]').dataset.kit || null; changed(); drawKit(); box.querySelector(`[data-kit="${sheet.kit || ''}"]`)?.focus(); }
    else if (t.closest('[data-clear]')) {
      const was = { lineup: { ...sheet.lineup }, ...Object.fromEntries(PIECES.map(([k]) => [k, sheet[k]])) };
      sheet.lineup = {}; sel = null; changed(); cleared = was; redraw('[data-unclear]');
    } else if (t.closest('[data-unclear]')) {
      Object.assign(sheet, cleared); cleared = null; changed(); redraw('[data-clear]');
    }
    else if (t.closest('[data-save]')) save();
    else if (t.closest('[data-sub-open]')) { picking = true; subMsg = ''; drawSubmit(); $('#submit input[name="sub-week"]:checked', box)?.focus(); }
    else if (t.closest('[data-sub-cancel]')) { picking = false; subMsg = ''; drawSubmit(); $('#submit .ts-submit-btn', box)?.focus(); }
    else if (t.closest('[data-sub-go]')) submitFor(pickWeek);
    else if (t.closest('[data-withdraw]')) { e.preventDefault(); withdraw(Number(t.closest('[data-withdraw]').dataset.withdraw)); }
  });
  box.addEventListener('change', e => {
    if (e.target.name === 'sub-week') { pickWeek = Number(e.target.value); drawSubmit(); $('#submit input[name="sub-week"]:checked', box)?.focus(); return; }
    const s = e.target.closest('[data-piece]');
    if (s) { sheet[s.dataset.piece] = s.value || null; changed(); drawPitch(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sel) { sel = null; redraw(); } });
  // Leaving the page: send what's waiting rather than lose it.
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'dirty') save(); });

  drawPitch(); drawPlayers(); drawPieces(); drawKit(); drawClear(); drawTactics(); drawSave(); drawDeadline(); drawLocked(); drawSubmit();
  if (state === 'new') save();

  // The deadline counts down; once one passes, read the deadlines again until the database has locked that week.
  setInterval(async () => {
    if (document.hidden) return;
    const now = new Date();
    if (deadlines.some(d => new Date(d.locks_at) <= now && !d.locked_at)) {
      const r = await ok(c.from('deadlines').select('*').order('locks_at'));
      if (!r.error) deadlines = r.data || [];
    }
    drawDeadline(now); drawLocked(now); if (!picking) drawSubmit(now);
  }, 30000);
}
