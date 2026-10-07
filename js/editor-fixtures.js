// Editor → Fixtures (0.40): rebuilt around what the office does with a season.
//   Make a season (the rounds and kick-offs, from the clubs), look after a round (teams, kick-offs, postpone, remove,
//   simulate, lock), add the next round, and the Test match. Kick-off times are entered in Melbourne time and stored
//   as an exact instant. The database checks everything again (supabase/migrations/0013, 0014 and 0021). The planning
//   logic lives in js/roster.js.
import { loadSeason } from './dashboard-data.js';
import * as R from './roster.js';
const { melbourneToIso, toLocalInput, addDays, addMinutes, dateOf, timeOf, shiftIso, mondayOf, daysBetween, WEEK_MAX } = R;

const ZONE = R.ZONE;
const whenFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function fixturesView() {
  return '<h1>Fixtures</h1><div id="fx-sim" class="fx-sim" role="status" hidden></div><div id="fx-root"><p class="quiet">Loading fixtures…</p></div>';
}

const TEST_WEEK = 99;   // test matches live here (js/simulate.js); they never count as part of the season
const LOCKS = [[0, 'At the first kick-off'], [30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [10080, '1 week']];
const KINDS = [['regular', 'Regular'], ['special', 'Special'], ['finals', 'Finals']];
const STAGES = [['', 'Regular'], ['SF', 'Semi-final'], ['GF', 'Grand Final']];
// When the games of a round kick off: blocks of games. games 0 = "all the rest".
const PATTERNS = {
  saturday: ['Saturday night', [{ day: 6, time: '19:00', games: 0, gap: 90 }]],
  weekend: ['Saturday and Sunday', [{ day: 6, time: '15:00', games: 3, gap: 100 }, { day: 0, time: '14:00', games: 0, gap: 100 }]],
  fri_sat: ['Friday night and Saturday', [{ day: 5, time: '19:30', games: 1, gap: 90 }, { day: 6, time: '15:00', games: 0, gap: 100 }]],
  midweek: ['Midweek', [{ day: 3, time: '19:30', games: 0, gap: 90 }]],
};
const NEW_COLS = ['numbered', 'number_override', 'note'];   // rounds columns from 0021; left out until that migration is in

const byKick = (a, b) => (a.starts_at || '9').localeCompare(b.starts_at || '9') || a.id.localeCompare(b.id);

export async function mountFixtures(ctx) {
  const root = document.getElementById('fx-root');
  if (!root) return;
  const { esc, explain } = ctx;

  // ---------------------------------------------------------------- state
  let fixtures = [], results = new Map(), rounds = [], looks = [], deadlines = new Map(), sheets = [];
  let busy = false, msg = '', msgKind = '', hasRoster = true, hasLadder = true, hasByes = true;
  const open = new Set();   // rounds the office has opened (the next round to play opens on its own)
  const setOpen = new Set(); let moreOpen = false;   // which round-settings panels and the More menu are open, so a redraw leaves them as they were

  const active = () => ctx.clubs.filter(c => c.status === 'active');
  const codes = () => active().map(c => c.code);
  const name = code => ctx.clubs.find(c => c.code === code)?.name || code;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const lookOpts = sel => opts(looks.map(l => [l.key, l.name]), sel);
  const clubOpts = sel => ctx.clubs.filter(c => c.status === 'active' || c.code === sel).map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const nextMon = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------------------------------------------------------------- loading
  async function load() {
    const c = await ctx.db();
    const [fx, rd, lk, rs, dl, ws] = await Promise.all([
      c.from('fixtures').select('id, week, home, away, starts_at, stage, postponed, window_id').order('week').order('starts_at').range(0, 1999),
      c.from('rounds').select('*').order('week'), c.from('looks').select('key, name').order('name'),
      c.from('results').select('fixture, summary').range(0, 1999), c.from('deadlines').select('week, locks_at, locked_at'), c.from('week_sheets').select('week, club').range(0, 1999),
    ]);
    if (fx.error) throw new Error(explain(fx.error));
    fixtures = fx.data; results = new Map((rs.data || []).map(r => [r.fixture, r.summary])); rounds = rd.data || [];
    looks = lk.data?.length ? lk.data : [{ key: 'classic', name: 'Classic' }];
    deadlines = new Map((dl.data || []).map(d => [d.week, d])); sheets = ws.data || [];
    hasLadder = !(await c.from('rounds').select('counts_for_ladder').limit(1)).error;   // false until 0025_week_ladder.sql is run
    hasRoster = !(await c.from('rounds').select('numbered').limit(1)).error;   // false until 0021_roster_tools.sql is run
    hasByes = !(await c.from('rounds').select('byes').limit(1)).error;   // false until 0028_byes.sql is run
  }

  const real = () => fixtures.filter(f => f.week !== TEST_WEEK);   // the season, without any test match
  const model = () => {
    const weeks = R.weekNumbers(fixtures, rounds), labels = R.roundLabels(weeks, rounds);
    return { weeks, labels, by: new Map(weeks.map(w => [w, fixtures.filter(f => f.week === w).sort(byKick)])) };
  };
  const round = w => ({ week: w, name: null, kind: 'regular', look: 'classic', lock_minutes_before: 180, lock_at_override: null, numbered: true, number_override: null, note: null, counts_for_ladder: true, byes: [], ...(rounds.find(r => r.week === w) || {}) });
  // Who sat out each round: the byes written down, plus any club missing from a round that has matches.
  const byeMap = () => {
    const out = new Map([...R.byeMapOf(rounds)].map(([w, s]) => [w, new Set(s)]));
    for (const w of new Set(real().map(f => f.week))) {
      const playing = new Set(real().filter(f => f.week === w).flatMap(f => [f.home, f.away]));
      const set = out.get(w) || new Set();
      codes().filter(c => !playing.has(c)).forEach(c => set.add(c));
      out.set(w, set);
    }
    return out;
  };
  const isLocked = w => !!deadlines.get(w)?.locked_at;
  const played = list => list.filter(f => results.has(f.id));
  const lastWeek = () => Math.max(0, ...real().map(f => f.week), ...rounds.filter(r => r.week !== TEST_WEEK).map(r => r.week));
  const todo = week => fixtures.filter(f => !f.postponed && !results.has(f.id) && (week == null ? f.week !== TEST_WEEK : f.week === week));

  function lockText(w, list) {
    const first = list.filter(f => f.starts_at && !f.postponed).map(f => f.starts_at).sort()[0], r = round(w), d = deadlines.get(w);
    if (d?.locked_at) return `Line-ups locked ${fullFmt.format(new Date(d.locks_at))}. ${sheets.filter(x => x.week === w).length} of ${active().length} team sheets saved.`;
    if (r.lock_at_override) return `Line-ups lock ${fullFmt.format(new Date(Math.min(+new Date(r.lock_at_override), first ? +new Date(first) : Infinity)))} (set by hand).`;
    return first ? `Line-ups lock ${fullFmt.format(new Date(new Date(first).getTime() - r.lock_minutes_before * 60000))}.` : 'Set a kick-off and the line-up lock time follows.';
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
      box.innerHTML = `<div class="fx-ask-card"><p>${esc(text)}</p><div class="ed-actions">${buttons.map((b, i) => `<button type="button" class="btn small" data-i="${i}">${esc(b)}</button>`).join('')}<button type="button" class="btn ghost small" data-i="-1">Cancel</button></div></div>`;
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
    return !n || (await ask(`${what} removes ${plural(n, 'saved result')} and the match file${n === 1 ? '' : 's'} for good.`, ['Remove and continue'])) === 0;
  }
  const failText = e => {
    const m = String(e?.message || e || '');
    if (/counts_for_ladder/i.test(m)) return 'The table setting needs the database update from 0025_week_ladder.sql. Run it once, then try again.';
    if (/office_unlock_week|schema cache/i.test(m)) return 'This needs the database update from 0022_unlock_week.sql. Run it once, then try again.';
    if (/column .*(numbered|number_override|note)/i.test(m)) return 'Round numbering needs the database update from 0021_roster_tools.sql.';
    return /^[A-Z]/.test(m) && m.length < 220 && !/violates|syntax|relation|permission denied/i.test(m) ? m : explain(e);
  };

  // ---------------------------------------------------------------- one operation: if a step fails, the steps already taken are put back
  async function run(label, fn) {
    if (busy) { notify('Hold on, still working…', 'bad'); return false; }
    busy = true; notify(`${label}…`);
    const tx = { steps: [] };
    let ok = false, err = '', note = '';
    try { note = (await fn(tx)) || ''; ok = true; }
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
    tx.steps.push({ undo: async () => { const u = await undoFn(); if (u?.error) throw u.error; } });
  }
  async function walk(list, size, fn) { for (let i = 0; i < list.length; i += size) { const r = await fn(list.slice(i, i + size)); if (r?.error) return r; } return {}; }
  const insertFx = (tx, list) => list.length ? step(tx,
    async () => walk(list, 100, async part => (await ctx.db()).from('fixtures').insert(part)),
    async () => walk(list, 100, async part => (await ctx.db()).from('fixtures').delete().in('id', part.map(f => f.id)))) : null;
  async function deleteFx(tx, list) {
    if (!list.length) return;
    const dead = played(list);
    if (dead.length) { const sim = await import('./simulate.js'), c = await ctx.db(); for (const f of dead) await sim.removeResult(c, f); }
    const keep = list.map(f => ({ id: f.id, week: f.week, home: f.home, away: f.away, starts_at: f.starts_at, stage: f.stage, postponed: f.postponed }));
    await step(tx, async () => walk(keep, 100, async part => (await ctx.db()).from('fixtures').delete().in('id', part.map(f => f.id))),
      async () => walk(keep, 100, async part => (await ctx.db()).from('fixtures').insert(part)));
  }
  // Teams changing means the old result no longer fits that match, so it goes.
  async function clearResult(f) {
    if (!results.has(f.id)) return;
    await (await import('./simulate.js')).removeResult(await ctx.db(), f);
    results.delete(f.id);
  }
  const setFx = (tx, f, patch) => {
    const prev = Object.fromEntries(Object.keys(patch).map(k => [k, f[k] ?? null]));
    return step(tx, async () => (await ctx.db()).from('fixtures').update(patch).eq('id', f.id), async () => (await ctx.db()).from('fixtures').update(prev).eq('id', f.id));
  };
  const KNOWN = ['week', 'name', 'kind', 'look', 'lock_minutes_before', 'lock_at_override'];
  const roundRow = (w, patch = {}) => { const all = { ...round(w), ...patch, week: w }; return Object.fromEntries(Object.entries(all).filter(([k]) => KNOWN.includes(k) || (hasRoster && NEW_COLS.includes(k)) || (hasLadder && k === 'counts_for_ladder') || (hasByes && k === 'byes'))); };
  function setRound(tx, w, patch) {
    const prev = rounds.find(r => r.week === w), row = roundRow(w, patch);
    return step(tx, async () => (await ctx.db()).from('rounds').upsert(row),
      async () => (prev ? (await ctx.db()).from('rounds').upsert(prev) : (await ctx.db()).from('rounds').delete().eq('week', w)));
  }
  const ensureRound = async (tx, w, patch) => { if (!rounds.some(r => r.week === w) || patch) await setRound(tx, w, patch || {}); };
  const takenIds = () => new Set(fixtures.map(f => f.id));
  const newWeekNumber = () => { const w = lastWeek() + 1; if (w > WEEK_MAX - 1) throw new Error(`There's no room for another round (the limit is ${WEEK_MAX - 1}).`); return w; };

  // A round's line-ups lock at its first kick-off minus the lock rule, and a locked round can never be unlocked. If the
  // kick-offs are in the past that happens within a minute, so ask before doing it.
  function lockPasses(w, isoTimes) {
    if (isLocked(w)) return false;
    const r = round(w), first = isoTimes.filter(Boolean).sort()[0];
    let at = r.lock_at_override ? new Date(r.lock_at_override) : first ? new Date(new Date(first).getTime() - r.lock_minutes_before * 60000) : null;
    if (at && first && at > new Date(first)) at = new Date(first);
    return !!at && at <= new Date();
  }
  async function confirmLock(w, isoTimes) {
    if (!lockPasses(w, isoTimes)) return true;
    return (await ask(`Those kick-offs are in the past, so this round's line-ups would lock within a minute, and a locked round can't be unlocked. Set them anyway?`, ['Set them anyway'])) === 0;
  }

  // ---------------------------------------------------------------- drawing
  function warnings(list) {
    const out = [], count = new Map();
    for (const f of list) for (const c of [f.home, f.away]) count.set(c, (count.get(c) || 0) + 1);
    const twice = [...count].filter(([, n]) => n > 1).map(([c]) => name(c));
    if (twice.length) out.push(`${twice.join(', ')} ${twice.length > 1 ? 'play' : 'plays'} more than once this round.`);
    const none = list.filter(f => !f.starts_at && !f.postponed).length;
    if (none) out.push(`${plural(none, 'match', 'matches')} ${none === 1 ? 'has' : 'have'} no kick-off time.`);
    return out;
  }

  function matchRow(f, r) {
    const res = results.get(f.id), done = !!res;
    return `<div class="fx-row${f.postponed ? ' is-postponed' : ''}" data-id="${esc(f.id)}">
      <span class="fx-teams"><select data-k="home" aria-label="Home club">${clubOpts(f.home)}</select><span>v</span><select data-k="away" aria-label="Away club">${clubOpts(f.away)}</select></span>
      <input type="datetime-local" value="${toLocalInput(f.starts_at)}" aria-label="Kick-off (Melbourne time)">
      ${r.kind === 'finals' ? `<select data-k="stage" aria-label="Stage">${opts(STAGES, f.stage || '')}</select>` : ''}
      <span class="fx-state">${done ? `<b class="fx-score">${res.home}–${res.away}</b>` : f.postponed ? 'Postponed' : ''}</span>
      <span class="fx-btns">
        ${f.postponed ? '' : done ? '<button class="btn ghost small" type="button" data-act="again">Play again</button><button class="btn ghost small" type="button" data-act="unplay">Remove result</button>' : '<button class="btn small" type="button" data-act="sim">Simulate</button>'}
        <button class="btn ghost small" type="button" data-act="postpone">${f.postponed ? 'Restore' : 'Postpone'}</button>
        <button class="btn ghost small" type="button" data-act="del">Remove</button></span></div>`;
  }

  function roundHtml(w, m, nextUp) {
    const list = m.by.get(w), L = m.labels.get(w), r = round(w), locked = isLocked(w), done = played(list).length;
    const times = list.map(f => f.starts_at).filter(Boolean).sort(), first = times[0];
    const span = first ? (dateOf(first) === dateOf(times.at(-1)) ? dayFmt.format(new Date(first)) : `${dayFmt.format(new Date(first))} to ${dayFmt.format(new Date(times.at(-1)))}`) : 'no dates yet';
    const playing = new Set(list.flatMap(f => [f.home, f.away])), resting = active().filter(c => !playing.has(c.code));
    const warn = warnings(list), isOpen = open.has(w) || (nextUp === w && !open.has(-w));
    return `<details class="fx-round${locked ? ' is-locked' : ''}" data-week="${w}" ${isOpen ? 'open' : ''}>
      <summary><b>${esc(L.label)}</b> <span>${esc(span)} · ${list.length ? `${done} of ${list.length} played` : 'no matches'}</span>${locked ? '<span class="ed-pill approved">Locked</span>' : ''}${r.counts_for_ladder === false && w !== TEST_WEEK ? '<span class="ed-pill warn">Not on the table</span>' : ''}</summary>
      <div class="fx-body">
        <p class="fx-lock">${esc(lockText(w, list))}${locked ? ' <button class="btn ghost small" type="button" data-act="unlock">Unlock line-ups</button>' : ''}</p>
        ${list.map(f => matchRow(f, r)).join('') || '<p class="quiet">No matches yet. Add one below.</p>'}
        ${warn.map(t => `<p class="fx-warn">${esc(t)}</p>`).join('')}
        <p class="fx-foot">${resting.length && list.length ? `<span class="fx-rest">Not playing: ${resting.map(c => esc(c.name)).join(', ')}</span>` : ''}
          <button class="btn ghost small" type="button" data-act="add-match">Add a match</button>
          <button class="btn small" type="button" data-act="sim-round" ${todo(w).length ? '' : 'disabled'}>Simulate the round (${todo(w).length})</button></p>
        <details class="fx-set" ${setOpen.has(w) ? 'open' : ''}><summary>Round settings</summary>
          <div class="fx-grid">
            <label>Name <input data-r="name" value="${esc(r.name || '')}" placeholder="Optional, for example Derby Day" maxlength="40"></label>
            <label>Type <select data-r="kind">${opts(KINDS, r.kind)}</select></label>
            <label>Scoreboard look <select data-r="look">${lookOpts(r.look)}</select></label>
            <label>Lock line-ups <select data-r="lock_minutes_before">${opts(LOCKS, r.lock_minutes_before)}</select> before the first match</label>
            <label class="fx-check"><input type="checkbox" data-r="counts_for_ladder" ${r.counts_for_ladder === false ? '' : 'checked'} ${hasLadder ? '' : 'disabled'}> Counts for the table</label>
            <label class="fx-check"><input type="checkbox" data-r="numbered" ${r.numbered ? 'checked' : ''} ${hasRoster ? '' : 'disabled'}> Has a round number</label>
            <label>Move the whole round to <input type="date" data-k="date" value="${esc(first ? dateOf(first) : '')}"></label>
            <span><button class="btn small" type="button" data-act="round-date">Move</button></span>
          </div>
          <div class="ed-actions">${r.lock_at_override ? '<button class="btn ghost small" type="button" data-act="lock-auto">Lock automatically again</button>' : ''}<button class="btn ghost small danger" type="button" data-act="round-delete" ${locked ? 'disabled title="Locked"' : ''}>Delete this round</button></div>
        </details>
      </div></details>`;
  }

  function seasonForm() {
    const clubsNow = active(), free = lastWeek() + 1;
    return `<form class="fx-card" id="fx-gen"><h2>Make a season</h2>
      <p class="ed-hint">Every club plays every other club once, or home and away. ${plural(clubsNow.length, 'active club')}${clubsNow.length % 2 ? ', so one sits out each round' : ''}.${lastWeek() ? ` The new rounds come after round ${free - 1}.` : ''}</p>
      <div class="fx-grid">
        <label>First round starts <input type="date" name="start" value="${nextMon()}" required></label>
        <label>Days between rounds <input type="number" name="every" min="1" max="60" value="7"></label>
        <label>Format <select name="rounds"><option value="1">Everyone plays everyone once</option><option value="2">Home and away</option></select></label>
        <label>Kick-offs <select name="pattern">${opts(Object.entries(PATTERNS).map(([k, v]) => [k, v[0]]), 'saturday')}</select></label>
        <label>Lock line-ups <select name="lock">${opts(LOCKS, 180)}</select> before</label>
        <label>Scoreboard look <select name="look">${lookOpts('classic')}</select></label></div>
      <div class="ed-actions"><button class="btn" ${clubsNow.length < 2 ? 'disabled' : ''}>Create the season</button></div><p class="ed-msg" role="status"></p></form>`;
  }

  function draw() {
    const y = window.scrollY, m = model(), season = real(), weeks = m.weeks.filter(w => w !== TEST_WEEK);
    const nextUp = weeks.find(w => todo(w).length) ?? null;
    const tests = fixtures.filter(f => f.week === TEST_WEEK).length;
    root.innerHTML = `<p class="fx-top"><b>${plural(season.length, 'match', 'matches')}</b> in ${plural(weeks.length, 'round')}, ${played(season).length} played.
        <button class="btn small" type="button" data-act="sim-all" ${todo().length ? '' : 'disabled'}>Simulate all unplayed (${todo().length})</button></p>
      ${hasRoster ? '' : '<p class="fx-warnbar">Round numbering needs the database update <b>0021_roster_tools.sql</b>. Everything else works now.</p>'}
      <p class="ed-msg fx-status" id="fx-msg" role="status" data-kind="${esc(msgKind)}">${esc(msg)}</p>
      ${weeks.length ? '' : seasonForm()}
      ${weeks.map(w => roundHtml(w, m, nextUp)).join('')}
      ${weeks.length ? `<p class="fx-add"><button class="btn" type="button" data-act="next-round">Add the next round</button> <button class="btn ghost" type="button" data-act="empty-round">Add an empty round</button></p>` : ''}
      ${tests ? roundHtml(TEST_WEEK, m, null) : ''}
      <p class="fx-test"><b>Test match</b> <select id="fx-test-look" aria-label="Scoreboard look for the test match"><option value="random">Random look</option>${looks.map(l => `<option value="${esc(l.key)}">${esc(l.name)}</option>`).join('')}</select>
        <button class="btn small" type="button" data-act="test-match" ${busy || codes().length < 2 ? 'disabled' : ''}>Play a test match now</button>
        ${tests ? `<button class="btn ghost small" type="button" data-act="test-clean" ${busy ? 'disabled' : ''}>Remove test matches (${tests})</button>` : ''}
        <span class="ed-hint">Two random clubs with made-up squads play a match that starts live right now. Nothing real changes.</span></p>
      <details class="fx-more" ${moreOpen ? 'open' : ''}><summary>More</summary>
        ${weeks.length ? seasonForm() : ''}
        <div class="fx-card"><h2>Copy or import matches</h2>
          <p class="ed-hint">One match per line: <code>round, home, away, date, time</code> (date like 2026-10-24, time like 19:30, clubs by code or name). Imported matches are added to what is there.</p>
          <div class="ed-actions"><button class="btn ghost small" type="button" data-act="io-export">Copy as CSV</button></div>
          <label>Paste to import <textarea id="fx-import" rows="4" placeholder="3, TUR, LAU, 2026-10-24, 19:30"></textarea></label>
          <div class="ed-actions"><button class="btn small" type="button" data-act="io-import">Import these matches</button></div><p class="ed-msg" id="fx-io-msg" role="status"></p></div>
        <div class="ed-actions"><button class="btn ghost small danger" type="button" data-act="clear-all" ${weeks.length ? '' : 'disabled'}>Delete every round and match</button></div>
      </details>`;
    if (y) window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------- simulate
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
        what.textContent = `${name(f.home)} v ${name(f.away)}${list.length > 1 ? ` (${done + 1} of ${list.length})` : ''}`;
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

  // ---------------------------------------------------------------- test match
  async function testMatch() {
    if (busy) return;
    if ((await ask('Play a made-up test match? Two random clubs get random made-up players, the match is played by the engine and it goes live right now, for anyone watching. No real player, club or table changes, and “Remove test matches” takes it away again.', ['Play it'])) !== 0) return;
    busy = true;
    const panel = document.getElementById('fx-sim'), look = document.getElementById('fx-test-look')?.value || 'random';
    panel.hidden = false;
    panel.innerHTML = `<p class="fx-sim-what">Test match</p><div class="vid-bar"><span></span></div><p class="fx-sim-status"></p><button class="btn ghost small" type="button" disabled>Close</button>`;
    const bar = panel.querySelector('.vid-bar span'), status = panel.querySelector('.fx-sim-status'), close = panel.querySelector('button');
    try {
      const [sim, c] = await Promise.all([import('./simulate.js'), ctx.db()]);
      const r = await sim.startTestMatch(c, ctx.clubs, { look, looks, onStatus: t => { status.textContent = t; }, onProgress: frac => {
        bar.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
        status.textContent = frac < 0.02 ? 'Loading the simulator (the first time takes a moment)…' : `Playing the match… ${Math.round(frac * 100)}%`;
      } });
      bar.style.width = '100%';
      const link = `game.html?id=${encodeURIComponent(r.id)}`;
      status.innerHTML = `${esc(name(r.home.code))} v ${esc(name(r.away.code))} (${esc(looks.find(l => l.key === r.look)?.name || r.look)} look) is live now. <a href="${esc(link)}" target="_blank" rel="noopener">Open the Game centre</a>. It also shows in Matches.`;
    } catch (e) {
      status.textContent = e.message;
    }
    close.disabled = false; close.onclick = () => { panel.hidden = true; };
    busy = false;
    try { await load(); } catch { /* shown below */ }
    draw();
  }
  async function testClean() {
    const n = fixtures.filter(f => f.week === TEST_WEEK).length;
    if (!n || (await ask(`Remove ${n} test match${n === 1 ? '' : 'es'}? They disappear for everyone.`, ['Remove'])) !== 0) return;
    busy = true; draw();
    try { const removed = await (await import('./simulate.js')).removeTestMatches(await ctx.db()); notify(`${removed} test match${removed === 1 ? '' : 'es'} removed.`); }
    catch (e) { notify(e.message, 'bad'); }
    busy = false;
    try { await load(); } catch { /* shown below */ }
    draw();
  }

  // ---------------------------------------------------------------- rounds and matches
  const gap = list => R.inferBlocks(list.map(f => f.starts_at))?.at(-1)?.gap || 90;

  // The next round: paired from the rounds so far (new opponents, fair byes), timed like the last round a week later.
  // Kick-offs that would already be in the past are left blank, so the round doesn't lock before you've set its dates.
  async function nextRound() {
    const m = model(), cs = codes();
    let week; try { week = newWeekNumber(); } catch (err) { return notify(err.message, 'bad'); }
    if (cs.length < 2) return notify('You need at least two active clubs.', 'bad');
    const lastW = m.weeks.filter(w => w !== TEST_WEEK).at(-1), prev = round(lastW || 1);
    const datedLast = lastW ? m.by.get(lastW).map(f => f.starts_at).filter(Boolean) : [];
    const blocks = R.inferBlocks(datedLast) || PATTERNS.saturday[1];
    const base = datedLast.length ? addDays(mondayOf(dateOf(datedLast.sort()[0])), 7) : nextMon();
    const pr = R.pairWeek({ byeWeeks: byeMap(), codes: cs, fixtures: real(), week, seed: Math.floor(Math.random() * 2 ** 31) });
    let placed = R.placeWeek(pr.games, base, blocks);
    const blank = lockPasses(week, placed.map(p => p.at));
    if (blank) placed = placed.map(p => ({ ...p, at: null }));
    return run('Add the next round', async tx => {
      await setRound(tx, week, { name: null, kind: 'regular', look: prev.look, lock_minutes_before: prev.lock_minutes_before, lock_at_override: null, byes: pr.byes, ...(hasRoster ? { numbered: true, number_override: null } : {}) });
      const taken = takenIds();
      await insertFx(tx, placed.map(p => { const id = R.freshId(week, p.h, p.a, taken); taken.add(id); return { id, week, home: p.h, away: p.a, starts_at: p.at }; }));
      return blank && placed.length ? 'Kick-off times are blank because those dates have passed. Set them when you know them.' : '';
    });
  }

  async function addMatchTo(w) {
    const list = model().by.get(w) || [], playing = new Set(list.flatMap(f => [f.home, f.away]));
    const free = active().filter(c => !playing.has(c.code)), pool = free.length >= 2 ? free : active();
    if (pool.length < 2) return notify('You need at least two active clubs.', 'bad');
    const times = list.map(f => f.starts_at).filter(Boolean).sort(), lastT = times.at(-1);
    const at = lastT ? melbourneToIso(dateOf(lastT), addMinutes(timeOf(lastT), gap(list))) : null;
    const [h, a] = [pool[0].code, pool[1].code];
    return run('Add a match', async tx => { await ensureRound(tx, w); await insertFx(tx, [{ id: R.freshId(w, h, a, takenIds()), week: w, home: h, away: a, starts_at: at }]); });
  }

  // ---------------------------------------------------------------- copy and import
  const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  function toCsv() {
    const m = model();
    return ['round,label,home,away,date,time,stage,postponed', ...real().slice().sort((a, b) => a.week - b.week || byKick(a, b)).map(f => [f.week, m.labels.get(f.week).label, f.home, f.away, f.starts_at ? dateOf(f.starts_at) : '', f.starts_at ? timeOf(f.starts_at) : '', f.stage || '', f.postponed ? 'yes' : ''].map(csvCell).join(','))].join('\n');
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
      if (/^(week|round)\b/i.test(line)) return;
      const cells = []; line.replace(/("([^"]|"")*"|[^,]*)(,|$)/g, (_, c) => { cells.push(c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()); return ''; });
      const [wk, h, a, d, t] = cells.length >= 7 ? [cells[0], cells[2], cells[3], cells[4], cells[5]] : cells;   // 7+ columns = our own export
      const week = Number(wk), home = lookup.get(String(h || '').toLowerCase()), away = lookup.get(String(a || '').toLowerCase());
      if (!(week >= 1 && week < WEEK_MAX) || !home || !away || home === away) return bad.push(`Line ${i + 1}: ${line.slice(0, 50)}`);
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
    if (f.id !== 'fx-gen') return;
    try {
      if (btn) btn.disabled = true;
      const first = lastWeek() + 1, every = Number(v.every) || 7, lock = Number(v.lock), look = v.look, plan = R.roundRobin(codes(), v.rounds === '2'), blocks = PATTERNS[v.pattern]?.[1] || PATTERNS.saturday[1];
      if (first + plan.length - 1 >= WEEK_MAX) throw new Error(`That would go past round ${WEEK_MAX - 1}.`);
      await run(`Make ${plural(plan.length, 'round')}`, async tx => {
        for (let w = 0; w < plan.length; w++) {
          const week = first + w, placed = R.placeWeek(plan[w], addDays(v.start, w * every), blocks), taken = takenIds(), playing = new Set(plan[w].flat());
          await setRound(tx, week, { name: null, kind: 'regular', look, lock_minutes_before: lock, lock_at_override: null, byes: codes().filter(c => !playing.has(c)), ...(hasRoster ? { numbered: true, number_override: null } : {}) });
          await insertFx(tx, placed.map(p => { const id = R.freshId(week, p.h, p.a, taken); taken.add(id); return { id, week, home: p.h, away: p.a, starts_at: p.at }; }));
        }
      });
    } catch (err) { say(failText(err)); if (btn) btn.disabled = false; }
  });

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, week = Number(b.closest('[data-week]')?.dataset.week), row = b.closest('.fx-row'), f = row ? fixtures.find(x => x.id === row.dataset.id) : null;
    const m = model(), box = b.closest('.fx-set');
    const val = k => box?.querySelector(`[data-k="${k}"]`)?.value;

    if (act === 'next-round') return nextRound();
    if (act === 'empty-round') return run('Add an empty round', async tx => setRound(tx, newWeekNumber(), { name: null, kind: 'regular' }));
    if (act === 'test-match') return testMatch();
    if (act === 'test-clean') return testClean();
    if (act === 'sim-all') return simulate(todo());
    if (act === 'sim-round') return simulate(todo(week));
    if (act === 'add-match') return addMatchTo(week);
    if (act === 'clear-all') {
      if ((await ask(`Delete all ${fixtures.length} matches, their ${plural(results.size, 'result')} and every round?`, ['Yes, delete everything'])) !== 0) return;
      return run('Delete everything', async tx => {
        await deleteFx(tx, fixtures);
        const rs = rounds.map(r => ({ ...r }));
        if (rs.length) await step(tx, async () => (await ctx.db()).from('rounds').delete().gte('week', 0), async () => (await ctx.db()).from('rounds').upsert(rs));
      });
    }

    // copy and import
    if (act === 'io-export') return copy(toCsv(), t => { document.getElementById('fx-io-msg').textContent = t; });
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

    // simulate and results
    if (act === 'sim') return simulate([f]);
    if (act === 'again') { if ((await ask('Replace its result with a new match?', ['Play it again'])) === 0) return simulate([f]); return; }
    if (act === 'unplay') {
      if ((await ask('Remove this result and its match file?', ['Remove'])) !== 0) return;
      try { await (await import('./simulate.js')).removeResult(await ctx.db(), f); } catch (err) { return notify(err.message, 'bad'); }
      results.delete(f.id); return draw();
    }

    // one match
    if (act === 'postpone') return run(f.postponed ? 'Restore a match' : 'Postpone a match', async tx => setFx(tx, f, { postponed: !f.postponed }));
    if (act === 'del') {
      const n = results.has(f.id);
      if ((await ask(`Remove ${name(f.home)} v ${name(f.away)}${n ? ' and its result' : ''}?`, ['Remove it'])) !== 0) return;
      return run('Remove a match', async tx => deleteFx(tx, [f]));
    }

    // one round
    if (act === 'unlock') {
      if ((await ask(`Unlock ${m.labels.get(week).label}'s line-ups? The saved copies of the club team sheets for this round are dropped, and the lock time is worked out again from its kick-offs. If that time is already in the past it locks again within a minute, so set the kick-offs or the lock time first. This can't be undone, and a round with played matches can't be unlocked.`, ['Unlock it'])) !== 0) return;
      return run(`Unlock ${m.labels.get(week).label}`, async () => { const r = await (await ctx.db()).rpc('office_unlock_week', { p_week: week }); if (r.error) throw r.error; });
    }
    if (act === 'lock-auto') return run('Lock automatically', async tx => setRound(tx, week, { lock_at_override: null }));
    if (act === 'round-date') {
      const d = val('date'), list = m.by.get(week), first = list.map(x => x.starts_at).filter(Boolean).sort()[0];
      if (!d) return notify('Pick a date.', 'bad');
      if (!first) return notify('This round has no kick-off times yet. Set one on a match first.', 'bad');
      const n = daysBetween(dateOf(first), d); if (!n) return;
      if (!(await confirmLock(week, list.map(x => x.starts_at && shiftIso(x.starts_at, n))))) return;
      return run(`Move the round to ${d}`, async tx => { for (const x of list) if (x.starts_at) await setFx(tx, x, { starts_at: shiftIso(x.starts_at, n) }); });
    }
    if (act === 'round-delete') {
      const list = m.by.get(week), n = played(list).length;
      if ((await ask(`Delete ${m.labels.get(week).label} with its ${plural(list.length, 'match', 'matches')}${n ? ` and ${plural(n, 'result')}` : ''}?`, ['Delete the round'])) !== 0) return;
      return run('Delete a round', async tx => {
        await deleteFx(tx, list);
        const prev = rounds.find(r => r.week === week);
        if (prev) await step(tx, async () => (await ctx.db()).from('rounds').delete().eq('week', week), async () => (await ctx.db()).from('rounds').upsert(prev));
      });
    }
  });

  root.addEventListener('toggle', e => {
    const d = e.target;
    if (d.classList?.contains('fx-more')) { moreOpen = d.open; return; }
    if (d.classList?.contains('fx-set')) { const w = Number(d.closest('.fx-round').dataset.week); if (d.open) setOpen.add(w); else setOpen.delete(w); return; }
    if (!d.classList?.contains('fx-round')) return;
    const w = Number(d.dataset.week); if (d.open) { open.add(w); open.delete(-w); } else { open.delete(w); open.add(-w); }   // -w: closed on purpose, even if it is the next one up
  }, true);

  root.addEventListener('change', async e => {
    const t = e.target;
    // round settings: name, type, look, lock rule, table and number
    if (t.dataset.r) {
      const w = Number(t.closest('.fx-round').dataset.week), k = t.dataset.r;
      let value = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'name') value = String(value).trim() || null;
      else if (k === 'lock_minutes_before') value = Number(value);
      return run(`Update the round`, async tx => setRound(tx, w, { [k]: value }));
    }
    const row = t.closest('.fx-row'); if (!row) return;
    const f = fixtures.find(x => x.id === row.dataset.id);
    // a kick-off time
    if (t.type === 'datetime-local') {
      const [d, tm] = t.value.split('T');
      if (d && !(await confirmLock(f.week, [melbourneToIso(d, tm || '19:00'), ...fixtures.filter(x => x.week === f.week && x.id !== f.id).map(x => x.starts_at)]))) return draw();
      return run('Change a kick-off', async tx => setFx(tx, f, { starts_at: d ? melbourneToIso(d, tm || '19:00') : null }));
    }
    // the teams, or the stage of a final
    if (t.dataset.k === 'stage') return run('Set the stage', async tx => setFx(tx, f, { stage: t.value || null }));
    if (t.dataset.k === 'home' || t.dataset.k === 'away') {
      const h = row.querySelector('[data-k="home"]').value, a = row.querySelector('[data-k="away"]').value;
      if (h === a) { notify('Pick two different clubs.', 'bad'); return draw(); }
      if (!(await confirmPlayed([f], 'Changing the teams'))) return draw();
      return run('Change teams', async tx => { await clearResult(f); await setFx(tx, f, { home: h, away: a }); });
    }
  });

  try {
    await load();
    draw();
  } catch (err) { root.innerHTML = `<p class="quiet">${esc(err.message)} <a href="#fixtures">Try again</a></p>`; }
}
