// Editor -> Office (S-35): the wage cap, releases per window, the transfer window (a switch and optional dates), every move with Undo, and who is
// short of the squad rules (office_squad_report). Settings are one row in office_settings, saved through office_save_settings; Undo is office_undo (supabase/migrations/0091_office.sql).
// Cap penalties (0092_cap_penalties.sql): the over-cap limit, every club's pending points (office_cap_report), and at the end of the regular season
// "Apply cap penalties" (office_apply_cap_penalties, a confirm listing each club's points) with Undo (office_undo_cap_penalties).
//   officeView() -> the tab's shell;  mountOffice({ db, esc, explain }) -> fills it in
//   localInput(iso) / fromLocal(value) -> a date for <input type="datetime-local"> and back (exported for the tests)
import { money, POSITIONS, pts, windowFromSettings } from './office-model.js';
import { snapshotInputs, restoreInputs } from './paint.js';

export const officeView = () => '<h1>Office</h1><div id="of-ed"><p class="quiet">Loading…</p></div>';

const pad = n => String(n).padStart(2, '0');
export function localInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocal = v => (v ? new Date(v).toISOString() : '');

// What the form says, as the object office_save_settings takes. Blank numbers are left out (the database keeps its value); blank dates clear them.
export function readOffice(f) {
  const out = {}, n = k => { const v = f.get(k); return v === null || v === '' ? undefined : Number(v); };
  for (const k of ['cap', 'over_limit', 'releases_per_window', 'squad_min', 'squad_max']) { const v = n(k); if (Number.isFinite(v)) out[k] = Math.round(v); }
  // 0093: the least of each position (no most)
  const mins = {};
  for (const p of ['GK', 'DEF', 'MID', 'FWD']) { const v = n(`min_${p}`); if (Number.isFinite(v)) mins[p] = Math.round(v); }
  if (Object.keys(mins).length) out.pos_min = mins;
  for (const k of ['opens_at', 'closes_at']) if (f.get(k) !== null) out[k] = fromLocal(f.get(k));
  return out;
}

