// Editor -> Draft (0.22): the office's side of the limited-time draft (docs/DRAFT.md, migrations 0023 and 0024).
// Create a draft, set the order, start/pause/resume/extend it, make or skip the pick on the clock, auto-assign the rest
// (with a preview and Undo) and see or change every club's queue and auto-pick rule. The database checks everything again.

const MODES = { always: 'Always (the moment it’s their turn)', on_miss: 'If they miss their turn', after_minutes: 'After a number of minutes', never: 'Never (the queue is only a reference)' };
const TIMEOUTS = { queue: 'Take the next player in their queue, else skip', best_value: 'Take the best-value free player', skip: 'Skip the pick' };
const STATUS = { setup: 'Setting up', live: 'Live', paused: 'Paused', done: 'Finished' };
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const localInput = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const isoOf = v => (v ? new Date(v).toISOString() : null);
const when = iso => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'no limit');
const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const minutesText = m => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

let selected = null, undoFrom = null, timer = null;

export const draftView = () => '<h1>Draft</h1><div id="dr-root"><p class="quiet">Loading…</p></div>';

// ctx: { db, esc, explain, clubs (the Editor's clubs) }
export async function mountDraft(ctx) {
  const root = document.getElementById('dr-root');
  if (!root) return;
  const { esc, explain } = ctx;
  const client = await ctx.db();
  const active = ctx.clubs.filter(c => c.status !== 'withdrawn');
  const cname = code => { const c = ctx.clubs.find(x => x.code === code); return c?.short_name || c?.name || code || '?'; };
  let S = null, msg = '', preview = null;

  const need = r => { if (r.error) throw new Error(explain(r.error)); return r.data || []; };

  async function load() {
    const drafts = need(await client.from('drafts').select('*').order('id', { ascending: false }));
    const d = drafts.find(x => x.id === selected) || drafts.find(x => x.status !== 'done') || drafts[0] || null;
    selected = d?.id ?? null;
    if (!d) return { drafts, d: null, order: [], picks: [], queue: [], prefs: [], players: [] };
    const [order, picks, queue, prefs, players] = await Promise.all([
      client.from('draft_order').select('pick_no, club').eq('draft', d.id).order('pick_no'),
      client.from('draft_picks').select('pick_no, club, player, made_at, how').eq('draft', d.id).order('pick_no'),
      client.from('draft_queue').select('club, player, rank').eq('draft', d.id).order('rank'),
      client.from('draft_prefs').select('club, mode, minutes').eq('draft', d.id),
      client.from('players').select('id, name, position, club, value').order('id').range(0, 1999),
    ]);
    return { drafts, d, order: need(order), picks: need(picks), queue: need(queue), prefs: need(prefs), players: need(players) };
  }

  const pname = new Map();
  const nameOf = id => pname.get(id) || '?';
  const turn = () => S.order.find(o => o.pick_no === S.d.current_pick) || null;
  const free = () => S.players.filter(p => !p.club);

  // A new order: p.length clubs per round (snake flips every other round), as many rounds as the draft has.
  function sequence(rounds, snake, random) {
    let base = active.map(c => c.code);
    if (random) base = base.map(c => [Math.random(), c]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const out = [];
    for (let r = 0; r < rounds; r++) out.push(...(snake && r % 2 ? [...base].reverse() : base));
    return out;
  }

  const bar = () => {
    const d = S.d, t = turn();
    return `<section class="ed-invite dr-live"><div class="dr-top">
      <div><h2>${esc(d.name)} <span class="ed-pill ${d.status === 'live' ? 'approved' : d.status === 'paused' ? 'warn' : ''}">${STATUS[d.status]}</span></h2>
        <p class="ed-hint">Open ${esc(when(d.opens_at))} to ${esc(when(d.closes_at))} · ${esc(minutesText(d.pick_minutes))} a pick · ${d.rounds} round${d.rounds === 1 ? '' : 's'} · ${S.order.length} picks · when time runs out: ${esc(TIMEOUTS[d.on_timeout].toLowerCase())}</p></div>
      ${d.status === 'live' && t ? `<div class="dr-clock">${esc(cname(t.club))} on the clock<b class="dr-count" data-deadline="${esc(d.pick_deadline || '')}"></b><small>Pick ${d.current_pick} of ${S.order.length}</small></div>`
        : d.status === 'paused' && t ? `<div class="dr-clock">Paused<small>${esc(cname(t.club))} is up, pick ${d.current_pick} of ${S.order.length}</small></div>` : ''}</div>
      <div class="ed-actions">
        ${d.status === 'setup' ? '<button class="btn" data-act="start">Start the draft</button>' : ''}
        ${d.status === 'live' ? '<button class="btn ghost" data-act="pause">Pause</button>' : ''}
        ${d.status === 'paused' ? '<button class="btn" data-act="resume">Resume</button>' : ''}
        ${d.status === 'live' ? `<button class="btn ghost" data-act="extend">Extend by</button><input class="dr-ext" type="number" min="1" value="60" aria-label="Minutes to add"> minutes` : ''}
        ${['live', 'paused'].includes(d.status) ? '<button class="btn ghost" data-act="skip">Skip this pick</button>' : ''}
        ${S.picks.length ? '<button class="btn ghost" data-act="undo">Undo last pick</button>' : ''}
        ${d.status === 'setup' ? '<button class="btn ghost" data-act="delete">Delete draft</button>' : ''}</div>
      <p class="ed-msg" role="status">${esc(msg)}</p></section>`;
  };

  const onClock = () => {
    const d = S.d, t = turn();
    if (!t || !['live', 'paused'].includes(d.status)) return '';
    const list = free().sort((a, b) => b.value - a.value).slice(0, 400);
    return `<section class="ed-invite"><h2>Pick for ${esc(cname(t.club))}</h2>
      <p class="ed-hint">Use this to make or override the pick on the clock. The player joins ${esc(cname(t.club))} straight away.</p>
      <div class="ed-actions"><select class="dr-pl" aria-label="Player">${list.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.position)} · ${money(p.value)}</option>`).join('')}</select>
        <button class="btn" data-act="makepick">Pick this player</button></div></section>`;
  };

  const orderPanel = () => {
    const d = S.d, made = d.status === 'setup' ? 0 : d.current_pick - 1;
    const rest = S.order.filter(o => o.pick_no > made);
    return `<section class="ed-invite"><h2>Draft order</h2>
      <form class="dr-build" novalidate>
        <div class="ed-fields"><label>Rounds<input name="rounds" type="number" min="1" max="50" value="${d.rounds}"></label>
          <label>Order<select name="snake"><option value="1">Snake (reverses each round)</option><option value="0">Same order every round</option></select></label>
          <label>First round<select name="random"><option value="0">Keep the current order</option><option value="1">Shuffle the clubs</option></select></label></div>
        <div class="ed-actions"><button class="btn ghost" type="submit">${rest.length ? 'Rebuild the unmade picks' : 'Build the order'}</button></div>
        <p class="ed-hint">${made ? `Picks 1 to ${made} are made and stay as they are.` : 'Replaces the whole order.'} You can still change any single pick below.</p></form>
      ${rest.length ? `<details ${rest.length <= 40 ? 'open' : ''}><summary>${rest.length} pick${rest.length === 1 ? '' : 's'} still to make</summary>
        <ol class="dr-order" start="${rest[0].pick_no}">${rest.map(o => `<li><span>Pick ${o.pick_no}</span><select data-pickno="${o.pick_no}" aria-label="Club for pick ${o.pick_no}">${active.map(c => `<option value="${esc(c.code)}"${c.code === o.club ? ' selected' : ''}>${esc(c.short_name || c.name)}</option>`).join('')}</select></li>`).join('')}</ol></details>` : ''}
    </section>`;
  };

  const autoPanel = () => {
    const d = S.d;
    if (!['live', 'paused'].includes(d.status)) return '';
    const rest = S.order.filter(o => o.pick_no >= d.current_pick);
    if (preview) return `<section class="ed-invite"><h2>Auto-assign the rest: preview</h2>
      <p class="ed-hint">Best value first, in draft order. Nothing is saved until you confirm. You can undo it afterwards.</p>
      <div class="pl-scroll"><table class="pl-table"><thead><tr><th>Pick</th><th>Club</th><th>Player</th><th>Value</th></tr></thead><tbody>${preview.map(r =>
        `<tr><td>${r.pick_no}</td><td>${esc(cname(r.club))}</td><td>${r.p ? esc(r.p.name) + ' · ' + esc(r.p.position) : '<i>skipped (no players left)</i>'}</td><td>${r.p ? money(r.p.value) : ''}</td></tr>`).join('')}</tbody></table></div>
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
      const pr = S.prefs.find(p => p.club === c.code) || { mode: 'on_miss', minutes: null };
      const q = S.queue.filter(x => x.club === c.code).sort((a, b) => a.rank - b.rank);
      return `<details class="dr-team"><summary><b>${esc(c.short_name || c.name)}</b><span>${esc(MODES[pr.mode].split(' (')[0])} · ${q.length} queued</span></summary>
        <div class="dr-club"><label>Auto-pick<select data-pref="${esc(c.code)}">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${k === pr.mode ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
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
      <div class="ed-actions"><button class="btn" type="submit">Create draft</button></div>
      <p class="ed-hint">It starts in set-up: nothing is visible to managers until you press Start. Players are drawn from the free agents (${S ? free().length : '…'} now).</p></form></section>`;

  const picker = () => (S.drafts.length > 1 ? `<label class="dr-sel">Draft <select data-select>${S.drafts.map(x => `<option value="${x.id}"${x.id === selected ? ' selected' : ''}>${esc(x.name)} (${STATUS[x.status]})</option>`).join('')}</select></label>` : '');

  function draw() {
    S.players.forEach(p => pname.set(p.id, p.name));
    root.innerHTML = `<div class="dr-ed">${picker()}${S.d ? bar() + onClock() + autoPanel() + orderPanel() + boardPanel() + clubsPanel() : ''}${newForm()}</div>`;
    tick();
  }
  function tick() {
    root.querySelectorAll('.dr-count').forEach(el => {
      const at = el.dataset.deadline ? new Date(el.dataset.deadline) : null;
      el.textContent = at ? left(at - Date.now()) : '';
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

  async function writeOrder(draftId, startPick, seq) {
    await write(client.from('draft_order').delete().eq('draft', draftId).gte('pick_no', startPick));
    const rows = seq.slice(startPick - 1).map((club, i) => ({ draft: draftId, pick_no: startPick + i, club }));
    if (rows.length) await write(client.from('draft_order').insert(rows));
  }

  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('.dr-new')) run(async () => {
      const name = f.name.value.trim(), rounds = Math.round(+f.rounds.value), mins = Math.round(+f.hours.value * 60);
      if (name.length < 2) throw new Error('Give the draft a name.');
      if (!active.length) throw new Error('There are no clubs to draft for.');
      if (!(mins >= 1)) throw new Error('Give each pick some time.');
      const row = (await write(client.from('drafts').insert({ name, opens_at: isoOf(f.opens.value), closes_at: isoOf(f.closes.value), pick_minutes: mins, rounds,
        on_timeout: f.timeout.value }).select('id').single())).data;
      await writeOrder(row.id, 1, sequence(rounds, f.snake.checked, false));
      selected = row.id; undoFrom = null;
    }, 'Draft created. Check the order, then press Start.');
    if (f.matches('.dr-build')) run(async () => {
      const d = S.d, made = d.status === 'setup' ? 0 : d.current_pick - 1, rounds = Math.round(+f.rounds.value);
      if (!(rounds >= 1)) throw new Error('Rounds must be at least 1.');
      const snake = f.snake.value === '1', random = f.random.value === '1';
      const seq = sequence(rounds, snake, random);
      if (made >= seq.length) throw new Error('That many rounds is fewer than the picks already made.');
      if (made) seq.splice(0, made, ...S.order.filter(o => o.pick_no <= made).map(o => o.club));   // made picks keep their clubs
      await write(client.from('drafts').update({ rounds }).eq('id', d.id));
      await writeOrder(d.id, made + 1, seq);
    }, 'Order saved.');
  });

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-select]')) { selected = +t.value; undoFrom = null; preview = null; msg = ''; refresh(); }
    else if (t.dataset.pickno) run(() => write(client.from('draft_order').update({ club: t.value }).eq('draft', S.d.id).eq('pick_no', +t.dataset.pickno)), `Pick ${t.dataset.pickno} is now ${cname(t.value)}’s.`);
    else if (t.dataset.pref || t.dataset.prefmin) {
      const code = t.dataset.pref || t.dataset.prefmin, box = root.querySelector(`[data-pref="${CSS.escape(code)}"]`), mode = box.value;
      const mins = mode === 'after_minutes' ? Math.round(+root.querySelector(`[data-prefmin="${CSS.escape(code)}"]`).value) || null : null;
      if (mode === 'after_minutes' && !mins) { root.querySelector(`[data-prefmin="${CSS.escape(code)}"]`).closest('label').hidden = false; return; }
      run(() => write(client.from('draft_prefs').upsert({ draft: S.d.id, club: code, mode, minutes: mins }, { onConflict: 'draft,club' })), `${cname(code)}’s auto-pick is saved.`);
    }
  });

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !S) return;
    const d = S.d, act = b.dataset.act;
    if (act === 'start') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'start' }), 'The draft is live. Managers can see the Draft tab now.');
    if (act === 'pause') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'pause' }), 'Paused.');
    if (act === 'resume') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'resume' }), 'Resumed with a fresh timer.');
    if (act === 'extend') run(() => rpc('office_draft_control', { p_draft: d.id, p_action: 'extend', p_minutes: Math.max(1, Math.round(+root.querySelector('.dr-ext').value) || 1) }), 'Time added.');
    if (act === 'skip') run(() => rpc('office_set_pick', { p_draft: d.id, p_player: null }), 'Pick skipped.');
    if (act === 'makepick') run(async () => { await rpc('office_set_pick', { p_draft: d.id, p_player: root.querySelector('.dr-pl').value }); undoFrom = null; }, 'Pick made.');
    if (act === 'undo') run(async () => { await rpc('office_draft_undo', { p_draft: d.id }); undoFrom = null; }, 'Last pick undone.');
    if (act === 'delete') run(async () => { await write(client.from('drafts').delete().eq('id', d.id)); selected = null; }, 'Draft deleted.');
    if (act === 'preview') {
      const pool = free().sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
      preview = S.order.filter(o => o.pick_no >= d.current_pick).map((o, i) => ({ pick_no: o.pick_no, club: o.club, p: pool[i] || null }));
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
