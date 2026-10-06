// Editor → Fixtures. 0.12 plan a season and set times; 0.13 rounds, looks and line-up locks; 0.14 Simulate; 0.20 the roster
// tools: reorder, renumber, insert, duplicate and delete weeks; weeks without numbers; change opponents, flip or swap
// teams anywhere; move matches between weeks; build the next week from the weeks already planned; fill and re-pair a
// week; shift dates; bulk edits; checks, a club-by-week grid and a meetings table; import and export; and Undo.
// Kick-off times are entered in Melbourne time and stored as an exact instant. The database checks everything again
// (supabase/migrations/0013, 0014 and 0021). The planning logic lives in js/roster.js.
import { loadSeason } from './dashboard-data.js';
import { safeColour } from './member.js';
import * as R from './roster.js';
export { melbourneToIso, roundRobin, placeWeek } from './roster.js';
const { melbourneToIso, toLocalInput, addDays, addMinutes, dateOf, timeOf, shiftIso, mondayOf, daysBetween, WEEK_MAX } = R;

const ZONE = R.ZONE;
const whenFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function fixturesView() {
  return '<h1>Fixtures</h1><div id="fx-sim" class="fx-sim" role="status" hidden></div><div id="fx-root"><p class="quiet">Loading fixtures…</p></div>';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LOCKS = [[0, 'At the first kick-off'], [30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [10080, '1 week']];
const KINDS = [['regular', 'Regular'], ['special', 'Special'], ['finals', 'Finals']];
const STAGES = [['', 'Regular'], ['SF', 'Semi-final'], ['GF', 'Grand Final']];
// Patterns: blocks of games. games 0 = "all the rest".
const PATTERNS = {
  saturday: ['Saturday night', [{ day: 6, time: '19:00', games: 0, gap: 90 }]],
  weekend: ['Saturday and Sunday', [{ day: 6, time: '15:00', games: 3, gap: 100 }, { day: 0, time: '14:00', games: 0, gap: 100 }]],
  fri_sat: ['Friday night + Saturday', [{ day: 5, time: '19:30', games: 1, gap: 90 }, { day: 6, time: '15:00', games: 0, gap: 100 }]],
  midweek: ['Midweek', [{ day: 3, time: '19:30', games: 0, gap: 90 }]],
};
const VIEWS = [['weeks', 'Weeks'], ['planner', 'Planner'], ['grid', 'Clubs by week'], ['meet', 'Meetings'], ['checks', 'Checks']];
const NEW_COLS = ['numbered', 'number_override', 'note'];   // rounds columns from 0021; left out until that migration is in

const byKick = (a, b) => (a.starts_at || '9').localeCompare(b.starts_at || '9') || a.id.localeCompare(b.id);
const blocksOf = rows => rows.map(r => ({ ...r }));

export async function mountFixtures(ctx) {
  const root = document.getElementById('fx-root');
  if (!root) return;
  const { esc, explain } = ctx;
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(`fx-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(`fx-${k}`, JSON.stringify(v)); } catch { /* private window: it just won't be remembered */ } },
  };

  // ---------------------------------------------------------------- state
  let fixtures = [], results = new Map(), rounds = [], looks = [], deadlines = new Map();
  let busy = false, msg = '', msgKind = '', hasRoster = true;
  let view = VIEWS.some(v => v[0] === store.get('view', 'weeks')) ? store.get('view', 'weeks') : 'weeks';
  const folded = new Set(store.get('folded', []));
  const toolsOpen = new Set(), moreOpen = new Set();
  let sel = null, picked = new Set(), preview = null, undoStack = [], redoStack = [];
  let pattern = 'last', rows = null, lastBlocks = null;

  const active = () => ctx.clubs.filter(c => c.status === 'active');
  const codes = () => active().map(c => c.code);
  const name = code => ctx.clubs.find(c => c.code === code)?.name || code;
  const names = () => Object.fromEntries(ctx.clubs.map(c => [c.code, c.name]));
  const colour = code => { const c = ctx.clubs.find(x => x.code === code); return c ? safeColour(c.colour) : '#64b5f6'; };
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const lookOpts = sel => opts(looks.map(l => [l.key, l.name]), sel);
  const clubOpts = (sel, blank) => `${blank ? `<option value="">${esc(blank)}</option>` : ''}${ctx.clubs.filter(c => c.status === 'active' || c.code === sel).map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const when = iso => whenFmt.format(new Date(iso));
  const nextMon = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------------------------------------------------------------- loading
  async function load() {
    const c = await ctx.db();
    const [fx, rd, lk, rs, dl] = await Promise.all([
      c.from('fixtures').select('id, week, home, away, starts_at, stage, postponed, window_id').order('week').order('starts_at').range(0, 1999),
      c.from('rounds').select('*').order('week'), c.from('looks').select('key, name').order('name'),
      c.from('results').select('fixture, summary').range(0, 1999), c.from('deadlines').select('week, locks_at, locked_at'),
    ]);
    if (fx.error) throw new Error(explain(fx.error));
    fixtures = fx.data; results = new Map((rs.data || []).map(r => [r.fixture, r.summary])); rounds = rd.data || [];
    looks = lk.data?.length ? lk.data : [{ key: 'classic', name: 'Classic' }];
    deadlines = new Map((dl.data || []).map(d => [d.week, d]));
    hasRoster = !(await c.from('rounds').select('numbered').limit(1)).error;   // false until 0021_roster_tools.sql is run
  }

  const model = () => {
    const weeks = R.weekNumbers(fixtures, rounds), labels = R.roundLabels(weeks, rounds);
    return { weeks, labels, by: new Map(weeks.map(w => [w, fixtures.filter(f => f.week === w).sort(byKick)])) };
  };
  const round = w => ({ week: w, name: null, kind: 'regular', look: 'classic', lock_minutes_before: 180, lock_at_override: null, numbered: true, number_override: null, note: null, ...(rounds.find(r => r.week === w) || {}) });
  const isLocked = w => !!deadlines.get(w)?.locked_at;
  const played = list => list.filter(f => results.has(f.id));
  const lastWeek = () => Math.max(0, ...fixtures.map(f => f.week), ...rounds.map(r => r.week));
  const firstDate = list => { const t = list.map(f => f.starts_at).filter(Boolean).sort()[0]; return t ? dateOf(t) : null; };

  function lockText(w, list) {
    const first = list.filter(f => f.starts_at && !f.postponed).map(f => f.starts_at).sort()[0], r = round(w), d = deadlines.get(w);
    if (d?.locked_at) return `Line-ups locked ${fullFmt.format(new Date(d.locks_at))}`;
    if (r.lock_at_override) return `Line-ups lock ${fullFmt.format(new Date(r.lock_at_override))} (picked by hand)`;
    return first ? `Line-ups lock ${fullFmt.format(new Date(new Date(first).getTime() - r.lock_minutes_before * 60000))}` : 'No kick-off set yet';
  }

  // ---------------------------------------------------------------- messages and questions
  function notify(text, kind = '') {
    msg = text; msgKind = kind;
    const el = document.getElementById('fx-msg');
    if (el) { el.textContent = text; el.dataset.kind = kind; }
  }
  function ask(text, buttons = ['Yes']) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'fx-ask'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-label', 'Confirm');
      box.innerHTML = `<div class="fx-ask-card"><p>${esc(text)}</p><div class="ed-actions">${buttons.map((b, i) => `<button type="button" class="btn small" data-i="${i}">${esc(b)}</button>`).join('')}<button type="button" class="btn ghost small" data-i="-1">Keep things as they are</button></div></div>`;
      const done = i => { document.removeEventListener('keydown', key); box.remove(); resolve(i); };
      const key = e => { if (e.key === 'Escape') done(-1); };
      box.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) done(Number(b.dataset.i)); else if (e.target === box) done(-1); });
      document.addEventListener('keydown', key);
      document.body.append(box);
      box.querySelector('button').focus();
    });
  }
  async function confirmPlayed(list, what) {
    const n = played(list).length;
    return !n || (await ask(`${what} removes ${plural(n, 'saved result')} and the match file${n === 1 ? '' : 's'} for good. Undo can't bring ${n === 1 ? 'it' : 'them'} back.`, ['Remove and continue'])) === 0;
  }
  const failText = e => {
    const m = String(e?.message || e || '');
    if (/office_move_weeks|office_unlock_week|schema cache/i.test(m)) return 'This needs the database update from 0021_roster_tools.sql / 0022_unlock_week.sql. Run it once, then try again.';
    if (/column .*(numbered|number_override|note)/i.test(m)) return 'Week numbering needs the database update from 0021_roster_tools.sql.';
    return /^[A-Z]/.test(m) && m.length < 220 && !/violates|syntax|relation|permission denied/i.test(m) ? m : explain(e);
  };

  // ---------------------------------------------------------------- one operation = one Undo step
  // run() does the work inside `tx`; if any step fails, the steps already taken are put back.
  async function run(label, fn) {
    if (busy) { notify('Hold on, still working…', 'bad'); return false; }
    busy = true; notify(`${label}…`);
    const tx = { label, steps: [], lossy: false };
    let ok = false, err = '', note = '';
    try { note = (await fn(tx)) || ''; ok = true; if (tx.steps.length) { undoStack.push(tx); if (undoStack.length > 40) undoStack.shift(); redoStack = []; } }
    catch (e) { err = failText(e); for (const s of [...tx.steps].reverse()) { try { await s.undo(); } catch { /* best effort */ } } }
    try { await load(); } catch (e) { err = err || failText(e); }
    busy = false;
    notify(ok ? `${label}: done.${note ? ` ${note}` : ''}` : `${label} didn’t work. ${err}`, ok ? (note ? 'warn' : '') : 'bad');
    draw();
    return ok;
  }
  async function step(tx, doFn, undoFn) {
    const r = await doFn();
    if (r?.error) throw r.error;
    tx.steps.push({ do: doFn, undo: async () => { const u = await undoFn(); if (u?.error) throw u.error; } });
  }
  async function walk(list, size, fn) { for (let i = 0; i < list.length; i += size) { const r = await fn(list.slice(i, i + size)); if (r?.error) return r; } return {}; }
  const insertFx = (tx, list) => list.length ? step(tx,
    async () => walk(list, 100, async part => (await ctx.db()).from('fixtures').insert(part)),
    async () => walk(list, 100, async part => (await ctx.db()).from('fixtures').delete().in('id', part.map(f => f.id)))) : null;
  async function deleteFx(tx, list) {
    if (!list.length) return;
    const dead = played(list);
    if (dead.length) { const sim = await import('./simulate.js'), c = await ctx.db(); for (const f of dead) await sim.removeResult(c, f); tx.lossy = true; }
    const keep = list.map(f => ({ id: f.id, week: f.week, home: f.home, away: f.away, starts_at: f.starts_at, stage: f.stage, postponed: f.postponed }));
    await step(tx, async () => walk(keep, 100, async part => (await ctx.db()).from('fixtures').delete().in('id', part.map(f => f.id))),
      async () => walk(keep, 100, async part => (await ctx.db()).from('fixtures').insert(part)));
  }
  // Teams changing means the old result no longer fits that match, so it goes.
  async function clearResult(tx, f) {
    if (!results.has(f.id)) return;
    await (await import('./simulate.js')).removeResult(await ctx.db(), f);
    results.delete(f.id); tx.lossy = true;
  }
  const setFx = (tx, f, patch) => {
    const prev = Object.fromEntries(Object.keys(patch).map(k => [k, f[k] ?? null]));
    return step(tx, async () => (await ctx.db()).from('fixtures').update(patch).eq('id', f.id), async () => (await ctx.db()).from('fixtures').update(prev).eq('id', f.id));
  };
  const KNOWN = ['week', 'name', 'kind', 'look', 'lock_minutes_before', 'lock_at_override'];
  const roundRow = (w, patch = {}) => { const all = { ...round(w), ...patch, week: w }; return Object.fromEntries(Object.entries(all).filter(([k]) => KNOWN.includes(k) || (hasRoster && NEW_COLS.includes(k)))); };
  function setRound(tx, w, patch) {
    const prev = rounds.find(r => r.week === w), row = roundRow(w, patch);
    return step(tx, async () => (await ctx.db()).from('rounds').upsert(row),
      async () => (prev ? (await ctx.db()).from('rounds').upsert(prev) : (await ctx.db()).from('rounds').delete().eq('week', w)));
  }
  const ensureRound = async (tx, w, patch) => { if (!rounds.some(r => r.week === w) || patch) await setRound(tx, w, patch || {}); };
  function lockedIn(map) {
    const bad = [...new Set(Object.entries(map).flat().map(Number))].filter(isLocked);
    if (bad.length) throw new Error(`Week${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'have' : 'has'} locked line-ups, so ${bad.length > 1 ? 'they' : 'it'} can’t be moved or renumbered.`);
  }
  async function moveWeeks(tx, map) {
    if (map === null) throw new Error(`That would go past week ${WEEK_MAX}.`);
    if (!Object.keys(map).length) return;
    lockedIn(map);
    const call = async m => (await ctx.db()).rpc('office_move_weeks', { p_map: m });
    await step(tx, () => call(map), () => call(R.invertMap(map)));
    // Later steps in the same operation see the weeks where they now are.
    fixtures = fixtures.map(f => (map[f.week] != null ? { ...f, week: map[f.week] } : f));
    rounds = rounds.map(r => (map[r.week] != null ? { ...r, week: map[r.week] } : r));
    deadlines = new Map([...deadlines].map(([w, d]) => [map[w] ?? w, d]));
    for (const set of [folded, toolsOpen]) { const now = [...set].map(w => map[w] ?? w); set.clear(); now.forEach(w => set.add(w)); }   // open panels follow their week
    store.set('folded', [...folded]);
  }
  const takenIds = () => new Set(fixtures.map(f => f.id));

  // ---------------------------------------------------------------- Undo and Redo
  async function undo() {
    const tx = undoStack.pop();
    if (!tx || busy) return;
    busy = true; notify(`Undoing: ${tx.label}…`);
    let err = '';
    try { for (const s of [...tx.steps].reverse()) await s.undo(); redoStack.push(tx); } catch (e) { err = failText(e); }
    try { await load(); } catch { /* shown below */ }
    busy = false; draw();
    notify(err ? `Couldn’t undo. ${err}` : `Undone: ${tx.label}.${tx.lossy ? ' Results that were removed stay removed.' : ''}`, err ? 'bad' : '');
  }
  async function redo() {
    const tx = redoStack.pop();
    if (!tx || busy) return;
    busy = true; notify(`Redoing: ${tx.label}…`);
    let err = '';
    try { for (const s of tx.steps) { const r = await s.do(); if (r?.error) throw r.error; } undoStack.push(tx); } catch (e) { err = failText(e); }
    try { await load(); } catch { /* shown below */ }
    busy = false; draw();
    notify(err ? `Couldn’t redo. ${err}` : `Redone: ${tx.label}.`, err ? 'bad' : '');
  }

  // ---------------------------------------------------------------- drawing
  const rowsHtml = () => rows.map((r, i) => `<div class="fx-win" data-i="${i}">
      <label>Day <select data-k="day">${opts(DAYS.map((d, k) => [k, d]), r.day)}</select></label>
      <label>First game <input type="time" data-k="time" value="${esc(r.time)}"></label>
      <label>Games <input type="number" data-k="games" min="0" max="20" value="${r.games}" title="0 = all the rest"></label>
      <label>Gap (min) <input type="number" data-k="gap" min="0" max="600" step="5" value="${r.gap}"></label>
      <button type="button" class="btn ghost small" data-act="win-del" ${rows.length < 2 ? 'hidden' : ''} aria-label="Remove this block">✕</button></div>`).join('');

  function patternHtml() {
    const lastNote = lastBlocks ? describe(lastBlocks) : 'no earlier week to copy yet';
    return `<div class="ed-invite fx-card" id="fx-pattern"><h2>Match pattern</h2>
      <p class="ed-hint">When the games of a week kick off. Games are spread over the blocks in order; a week can have several blocks, each with its own start and gap (0 games = all the rest). Times are Melbourne time. The tools below all use this pattern.</p>
      <label>Pattern <select name="pattern">${opts([['last', `Same as the last week (${lastNote})`], ...Object.entries(PATTERNS).map(([k, v]) => [k, v[0]]), ['custom', 'My own']], pattern)}</select></label>
      <div id="fx-wins">${rowsHtml()}</div>
      <div><button type="button" class="btn ghost small" data-act="win-add">+ Add a block</button></div></div>`;
  }
  const describe = blocks => blocks.map(b => `${DAYS[b.day].slice(0, 3)} ${b.time}${b.games ? ` ×${b.games}` : ''}`).join(' + ');

  function weekCard(w, m) {
    const list = m.by.get(w), L = m.labels.get(w), r = round(w), locked = isLocked(w), open = !folded.has(w), tools = toolsOpen.has(w);
    const done = played(list).length, undated = list.filter(f => !f.starts_at).length, i = m.weeks.indexOf(w);
    const first = list.map(f => f.starts_at).filter(Boolean).sort()[0], lastK = list.map(f => f.starts_at).filter(Boolean).sort().at(-1);
    const span = first ? (dateOf(first) === dateOf(lastK) ? dayFmt.format(new Date(first)) : `${dayFmt.format(new Date(first))} – ${dayFmt.format(new Date(lastK))}`) : 'no dates yet';
    const playing = new Set(list.flatMap(f => [f.home, f.away]));
    const resting = active().filter(c => !playing.has(c.code));
    const mv = n => !locked && m.weeks[i + n] != null && !isLocked(m.weeks[i + n]);
    return `<section class="fx-week${locked ? ' is-locked' : ''}${!L.numbered ? ' is-unnumbered' : ''}" data-week="${w}">
      <div class="fx-head">
        <span class="fx-grip" draggable="${locked ? 'false' : 'true'}" data-drag="week" title="${locked ? 'Locked: this week can’t be moved' : 'Drag to reorder the weeks'}" aria-hidden="true">⠿</span>
        <button class="btn ghost small fx-fold" type="button" data-act="fold" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(L.label)}">${open ? '▾' : '▸'}</button>
        <h2>${esc(L.label)} <small>week ${w} · ${esc(span)}</small></h2>
        <span class="fx-pills">${locked ? '<span class="ed-pill approved">Locked</span>' : ''}${L.numbered ? '' : '<span class="ed-pill">No number</span>'}${r.kind !== 'regular' ? `<span class="ed-pill">${esc(KINDS.find(k => k[0] === r.kind)?.[1] || r.kind)}</span>` : ''}
          ${list.length ? `<span class="ed-pill">${done}/${list.length} played</span>` : '<span class="ed-pill warn">Empty</span>'}${undated ? `<span class="ed-pill warn">${undated} no time</span>` : ''}</span>
        <span class="fx-quick">
          <button class="btn ghost small" type="button" data-act="week-up" ${mv(-1) ? '' : 'disabled'} title="Swap places with the week before" aria-label="Move up">▲</button>
          <button class="btn ghost small" type="button" data-act="week-down" ${mv(1) ? '' : 'disabled'} title="Swap places with the week after" aria-label="Move down">▼</button>
          <button class="btn small" type="button" data-act="sim-week" ${todo(w).length ? '' : 'disabled'}>Simulate (${todo(w).length})</button>
          <button class="btn ghost small" type="button" data-act="tools" aria-expanded="${tools}">${tools ? 'Hide tools' : 'Week tools'}</button>
        </span>
      </div>
      ${open ? `${tools ? toolsHtml(w, m, list, r, locked) : ''}
        <p class="fx-lock">${esc(lockText(w, list))}${locked ? ' <button class="btn ghost small" type="button" data-act="week-unlock">Unlock line-ups</button>' : ''}${r.note ? ` · <i>${esc(r.note)}</i>` : ''}</p>
        ${list.map(f => matchRow(f, m)).join('') || `<p class="quiet fx-none">No matches in this week yet.</p>`}
        <div class="fx-foot">
          ${resting.length ? `<span class="fx-byes"><b>Not playing:</b> ${resting.map(c => `<button type="button" class="fx-chip bye${sel?.bye === c.code && sel.week === w ? ' is-sel' : ''}" data-act="bye-chip" data-week="${w}" data-code="${esc(c.code)}" style="--club:${esc(colour(c.code))}">${esc(c.name)}</button>`).join('')}</span>` : ''}
          <button class="btn ghost small" type="button" data-act="add-here">+ Add a match</button>
        </div>` : ''}
    </section>`;
  }

  function matchRow(f, m) {
    const res = results.get(f.id), selSide = side => (sel?.fx === f.id && sel.side === side ? ' is-sel' : ''), more = moreOpen.has(f.id), done = !!res;
    const chip = side => `<button type="button" class="fx-chip${selSide(side)}" data-act="chip" data-side="${side}" style="--club:${esc(colour(f[side]))}" title="Tap, then tap another team to swap them">${esc(name(f[side]))}</button>`;
    return `<div class="fx-row${picked.has(f.id) ? ' is-picked' : ''}${f.postponed ? ' is-postponed' : ''}" data-id="${esc(f.id)}">
      <input type="checkbox" class="fx-pick" data-act="pick" ${picked.has(f.id) ? 'checked' : ''} aria-label="Select this match">
      <span class="fx-drag" draggable="true" data-drag="match" title="Drag onto another week to move this match" aria-hidden="true">⠿</span>
      <span class="fx-teams">${chip('home')}<button type="button" class="fx-flip" data-act="flip" title="Swap home and away" aria-label="Swap home and away">⇄</button>${chip('away')}${f.stage ? ` <small>${esc(f.stage === 'SF' ? 'Semi-final' : 'Grand Final')}</small>` : ''}${f.postponed ? ' <small>postponed</small>' : ''}${done ? ` <b class="fx-score">${res.home}–${res.away}</b>` : ''}</span>
      <input type="datetime-local" value="${toLocalInput(f.starts_at)}" aria-label="Kick-off (Melbourne time)">
      ${f.postponed ? '' : done
        ? '<button class="btn ghost small" type="button" data-act="again">Play again</button><button class="btn ghost small" type="button" data-act="unplay">Remove result</button>'
        : '<button class="btn small" type="button" data-act="sim">Simulate</button>'}
      <button class="btn ghost small" type="button" data-act="more" aria-expanded="${more}">${more ? 'Less' : 'More'}</button>
      ${more ? `<div class="fx-more">
        <label>Home <select data-k="home">${clubOpts(f.home)}</select></label><label>Away <select data-k="away">${clubOpts(f.away)}</select></label>
        <button class="btn small" type="button" data-act="set-teams">Change teams</button>
        <label>Stage <select data-k="stage">${opts(STAGES, f.stage || '')}</select></label><button class="btn small" type="button" data-act="set-stage">Set</button>
        <label>Week <select data-k="week">${opts([...m.weeks.map(w => [w, `${m.labels.get(w).label} (week ${w})`]), ['new', 'A new week at the end']], f.week)}</select></label>
        <button class="btn small" type="button" data-act="move-to">Move</button><button class="btn ghost small" type="button" data-act="copy-to">Copy</button>
        <label>Swap kick-off with <select data-k="slot"><option value="">Pick a match…</option>${[...m.by.values()].flat().filter(x => x.id !== f.id).map(x => `<option value="${esc(x.id)}">${esc(name(x.home))} v ${esc(name(x.away))} · ${esc(m.labels.get(x.week).label)}${x.starts_at ? `, ${esc(when(x.starts_at))}` : ''}</option>`).join('')}</select></label>
        <button class="btn small" type="button" data-act="swap-slot">Swap</button>
        <button class="btn ghost small" type="button" data-act="postpone">${f.postponed ? 'Restore' : 'Postpone'}</button>
        <button class="btn ghost small" type="button" data-act="del">Remove</button></div>` : ''}
    </div>`;
  }

  function toolsHtml(w, m, list, r, locked) {
    const free = Math.min(WEEK_MAX, lastWeek() + 1), first = firstDate(list), lockVal = r.lock_at_override ? toLocalInput(r.lock_at_override) : '';
    const off = locked ? ' disabled title="This week’s line-ups have locked"' : '';
    return `<div class="fx-tools" data-week="${w}">
      <fieldset class="fx-set"><legend>Name and numbering</legend>
        <label>Name <input data-r="name" value="${esc(r.name || '')}" placeholder="${esc(r.numbered ? 'Optional, e.g. Derby Day' : 'e.g. Christmas Cup')}" maxlength="40"></label>
        <label>Type <select data-r="kind">${opts(KINDS, r.kind)}</select></label>
        <label class="fx-check"><input type="checkbox" data-r="numbered" ${r.numbered ? 'checked' : ''} ${hasRoster ? '' : 'disabled'}> Counts as a numbered round</label>
        <label>Show round number <input type="number" data-r="number_override" min="0" max="999" value="${r.number_override ?? ''}" placeholder="${m.labels.get(w).numbered ? `auto (${m.labels.get(w).no})` : 'none'}" ${hasRoster && r.numbered ? '' : 'disabled'}></label>
        <label>Look <select data-r="look">${lookOpts(r.look)}</select></label>
        <label class="fx-wide">Note (only you see it) <input data-r="note" value="${esc(r.note || '')}" maxlength="300" ${hasRoster ? '' : 'disabled'}></label>
      </fieldset>
      <fieldset class="fx-set"><legend>Line-up lock</legend>
        <label>Lock before the first game <select data-r="lock_minutes_before">${opts(LOCKS, r.lock_minutes_before)}</select></label>
        <label>or at an exact time <input type="datetime-local" data-r="lock_at_override" value="${lockVal}"></label>
        <button class="btn ghost small" type="button" data-act="lock-auto" ${r.lock_at_override ? '' : 'disabled'}>Back to automatic</button>
      </fieldset>
      <fieldset class="fx-set"><legend>Where this week sits</legend>
        <label>Move this week <select data-k="mode"><option value="swap">to number (swap if taken)</option><option value="insert">to number, pushing later weeks up</option><option value="pos">to position</option></select></label>
        <label>Number <input type="number" data-k="to" min="1" max="${WEEK_MAX}" value="${esc(w)}"></label>
        <button class="btn small" type="button" data-act="week-move" ${locked ? 'disabled title="Locked"' : ''}>Move</button>
        <button class="btn ghost small" type="button" data-act="blank-before">Insert a blank week before</button>
        <button class="btn ghost small" type="button" data-act="blank-after">Insert a blank week after</button>
      </fieldset>
      <fieldset class="fx-set"><legend>Dates</legend>
        <label>Start this week on <input type="date" data-k="date" value="${esc(first || '')}"></label><button class="btn small" type="button" data-act="week-date">Move</button>
        <span class="fx-nudge">Shift by <button class="btn ghost small" type="button" data-act="week-shift" data-n="-7">−7</button><button class="btn ghost small" type="button" data-act="week-shift" data-n="-1">−1</button><button class="btn ghost small" type="button" data-act="week-shift" data-n="1">+1</button><button class="btn ghost small" type="button" data-act="week-shift" data-n="7">+7</button> days</span>
        <button class="btn ghost small" type="button" data-act="week-retime">Re-time with the Planner’s pattern</button>
        <button class="btn ghost small" type="button" data-act="week-untime">Clear all times</button>
      </fieldset>
      <fieldset class="fx-set"><legend>Matches</legend>
        <button class="btn ghost small" type="button" data-act="week-repair" ${list.length ? '' : 'disabled'}>Re-pair (new opponents)</button>
        <button class="btn ghost small" type="button" data-act="week-fill">Fill the rest</button>
        <button class="btn ghost small" type="button" data-act="week-flip" ${list.length ? '' : 'disabled'}>Swap home and away</button>
        <button class="btn ghost small" type="button" data-act="week-postpone" ${list.length ? '' : 'disabled'}>Postpone all</button>
        <button class="btn ghost small" type="button" data-act="week-restore" ${list.some(f => f.postponed) ? '' : 'disabled'}>Restore all</button>
        <button class="btn ghost small" type="button" data-act="week-unplay" ${played(list).length ? '' : 'disabled'}>Remove results</button>
        <button class="btn ghost small" type="button" data-act="week-copytext" ${list.length ? '' : 'disabled'}>Copy as text</button>
      </fieldset>
      <fieldset class="fx-set"><legend>Copy or delete</legend>
        <label>Copy this week to week <input type="number" data-k="copyto" min="1" max="${WEEK_MAX}" value="${free}"></label>
        <label>dates +<input type="number" data-k="days" value="7" min="-365" max="365"> days</label>
        <label class="fx-check"><input type="checkbox" data-k="flip"> swap home and away</label>
        <button class="btn small" type="button" data-act="week-copy" ${list.length ? '' : 'disabled'}>Copy</button>
        <button class="btn ghost small" type="button" data-act="week-delete" ${locked ? 'disabled title="Locked"' : ''}>Delete this week</button>
      </fieldset>
    </div>`;
  }

  // The bar that shows what's selected or being swapped.
  function barHtml(m) {
    const bits = [];
    if (sel) {
      const f = sel.fx ? fixtures.find(x => x.id === sel.fx) : null;
      bits.push(`<div class="fx-bar is-swap" role="status"><span>Swapping <b>${esc(name(sel.fx ? f?.[sel.side] : sel.bye))}</b>. Tap another team in any week, or a club that’s not playing, to swap them.</span><button class="btn ghost small" type="button" data-act="chip-cancel">Cancel</button></div>`);
    }
    if (picked.size) {
      const wk = m.weeks.map(w => [w, `${m.labels.get(w).label} (week ${w})`]);
      bits.push(`<div class="fx-bar" role="group" aria-label="Selected matches"><b>${plural(picked.size, 'match', 'matches')} selected</b>
        <select data-b="week">${opts([...wk, ['new', 'A new week at the end']], '')}</select><button class="btn small" type="button" data-act="bulk-move">Move to week</button>
        <label>Kick-off by <input type="number" data-b="mins" value="30" step="5" style="width:5em"> min</label><button class="btn small" type="button" data-act="bulk-shift">Shift</button>
        <label>Date <input type="date" data-b="date"></label><label>Time <input type="time" data-b="time"></label><button class="btn small" type="button" data-act="bulk-set">Set</button>
        <button class="btn ghost small" type="button" data-act="bulk-flip">Swap home/away</button><button class="btn ghost small" type="button" data-act="bulk-postpone">Postpone</button>
        <button class="btn ghost small" type="button" data-act="bulk-restore">Restore</button><button class="btn ghost small" type="button" data-act="bulk-del">Remove</button>
        <button class="btn ghost small" type="button" data-act="bulk-clear">Clear selection</button></div>`);
    }
    return bits.join('');
  }

  // ---------------------------------------------------------------- the views
  function weeksView(m) {
    return `${barHtml(m)}<p class="ed-hint">Drag a week by its ⠿ handle to reorder, or use ▲ ▼. Tap one team then another to swap them, even across weeks. Everything you do here can be undone.</p>
      <p class="fx-allfold"><button class="btn ghost small" type="button" data-act="fold-all">Collapse all</button> <button class="btn ghost small" type="button" data-act="unfold-all">Expand all</button></p>
      <p class="fx-quick-create"><button class="btn" type="button" data-act="quick-create">+ Quick create week</button></p>
      ${m.weeks.length ? m.weeks.map(w => weekCard(w, m)).join('') : '<p class="quiet">No weeks yet. Quick create one, or open the Planner.</p>'}
      ${m.weeks.length ? '<p class="fx-quick-create"><button class="btn" type="button" data-act="quick-create">+ Quick create week</button></p>' : ''}`;
  }

  function plannerView(m) {
    const clubsNow = active(), last = lastWeek(), free = Math.min(WEEK_MAX, last + 1);
    const lastR = round(m.weeks.at(-1) || 1), dated = [...m.by.entries()].filter(([, l]) => l.some(f => f.starts_at)).at(-1);
    const base = dated ? addDays(mondayOf(dateOf(dated[1].map(f => f.starts_at).filter(Boolean).sort()[0])), 7) : nextMon();
    return `${patternHtml()}
      <form class="ed-invite fx-card" id="fx-next"><h2>Next week, built from the weeks so far</h2>
        <p class="ed-hint">Pairs the clubs with opponents they haven't met yet, keeps byes and home games fair, and avoids repeats from recent weeks. Look it over, re-roll if you like, then create it. Nothing is saved until you press Create.</p>
        <div class="fx-grid">
          <label>Week number <input type="number" name="week" min="1" max="${WEEK_MAX}" value="${free}" required></label>
          <label>How many weeks <input type="number" name="count" min="1" max="40" value="1"></label>
          <label>Week begins <input type="date" name="start" value="${base}" required></label>
          <label>Days between weeks <input type="number" name="every" min="1" max="60" value="7"></label>
          <label>Rematches <select name="avoid"><option value="normal">Avoid them where possible</option><option value="strict">Avoid them strongly</option></select></label>
          <label>Not repeated within <input type="number" name="recent" min="0" max="20" value="4"> weeks</label>
          <label>Line-ups lock <select name="lock">${opts(LOCKS, lastR.lock_minutes_before)}</select> before</label>
          <label>Scoreboard look <select name="look">${lookOpts(lastR.look)}</select></label>
        </div>
        <details${clubsNow.length ? '' : ' open'}><summary>Clubs resting this week</summary><div class="fx-rest">${clubsNow.map(c => `<label class="fx-check"><input type="checkbox" name="rest" value="${esc(c.code)}"> ${esc(c.name)}</label>`).join('')}</div></details>
        <label class="fx-check"><input type="checkbox" name="insert"> Make room: if the week number is taken, push that week and later ones up</label>
        <div class="ed-actions"><button class="btn" ${clubsNow.length < 2 ? 'disabled' : ''}>Build a preview</button></div>
        <p class="ed-msg" role="status"></p>
        ${preview ? previewHtml() : ''}</form>
      <form class="ed-invite fx-card" id="fx-gen"><h2>Plan a whole season</h2>
        <p class="ed-hint">Every club plays every other once, or home and away. ${clubsNow.length} active clubs${clubsNow.length % 2 ? ': one rests each week' : ''}.</p>
        <div class="fx-grid">
          <label>First week number <input type="number" name="first" min="1" max="${WEEK_MAX}" value="${free}"></label>
          <label>First week begins <input type="date" name="start" value="${base}" required></label>
          <label>Days between weeks <input type="number" name="every" min="1" max="60" value="7"></label>
          <label>Rounds <select name="rounds"><option value="1">Everyone plays everyone once</option><option value="2">Home and away</option></select></label>
          <label>Line-ups lock <select name="lock">${opts(LOCKS, 180)}</select> before</label>
          <label>Scoreboard look <select name="look">${lookOpts('classic')}</select></label></div>
        <label class="fx-check"><input type="checkbox" name="insert"> Make room: push existing weeks at or after the first week number up</label>
        <div class="ed-actions"><button class="btn" ${clubsNow.length < 2 ? 'disabled' : ''}>Create fixtures</button></div><p class="ed-msg" role="status"></p></form>
      <form class="ed-invite fx-card" id="fx-add"><h2>Add one match</h2>
        <div class="fx-grid"><label>Week <select name="week">${opts([...m.weeks.map(w => [w, `${m.labels.get(w).label} (week ${w})`]), ['new', 'A new week at the end']], m.weeks.at(-1) ?? 'new')}</select></label>
        <label>Home <select name="home">${clubOpts(clubsNow[0]?.code)}</select></label><label>Away <select name="away">${clubOpts(clubsNow[1]?.code)}</select></label>
        <label>Date <input type="date" name="date"></label><label>Kick-off <input type="time" name="time" value="19:00"></label></div>
        <div class="ed-actions"><button class="btn">Add match</button></div><p class="ed-msg" role="status"></p></form>
      <form class="ed-invite fx-card" id="fx-blank"><h2>Add a custom week</h2>
        <p class="ed-hint">An empty week to fill by hand: a special round, a break, a finals week. Add its matches from the Weeks tab.</p>
        <div class="fx-grid"><label>Week number <input type="number" name="week" min="1" max="${WEEK_MAX}" value="${free}" required></label>
        <label>Name <input name="name" maxlength="40" placeholder="e.g. Christmas Cup"></label>
        <label>Type <select name="kind">${opts(KINDS, 'regular')}</select></label>
        <label class="fx-check"><input type="checkbox" name="numbered" checked ${hasRoster ? '' : 'disabled'}> Counts as a numbered round</label>
        <label>Look <select name="look">${lookOpts('classic')}</select></label></div>
        <label class="fx-check"><input type="checkbox" name="insert"> Make room: if the number is taken, push that week and later ones up</label>
        <div class="ed-actions"><button class="btn">Add the week</button></div><p class="ed-msg" role="status"></p></form>
      <div class="ed-invite fx-card" id="fx-season"><h2>Whole-season tools</h2>
        <p class="ed-hint">These work on every week at once. If a week with locked line-ups would have to move, nothing changes.</p>
        <div class="ed-actions">
          <button class="btn ghost small" type="button" data-act="s-compact">Close gaps in the week numbers</button>
          <button class="btn ghost small" type="button" data-act="s-bydate">Put weeks in date order</button>
          <button class="btn ghost small" type="button" data-act="s-reverse">Reverse the week order</button>
          <button class="btn ghost small" type="button" data-act="s-autonum">Use automatic round numbers</button></div>
        <div class="fx-grid"><label>Shift every kick-off by <input type="number" id="fx-sdays" value="7" min="-365" max="365"> days</label>
          <span><button class="btn ghost small" type="button" data-act="s-shift">Shift all dates</button></span>
          <label>Swap home and away in <select id="fx-sflip"><option value="all">every match</option>${m.weeks.map(w => `<option value="${w}">${esc(m.labels.get(w).label)} only</option>`).join('')}</select></label>
          <span><button class="btn ghost small" type="button" data-act="s-flip">Swap</button></span></div></div>
      <div class="ed-invite fx-card" id="fx-io"><h2>Export and import</h2>
        <p class="ed-hint">Copy the roster as a spreadsheet-style list, or paste one in. One match per line: <code>week, home, away, date, time</code> (date as 2026-10-17, time as 19:30, club by code or name). Imported matches are added to what's there.</p>
        <div class="ed-actions"><button class="btn ghost small" type="button" data-act="io-export">Copy the roster as CSV</button><button class="btn ghost small" type="button" data-act="io-text">Copy as plain text</button></div>
        <label>Paste to import <textarea id="fx-import" rows="5" placeholder="3, TUR, LAU, 2026-10-24, 19:30"></textarea></label>
        <div class="ed-actions"><button class="btn" type="button" data-act="io-import">Import these matches</button></div><p class="ed-msg" id="fx-io-msg" role="status"></p></div>`;
  }

  function previewHtml() {
    const p = preview;
    return `<div class="fx-preview" role="region" aria-label="Preview">
      <h3>Preview</h3>
      ${p.weeks.map(w => `<div class="fx-pw"><h4>Week ${w.week} <small>${esc(plural(w.fresh, 'new matchup'))}${w.rematches ? `, ${plural(w.rematches, 'rematch', 'rematches')}` : ''}</small></h4>
        <ul>${w.placed.map(g => `<li><b style="--club:${esc(colour(g.h))}" class="fx-team">${esc(name(g.h))}</b> v <b style="--club:${esc(colour(g.a))}" class="fx-team">${esc(name(g.a))}</b> <small>${esc(when(g.at))}${g.met ? ` · played ${g.met === 1 ? 'once' : `${g.met} times`} before` : ''}</small></li>`).join('')}</ul>
        ${w.byes.length ? `<p class="fx-pbye">Not playing: ${w.byes.map(c => esc(name(c))).join(', ')}</p>` : ''}</div>`).join('')}
      <div class="ed-actions"><button class="btn" type="button" data-act="pv-create">Create ${p.weeks.length === 1 ? 'this week' : `these ${p.weeks.length} weeks`}</button>
        <button class="btn ghost small" type="button" data-act="pv-reroll">Re-roll</button><button class="btn ghost small" type="button" data-act="pv-discard">Discard</button></div></div>`;
  }

  function gridView(m) {
    const cs = codes(), fx = fixtures;
    if (!m.weeks.length) return '<p class="quiet">No weeks yet.</p>';
    const st = R.statsOf(fx, cs);
    return `<p class="ed-hint">Each club's opponent in each week. Italic = away. “–” = not playing.</p><div class="fx-scroll"><table class="fx-table"><thead><tr><th>Club</th>${m.weeks.map(w => `<th title="${esc(m.labels.get(w).label)}" class="${m.labels.get(w).numbered ? '' : 'nonum'}">${esc(m.labels.get(w).short)}</th>`).join('')}<th>H</th><th>A</th><th>Bye</th></tr></thead>
      <tbody>${cs.map(c => `<tr><th style="--club:${esc(colour(c))}"><span class="fx-team">${esc(name(c))}</span></th>${m.weeks.map(w => { const r = R.clubRoster(fx, w, c); return r ? `<td class="${r.home ? 'h' : 'a'}${r.fixture.postponed ? ' pp' : ''}${results.has(r.fixture.id) ? ' done' : ''}" title="${esc(`${m.labels.get(w).label}: ${r.home ? 'home v' : 'away at'} ${name(r.opp)}`)}">${esc(r.opp)}</td>` : '<td class="bye">–</td>'; }).join('')}
        <td>${st.home.get(c)}</td><td>${st.away.get(c)}</td><td>${st.byes.get(c)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function meetView() {
    const cs = codes(), grid = R.meetingMatrix(fixtures, cs);
    if (cs.length < 2) return '<p class="quiet">Not enough clubs yet.</p>';
    const max = Math.max(1, ...grid.flat().filter(v => v != null));
    return `<p class="ed-hint">How many times each pair of clubs plays. A zero is a match-up that hasn't been scheduled.</p><div class="fx-scroll"><table class="fx-table meet"><thead><tr><th></th>${cs.map(c => `<th title="${esc(name(c))}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${cs.map((a, i) => `<tr><th style="--club:${esc(colour(a))}"><span class="fx-team">${esc(name(a))}</span></th>${grid[i].map((v, j) => v == null ? '<td class="self"></td>' : `<td class="m${v === 0 ? ' zero' : ''}" style="--heat:${(v / max).toFixed(2)}" title="${esc(`${name(a)} v ${name(cs[j])}: ${v}`)}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  const issues = () => R.checkRoster({ fixtures, clubs: ctx.clubs, rounds, names: names() });
  function checksView(m) {
    const list = issues();
    if (!list.length) return '<p class="fx-allgood">Nothing to flag: no club plays twice in a week, every match has a time, and no rematches come early.</p>';
    const icon = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
    return `<p class="ed-hint">Things that look wrong or odd across the whole roster. Click a week to jump to it.</p>
      <ul class="fx-issues">${list.map(i => `<li class="lvl-${i.level}"><span aria-hidden="true">${icon[i.level]}</span> ${esc(i.msg)}${i.week != null ? ` <button class="btn ghost small" type="button" data-act="goto" data-week="${i.week}">Go to ${esc(m.labels.get(i.week)?.label || `week ${i.week}`)}</button>` : ''}</li>`).join('')}</ul>`;
  }

  const todo = week => fixtures.filter(f => !f.postponed && !results.has(f.id) && (week == null || f.week === week));

  function draw() {
    const y = window.scrollY, m = model(), n = issues().filter(i => i.level !== 'info').length;
    root.innerHTML = `<div class="fx-top"><p class="pl-sum"><b>${fixtures.length}</b> fixture${fixtures.length === 1 ? '' : 's'} over ${m.weeks.length} week${m.weeks.length === 1 ? '' : 's'}.
        <button class="btn small" type="button" data-act="sim-all" ${todo().length ? '' : 'disabled'}>Simulate all unplayed (${todo().length})</button>
        <button class="btn ghost small" type="button" data-act="clear-all" ${m.weeks.length ? '' : 'disabled'}>Clear everything</button></p>
      <div class="fx-undo"><button class="btn ghost small" type="button" data-act="undo" ${undoStack.length && !busy ? '' : 'disabled'}>↶ Undo${undoStack.length ? `: ${esc(undoStack.at(-1).label)}` : ''}</button>
        <button class="btn ghost small" type="button" data-act="redo" ${redoStack.length && !busy ? '' : 'disabled'}>↷ Redo${redoStack.length ? `: ${esc(redoStack.at(-1).label)}` : ''}</button></div></div>
      ${hasRoster ? '' : '<p class="fx-warnbar">Week numbering and the safe week mover need the database update <b>0021_roster_tools.sql</b>. Everything else works now.</p>'}
      <nav class="fx-views" aria-label="Fixtures views">${VIEWS.map(([k, l]) => `<button type="button" data-view="${k}" ${k === view ? 'aria-current="page"' : ''}>${esc(l)}${k === 'checks' && n ? ` <span class="ed-count">${n}</span>` : ''}</button>`).join('')}</nav>
      <p class="ed-msg fx-status" id="fx-msg" role="status" data-kind="${esc(msgKind)}">${esc(msg)}</p>
      ${{ weeks: weeksView, planner: plannerView, grid: gridView, meet: meetView, checks: checksView }[view](m)}`;
    if (y) window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------- simulate (0.14)
  // Plays the matches one after another and saves each. One match that can't be played stops with its reason; in a
  // batch it's skipped and listed at the end.
  async function simulate(list) {
    if (busy) return;
    busy = true;
    const panel = document.getElementById('fx-sim');
    panel.hidden = false;
    let cancelled = false, done = 0;
    const skipped = [];
    panel.innerHTML = `<p class="fx-sim-what"></p><div class="vid-bar"><span></span></div><p class="fx-sim-status"></p>
      <button class="btn ghost small" type="button">Cancel</button>`;
    const what = panel.querySelector('.fx-sim-what'), bar = panel.querySelector('.vid-bar span'), status = panel.querySelector('.fx-sim-status'), cancel = panel.querySelector('button');
    cancel.onclick = () => { cancelled = true; cancel.disabled = true; status.textContent = 'Stopping after this match…'; };
    try {
      const [sim, c, season] = await Promise.all([import('./simulate.js'), ctx.db(), loadSeason()]);
      for (const f of list) {
        if (cancelled) break;
        what.textContent = `${name(f.home)} v ${name(f.away)} · week ${f.week}${list.length > 1 ? ` (${done + 1} of ${list.length})` : ''}`;
        try {
          const fx = season.fixtures.find(x => x.id === f.id);
          if (!fx) throw new Error('That match isn’t in the league data yet. Reload the page.');
          // A fresh seed each time, so playing a match again gives a new result.
          const data = await sim.simulateFixture(c, season, fx, { seed: Math.floor(Math.random() * 2 ** 31), onProgress: frac => {
            bar.style.width = `${Math.round(((done + Math.min(1, frac)) / list.length) * 100)}%`;
            status.textContent = frac < 0.02 ? 'Loading the simulator (the first time takes a moment)…' : `Playing the match… ${Math.round(frac * 100)}%`;
          } });
          status.textContent = 'Saving…';
          const summary = await sim.saveResult(c, fx, data);
          fx.result = summary;                        // later matches see this game's red cards
          results.set(f.id, summary);
          done++;
          draw();
        } catch (e) {
          if (list.length === 1) throw e;
          skipped.push(`${name(f.home)} v ${name(f.away)}: ${e.message}`);
        }
      }
      bar.style.width = '100%';
      status.textContent = `${done} match${done === 1 ? '' : 'es'} played${cancelled ? ' (stopped)' : ''}.${skipped.length ? ` Skipped ${skipped.length}:` : ''}`;
      if (skipped.length) panel.insertAdjacentHTML('beforeend', `<ul class="fx-sim-skipped">${skipped.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`);
    } catch (e) {
      status.textContent = e.message;
    }
    cancel.textContent = 'Close'; cancel.disabled = false; cancel.onclick = () => { panel.hidden = true; };
    busy = false;
    draw();
  }

  // ---------------------------------------------------------------- building weeks
  // The next free week number, or the one asked for; an existing week is pushed up when `insert` says so.
  async function makeRoom(tx, m, at, n, insert) {
    const used = m.weeks.filter(w => w >= at && w < at + n && (insert || m.by.get(w).length));
    if (!used.length) return;
    if (!insert) throw new Error(`Week ${used[0]} is already in use. Pick a free week number, or tick “Make room”.`);
    await moveWeeks(tx, R.mapInsertGap(m.weeks, at, n));
  }
  const newWeekNumber = () => { const w = lastWeek() + 1; if (w > WEEK_MAX) throw new Error(`There's no room for another week (the limit is ${WEEK_MAX}).`); return w; };

  function buildPreview(o) {
    const m = model(), virtual = [], out = [], cs = codes();
    if (cs.length < 2) throw new Error('You need at least two active clubs.');
    for (let k = 0; k < o.count; k++) {
      const week = o.week + k;
      if (week > WEEK_MAX) throw new Error(`That would go past week ${WEEK_MAX}.`);
      if (!o.insert && m.weeks.includes(week) && fixtures.some(f => f.week === week)) throw new Error(`Week ${week} already has matches. Pick an empty week, tick “Make room”, or use Fill the rest on that week.`);
      const pr = R.pairWeek({ codes: cs, fixtures: [...fixtures.filter(f => f.week < o.week), ...virtual], week, rest: o.rest, seed: o.seed + k * 101, recent: o.recent, avoid: o.avoid });
      const meet = R.statsOf([...fixtures.filter(f => f.week < o.week), ...virtual], cs).meet;
      const placed = R.placeWeek(pr.games, addDays(o.start, k * o.every), rows).map(p => ({ ...p, met: meet.get(R.pairKey(p.h, p.a)) || 0 }));
      virtual.push(...placed.map(p => ({ week, home: p.h, away: p.a, starts_at: p.at })));
      out.push({ week, placed, byes: pr.byes, fresh: pr.fresh, rematches: pr.rematches });
    }
    return { weeks: out, opts: o };
  }

  async function createPreview(tx, p) {
    const o = p.opts, m = model();
    await makeRoom(tx, m, o.week, o.count, o.insert);
    for (const w of p.weeks) {
      await setRound(tx, w.week, { name: null, kind: 'regular', look: o.look, lock_minutes_before: o.lock, lock_at_override: null, ...(hasRoster ? { numbered: true, number_override: null } : {}) });
      const taken = takenIds();
      await insertFx(tx, w.placed.map(p => { const id = R.freshId(w.week, p.h, p.a, taken); taken.add(id); return { id, week: w.week, home: p.h, away: p.a, starts_at: p.at }; }));
    }
  }

  // ---------------------------------------------------------------- week and match operations
  const gamesOf = list => list.map(f => [f.home, f.away]);
  function startFor(week, list) { return list.map(f => f.starts_at).filter(Boolean).sort()[0] || null; }
  async function copyWeek(tx, m, w, to, days, flip) {
    const list = m.by.get(w);
    if (!list.length) throw new Error('That week has no matches to copy.');
    if (to < 1 || to > WEEK_MAX) throw new Error(`Weeks go from 1 to ${WEEK_MAX}.`);
    if (fixtures.some(f => f.week === to)) throw new Error(`Week ${to} already has matches. Copy to a free week, or delete that week first.`);
    const src = round(w), taken = takenIds();
    if (!rounds.some(r => r.week === to)) await setRound(tx, to, { name: src.name ? `${src.name} (copy)`.slice(0, 40) : null, kind: src.kind, look: src.look, lock_minutes_before: src.lock_minutes_before, lock_at_override: null, ...(hasRoster ? { numbered: src.numbered, number_override: null } : {}) });
    await insertFx(tx, list.map(f => { const [h, a] = flip ? [f.away, f.home] : [f.home, f.away], id = R.freshId(to, h, a, taken); taken.add(id); return { id, week: to, home: h, away: a, starts_at: f.starts_at && days ? shiftIso(f.starts_at, days) : f.starts_at, stage: f.stage || null }; }));
  }

  async function shiftWeek(tx, list, days) {
    for (const f of list) if (f.starts_at) await setFx(tx, f, { starts_at: shiftIso(f.starts_at, days) });
  }

  // Swap the clubs in two places. A place is a side of a match, or a club that isn't playing that week.
  async function swapTeams(a, b) {
    const get = x => (x.fx ? fixtures.find(f => f.id === x.fx) : null);
    const fa = get(a), fb = get(b), codeA = fa ? fa[a.side] : a.bye, codeB = fb ? fb[b.side] : b.bye;
    if (fa && fb && fa.id === fb.id) {
      if (a.side === b.side) return;
      if (!(await confirmPlayed([fa], 'Swapping home and away'))) return;
      return run('Swap home and away', async tx => { await clearResult(tx, fa); await setFx(tx, fa, { home: fa.away, away: fa.home }); });
    }
    if (!fa && !fb) return;
    const next = new Map();   // fixture id -> patch
    const put = (f, side, code) => { next.set(f.id, { ...(next.get(f.id) || {}), [side]: code }); };
    if (fa) put(fa, a.side, codeB);
    if (fb) put(fb, b.side, codeA);
    for (const [id, patch] of next) { const f = fixtures.find(x => x.id === id), after = { ...f, ...patch }; if (after.home === after.away) { notify(`That would make ${name(after.home)} play themselves.`, 'bad'); return; } }
    const hit = [fa, fb].filter(Boolean);
    if (!(await confirmPlayed(hit, 'Swapping these teams'))) return;
    // Warn when someone would then be in a week twice.
    const dup = [];
    for (const [id, patch] of next) {
      const f = fixtures.find(x => x.id === id), same = fixtures.filter(x => x.week === f.week && x.id !== id);
      for (const c of Object.values(patch)) if (same.some(x => (x.home === c || x.away === c) && !next.has(x.id))) dup.push(name(c));
    }
    return run(`Swap ${name(codeA)} and ${name(codeB)}`, async tx => {
      for (const [id, patch] of next) { const f = fixtures.find(x => x.id === id); await clearResult(tx, f); await setFx(tx, f, patch); }
      return dup.length ? `${[...new Set(dup)].join(', ')} now ${dup.length > 1 ? 'play' : 'plays'} twice in a week. See Checks.` : '';
    });
  }

  async function addMatchTo(w) {
    const m = model(), list = m.by.get(w) || [], playing = new Set(list.flatMap(f => [f.home, f.away]));
    const free = active().filter(c => !playing.has(c.code)), pool = free.length >= 2 ? free : active();
    if (pool.length < 2) return notify('You need at least two active clubs.', 'bad');
    const times = list.map(f => f.starts_at).filter(Boolean).sort(), lastT = times.at(-1);
    const gap = (rows && rows.at(-1)?.gap) || 90;
    const at = lastT ? melbourneToIso(dateOf(lastT), addMinutes(timeOf(lastT), gap)) : null;
    const [h, a] = [pool[0].code, pool[1].code];
    return run('Add a match', async tx => { await ensureRound(tx, w); await insertFx(tx, [{ id: R.freshId(w, h, a, takenIds()), week: w, home: h, away: a, starts_at: at }]); });
  }

  async function repairWeek(w) {
    const m = model(), list = m.by.get(w);
    if (!list.length) return;
    const cs = codes(), inWeek = new Set(list.flatMap(f => [f.home, f.away]));
    if (!(await confirmPlayed(list, `Re-pairing week ${w}`))) return;
    const pr = R.pairWeek({ codes: cs, fixtures, week: w, rest: cs.filter(c => !inWeek.has(c)), seed: Math.floor(Math.random() * 2 ** 31) });
    if (pr.games.length !== list.length) return notify('Couldn’t re-pair that week with the clubs in it (an odd number is playing). Use Fill the rest instead.', 'bad');
    return run(`Re-pair week ${w}`, async tx => { for (let i = 0; i < list.length; i++) { await clearResult(tx, list[i]); await setFx(tx, list[i], { home: pr.games[i][0], away: pr.games[i][1] }); } return pr.rematches ? `${plural(pr.rematches, 'rematch', 'rematches')} couldn’t be avoided.` : ''; });
  }

  async function fillWeek(w) {
    const m = model(), list = m.by.get(w) || [], cs = codes();
    const pr = R.pairWeek({ codes: cs, fixtures, week: w, fixed: gamesOf(list), seed: Math.floor(Math.random() * 2 ** 31) });
    if (!pr.games.length) return notify('Everyone who can play is already in this week.', 'bad');
    const times = list.map(f => f.starts_at).filter(Boolean).sort(), lastT = times.at(-1), gap = (inferGap(list) || (rows && rows.at(-1)?.gap) || 90);
    return run(`Fill week ${w}`, async tx => {
      await ensureRound(tx, w);
      const taken = takenIds();
      await insertFx(tx, pr.games.map(([h, a], k) => { const id = R.freshId(w, h, a, taken); taken.add(id); return { id, week: w, home: h, away: a, starts_at: lastT ? melbourneToIso(dateOf(lastT), addMinutes(timeOf(lastT), gap * (k + 1))) : null }; }));
      return pr.byes.length ? `${pr.byes.map(name).join(', ')} still ${pr.byes.length > 1 ? 'aren’t' : 'isn’t'} playing.` : '';
    });
  }
  const inferGap = list => R.inferBlocks(list.map(f => f.starts_at))?.at(-1)?.gap;

  // A week's line-ups lock at its first kick-off minus the lock rule, and a locked week can never be unlocked. If the
  // kick-offs are in the past that happens within a minute, so ask before doing it.
  function lockPasses(w, isoTimes) {
    if (isLocked(w)) return false;
    const r = round(w), first = isoTimes.filter(Boolean).sort()[0];
    const at = r.lock_at_override ? new Date(r.lock_at_override) : first ? new Date(new Date(first).getTime() - r.lock_minutes_before * 60000) : null;
    return !!at && at <= new Date();
  }
  async function confirmLock(w, isoTimes) {
    if (!lockPasses(w, isoTimes)) return true;
    return (await ask(`Those kick-offs are in the past, so ${model().labels.get(w)?.label || `week ${w}`}'s line-ups would lock within a minute, and a locked week can't be unlocked. Set them anyway?`, ['Set them anyway'])) === 0;
  }

  // One press: the next week, paired from the weeks so far, timed like the last week a week later. Kick-offs that would
  // already be in the past are left blank, so the week doesn't lock before you've set its dates.
  async function quickCreate() {
    const m = model(), cs = codes(), week = lastWeek() + 1;
    if (week > WEEK_MAX) return notify(`There's no room for another week (the limit is ${WEEK_MAX}).`, 'bad');
    const prev = round(m.weeks.at(-1) || 1), dated = [...m.by.entries()].filter(([, l]) => l.some(f => f.starts_at)).at(-1);
    const base = dated ? addDays(mondayOf(dateOf(dated[1].map(f => f.starts_at).filter(Boolean).sort()[0])), 7) : nextMon();
    const pr = cs.length >= 2 ? R.pairWeek({ codes: cs, fixtures, week, seed: Math.floor(Math.random() * 2 ** 31) }) : { games: [], byes: [] };
    let placed = R.placeWeek(pr.games, base, rows);
    const blank = lockPasses(week, placed.map(p => p.at)) || (!!placed.length && !rows);
    if (blank) placed = placed.map(p => ({ ...p, at: null }));
    return run(`Quick create week ${week}`, async tx => {
      await setRound(tx, week, { name: null, kind: 'regular', look: prev.look, lock_minutes_before: prev.lock_minutes_before, lock_at_override: null, ...(hasRoster ? { numbered: true, number_override: null } : {}) });
      const taken = takenIds();
      await insertFx(tx, placed.map(p => { const id = R.freshId(week, p.h, p.a, taken); taken.add(id); return { id, week, home: p.h, away: p.a, starts_at: p.at }; }));
      return blank && placed.length ? 'Kick-off times are blank because those dates have passed. Set them when you know them.' : '';
    });
  }

  // ---------------------------------------------------------------- the CSV
  const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  function toCsv() {
    const m = model();
    return ['week,round,home,away,date,time,stage,postponed', ...fixtures.slice().sort((a, b) => a.week - b.week || byKick(a, b)).map(f => [f.week, m.labels.get(f.week).label, f.home, f.away, f.starts_at ? dateOf(f.starts_at) : '', f.starts_at ? timeOf(f.starts_at) : '', f.stage || '', f.postponed ? 'yes' : ''].map(csvCell).join(','))].join('\n');
  }
  function toText() {
    const m = model();
    return m.weeks.map(w => R.weekText(`${m.labels.get(w).label} (week ${w})`, m.by.get(w), name, when)).join('\n\n');
  }
  async function copy(text, say) {
    try { await navigator.clipboard.writeText(text); say('Copied.'); }
    catch { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { /* no clipboard */ } ta.remove(); say(ok ? 'Copied.' : 'Couldn’t copy. Select and copy it by hand.'); }
  }
  function parseImport(text) {
    const lookup = new Map();
    ctx.clubs.forEach(c => { lookup.set(c.code.toLowerCase(), c.code); lookup.set(c.name.toLowerCase(), c.code); if (c.short_name) lookup.set(String(c.short_name).toLowerCase(), c.code); });
    const out = [], bad = [];
    text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      if (/^week\b/i.test(line)) return;
      const cells = []; line.replace(/("([^"]|"")*"|[^,]*)(,|$)/g, (_, c) => { cells.push(c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()); return ''; });
      const [wk, h, a, d, t] = cells.length >= 7 ? [cells[0], cells[2], cells[3], cells[4], cells[5]] : cells;   // 7+ columns = our own export
      const week = Number(wk), home = lookup.get(String(h || '').toLowerCase()), away = lookup.get(String(a || '').toLowerCase());
      if (!(week >= 1 && week <= WEEK_MAX) || !home || !away || home === away) return bad.push(`Line ${i + 1}: ${line.slice(0, 50)}`);
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad.push(`Line ${i + 1}: the date should look like 2026-10-24`);
      if (t && !/^\d{1,2}:\d{2}$/.test(t)) return bad.push(`Line ${i + 1}: the time should look like 19:30`);
      out.push({ week, home, away, starts_at: d ? melbourneToIso(d, (t || '19:00').padStart(5, '0')) : null });
    });
    return { out, bad };
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msgEl = f.querySelector('.ed-msg'), btn = f.querySelector('.ed-actions .btn');
    const say = t => { if (msgEl) msgEl.textContent = t; };
    const v = Object.fromEntries(new FormData(f));
    try {
      if (f.id === 'fx-next') {
        const o = { week: Number(v.week), count: Math.max(1, Math.min(40, Number(v.count) || 1)), start: v.start, every: Number(v.every) || 7, avoid: v.avoid, recent: Number(v.recent) || 0, lock: Number(v.lock), look: v.look, insert: !!v.insert, rest: new FormData(f).getAll('rest'), seed: Math.floor(Math.random() * 2 ** 31) };
        if (!o.start) return say('Pick the date the week begins.');
        preview = buildPreview(o); draw(); document.querySelector('.fx-preview')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (btn) btn.disabled = true;
      if (f.id === 'fx-gen') {
        const first = Number(v.first) || 1, every = Number(v.every) || 7, lock = Number(v.lock), look = v.look, plan = R.roundRobin(codes(), v.rounds === '2');
        if (first + plan.length - 1 > WEEK_MAX) throw new Error(`That would go past week ${WEEK_MAX}.`);
        await run(`Plan ${plural(plan.length, 'week')}`, async tx => {
          await makeRoom(tx, model(), first, plan.length, !!v.insert);
          for (let w = 0; w < plan.length; w++) {
            const week = first + w, placed = R.placeWeek(plan[w], addDays(v.start, w * every), rows), taken = takenIds();
            await setRound(tx, week, { name: null, kind: 'regular', look, lock_minutes_before: lock, lock_at_override: null, ...(hasRoster ? { numbered: true, number_override: null } : {}) });
            await insertFx(tx, placed.map(p => { const id = R.freshId(week, p.h, p.a, taken); taken.add(id); return { id, week, home: p.h, away: p.a, starts_at: p.at }; }));
          }
        });
      } else if (f.id === 'fx-add') {
        if (v.home === v.away) throw new Error('Pick two different clubs.');
        const week = v.week === 'new' ? newWeekNumber() : Number(v.week);
        await run('Add a match', async tx => { await ensureRound(tx, week); await insertFx(tx, [{ id: R.freshId(week, v.home, v.away, takenIds()), week, home: v.home, away: v.away, starts_at: v.date ? melbourneToIso(v.date, v.time || '19:00') : null }]); });
      } else if (f.id === 'fx-blank') {
        const week = Number(v.week), m = model();
        if (!(week >= 1 && week <= WEEK_MAX)) throw new Error(`Weeks go from 1 to ${WEEK_MAX}.`);
        await run('Add a week', async tx => { await makeRoom(tx, m, week, 1, !!v.insert); await setRound(tx, week, { name: (v.name || '').trim() || null, kind: v.kind, look: v.look, ...(hasRoster ? { numbered: !!v.numbered, number_override: null } : {}) }); });
        if (!hasRoster) say('Added. (Unnumbered weeks need database update 0021.)');
      }
    } catch (err) { say(failText(err)); if (btn) btn.disabled = false; }
  });

  root.addEventListener('click', async e => {
    const vb = e.target.closest('[data-view]');
    if (vb) { view = vb.dataset.view; store.set('view', view); return draw(); }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, week = Number(b.closest('[data-week]')?.dataset.week), row = b.closest('.fx-row'), f = row ? fixtures.find(x => x.id === row.dataset.id) : null;
    const m = model(), box = b.closest('.fx-tools, .fx-more, .fx-bar');
    const val = k => box?.querySelector(`[data-k="${k}"], [data-b="${k}"]`)?.value;
    const num = k => Number(val(k));

    // undo / redo / top bar
    if (act === 'undo') return undo();
    if (act === 'redo') return redo();
    if (act === 'quick-create') return quickCreate();
    if (act === 'sim-all') return simulate(todo());
    if (act === 'clear-all') {
      if ((await ask(`Delete all ${fixtures.length} fixtures, their ${plural(results.size, 'result')} and every round?`, ['Yes, clear everything'])) !== 0) return;
      return run('Clear everything', async tx => {
        await deleteFx(tx, fixtures);
        const rs = rounds.map(r => ({ ...r }));
        if (rs.length) await step(tx, async () => (await ctx.db()).from('rounds').delete().gte('week', 0), async () => (await ctx.db()).from('rounds').upsert(rs));
      });
    }
    if (act === 'goto') { view = 'weeks'; store.set('view', view); folded.delete(week); store.set('folded', [...folded]); draw(); document.querySelector(`.fx-week[data-week="${week}"]`)?.scrollIntoView({ block: 'start' }); return; }

    // planner: pattern blocks
    if (act === 'win-add') { rows.push({ day: 6, time: '19:00', games: 0, gap: 90 }); pattern = 'custom'; return draw(); }
    if (act === 'win-del') { rows.splice(Number(b.closest('.fx-win').dataset.i), 1); pattern = 'custom'; return draw(); }
    if (act === 'pv-discard') { preview = null; return draw(); }
    if (act === 'pv-reroll') { preview = buildPreview({ ...preview.opts, seed: Math.floor(Math.random() * 2 ** 31) }); return draw(); }
    if (act === 'pv-create') { const p = preview; preview = null; const ok = await run(`Create ${plural(p.weeks.length, 'week')}`, tx => createPreview(tx, p)); if (!ok) { preview = p; draw(); } return; }

    // whole-season tools
    if (act.startsWith('s-')) {
      const weeks = m.weeks;
      if (act === 's-compact') return run('Close gaps in week numbers', async tx => moveWeeks(tx, R.mapCompact(weeks, 1)));
      if (act === 's-bydate') { const first = new Map(m.weeks.map(w => [w, startFor(w, m.by.get(w))])); return run('Put weeks in date order', async tx => moveWeeks(tx, R.mapByDate(weeks, first))); }
      if (act === 's-reverse') return run('Reverse the week order', async tx => moveWeeks(tx, R.mapReverse(weeks)));
      if (act === 's-autonum') return run('Use automatic round numbers', async tx => { for (const r of rounds.filter(x => x.number_override != null || x.numbered === false)) await setRound(tx, r.week, { number_override: null, numbered: true }); });
      if (act === 's-shift') { const n = Number(document.getElementById('fx-sdays').value) || 0; if (!n) return; return run(`Shift every date by ${n} day${Math.abs(n) === 1 ? '' : 's'}`, async tx => shiftWeek(tx, fixtures, n)); }
      if (act === 's-flip') {
        const w = document.getElementById('fx-sflip').value, list = w === 'all' ? fixtures : fixtures.filter(x => x.week === Number(w));
        if (!(await confirmPlayed(list, 'Swapping home and away'))) return;
        return run('Swap home and away', async tx => { for (const x of list) { await clearResult(tx, x); await setFx(tx, x, { home: x.away, away: x.home }); } });
      }
    }

    // import / export
    if (act === 'io-export' || act === 'io-text') return copy(act === 'io-export' ? toCsv() : toText(), t => { document.getElementById('fx-io-msg').textContent = t; });
    if (act === 'io-import') {
      const { out, bad } = parseImport(document.getElementById('fx-import').value), say = t => { document.getElementById('fx-io-msg').textContent = t; };
      if (!out.length) return say(bad.length ? bad.slice(0, 4).join(' · ') : 'Paste some matches first.');
      const taken = takenIds(), weeks = [...new Set(out.map(x => x.week))];
      return run(`Import ${plural(out.length, 'match', 'matches')}`, async tx => {
        for (const w of weeks) if (!rounds.some(r => r.week === w)) await setRound(tx, w, {});
        await insertFx(tx, out.map(x => { const id = R.freshId(x.week, x.home, x.away, taken); taken.add(id); return { id, ...x }; }));
        return bad.length ? `Skipped ${bad.length}: ${bad.slice(0, 2).join(' · ')}` : '';
      });
    }

    // folding and drawers
    if (act === 'fold') { folded.has(week) ? folded.delete(week) : folded.add(week); store.set('folded', [...folded]); return draw(); }
    if (act === 'fold-all') { m.weeks.forEach(w => folded.add(w)); store.set('folded', [...folded]); return draw(); }
    if (act === 'unfold-all') { folded.clear(); store.set('folded', []); return draw(); }
    if (act === 'tools') { toolsOpen.has(week) ? toolsOpen.delete(week) : toolsOpen.add(week); return draw(); }
    if (act === 'more') { moreOpen.has(f.id) ? moreOpen.delete(f.id) : moreOpen.add(f.id); return draw(); }

    // simulate
    if (act === 'sim-week') return simulate(todo(week));
    if (act === 'sim') return simulate([f]);
    if (act === 'again') { if ((await ask('Replace its result with a new match?', ['Play it again'])) === 0) return simulate([f]); return; }
    if (act === 'unplay') {
      if ((await ask('Remove this result and its match file?', ['Remove'])) !== 0) return;
      try { await (await import('./simulate.js')).removeResult(await ctx.db(), f); } catch (err) { return notify(err.message, 'bad'); }
      results.delete(f.id); return draw();
    }

    // week order
    if (act === 'week-up' || act === 'week-down') {
      const i = m.weeks.indexOf(week), other = m.weeks[i + (act === 'week-up' ? -1 : 1)];
      if (other == null) return;
      return run(`Swap week ${week} with week ${other}`, async tx => moveWeeks(tx, R.mapSwap(week, other)));
    }
    if (act === 'week-move') {
      const mode = val('mode'), to = num('to');
      if (!(to >= 1 && to <= WEEK_MAX)) return notify(`Weeks go from 1 to ${WEEK_MAX}.`, 'bad');
      if (to === week && mode !== 'pos') return;
      if (mode === 'swap') return run(`Move week ${week} to ${to}`, async tx => moveWeeks(tx, R.mapSwap(week, to)));
      if (mode === 'insert') {
        const others = m.weeks.filter(x => x !== week);
        const gap = R.mapInsertGap(others, to, 1);
        return run(`Insert week ${week} at ${to}`, async tx => moveWeeks(tx, gap === null ? null : { ...gap, [week]: to }));
      }
      const target = m.weeks[Math.max(1, Math.min(m.weeks.length, to)) - 1];
      return run(`Move week ${week} to position ${to}`, async tx => moveWeeks(tx, R.mapReorder(m.weeks, week, target)));
    }
    if (act === 'blank-before' || act === 'blank-after') {
      const at = act === 'blank-before' ? week : week + 1;
      return run('Insert a blank week', async tx => { if (m.weeks.includes(at)) await moveWeeks(tx, R.mapInsertGap(m.weeks, at, 1)); await setRound(tx, at, { name: null, kind: 'regular' }); });
    }
    if (act === 'week-delete') {
      const list = m.by.get(week), n = played(list).length;
      const pick = await ask(`Delete ${m.labels.get(week).label} (week ${week}) with its ${plural(list.length, 'match', 'matches')}${n ? ` and ${plural(n, 'result')}` : ''}?`, ['Delete the week', 'Delete and close the gap']);
      if (pick < 0) return;
      return run(`Delete week ${week}`, async tx => {
        await deleteFx(tx, list);
        if (rounds.some(r => r.week === week)) { const prev = rounds.find(r => r.week === week); await step(tx, async () => (await ctx.db()).from('rounds').delete().eq('week', week), async () => (await ctx.db()).from('rounds').upsert(prev)); }
        if (pick === 1) { const later = m.weeks.filter(x => x > week); await moveWeeks(tx, Object.fromEntries(later.map(x => [x, x - 1]))); }
      });
    }
    if (act === 'week-copy') {
      const to = num('copyto'), days = Number(val('days')) || 0, flip = !!box.querySelector('[data-k="flip"]').checked;
      return run(`Copy week ${week} to ${to}`, async tx => copyWeek(tx, m, week, to, days, flip));
    }

    // dates
    if (act === 'week-date') {
      const d = val('date'), list = m.by.get(week), first = firstDate(list);
      if (!d) return notify('Pick a date.', 'bad');
      if (!first) return notify('This week has no kick-off times yet. Use “Re-time with the Planner’s pattern”.', 'bad');
      const n = daysBetween(first, d); if (!n) return;
      if (!(await confirmLock(week, list.map(x => x.starts_at && shiftIso(x.starts_at, n))))) return;
      return run(`Move week ${week} to ${d}`, async tx => shiftWeek(tx, list, n));
    }
    if (act === 'week-shift') { const n = Number(b.dataset.n); if (!(await confirmLock(week, m.by.get(week).map(x => x.starts_at && shiftIso(x.starts_at, n))))) return; return run(`Shift week ${week} by ${n} day${Math.abs(n) === 1 ? '' : 's'}`, async tx => shiftWeek(tx, m.by.get(week), n)); }
    if (act === 'week-retime') {
      const list = m.by.get(week), d = val('date') || (firstDate(list) ? mondayOf(firstDate(list)) : nextMon());
      const placed = R.placeWeek(gamesOf(list), d, rows);
      if (!(await confirmLock(week, placed.map(p => p.at)))) return;
      return run(`Re-time week ${week}`, async tx => { for (let i = 0; i < list.length; i++) await setFx(tx, list[i], { starts_at: placed[i].at }); });
    }
    if (act === 'week-untime') return run(`Clear week ${week}'s times`, async tx => { for (const x of m.by.get(week)) if (x.starts_at) await setFx(tx, x, { starts_at: null }); });
    if (act === 'week-unlock') {
      if ((await ask(`Unlock ${m.labels.get(week).label}'s line-ups? The saved copies of the club team sheets for this week are dropped, and the lock time is worked out again from its kick-offs. If that time is already in the past it locks again within a minute, so set the kick-offs or the lock time first. This can't be undone, and a week with played matches can't be unlocked.`, ['Unlock it'])) !== 0) return;
      return run(`Unlock ${m.labels.get(week).label}`, async () => { const r = await (await ctx.db()).rpc('office_unlock_week', { p_week: week }); if (r.error) throw r.error; });
    }
    if (act === 'lock-auto') return run('Lock automatically', async tx => setRound(tx, week, { lock_at_override: null }));

    // pairings
    if (act === 'week-repair') return repairWeek(week);
    if (act === 'week-fill') return fillWeek(week);
    if (act === 'add-here') return addMatchTo(week);
    if (act === 'week-flip') { const list = m.by.get(week); if (!(await confirmPlayed(list, 'Swapping home and away'))) return; return run(`Swap home and away in week ${week}`, async tx => { for (const x of list) { await clearResult(tx, x); await setFx(tx, x, { home: x.away, away: x.home }); } }); }
    if (act === 'week-postpone' || act === 'week-restore') { const on = act === 'week-postpone'; return run(`${on ? 'Postpone' : 'Restore'} week ${week}`, async tx => { for (const x of m.by.get(week)) if (!!x.postponed !== on) await setFx(tx, x, { postponed: on }); }); }
    if (act === 'week-unplay') {
      const list = played(m.by.get(week));
      if ((await ask(`Remove ${plural(list.length, 'result')} from week ${week}?`, ['Remove them'])) !== 0) return;
      try { const sim = await import('./simulate.js'), c = await ctx.db(); for (const x of list) { await sim.removeResult(c, x); results.delete(x.id); } } catch (err) { return notify(err.message, 'bad'); }
      return draw();
    }
    if (act === 'week-copytext') return copy(R.weekText(`${m.labels.get(week).label} (week ${week})`, m.by.get(week), name, when), t => notify(t));

    // one match
    if (act === 'chip' || act === 'bye-chip') {
      const here = act === 'chip' ? { fx: f.id, side: b.dataset.side } : { bye: b.dataset.code, week: Number(b.dataset.week) };
      if (!sel) { sel = here; draw(); return; }
      const first = sel; sel = null;
      if (JSON.stringify(first) === JSON.stringify(here)) return draw();
      draw();
      return swapTeams(first, here);
    }
    if (act === 'chip-cancel') { sel = null; return draw(); }
    if (act === 'flip') { if (!(await confirmPlayed([f], 'Swapping home and away'))) return; return run('Swap home and away', async tx => { await clearResult(tx, f); await setFx(tx, f, { home: f.away, away: f.home }); }); }
    if (act === 'set-teams') {
      const h = val('home'), a = val('away');
      if (h === a) return notify('Pick two different clubs.', 'bad');
      if (h === f.home && a === f.away) return;
      if (!(await confirmPlayed([f], 'Changing the teams'))) return;
      const twice = fixtures.some(x => x.week === f.week && x.id !== f.id && [h, a].some(c => x.home === c || x.away === c));
      return run('Change teams', async tx => { await clearResult(tx, f); await setFx(tx, f, { home: h, away: a }); return twice ? 'A club is now in this week twice. See Checks.' : ''; });
    }
    if (act === 'set-stage') return run('Set the stage', async tx => setFx(tx, f, { stage: val('stage') || null }));
    if (act === 'move-to' || act === 'copy-to') {
      const to = val('week') === 'new' ? newWeekNumber() : num('week');
      if (act === 'move-to' && to === f.week) return;
      return run(act === 'move-to' ? 'Move a match' : 'Copy a match', async tx => {
        await ensureRound(tx, to);
        if (act === 'move-to') await setFx(tx, f, { week: to, window_id: null });
        else await insertFx(tx, [{ id: R.freshId(to, f.home, f.away, takenIds()), week: to, home: f.home, away: f.away, starts_at: f.starts_at }]);
        return fixtures.some(x => x.week === to && x.id !== f.id && [f.home, f.away].some(c => x.home === c || x.away === c)) ? 'A club is now in that week twice. See Checks.' : '';
      });
    }
    if (act === 'swap-slot') {
      const other = fixtures.find(x => x.id === val('slot'));
      if (!other) return notify('Pick a match to swap with.', 'bad');
      return run('Swap kick-offs', async tx => { await setFx(tx, f, { starts_at: other.starts_at }); await setFx(tx, other, { starts_at: f.starts_at }); });
    }
    if (act === 'postpone') return run(f.postponed ? 'Restore a match' : 'Postpone a match', async tx => setFx(tx, f, { postponed: !f.postponed }));
    if (act === 'del') {
      const n = results.has(f.id);
      if ((await ask(`Remove ${name(f.home)} v ${name(f.away)}${n ? ' and its result' : ''}?`, ['Remove it'])) !== 0) return;
      return run('Remove a match', async tx => deleteFx(tx, [f]));
    }

    // selection and bulk
    if (act === 'pick') return; // handled on change
    if (act === 'bulk-clear') { picked.clear(); return draw(); }
    if (act.startsWith('bulk-')) {
      const list = fixtures.filter(x => picked.has(x.id)), done = () => { picked.clear(); };
      if (act === 'bulk-move') {
        const to = val('week') === 'new' ? newWeekNumber() : num('week');
        return run(`Move ${plural(list.length, 'match', 'matches')} to week ${to}`, async tx => { await ensureRound(tx, to); for (const x of list) if (x.week !== to) await setFx(tx, x, { week: to, window_id: null }); done(); });
      }
      if (act === 'bulk-shift') { const mins = num('mins'); if (!mins) return; return run(`Shift ${plural(list.length, 'kick-off')} by ${mins} min`, async tx => { for (const x of list) if (x.starts_at) await setFx(tx, x, { starts_at: new Date(new Date(x.starts_at).getTime() + mins * 60000).toISOString() }); done(); }); }
      if (act === 'bulk-set') {
        const d = val('date'), t = val('time');
        if (!d && !t) return notify('Pick a date, a time, or both.', 'bad');
        return run(`Set ${plural(list.length, 'kick-off')}`, async tx => { for (const x of list) { const nd = d || (x.starts_at ? dateOf(x.starts_at) : null), nt = t || (x.starts_at ? timeOf(x.starts_at) : '19:00'); if (nd) await setFx(tx, x, { starts_at: melbourneToIso(nd, nt) }); } done(); });
      }
      if (act === 'bulk-flip') { if (!(await confirmPlayed(list, 'Swapping home and away'))) return; return run('Swap home and away', async tx => { for (const x of list) { await clearResult(tx, x); await setFx(tx, x, { home: x.away, away: x.home }); } done(); }); }
      if (act === 'bulk-postpone' || act === 'bulk-restore') { const on = act === 'bulk-postpone'; return run(on ? 'Postpone matches' : 'Restore matches', async tx => { for (const x of list) if (!!x.postponed !== on) await setFx(tx, x, { postponed: on }); done(); }); }
      if (act === 'bulk-del') {
        if ((await ask(`Remove ${plural(list.length, 'match', 'matches')}${played(list).length ? ` and ${plural(played(list).length, 'result')}` : ''}?`, ['Remove them'])) !== 0) return;
        return run('Remove matches', async tx => { await deleteFx(tx, list); done(); });
      }
    }
  });

  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-act="pick"]')) { const id = t.closest('.fx-row').dataset.id; t.checked ? picked.add(id) : picked.delete(id); return draw(); }
    if (t.name === 'pattern') { pattern = t.value; rows = pattern === 'last' ? blocksOf(lastBlocks || PATTERNS.saturday[1]) : PATTERNS[pattern] ? blocksOf(PATTERNS[pattern][1]) : rows; return draw(); }
    const win = t.closest('.fx-win');
    if (win) { const k = t.dataset.k; rows[Number(win.dataset.i)][k] = k === 'time' ? t.value : Number(t.value); pattern = 'custom'; const sel2 = root.querySelector('[name=pattern]'); if (sel2) sel2.value = 'custom'; return; }
    // the Week tools: name, numbering, look, lock rule
    if (t.dataset.r) {
      const w = Number(t.closest('.fx-tools').dataset.week), k = t.dataset.r;
      let value = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'name' || k === 'note') value = String(value).trim() || null;
      else if (k === 'lock_minutes_before') value = Number(value);
      else if (k === 'number_override') value = value === '' ? null : Number(value);
      else if (k === 'lock_at_override') value = value ? new Date(melbourneToIso(value.slice(0, 10), value.slice(11, 16))).toISOString() : null;
      const patch = { [k]: value };
      if (k === 'lock_at_override' && value) patch.lock_minutes_before = round(w).lock_minutes_before;
      return run(`Update week ${w}`, async tx => setRound(tx, w, patch));
    }
    // a kick-off time
    const row = t.closest('.fx-row');
    if (row && t.type === 'datetime-local') {
      const f = fixtures.find(x => x.id === row.dataset.id), [d, tm] = t.value.split('T');
      if (d && !(await confirmLock(f.week, [melbourneToIso(d, tm || '19:00'), ...fixtures.filter(x => x.week === f.week && x.id !== f.id).map(x => x.starts_at)]))) return draw();
      return run('Change a kick-off', async tx => setFx(tx, f, { starts_at: d ? melbourneToIso(d, tm || '19:00') : null }));
    }
  });

  // dragging: a week by its handle onto another week (reorders), or a match onto a week (moves it there)
  let drag = null;
  root.addEventListener('dragstart', e => {
    const g = e.target.closest('[data-drag]');
    if (!g) return;
    drag = g.dataset.drag === 'week' ? { week: Number(g.closest('.fx-week').dataset.week) } : { fx: g.closest('.fx-row').dataset.id };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(drag));
    g.closest(drag.week ? '.fx-week' : '.fx-row').classList.add('is-dragging');
  });
  root.addEventListener('dragend', () => { drag = null; root.querySelectorAll('.is-dragging, .is-over').forEach(x => x.classList.remove('is-dragging', 'is-over')); });
  root.addEventListener('dragover', e => { const card = e.target.closest('.fx-week'); if (!drag || !card) return; e.preventDefault(); root.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over')); card.classList.add('is-over'); });
  root.addEventListener('drop', async e => {
    const card = e.target.closest('.fx-week');
    if (!drag || !card) return;
    e.preventDefault();
    const to = Number(card.dataset.week), d = drag; drag = null; root.querySelectorAll('.is-over, .is-dragging').forEach(x => x.classList.remove('is-over', 'is-dragging'));
    const m = model();
    if (d.week != null) { if (d.week === to) return; return run(`Move week ${d.week} to ${to}'s place`, async tx => moveWeeks(tx, R.mapReorder(m.weeks, d.week, to))); }
    const f = fixtures.find(x => x.id === d.fx);
    if (!f || f.week === to) return;
    return run('Move a match', async tx => { await setFx(tx, f, { week: to, window_id: null }); return fixtures.some(x => x.week === to && [f.home, f.away].some(c => x.home === c || x.away === c)) ? 'A club is now in that week twice. See Checks.' : ''; });
  });

  try {
    await load();
    // "Same as the last week": the blocks the latest week with kick-offs was played in.
    const dated = model().weeks.map(w => fixtures.filter(f => f.week === w && f.starts_at).map(f => f.starts_at)).filter(l => l.length).at(-1);
    lastBlocks = dated ? R.inferBlocks(dated) : null;
    rows = blocksOf(lastBlocks || PATTERNS.saturday[1]);
    if (!lastBlocks) pattern = 'saturday';
    draw();
  } catch (err) { root.innerHTML = `<p class="quiet">${esc(err.message)} <a href="#fixtures">Try again</a></p>`; }
}
