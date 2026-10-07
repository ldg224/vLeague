// Editor -> Draft (0.22): the office's side of the limited-time draft (docs/DRAFT.md, migrations 0023 and 0024).
// Create a draft, set the order, start/pause/resume/extend it, make or skip the pick on the clock, auto-assign the rest
// (with a preview and Undo) and see or change every club's queue and auto-pick rule. The database checks everything again.

const MODES = { always: 'Always (the moment it’s their turn)', on_miss: 'If they miss their turn', after_minutes: 'After a number of minutes', never: 'Never (they pick themselves)' };
const HOWS = { queue: 'From their queue', random: 'A random player' };
const TIMEOUTS = { queue: 'Take the next player in their queue, else a random player who fits', best_value: 'Take the best-value player who fits', skip: 'Pick a random player who fits their open positions' };
const STATUS = { setup: 'Setting up', live: 'Live', paused: 'Paused', done: 'Finished' };
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const localInput = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const isoOf = v => (v ? new Date(v).toISOString() : null);
const when = iso => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'no limit');
const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const minutesText = m => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

const POS = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const shuffle = a => a.map(x => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]);

let selected = null, undoFrom = null, timer = null;
// Active times (0.28): the schedule of quiet times, when the pick timer doesn't run. Days run Monday first.
const QDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const OVERNIGHT = { days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '07:00' };

import { gridOf, renderGrid, moveColumn } from './draft-grid.js';

export const draftView = () => '<h1>Draft</h1><div id="dr-root"><p class="quiet">Loading…</p></div>';

