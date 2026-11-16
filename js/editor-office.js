// Editor -> Office (S-35): the wage cap, releases per window, the transfer window (a switch and optional dates), who is short of the squad rules,
// and every move with Undo. Settings are one row in office_settings, saved through office_save_settings; Undo is office_undo (supabase/migrations/0091_office.sql).
//   officeView() -> the tab's shell;  mountOffice({ db, esc, explain }) -> fills it in
//   localInput(iso) / fromLocal(value) -> a date for <input type="datetime-local"> and back (exported for the tests)
import { money } from './office-model.js';

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
  for (const k of ['cap', 'releases_per_window']) { const v = n(k); if (Number.isFinite(v)) out[k] = Math.round(v); }
  for (const k of ['opens_at', 'closes_at']) if (f.get(k) !== null) out[k] = fromLocal(f.get(k));
  return out;
}

export async function mountOffice({ db, esc, explain }) {
  const root = document.getElementById('of-ed');
  if (!root) return;
  const c = await db();
  let S = null, moves = [], players = new Map(), msg = '', bad = false, ask = null;

  const load = async () => {
    const [a, b, p] = await Promise.all([
      c.from('office_settings').select('*').eq('id', 1).maybeSingle(),
      c.from('office_moves').select('*').order('made_at', { ascending: false }).limit(100),
      c.from('players').select('id, name').range(0, 1999),
    ]);
    if (a.error || !a.data) { msg = a.error ? explain(a.error) : 'Office settings are missing. Run the database update 0091_office.sql once.'; bad = true; S = null; } else S = a.data;
    moves = b.data || [];
    players = new Map((p.data || []).map(r => [r.id, r.name]));
  };
  const run = async (fn, ok) => {
    const { error } = await fn();
    msg = error ? explain(error) : ok; bad = Boolean(error); ask = null;
    await load(); draw();
  };
  const names = ids => (ids || []).map(id => esc(players.get(id) || id)).join(', ') || 'nobody';
  const moveText = m => m.kind === 'release' ? `<b>${esc(m.club)}</b> released ${names(m.players_out)}`
    : m.kind === 'sign' ? `<b>${esc(m.club)}</b> signed ${names(m.players_in)}`
    : `<b>${esc(m.club)}</b> sent ${names(m.players_out)} to <b>${esc(m.other_club)}</b> for ${names(m.players_in)}`;
  const day = iso => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).replace(/\s(am|pm)$/i, (x, y) => ` ${y.toLowerCase()}`);

  function draw() {
    if (!S) { root.innerHTML = `<p class="${bad ? 'err' : 'quiet'}">${esc(msg || 'Office settings did not load.')}</p>`; return; }
    const on = S.window_open;
    const rows = moves.map(m => `<li class="ed-ofmove${m.undone_at ? ' undone' : ''}">
        <span><span class="ed-ofk">${m.kind === 'release' ? 'Release' : m.kind === 'sign' ? 'Signing' : 'Trade'}</span>${moveText(m)}
          <small>${esc(day(m.made_at))} · ${esc(m.club)} bill ${money(m.bill_before)} → ${money(m.bill_after)}${m.other_club ? ` · ${esc(m.other_club)} ${money(m.other_before)} → ${money(m.other_after)}` : ''}${m.undone_at ? ` · undone ${esc(day(m.undone_at))}` : ''}</small></span>
        ${m.undone_at ? '' : ask === m.id
          ? `<span class="ed-ofask">Put the players back?<button type="button" data-of-undo="${m.id}" class="danger">Undo move</button><button type="button" data-of-cancel>Keep</button></span>`
          : `<button type="button" data-of-ask="${m.id}">Undo</button>`}
      </li>`).join('');
    root.innerHTML = `<section class="dr-vis ${on ? 'on' : 'off'}"><div><h2>TRANSFER WINDOW OPEN</h2><p>${on ? 'YES: managers can release, sign and trade (inside the dates below, and never while a round is being played).' : 'NO: the Office is look-only. Pending offers expire when the window closes.'}</p></div>
        <div class="dr-switch" role="group" aria-label="Transfer window open"><button type="button" data-of-flip="0" aria-pressed="${!on}">NO</button><button type="button" data-of-flip="1" aria-pressed="${on}">YES</button></div></section>
      ${msg ? `<p class="${bad ? 'err' : 'ed-hint'}" role="status">${esc(msg)}</p>` : ''}
      <form class="of-ed-form" novalidate>
        <section class="ed-invite"><h2>Wages</h2>
          <div class="ed-fields"><label>Wage cap <i>a club’s squad values added up, in $</i><input name="cap" type="number" min="0" max="10000000" step="500" value="${esc(S.cap)}"></label>
          <label>Releases per window <i>per club</i><input name="releases_per_window" type="number" min="0" max="50" value="${esc(S.releases_per_window)}"></label></div></section>
        <section class="ed-invite"><h2>Window dates</h2><p class="ed-hint">Optional. With the switch on, moves are allowed only between these times. Leave both empty to keep the window open until you switch it off.</p>
          <div class="ed-fields"><label>Opens <input name="opens_at" type="datetime-local" value="${localInput(S.opens_at)}"></label>
          <label>Closes <input name="closes_at" type="datetime-local" value="${localInput(S.closes_at)}"></label></div></section>
        <button type="submit" class="primary">Save Office settings</button>
      </form>
      <section class="ed-invite"><h2>Moves</h2><p class="ed-hint">Newest first. Undo puts the players back where they were (no cap or squad check: your call). A move can only be undone while its players are still where it put them.</p>
        <ul class="ed-ofmoves">${rows || '<li class="quiet">No moves yet.</li>'}</ul></section>`;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ofFlip != null) return run(() => c.rpc('office_save_settings', { p: { window_open: b.dataset.ofFlip === '1' } }), b.dataset.ofFlip === '1' ? 'Window open. Managers can make moves.' : 'Window closed.');
    if (b.dataset.ofAsk) { ask = Number(b.dataset.ofAsk); return draw(); }
    if (b.dataset.ofCancel != null) { ask = null; return draw(); }
    if (b.dataset.ofUndo) return run(() => c.rpc('office_undo', { p_move: Number(b.dataset.ofUndo) }), 'Move undone. The players are back.');
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    run(() => c.rpc('office_save_settings', { p: readOffice(new FormData(e.target)) }), 'Saved. It applies straight away.');
  });
  await load();
  draw();
}