export async function mountOffice({ db, esc, explain }) {
  const root = document.getElementById('of-ed');
  if (!root) return;
  const c = await db();
  let S = null, moves = [], players = new Map(), report = null, caps = null, msg = '', bad = false, ask = null, busy = false;

  const load = async () => {
    const [a, b, p, r, k] = await Promise.all([
      c.from('office_settings').select('*').eq('id', 1).maybeSingle(),
      c.from('office_moves').select('*').order('made_at', { ascending: false }).limit(100),
      c.from('players').select('id, name').range(0, 1999),
      c.rpc('office_squad_report'),
      c.rpc('office_cap_report'),
    ]);
    caps = k.error ? null : k.data;   // null until 0092_cap_penalties.sql is in
    report = r.error ? null : r.data || [];
    if (a.error || !a.data) { msg = a.error ? explain(a.error) : 'Office settings are missing. Run the database update 0091_office.sql once.'; bad = true; S = null; } else S = a.data;
    moves = b.data || [];
    players = new Map((p.data || []).map(r => [r.id, r.name]));
  };
  // One action at a time (a second press while one is on its way does nothing); the buttons show it is working.
  const run = async (fn, ok) => {
    if (busy) return;
    busy = true; root.classList.add('ed-busy'); root.setAttribute('aria-busy', 'true');
    try {
      const { error } = await fn();
      msg = error ? explain(error) : ok; bad = Boolean(error); ask = null;
      await load();
    } catch (e) { msg = explain(e); bad = true; }
    busy = false; root.classList.remove('ed-busy'); root.setAttribute('aria-busy', 'false');
    draw();
  };
  const names = ids => (ids || []).map(id => esc(players.get(id) || id)).join(', ') || 'nobody';
  const moveText = m => m.kind === 'release' ? `<b>${esc(m.club)}</b> released ${names(m.players_out)}`
    : m.kind === 'sign' ? `<b>${esc(m.club)}</b> signed ${names(m.players_in)}`
    : `<b>${esc(m.club)}</b> sent ${names(m.players_out)} to <b>${esc(m.other_club)}</b> for ${names(m.players_in)}`;
  const day = iso => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).replace(/\s(am|pm)$/i, (x, y) => ` ${y.toLowerCase()}`);

  // Who is short of the squad rules (or over a position's maximum): nothing happens to them automatically when a window closes.
  const shortText = r => POSITIONS.map(p => { const x = r.roster?.positions?.[p]; if (!x) return ''; const n = Number(x.count);
    return n < x.min ? `${n - x.min} ${p}` : n > x.max ? `+${n - x.max} ${p}` : ''; }).filter(Boolean).join(', ').replace(/-/g, '−');
  const reportHtml = () => (report == null ? ''
    : `<section class="ed-invite"><h2>Squad check</h2><p class="ed-hint">Clubs outside the squad rules right now (short of a position’s minimum, or over its maximum). Nothing happens to them automatically: a manager may be one short while a window is open.</p>
        <ul class="ed-ofmoves">${report.map(r => `<li class="ed-ofmove"><span><b>${esc(r.name || r.club)}</b><small>${esc(shortText(r))}${Number(r.roster?.short) ? ` · ${Number(r.roster.short)} short in all` : ''}</small></span></li>`).join('') || '<li class="quiet">Every club meets the squad rules.</li>'}</ul></section>`);

  // Cap penalties: every club over the cap with its pending points; Apply (with a confirm listing them) at the end of the regular season, and Undo.
  const capsHtml = () => {
    if (!caps) return '';
    const over = (caps.clubs || []).filter(x => Number(x.over) > 0);
    const list = over.map(x => `<li class="ed-ofmove"><span><b>${esc(x.name || x.club)}</b><small>${money(x.wage_bill)} · ${money(x.over)} over${caps.applied ? ` · ${x.applied_points ? `${x.applied_points} taken off` : 'nothing taken off'}` : ''}</small></span><b>${caps.applied ? '' : `−${Number(x.points)}`}</b></li>`).join('');
    const act = caps.applied
      ? (ask === 'unpen' ? `<p class="ed-ofask">Put the points back on the table?<button type="button" data-of-unpen class="danger">Undo cap penalties</button><button type="button" data-of-cancel>Keep</button></p>`
        : '<button type="button" data-of-askunpen>Undo cap penalties</button>')
      : (ask === 'pen' ? `<div class="ed-ofask"><p>Take these points off the table now? ${over.length ? over.map(x => `${esc(x.club)} ${pts(Number(x.points))}`).join(', ') : 'No club is over the cap, so nothing is taken off'}. They are worked out from the wage bills right now.</p><button type="button" data-of-pen class="danger">Apply cap penalties</button><button type="button" data-of-cancel>Keep</button></div>`
        : '<button type="button" data-of-askpen class="primary">Apply cap penalties</button>');
    return `<section class="ed-invite"><h2>Cap penalties</h2><p class="ed-hint">${caps.applied
      ? 'Applied: the league table counts them. Undo puts the points back (the record is kept).'
      : `Pending: shown on the league table, not counted yet. At the end of the regular season, apply them: each club over the ${money(caps.cap)} cap loses points by how far over it is right then.`}</p>
      <ul class="ed-ofmoves">${list || '<li class="quiet">No club is over the cap.</li>'}</ul>${act}</section>`;
  };

  function draw() {
    if (!S) { root.innerHTML = `<p class="${bad ? 'err' : 'quiet'}">${esc(msg || 'Office settings did not load.')}</p>`; return; }
    const snap = snapshotInputs(root);   // flipping the window or an undo redraws the tab: keep what was typed in the form and not saved
    // The switch and the dates together (22 Nov 2026: the switch said YES while a passed closing time kept the window shut, and nothing said so).
    const on = S.window_open, w = windowFromSettings(S), live = w.open;
    const state = w.status === 'closed' && on ? 'passed' : !on ? 'off' : w.status;
    const head = live ? 'OPEN' : state === 'not_yet' ? 'OPENS SOON' : 'CLOSED';
    const said = {
      open: `Managers can release, sign and trade${w.closes_at ? `, until ${esc(day(w.closes_at))}` : ' until you switch it off'}. Moves made while a round is being played wait until it ends.`,
      not_yet: `The switch is on, and the window opens ${esc(day(w.opens_at))}. Moves made before then wait in the queue.`,
      passed: `The switch is on, but the closing time (${esc(day(w.closes_at))}) has passed. Press YES again to reopen it: that clears the old dates.`,
      off: 'Moves managers make now wait in the queue and go through when the window opens.',
    }[state];
    const rows = moves.map(m => `<li class="ed-ofmove${m.undone_at ? ' undone' : ''}">
        <span><span class="ed-ofk">${m.kind === 'release' ? 'Release' : m.kind === 'sign' ? 'Signing' : 'Trade'}</span>${moveText(m)}
          <small>${esc(day(m.made_at))} · ${esc(m.club)} bill ${money(m.bill_before)} → ${money(m.bill_after)}${m.other_club ? ` · ${esc(m.other_club)} ${money(m.other_before)} → ${money(m.other_after)}` : ''}${m.undone_at ? ` · undone ${esc(day(m.undone_at))}` : ''}</small></span>
        ${m.undone_at ? '' : ask === m.id
          ? `<span class="ed-ofask">Put the players back?<button type="button" data-of-undo="${m.id}" class="danger">Undo move</button><button type="button" data-of-cancel>Keep</button></span>`
          : `<button type="button" data-of-ask="${m.id}">Undo</button>`}
      </li>`).join('');
    root.innerHTML = `<section class="dr-vis ${live ? 'on' : 'off'}"><div><h2>TRANSFER WINDOW ${head}</h2><p>${said}</p></div>
        <div class="dr-switch" role="group" aria-label="Transfer window open"><button type="button" data-of-flip="0" aria-pressed="${!on}">NO</button><button type="button" data-of-flip="1" aria-pressed="${on}">YES</button></div></section>
      ${msg ? `<p class="${bad ? 'err' : 'ed-hint'}" role="status">${esc(msg)}</p>` : ''}
      <form class="of-ed-form" novalidate>
        <section class="ed-invite"><h2>Wages</h2>
          <div class="ed-fields"><label>Wage cap <i>a club’s squad values added up, in $</i><input name="cap" type="number" min="0" max="10000000" step="500" value="${esc(S.cap)}"></label>
          <label>Over-cap limit <i>the most a club may go over the cap, in $ (penalty points up to it)</i><input name="over_limit" type="number" min="0" max="1000000" step="500" value="${esc(S.over_limit ?? 30000)}"></label>
          <label>Releases per window <i>per club</i><input name="releases_per_window" type="number" min="0" max="50" value="${esc(S.releases_per_window)}"></label>
      <label>Fewest players <i>a squad may have (after a release)</i><input name="squad_min" type="number" min="11" max="40" value="${esc(S.squad_min ?? 15)}"></label>
      <label>Most players <i>a squad may have</i><input name="squad_max" type="number" min="11" max="40" value="${esc(S.squad_max ?? 16)}"></label>
      ${['GK', 'DEF', 'MID', 'FWD'].map(p => `<label>At least ${p} <i>no most</i><input name="min_${p}" type="number" min="0" max="11" value="${esc(S.pos_min?.[p] ?? { GK: 1, DEF: 4, MID: 3, FWD: 3 }[p])}"></label>`).join('')}</div></section>
        <section class="ed-invite"><h2>Window dates</h2><p class="ed-hint">Optional. With the switch on, moves are allowed only between these times. Leave both empty to keep the window open until you switch it off. Switching it on after the closing time has passed clears these dates.</p>
          <div class="ed-fields"><label>Opens <input name="opens_at" type="datetime-local" value="${localInput(S.opens_at)}"></label>
          <label>Closes <input name="closes_at" type="datetime-local" value="${localInput(S.closes_at)}"></label></div></section>
        <button type="submit" class="primary">Save Office settings</button>
      </form>
      <section class="ed-invite"><h2>Moves</h2><p class="ed-hint">Newest first. Undo puts the players back where they were (no cap or squad check: your call). A move can only be undone while its players are still where it put them.</p>
        <ul class="ed-ofmoves">${rows || '<li class="quiet">No moves yet.</li>'}</ul></section>
      ${capsHtml()}
      ${reportHtml()}`;
    restoreInputs(root, snap);
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.ofFlip != null) return run(() => c.rpc('office_save_settings', { p: { window_open: b.dataset.ofFlip === '1' } }), b.dataset.ofFlip === '1' ? 'Saved: the switch is on.' : 'Window closed.');
    if (b.dataset.ofAsk) { ask = Number(b.dataset.ofAsk); return draw(); }
    if (b.dataset.ofCancel != null) { ask = null; return draw(); }
    if (b.dataset.ofAskpen != null) { ask = 'pen'; return draw(); }
    if (b.dataset.ofAskunpen != null) { ask = 'unpen'; return draw(); }
    if (b.dataset.ofPen != null) return run(() => c.rpc('office_apply_cap_penalties', { p_note: 'End of the regular season' }), 'Cap penalties applied. The table counts them now.');
    if (b.dataset.ofUnpen != null) return run(() => c.rpc('office_undo_cap_penalties'), 'Cap penalties undone. The points are back.');
    if (b.dataset.ofUndo) return run(() => c.rpc('office_undo', { p_move: Number(b.dataset.ofUndo) }), 'Move undone. The players are back.');
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    run(() => c.rpc('office_save_settings', { p: readOffice(new FormData(e.target)) }), 'Saved. It applies straight away.');
  });
  await load();
  draw();
}