// ctx: { db, esc, explain, clubs (the Editor's clubs) }
export async function mountDraft(ctx) {
  const root = document.getElementById('dr-root');
  if (!root) return;
  const { esc, explain } = ctx;
  const client = await ctx.db();
  const active = ctx.clubs.filter(c => c.status !== 'withdrawn');
  const cname = code => { const c = ctx.clubs.find(x => x.code === code); return c?.short_name || c?.name || code || '?'; };
  let S = null, msg = '', preview = null, qWork = null, qOpen = false;

  const need = r => { if (r.error) throw new Error(explain(r.error)); return r.data || []; };

  async function load() {
    const drafts = need(await client.from('drafts').select('*').order('id', { ascending: false }));
    const d = drafts.find(x => x.id === selected) || drafts.find(x => x.status !== 'done') || drafts[0] || null;
    selected = d?.id ?? null;
    if (!d) return { drafts, d: null, order: [], picks: [], queue: [], prefs: [], players: [], qs: null };
    const [order, picks, queue, prefs, players] = await Promise.all([
      client.from('draft_order').select('pick_no, club').eq('draft', d.id).order('pick_no'),
      client.from('draft_picks').select('pick_no, club, player, made_at, how').eq('draft', d.id).order('pick_no'),
      client.from('draft_queue').select('club, player, rank').eq('draft', d.id).order('rank'),
      client.from('draft_prefs').select('club, mode, minutes').eq('draft', d.id),
      client.from('players').select('id, name, position, club, value').order('id').range(0, 1999),
    ]);
    let qs = null;   // how the clock stands: in quiet time?, when's the next, and how much active time is left
    if (d.quiet?.length) { const r = await client.rpc('draft_quiet_state', { p_draft: d.id }); if (!r.error && r.data) qs = { ...r.data, at: Date.now() }; }
    return { drafts, d, order: need(order), picks: need(picks), queue: need(queue), prefs: need(prefs), players: need(players), qs };
  }

  const pname = new Map();
  const nameOf = id => pname.get(id) || '?';
  const turn = () => S.order.find(o => o.pick_no === S.d.current_pick) || null;
  const free = () => S.players.filter(p => !p.club);

  // The clubs in the current first round (so "keep the order" really keeps it), else every active club.
  const firstRound = () => {
    const codes = active.map(c => c.code), first = S.order.slice(0, codes.length).map(o => o.club);
    return first.length === codes.length && codes.every(c => first.includes(c)) ? first : codes;
  };
  const teamValue = code => S.players.filter(p => p.club === code).reduce((n, p) => n + (p.value || 0), 0);
  const baseFor = kind => {
    const base = firstRound();
    if (kind === 'random') return shuffle(base);
    if (kind === 'low') return [...base].sort((a, b) => teamValue(a) - teamValue(b) || (cname(a) < cname(b) ? -1 : 1));
    if (kind === 'high') return [...base].sort((a, b) => teamValue(b) - teamValue(a) || (cname(a) < cname(b) ? -1 : 1));
    if (kind === 'alpha') return [...base].sort((a, b) => (cname(a) < cname(b) ? -1 : 1));
    return base;
  };
  // One round per `rounds`; a snake flips every other round.
  function sequence(rounds, snake, base) {
    const out = [];
    for (let r = 0; r < rounds; r++) out.push(...(snake && r % 2 ? [...base].reverse() : base));
    return out;
  }
  const made = () => (S.d.status === 'setup' ? 0 : S.d.current_pick - 1);
  const madeClubs = () => S.order.filter(o => o.pick_no <= made()).map(o => o.club);
  const restClubs = () => S.order.filter(o => o.pick_no > made()).map(o => o.club);

  // Roster rules as two small tables of numbers: fewest and most of each position a club may hold.
  const rulesFields = d => `<fieldset class="dr-rules"><legend>Roster rules per club <i>optional, leave blank for no limit</i></legend>
    <div class="dr-rgrid"><span></span><b>Fewest</b><b>Most</b>${Object.entries(POS).map(([k, l]) => `<span>${l}</span>
      <input name="min_${k}" type="number" min="0" max="50" value="${esc(d?.roster_min?.[k] ?? '')}" aria-label="Fewest ${l}">
      <input name="max_${k}" type="number" min="0" max="50" value="${esc(d?.roster_max?.[k] ?? '')}" aria-label="Most ${l}">`).join('')}</div></fieldset>`;
  function readRules(f, rounds) {
    const roster_min = {}, roster_max = {};
    for (const k of Object.keys(POS)) {
      const lo = f[`min_${k}`].value.trim(), hi = f[`max_${k}`].value.trim();
      if (lo !== '') roster_min[k] = Math.round(+lo);
      if (hi !== '') roster_max[k] = Math.round(+hi);
      if (roster_min[k] != null && roster_max[k] != null && roster_min[k] > roster_max[k]) throw new Error(`${POS[k]}: the fewest can't be more than the most.`);
    }
    const sumMin = Object.values(roster_min).reduce((a, b) => a + b, 0), sumMax = Object.keys(POS).reduce((a, k) => a + (roster_max[k] ?? Infinity), 0);
    if (sumMin > rounds) throw new Error(`The fewest per position add up to ${sumMin}, but a club only gets ${rounds} pick${rounds === 1 ? '' : 's'}. Add rounds or lower the fewest.`);
    if (sumMax < rounds) throw new Error(`The most per position add up to only ${sumMax}, fewer than the ${rounds} picks a club gets. Raise the most or lower the rounds.`);
    return { roster_min, roster_max };
  }
  const rulesLine = d => {
    const parts = Object.entries(POS).map(([k, l]) => { const lo = d.roster_min?.[k], hi = d.roster_max?.[k];
      return lo == null && hi == null ? '' : `${l.toLowerCase()} ${lo != null && hi != null ? (lo === hi ? lo : `${lo} to ${hi}`) : hi != null ? `up to ${hi}` : `at least ${lo}`}`; }).filter(Boolean);
    return parts.length ? parts.join(', ') : 'no position limits';
  };
  // Mirror of the database rule (0026), used for the auto-assign preview.
  function allowed(d, have, p, clubCode, picksAfter) {
    const mx = d.roster_max?.[p.position];
    if (mx != null && (have[p.position] || 0) >= mx) return false;
    const needed = Object.entries(d.roster_min || {}).reduce((n, [k, mn]) => n + Math.max(0, mn - (have[k] || 0) - (k === p.position ? 1 : 0)), 0);
    return needed <= picksAfter;
  }

  const bar = () => {
    const d = S.d, t = turn();
    return `<section class="ed-invite dr-live"><div class="dr-top">
      <div><h2>${esc(d.name)} <span class="ed-pill ${d.status === 'live' ? 'approved' : d.status === 'paused' ? 'warn' : ''}">${STATUS[d.status]}</span></h2>
        <p class="ed-hint">Open ${esc(when(d.opens_at))} to ${esc(when(d.closes_at))} · ${esc(minutesText(d.pick_minutes))} a pick · ${d.rounds} round${d.rounds === 1 ? '' : 's'} · ${S.order.length} picks · when time runs out: ${esc(TIMEOUTS[d.on_timeout].toLowerCase())}<br>Roster rules: ${esc(rulesLine(d))}</p></div>
      ${d.status === 'live' && t ? `<div class="dr-clock">${esc(cname(t.club))} on the clock<b class="dr-count" data-deadline="${esc(d.pick_deadline || '')}"></b><small>Pick ${d.current_pick} of ${S.order.length}</small></div>`
        : d.status === 'paused' && t ? `<div class="dr-clock">Paused<small>${esc(cname(t.club))} is up, pick ${d.current_pick} of ${S.order.length}</small></div>` : ''}</div>
      <div class="ed-actions">
        ${d.status === 'setup' ? '<button class="btn" data-act="start">Start the draft</button>' : ''}
        ${d.status === 'live' ? '<button class="btn ghost" data-act="pause">Pause</button>' : ''}
        ${d.status === 'paused' ? '<button class="btn" data-act="resume">Resume</button>' : ''}
        ${d.status === 'live' ? `<button class="btn ghost" data-act="extend">Extend by</button><input class="dr-ext" type="number" min="1" value="60" aria-label="Minutes to add"> minutes` : ''}
        ${['live', 'paused'].includes(d.status) ? '<button class="btn ghost" data-act="skip" title="Picks a random free player who fits the club’s open positions">Random pick for them</button>' : ''}
        ${S.picks.length ? '<button class="btn ghost" data-act="undo">Undo last pick</button>' : ''}
        ${d.status !== 'setup' ? '<button class="btn ghost" data-act="reset">Reset to set-up</button>' : ''}
        ${['live', 'paused'].includes(d.status) ? '<button class="btn ghost" data-act="finish">Finish now</button>' : ''}
        <button class="btn ghost" data-act="duplicate">Duplicate</button>
        <button class="btn ghost danger" data-act="delete">Delete draft</button></div>
      <p class="ed-msg" role="status">${esc(msg)}</p></section>`;
  };

  const onClock = () => {
    const d = S.d, t = turn();
    if (!t || !['live', 'paused'].includes(d.status)) return '';
    const list = free().sort((a, b) => b.value - a.value).slice(0, 400);
    return `<section class="ed-invite"><h2>Pick for ${esc(cname(t.club))} <small>(override: ignores the roster rules)</small></h2>
      <p class="ed-hint">Use this to make or override the pick on the clock. The player joins ${esc(cname(t.club))} straight away.</p>
      <div class="ed-actions"><select class="dr-pl" aria-label="Player">${list.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.position)} · ${money(p.value)}</option>`).join('')}</select>
        <button class="btn" data-act="makepick">Pick this player</button></div></section>`;
  };

  const clubSelect = (attrs, sel) => `<select ${attrs}>${active.map(c => `<option value="${esc(c.code)}"${c.code === sel ? ' selected' : ''}>${esc(c.short_name || c.name)}</option>`).join('')}</select>`;

  // The order as a grid: drag an unmade pick onto another to swap them (or press one, then press the other). Before
  // any pick is made the club columns can be dragged too, which moves a club's place in every round.
  let gridSel = null;
  const orderGrid = () => {
    const m = made(), map = new Map(S.players.map(p => [p.id, p]));
    return `<p class="dg-hint">${m ? 'Made picks are fixed.' : 'Drag a column heading to change a club’s draft position.'} Drag any unmade pick onto another to swap them, or press one and then the other.</p>${renderGrid(gridOf(S.order, S.picks), {
      esc, clubName: cname, editable: true, made: m, current: S.d.status === 'done' ? null : S.d.current_pick, selected: gridSel,
      who: x => { const p = map.get(x.pick?.player); return p ? `${esc(p.name)} <small>${esc(p.position)}</small>` : '<i>skipped</i>'; },
    })}`;
  };

  const orderPanel = () => {
    const d = S.d, m = made(), rest = S.order.filter(o => o.pick_no > m);
    const last = rest.length ? rest[rest.length - 1].pick_no : m;
    return `<section class="ed-invite"><h2>Draft order</h2>${orderGrid()}
      <form class="dr-build" novalidate>
        <div class="ed-fields"><label>Rounds<input name="rounds" type="number" min="1" max="50" value="${d.rounds}"></label>
          <label>Order<select name="snake"><option value="1">Snake (reverses each round)</option><option value="0">Same order every round</option></select></label>
          <label>First round<select name="first"><option value="keep">Keep the current order</option><option value="random">Shuffle the clubs</option>
            <option value="low">Lowest team value first</option><option value="high">Highest team value first</option><option value="alpha">A to Z</option></select></label></div>
        <div class="ed-actions"><button class="btn ghost" type="submit">${rest.length ? 'Rebuild the unmade picks' : 'Build the order'}</button></div>
        <p class="ed-hint">${m ? `Picks 1 to ${m} are made and stay as they are.` : 'Replaces the whole order.'} Use the tools below to change single picks.</p></form>
      ${rest.length ? `<details class="dr-tools"><summary>Order tools</summary>
        <div class="dr-toolgrid">
          <form class="dr-swap" novalidate><b>Swap two picks</b><div class="ed-actions"><input name="a" type="number" min="${m + 1}" max="${last}" placeholder="Pick" aria-label="First pick"><input name="b" type="number" min="${m + 1}" max="${last}" placeholder="Pick" aria-label="Second pick"><button class="btn ghost small" type="submit">Swap</button></div></form>
          <form class="dr-move" novalidate><b>Move a pick</b><div class="ed-actions"><input name="from" type="number" min="${m + 1}" max="${last}" placeholder="From" aria-label="Move from pick"><input name="to" type="number" min="${m + 1}" max="${last}" placeholder="To" aria-label="Move to pick"><button class="btn ghost small" type="submit">Move</button></div><small>The picks in between shift along.</small></form>
          <form class="dr-insert" novalidate><b>Add an extra pick</b><div class="ed-actions">${clubSelect('name="club" aria-label="Club"', active[0]?.code)}<input name="at" type="number" min="${m + 1}" max="${last + 1}" placeholder="At pick" aria-label="At pick number"><button class="btn ghost small" type="submit">Add</button></div><small>Later picks move down one.</small></form>
          <div><b>Whole order</b><div class="ed-actions"><button class="btn ghost small" data-act="reverse">Reverse</button><button class="btn ghost small" data-act="shuffle">Shuffle</button>
            <input class="dr-rot" type="number" value="1" aria-label="Rotate by"><button class="btn ghost small" data-act="rotate">Rotate by</button></div><small>These change only the ${rest.length} unmade pick${rest.length === 1 ? '' : 's'}.</small></div>
        </div></details>
        <ol class="dr-order" start="${rest[0].pick_no}">${rest.map((o, i) => `<li><span>Pick ${o.pick_no}</span>${clubSelect(`data-pickno="${o.pick_no}" aria-label="Club for pick ${o.pick_no}"`, o.club)}
          <button class="dr-b" data-act="rowup" data-no="${o.pick_no}" aria-label="Move pick ${o.pick_no} up"${i ? '' : ' disabled'}>▲</button><button class="dr-b" data-act="rowdown" data-no="${o.pick_no}" aria-label="Move pick ${o.pick_no} down"${i < rest.length - 1 ? '' : ' disabled'}>▼</button><button class="dr-b" data-act="rowdel" data-no="${o.pick_no}" aria-label="Remove pick ${o.pick_no}">✕</button></li>`).join('')}</ol>` : ''}
    </section>`;
  };

  const settingsPanel = () => {
    const d = S.d;
    return `<details class="ed-invite dr-settings"><summary><b>Draft settings</b> <small>name, dates, pick time, roster rules</small></summary>
      <form class="dr-set" novalidate>
        <div class="ed-fields"><label>Name<input name="name" maxlength="60" value="${esc(d.name)}"></label>
          <label>Opens <i>optional</i><input name="opens" type="datetime-local" value="${esc(localInput(d.opens_at))}"></label>
          <label>Closes <i>optional</i><input name="closes" type="datetime-local" value="${esc(localInput(d.closes_at))}"></label></div>
        <div class="ed-fields"><label>Time for each pick (hours)<input name="hours" type="number" min="0.02" max="336" step="any" value="${d.pick_minutes / 60}"></label>
          <label>When time runs out<select name="timeout">${Object.entries(TIMEOUTS).map(([k, v]) => `<option value="${k}"${k === d.on_timeout ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
        ${rulesFields(d)}
        <div class="ed-actions"><button class="btn" type="submit">Save settings</button></div>
        <p class="ed-hint">Rules apply to managers’ picks and every automatic pick. Your own overrides ignore them. They don’t change players already picked.</p></form></details>`;
  };

  // Active times: when the pick timer runs. Quiet times are the gaps; a manager can still pick in them.
  const quietPanel = () => {
    const d = S.d;
    if (!Array.isArray(d.quiet)) return '<p class="ed-hint">Active times need the database update 0029_draft_active_times.sql. Run it once.</p>';
    const rows = qWork || d.quiet, qs = S.qs;
    const state = !d.quiet.length ? 'The timer runs all the time.'
      : qs?.quiet_until ? `Quiet right now: the timer is paused until ${esc(when(qs.quiet_until))}.`
      : qs?.next_quiet ? `The timer is running. The next quiet time starts ${esc(when(qs.next_quiet))}.` : 'The timer is running.';
    return `<details class="ed-invite dr-settings dr-quietbox"${qOpen || qWork ? ' open' : ''}><summary><b>Active times</b> <small>${d.quiet.length ? `${d.quiet.length} quiet time${d.quiet.length === 1 ? '' : 's'} set` : 'the timer runs all the time'}</small></summary>
      <p class="ed-hint">Add quiet times when the pick timer <b>doesn’t run</b>, for example overnight. Nobody is locked out: managers and you can still pick, and the draft keeps working. Only the countdown stops, so a pick that starts at 3 am gets its full time counted from when the quiet time ends. Melbourne time.</p>
      <div class="dr-qrows">${rows.map((w, i) => `<div class="dr-qrow" data-i="${i}">
        <span class="dr-qdays" role="group" aria-label="Days this quiet time starts">${QDAYS.map(([v, l]) => `<label><input type="checkbox" value="${v}"${w.days.includes(v) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</span>
        <label>From <input type="time" name="from" value="${esc(w.from)}"></label><label>Until <input type="time" name="to" value="${esc(w.to)}"></label>
        <button class="dr-b" type="button" data-act="q-del" data-i="${i}" aria-label="Remove this quiet time">✕</button></div>`).join('') || '<p class="quiet">No quiet times.</p>'}</div>
      <p class="ed-hint">A time that ends before it starts (like 10:00 pm until 7:00 am) runs overnight. The days are the days it starts on.</p>
      <div class="ed-actions"><button class="btn ghost small" type="button" data-act="q-add">+ Add a quiet time</button>
        <button class="btn ghost small" type="button" data-act="q-night">Every night, 10 pm to 7 am</button>
        <button class="btn" type="button" data-act="q-save">Save active times</button>${rows.length ? '<button class="btn ghost" type="button" data-act="q-clear">Remove all</button>' : ''}</div>
      <p class="ed-hint">${state}${d.status === 'live' ? ' Saving keeps the active time the current pick had left.' : ''}</p></details>`;
  };

  const autoPanel = () => {
    const d = S.d;
    if (!['live', 'paused'].includes(d.status)) return '';
    const rest = S.order.filter(o => o.pick_no >= d.current_pick);
    if (preview) return `<section class="ed-invite"><h2>Auto-assign the rest: preview</h2>
      <p class="ed-hint">Best value first, in draft order. Nothing is saved until you confirm. You can undo it afterwards.</p>
      <div class="pl-scroll"><table class="pl-table"><thead><tr><th>Pick</th><th>Club</th><th>Player</th><th>Value</th></tr></thead><tbody>${preview.map(r =>
        `<tr><td>${r.pick_no}</td><td>${esc(cname(r.club))}</td><td>${r.p ? esc(r.p.name) + ' · ' + esc(r.p.position) : '<i>skipped (nobody left who fits the rules)</i>'}</td><td>${r.p ? money(r.p.value) : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="ed-actions"><button class="btn" data-act="autofill">Assign ${preview.length} pick${preview.length === 1 ? '' : 's'}</button><button class="btn ghost" data-act="nopreview">Cancel</button></div></section>`;
    return `<section class="ed-invite"><h2>Auto-assign the rest</h2>
      <p class="ed-hint">Fills the ${rest.length} remaining pick${rest.length === 1 ? '' : 's'} with the best-value free players. ${free().length} free player${free().length === 1 ? '' : 's'} left.</p>
      <div class="ed-actions"><button class="btn ghost" data-act="preview"${rest.length ? '' : ' disabled'}>Preview</button>
        ${undoFrom && undoFrom < d.current_pick ? `<button class="btn ghost" data-act="undoauto">Undo auto-assign (back to pick ${undoFrom})</button>` : ''}</div></section>`;
  };

  const boardPanel = () => {
    const recent = [...S.picks].reverse().slice(0, 12);
    return `<section class="ed-invite"><h2>Recent picks</h2>${recent.length ? `<ul class="dr-recent">${recent.map(k =>
      `<li><b>${k.pick_no}.</b> ${esc(cname(k.club))}: ${k.player ? esc(nameOf(k.player)) : '<i>skipped</i>'} <small>${esc(k.how)} · ${esc(when(k.made_at))}</small></li>`).join('')}</ul>` : '<p class="quiet">No picks yet.</p>'}</section>`;
  };

  const clubsPanel = () => `<section class="ed-invite"><h2>Clubs’ queues and auto-pick</h2>
    <p class="ed-hint">What each manager has set. You can change a club’s rule, or take a player out of its queue.</p>
    ${active.map(c => {
      const pr = S.prefs.find(p => p.club === c.code) || { mode: 'on_miss', minutes: null, pick_how: 'queue' }, how = pr.pick_how || 'queue';
      const q = S.queue.filter(x => x.club === c.code).sort((a, b) => a.rank - b.rank);
      return `<details class="dr-team"><summary><b>${esc(c.short_name || c.name)}</b><span>${esc(pr.mode === 'never' ? 'Picks themselves' : HOWS[how] + ': ' + MODES[pr.mode].split(' (')[0].toLowerCase())} · ${q.length} queued</span></summary>
        <div class="dr-club"><label>Pick<select data-how="${esc(c.code)}">${Object.entries(HOWS).map(([k, v]) => `<option value="${k}"${k === how ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label>When<select data-pref="${esc(c.code)}">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${k === pr.mode ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label ${pr.mode === 'after_minutes' ? '' : 'hidden'}>Minutes<input type="number" min="1" max="20160" value="${pr.minutes || ''}" data-prefmin="${esc(c.code)}"></label>
          ${q.length ? `<ol class="dr-q">${q.map(x => `<li>${esc(nameOf(x.player))}${S.players.find(p => p.id === x.player)?.club ? ' <i>(taken)</i>' : ''} <button class="dr-b" data-act="unqueue" data-club="${esc(c.code)}" data-player="${esc(x.player)}">Remove</button></li>`).join('')}</ol>` : '<p class="quiet">Nothing queued.</p>'}</div></details>`;
    }).join('')}</section>`;

  const newForm = () => `<section class="ed-invite"><h2>${S?.d ? 'Start another draft' : 'Create a draft'}</h2>
    <form class="dr-new" novalidate>
      <div class="ed-fields"><label>Name<input name="name" maxlength="60" required placeholder="Season 1 draft" value="${S?.d ? '' : 'Season 1 draft'}"></label>
        <label>Opens <i>optional</i><input name="opens" type="datetime-local"></label>
        <label>Closes <i>optional</i><input name="closes" type="datetime-local"></label></div>
      <div class="ed-fields"><label>Time for each pick (hours)<input name="hours" type="number" min="0.02" max="336" step="any" value="12"></label>
        <label>Rounds (picks per club)<input name="rounds" type="number" min="1" max="50" value="${Math.max(1, Math.ceil(16 / Math.max(active.length, 1)) || 1)}"></label>
        <label>When time runs out<select name="timeout">${Object.entries(TIMEOUTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div>
      <label class="dr-check"><input type="checkbox" name="snake" checked> Snake order (reverses every round)</label>
      ${rulesFields(null)}
      <div class="ed-actions"><button class="btn" type="submit">Create draft</button></div>
      <p class="ed-hint">It starts in set-up: nothing is visible to managers until you press Start. Players are drawn from the free agents (${S ? free().length : '…'} now).</p></form></section>`;

  const picker = () => (S.drafts.length > 1 ? `<label class="dr-sel">Draft <select data-select>${S.drafts.map(x => `<option value="${x.id}"${x.id === selected ? ' selected' : ''}>${esc(x.name)} (${STATUS[x.status]})</option>`).join('')}</select></label>` : '');

  function draw() {
    const qb = root.querySelector('.dr-quietbox'); if (qb) qOpen = qb.open;
    S.players.forEach(p => pname.set(p.id, p.name));
    root.innerHTML = `<div class="dr-ed">${picker()}${S.d ? bar() + onClock() + autoPanel() + orderPanel() + settingsPanel() + quietPanel() + boardPanel() + clubsPanel() : ''}${newForm()}</div>`;
    tick();
  }
  function tick() {
    root.querySelectorAll('.dr-count').forEach(el => {
      const at = el.dataset.deadline ? new Date(el.dataset.deadline) : null, q = S.qs;
      if (!at) { el.textContent = ''; return; }
      if (q?.active_left == null) { el.textContent = left(at - Date.now()); return; }   // no quiet times: the plain countdown
      const paused = !!q.quiet_until && Date.now() < new Date(q.quiet_until);
      el.textContent = left(paused ? q.active_left * 1000 : Math.max(0, q.active_left * 1000 - (Date.now() - q.at))) + (paused ? ' ⏸' : '');
    });
  }

  async function refresh(note) {
    if (note !== undefined) msg = note;
    try { S = await load(); draw(); } catch (e) { root.innerHTML = `<p class="quiet">${esc(e.message || 'The draft didn’t load.')} If this is new, run migrations 0023 and 0024 first.</p>`; }
  }
  async function run(fn, ok) {
    try { await fn(); await refresh(ok); } catch (e) { msg = e.message || String(e); draw(); }
  }
  const rpc = async (name, args) => { const r = await client.rpc(name, args); if (r.error) throw new Error(explain(r.error)); return r.data; };
  const write = async q => { const r = await q; if (r.error) throw new Error(explain(r.error)); return r; };

  async function saveRest(arr) { await writeOrder(S.d.id, made() + 1, [...madeClubs(), ...arr]); }
  async function writeOrder(draftId, startPick, seq) {
    await write(client.from('draft_order').delete().eq('draft', draftId).gte('pick_no', startPick));
    const rows = seq.slice(startPick - 1).map((club, i) => ({ draft: draftId, pick_no: startPick + i, club }));
    if (rows.length) await write(client.from('draft_order').insert(rows));
  }

  const readQuiet = () => [...root.querySelectorAll('.dr-qrow')].map(r => ({
    days: [...r.querySelectorAll('input[type=checkbox]:checked')].map(c => +c.value).sort(), from: r.querySelector('[name=from]').value, to: r.querySelector('[name=to]').value }));

  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('.dr-new')) run(async () => {
      const name = f.name.value.trim(), rounds = Math.round(+f.rounds.value), mins = Math.round(+f.hours.value * 60);
      if (name.length < 2) throw new Error('Give the draft a name.');
      if (!active.length) throw new Error('There are no clubs to draft for.');
      if (!(mins >= 1)) throw new Error('Give each pick some time.');
      const rules = readRules(f, rounds);
      const row = (await write(client.from('drafts').insert({ name, opens_at: isoOf(f.opens.value), closes_at: isoOf(f.closes.value), pick_minutes: mins, rounds,
        on_timeout: f.timeout.value, ...rules }).select('id').single())).data;
      await writeOrder(row.id, 1, sequence(rounds, f.snake.checked, active.map(c => c.code)));
      selected = row.id; undoFrom = null;
    }, 'Draft created. Check the order, then press Start.');
    if (f.matches('.dr-set')) run(async () => {
      const d = S.d, name = f.name.value.trim(), mins = Math.round(+f.hours.value * 60);
      if (name.length < 2) throw new Error('Give the draft a name.');
      if (!(mins >= 1)) throw new Error('Give each pick some time.');
      const rules = readRules(f, d.rounds);
      await write(client.from('drafts').update({ name, opens_at: isoOf(f.opens.value), closes_at: isoOf(f.closes.value), pick_minutes: mins, on_timeout: f.timeout.value, ...rules }).eq('id', d.id));
    }, 'Settings saved.');
    if (f.matches('.dr-build')) run(async () => {
      const d = S.d, m = made(), rounds = Math.round(+f.rounds.value);
      if (!(rounds >= 1)) throw new Error('Rounds must be at least 1.');
      const seq = sequence(rounds, f.snake.value === '1', baseFor(f.first.value));
      if (m >= seq.length) throw new Error('That many rounds is fewer than the picks already made.');
      seq.splice(0, m, ...madeClubs());   // made picks keep their clubs
      await write(client.from('drafts').update({ rounds }).eq('id', d.id));
      await writeOrder(d.id, m + 1, seq);
    }, 'Order saved.');
    const num = n => Math.round(+n);
    const idx = no => no - made() - 1;   // a pick number's place among the unmade picks
    const check = (...nos) => { for (const no of nos) if (!(idx(no) >= 0 && idx(no) < restClubs().length)) throw new Error(`Pick ${no || '?'} isn’t one of the unmade picks.`); };
    if (f.matches('.dr-swap')) run(async () => {
      const a = num(f.a.value), b = num(f.b.value); check(a, b);
      const arr = restClubs(); [arr[idx(a)], arr[idx(b)]] = [arr[idx(b)], arr[idx(a)]];
      await saveRest(arr);
    }, 'Picks swapped.');
    if (f.matches('.dr-move')) run(async () => {
      const a = num(f.from.value), b = num(f.to.value); check(a, b);
      const arr = restClubs(); const [x] = arr.splice(idx(a), 1); arr.splice(idx(b), 0, x);
      await saveRest(arr);
    }, 'Pick moved.');
    if (f.matches('.dr-insert')) run(async () => {
      const at = num(f.at.value), arr = restClubs();
      if (!(at >= made() + 1 && at <= made() + arr.length + 1)) throw new Error('Choose a pick number among the unmade picks, or the one after the last.');
      arr.splice(idx(at), 0, f.club.value);
      await saveRest(arr);
    }, 'Extra pick added.');
  });

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-select]')) { selected = +t.value; undoFrom = null; preview = null; msg = ''; refresh(); }
    else if (t.dataset.pickno) run(() => write(client.from('draft_order').update({ club: t.value }).eq('draft', S.d.id).eq('pick_no', +t.dataset.pickno)), `Pick ${t.dataset.pickno} is now ${cname(t.value)}’s.`);
    else if (t.dataset.pref || t.dataset.prefmin || t.dataset.how) {
      const code = t.dataset.pref || t.dataset.prefmin || t.dataset.how, box = root.querySelector(`[data-pref="${CSS.escape(code)}"]`), mode = box.value;
      const mins = mode === 'after_minutes' ? Math.round(+root.querySelector(`[data-prefmin="${CSS.escape(code)}"]`).value) || null : null;
      if (mode === 'after_minutes' && !mins) { root.querySelector(`[data-prefmin="${CSS.escape(code)}"]`).closest('label').hidden = false; return; }
      run(() => write(client.from('draft_prefs').upsert({ draft: S.d.id, club: code, mode, minutes: mins, pick_how: root.querySelector(`[data-how="${CSS.escape(code)}"]`).value }, { onConflict: 'draft,club' })), `${cname(code)}’s auto-pick is saved.`);
    }
  });

  async function swapPicks(a, b) {
    const m = made();
    if (a === b || a <= m || b <= m) return;
    const arr = restClubs(), i = a - m - 1, j = b - m - 1;
    if (!(i in arr) || !(j in arr)) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    gridSel = null;
    await run(() => saveRest(arr), `Picks ${a} and ${b} swapped.`);
  }
  async function moveCol(from, to) {
    const cols = gridOf(S.order, S.picks).cols;
    if (made() || from === to || !(from in cols) || !(to in cols)) return;
    const map = moveColumn(cols, from, to);
    await run(() => saveRest(restClubs().map(c => map[c] ?? c)), `${cname(cols[from])} moved to position ${to + 1}.`);
  }
  let dragged = null;
  root.addEventListener('dragstart', e => {
    const p = e.target.closest?.('.dg-pick[data-no]'), c = e.target.closest?.('.dg-col[data-col]');
    dragged = p ? { pick: +p.dataset.no } : c ? { col: +c.dataset.i } : null;
    if (dragged) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(dragged)); }
  });
  root.addEventListener('dragover', e => {
    const over = dragged?.pick != null ? e.target.closest?.('.dg-pick.drag') : dragged?.col != null ? e.target.closest?.('.dg-col[data-col]') : null;
    root.querySelectorAll('.over').forEach(x => { if (x !== over) x.classList.remove('over'); });
    if (over) { e.preventDefault(); over.classList.add('over'); }
  });
  root.addEventListener('dragend', () => { dragged = null; root.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  root.addEventListener('drop', e => {
    const d = dragged; dragged = null;
    if (!d) return;
    if (d.pick != null) { const t = e.target.closest?.('.dg-pick.drag'); if (t) { e.preventDefault(); swapPicks(d.pick, +t.dataset.no); } }
    else { const t = e.target.closest?.('.dg-col[data-col]'); if (t) { e.preventDefault(); moveCol(d.col, +t.dataset.i); } }
  });
  // Without a mouse (phones, keyboards): press a pick to select it, press another to swap.
  root.addEventListener('click', e => {
    const p = e.target.closest?.('.dg-pick.drag');
    if (!p || !S) return;
    const no = +p.dataset.no;
    if (gridSel == null) { gridSel = no; return draw(); }
    if (gridSel === no) { gridSel = null; return draw(); }
    swapPicks(gridSel, no);
  });
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.dg-pick.drag')) { e.preventDefault(); e.target.click(); }
  });

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !S) return;
    if (b.dataset.act === 'colleft' || b.dataset.act === 'colright') { const i = +b.dataset.i; return moveCol(i, b.dataset.act === 'colleft' ? i - 1 : i + 1); }
    const d = S.d, act = b.dataset.act;
    if (act === 'q-add' || act === 'q-night' || act === 'q-del' || act === 'q-clear') {
      const cur = readQuiet(); qOpen = true;
      qWork = act === 'q-clear' ? [] : act === 'q-del' ? cur.filter((_, i) => i !== +b.dataset.i)
        : [...cur, act === 'q-night' ? { ...OVERNIGHT } : { days: [1, 2, 3, 4, 5], from: '12:00', to: '13:00' }];
      return draw();
    }
    if (act === 'q-save') return run(async () => {
      const q = readQuiet();
      for (const w of q) {
        if (!w.days.length) throw new Error('Tick at least one day for each quiet time.');
        if (!w.from || !w.to) throw new Error('Give each quiet time a start and an end.');
        if (w.from === w.to) throw new Error('A quiet time can’t start and end at the same time.');
      }
      await rpc('office_set_quiet', { p_draft: d.id, p_quiet: q });
      qWork = null;
    }, 'Active times saved.');
    if (act === 'start') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'start' }), 'The draft is live. Managers can see the Draft tab now.');
    if (act === 'pause') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'pause' }), 'Paused.');
    if (act === 'resume') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'resume' }), 'Resumed with a fresh timer.');
    if (act === 'extend') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'extend', p_minutes: Math.max(1, Math.round(+root.querySelector('.dr-ext').value) || 1) }), 'Time added.');
    if (act === 'skip') run(() => rpc('office_set_pick', { p_draft: d.id, p_player: null }), 'A random player was picked.');
    if (act === 'makepick') run(async () => { await rpc('office_set_pick', { p_draft: d.id, p_player: root.querySelector('.dr-pl').value }); undoFrom = null; }, 'Pick made.');
    if (act === 'undo') run(async () => { await rpc('office_draft_undo', { p_draft: d.id }); undoFrom = null; }, 'Last pick undone.');
    if (act === 'delete') {
      const picked = S.picks.filter(k => k.player).length;
      if (!confirm(`Delete “${d.name}”? Its order, queues and auto-pick settings are removed. This can’t be undone.`)) return;
      const release = picked > 0 && confirm(`${picked} player${picked === 1 ? ' was' : 's were'} drafted in it. Press OK to return them to free agents, or Cancel to leave them at their clubs.`);
      run(async () => { await rpc('office_delete_draft', { p_draft: d.id, p_release: release }); selected = null; undoFrom = null; preview = null; }, release ? 'Draft deleted and its players returned to free agents.' : 'Draft deleted.');
    }
    if (act === 'reset') {
      if (!confirm(`Reset “${d.name}” to set-up? Every pick is taken back and the players return to free agents. The order and settings stay.`)) return;
      run(async () => { await rpc('office_draft_reset', { p_draft: d.id }); undoFrom = null; preview = null; }, 'Reset to set-up.');
    }
    if (act === 'finish') {
      if (!confirm('Finish the draft now? Remaining picks stay empty.')) return;
      run(() => write(client.from('drafts').update({ status: 'done', pick_deadline: null }).eq('id', d.id)), 'Draft finished.');
    }
    if (act === 'duplicate') run(async () => {
      const row = (await write(client.from('drafts').insert({ name: `${d.name} (copy)`.slice(0, 60), opens_at: d.opens_at, closes_at: d.closes_at, pick_minutes: d.pick_minutes,
        on_timeout: d.on_timeout, rounds: d.rounds, roster_min: d.roster_min, roster_max: d.roster_max, ...(Array.isArray(d.quiet) ? { quiet: d.quiet } : {}) }).select('id').single())).data;
      await writeOrder(row.id, 1, S.order.map(o => o.club));
      selected = row.id; undoFrom = null; preview = null;
    }, 'Duplicated as a new draft in set-up.');
    if (act === 'reverse') run(() => saveRest(restClubs().reverse()), 'Unmade picks reversed.');
    if (act === 'shuffle') run(() => saveRest(shuffle(restClubs())), 'Unmade picks shuffled.');
    if (act === 'rotate') run(() => { const arr = restClubs(), n = arr.length ? ((Math.round(+root.querySelector('.dr-rot').value) || 0) % arr.length + arr.length) % arr.length : 0; return saveRest([...arr.slice(n), ...arr.slice(0, n)]); }, 'Unmade picks rotated.');
    if (['rowup', 'rowdown', 'rowdel'].includes(act)) run(() => {
      const arr = restClubs(), i = +b.dataset.no - made() - 1, j = act === 'rowup' ? i - 1 : i + 1;
      if (act === 'rowdel') arr.splice(i, 1); else [arr[i], arr[j]] = [arr[j], arr[i]];
      return saveRest(arr);
    }, act === 'rowdel' ? 'Pick removed.' : 'Pick moved.');
    if (act === 'preview') {
      const have = {};
      for (const pl of S.players) if (pl.club) { const h = (have[pl.club] ||= {}); h[pl.position] = (h[pl.position] || 0) + 1; }
      const pool = free().sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1)), taken = new Set();
      const todo = S.order.filter(o => o.pick_no >= d.current_pick);
      preview = todo.map((o, i) => {
        const after = todo.slice(i + 1).filter(x => x.club === o.club).length, h = (have[o.club] ||= {});
        const p = pool.find(x => !taken.has(x.id) && allowed(d, h, x, o.club, after)) || null;
        if (p) { taken.add(p.id); h[p.position] = (h[p.position] || 0) + 1; }
        return { pick_no: o.pick_no, club: o.club, p };
      });
      draw();
    }
    if (act === 'nopreview') { preview = null; draw(); }
    if (act === 'autofill') run(async () => { const from = d.current_pick; await rpc('office_autofill', { p_draft: d.id }); undoFrom = from; preview = null; }, 'Done. Press Undo auto-assign if that isn’t what you wanted.');
    if (act === 'undoauto') run(async () => { await rpc('office_draft_undo', { p_draft: d.id, p_from: undoFrom }); undoFrom = null; }, 'Auto-assign undone.');
    if (act === 'unqueue') run(() => write(client.from('draft_queue').delete().eq('draft', d.id).eq('club', b.dataset.club).eq('player', b.dataset.player)), 'Removed from the queue.');
  });

  await refresh();
  // Keep the page current while someone watches it: the countdown every second, the data every 15 s (never while typing).
  clearInterval(timer);
  let n = 0;
  timer = setInterval(() => {
    if (!document.body.contains(root)) { clearInterval(timer); return; }
    tick();
    if (++n % 15 === 0 && !preview && !root.contains(document.activeElement && document.activeElement.matches('input, select, textarea') ? document.activeElement : null)) refresh(msg);
  }, 1000);
}
