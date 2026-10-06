// Draft (0.21): the manager's side of the limited-time draft. Four tabs: Board, My queue, Auto-pick, Team values.
// Only reachable while a draft is live/paused inside its window; otherwise a short "no draft" note. Polls every 15 s.
import { enterPlace } from './shell.js';
import { esc } from './member.js';
import { openDraft, loadDraft, saveQueue, savePrefs, makePick } from './draft-data.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { ago } from './places.js';

const MODES = [
  ['always', 'Always', 'Pick from my queue the moment it’s my turn.'],
  ['on_miss', 'If I miss my turn', 'Pick from my queue only when my pick timer runs out.'],
  ['after_minutes', 'After a few minutes', 'Pick from my queue once my turn has lasted this long.'],
  ['never', 'Never', 'My queue is only a reference. A missed turn is handled the way the office set.'],
];
const TABS = [['board', 'Board'], ['queue', 'My queue'], ['auto', 'Auto-pick'], ['values', 'Team values']];
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const fmt = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`; };

const ctx = await enterPlace('draft');
if (ctx) {
  const { main, club } = ctx, code = club?.code;
  const clubName = new Map((ctx.season?.teams || []).map(t => [t.code, t.name]));
  const nameOf = c => (c === code && club?.name) || clubName.get(c) || c;
  const draft0 = await openDraft();
  if (!draft0) {
    main.innerHTML = '<h1 class="page-title" tabindex="-1">Draft</h1><p class="empty">There’s no draft open right now.</p>';
    document.querySelector('#places [data-place="draft"]')?.remove();
    main.setAttribute('aria-busy', 'false');
  } else {
    let tab = TABS.some(t => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'board';
    let st = await loadDraft(draft0.id, code), players = await loadPlayers({ fresh: true });
    const filter = { q: '', pos: '' };
    let msg = '';
    const byId = () => new Map(players.map(p => [p.id, p]));

    const turn = () => st.order.find(o => o.pick_no === st.draft.current_pick) || null;
    const myTurn = () => st.draft.status === 'live' && turn()?.club === code;
    const free = () => players.filter(p => !p.team);
    // My queue only keeps players who are still free.
    const queue = () => st.queue.filter(id => free().some(p => p.id === id));

    // The office's roster rules (most/fewest per position). The database checks them again on every pick.
    const rulesText = () => {
      const mx = st.draft.roster_max || {}, mn = st.draft.roster_min || {};
      return ['GK', 'DEF', 'MID', 'FWD'].filter(k => mx[k] != null || mn[k] != null)
        .map(k => `${k} ${mn[k] != null && mx[k] != null ? (mn[k] === mx[k] ? mn[k] : `${mn[k]} to ${mx[k]}`) : mx[k] != null ? `up to ${mx[k]}` : `at least ${mn[k]}`}`).join(' · ');
    };
    const blocked = p => {
      const mx = st.draft.roster_max || {}, mn = st.draft.roster_min || {}, have = pos => players.filter(x => x.team === code && x.position === pos).length;
      if (mx[p.position] != null && have(p.position) >= mx[p.position]) return `You already have the most ${p.position} allowed (${mx[p.position]}).`;
      const left = st.order.filter(o => o.club === code && o.pick_no > st.draft.current_pick).length;
      const needed = Object.keys(mn).reduce((n, k) => n + Math.max(0, mn[k] - have(k) - (k === p.position ? 1 : 0)), 0);
      return needed > left ? 'Taking this player would leave too few picks to fill every position.' : '';
    };
    const playerRow = (p, extra = '', attrs = '') => `<li class="dr-p"${attrs}><span class="pos">${esc(p.position)}</span>
      <span class="nm">${esc(p.name)}</span><span class="rt">${p.offense}/${p.defense}</span><span class="val">${money(p.value)}</span>${extra}</li>`;

    function head() {
      const d = st.draft, t = turn();
      const clock = d.status === 'paused' ? 'Paused' : d.status !== 'live' ? '' : `<span id="clock">${fmt(Math.max(0, d.pick_deadline ? new Date(d.pick_deadline) - Date.now() : 0))}</span>`;
      return `<div class="dr-head"><div><h1 class="page-title" tabindex="-1">${esc(d.name || 'Draft')}</h1>
        <p class="quiet">${t ? `Pick ${t.pick_no} of ${st.order.length}: <b>${esc(nameOf(t.club))}</b>${t.club === code ? ' (you)' : ''}` : 'Draft complete'}</p>${rulesText() ? `<p class="quiet">Roster rules: ${esc(rulesText())}</p>` : ''}</div>
        <div class="dr-clock${myTurn() ? ' mine' : ''}">${myTurn() ? '<small>Your pick</small>' : ''}${clock}</div></div>`;
    }

    function board() {
      const map = byId(), recent = st.picks.slice(-8).reverse(), q = new Set(st.queue);
      const list = free().filter(p => (!filter.pos || p.position === filter.pos) && (!filter.q || p.name.toLowerCase().includes(filter.q.toLowerCase())))
        .sort((a, b) => b.value - a.value).slice(0, 80);
      return `<section class="dr-cols"><div><h2>Recent picks</h2>${recent.length ? `<ol class="dr-recent">${recent.map(r => `<li${r.club === code ? ' class="me"' : ''}><b>#${r.pick_no}</b> ${esc(nameOf(r.club))} took ${esc(map.get(r.player)?.name || r.player)} <small>${r.made_at ? esc(ago(new Date(r.made_at))) : ''}</small></li>`).join('')}</ol>` : '<p class="empty">No picks yet.</p>'}</div>
        <div><h2>Available (${free().length})</h2>
        <div class="dr-filter"><input type="search" id="q" placeholder="Search players" value="${esc(filter.q)}"><select id="pos"><option value="">All</option>${['GK', 'DEF', 'MID', 'FWD'].map(p => `<option${filter.pos === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
        <ul class="dr-list">${list.map(p => playerRow(p, `${code ? `<button class="dr-b" data-add="${esc(p.id)}"${q.has(p.id) ? ' disabled' : ''}>${q.has(p.id) ? 'Queued' : '+ Queue'}</button>` : ''}${myTurn() ? `<button class="dr-b pick" data-pick="${esc(p.id)}"${blocked(p) ? ` disabled title="${esc(blocked(p))}"` : ''}>Pick</button>` : ''}`)).join('') || '<li class="empty">No players match.</li>'}</ul></div></section>`;
    }

    function queueTab() {
      if (!code) return '<p class="empty">Your account isn’t linked to a club.</p>';
      const map = byId(), q = queue();
      return `<section><h2>My queue</h2><p class="quiet">Drag to reorder (or use the arrows). Add players from the Board. Players taken by other clubs drop off by themselves.</p>
        ${myTurn() && q.length ? `<button class="dr-b pick big" data-pick="${esc(q[0])}"${blocked(map.get(q[0])) ? ` disabled title="${esc(blocked(map.get(q[0])))}"` : ''}>Pick now: ${esc(map.get(q[0])?.name)}</button>` : ''}
        <ol class="dr-list" id="queue">${q.map((id, i) => playerRow(map.get(id), `<span class="mv"><button class="dr-b" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>▲</button><button class="dr-b" data-down="${i}" aria-label="Move down"${i < q.length - 1 ? '' : ' disabled'}>▼</button><button class="dr-b" data-rm="${i}" aria-label="Remove">✕</button></span>`, ` draggable="true" data-i="${i}"`)).join('') || '<li class="empty">Your queue is empty.</li>'}</ol></section>`;
    }

    function autoTab() {
      if (!code) return '<p class="empty">Your account isn’t linked to a club.</p>';
      const { mode, minutes } = st.prefs, max = st.draft.pick_minutes;
      return `<section><h2>Auto-pick</h2><p class="quiet">What happens to your queue when you’re on the clock. The office can change this too.</p>
        <form id="auto" class="dr-auto">${MODES.map(([v, l, h]) => `<label class="dr-mode"><input type="radio" name="mode" value="${v}"${mode === v ? ' checked' : ''}><span><b>${l}</b><br><small>${h}</small></span></label>`).join('')}
        <label class="dr-min">Minutes into my turn <input type="number" name="minutes" min="1"${max ? ` max="${max}"` : ''} value="${esc(minutes ?? '')}"${mode === 'after_minutes' ? '' : ' disabled'}> ${max ? `<small>(up to ${max}, the pick timer)</small>` : ''}</label>
        <button class="dr-b pick" type="submit">Save</button></form></section>`;
    }

    function valuesTab() {
      const by = new Map();
      for (const p of players) if (p.team) { if (!by.has(p.team)) by.set(p.team, []); by.get(p.team).push(p); }
      const clubs = [...by.entries()].map(([c, ps]) => ({ c, ps: ps.sort((a, b) => b.value - a.value), total: ps.reduce((s, p) => s + p.value, 0) }))
        .sort((a, b) => (a.c === code ? -1 : b.c === code ? 1 : b.total - a.total));
      return `<section><h2>Team values</h2><div class="dr-teams">${clubs.map(({ c, ps, total }) => `<details class="dr-team${c === code ? ' me' : ''}"${c === code ? ' open' : ''}><summary><b>${esc(nameOf(c))}</b><span>${ps.length} players · ${money(total)}</span></summary>
        <ul class="dr-list">${ps.map(p => playerRow(p)).join('')}</ul></details>`).join('') || '<p class="empty">No club has a player yet.</p>'}</div></section>`;
    }

    function draw() {
      const open = [...main.querySelectorAll('details.dr-team')].map(d => d.open);
      main.innerHTML = `<div class="draft">${head()}<nav class="dr-tabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${l}</button>`).join('')}</nav>
        <p class="dr-msg" role="status">${esc(msg)}</p>${{ board, queue: queueTab, auto: autoTab, values: valuesTab }[tab]()}</div>`;
      if (tab === 'values') main.querySelectorAll('details.dr-team').forEach((d, i) => { if (i in open) d.open = open[i]; });
    }

    async function refresh() {
      try {
        if (!await openDraft()) { location.reload(); return; }
        const typing = document.activeElement?.matches?.('input,select');
        forgetPlayers();
        [st, players] = await Promise.all([loadDraft(draft0.id, code), loadPlayers({ fresh: true })]);
        if (!typing) draw();
      } catch { /* try again next time */ }
    }

    const fail = e => { msg = /not your turn/i.test(e.message) ? 'It isn’t your turn.' : /taken|already/i.test(e.message) ? 'That player has just been taken.' : `That didn’t work: ${e.message}`; };
    async function setQueue(list) {
      st.queue = list; draw();
      try { await saveQueue(draft0.id, code, list); msg = ''; } catch (e) { fail(e); }
      draw();
    }

    main.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const q = queue(), d = b.dataset;
      if (d.tab) { tab = d.tab; location.hash = tab; msg = ''; draw(); }
      else if (d.add) setQueue([...q, d.add]);
      else if (d.rm) setQueue(q.filter((_, i) => i !== +d.rm));
      else if (d.up || d.down) {
        const i = +(d.up ?? d.down), j = d.up ? i - 1 : i + 1, n = [...q];
        [n[i], n[j]] = [n[j], n[i]]; setQueue(n);
      } else if (d.pick) {
        const p = byId().get(d.pick);
        if (!confirm(`Pick ${p?.name || 'this player'} for ${nameOf(code)}?`)) return;
        b.disabled = true;
        try { await makePick(draft0.id, d.pick); msg = `You picked ${p?.name}.`; await refresh(); } catch (er) { fail(er); }
        draw();
      }
    });
    main.addEventListener('input', e => {
      if (e.target.id === 'q') { filter.q = e.target.value; const s = e.target.selectionStart; draw(); const i = main.querySelector('#q'); i.focus(); i.setSelectionRange(s, s); }
      if (e.target.name === 'mode') main.querySelector('[name=minutes]').disabled = e.target.value !== 'after_minutes';
    });
    main.addEventListener('change', e => { if (e.target.id === 'pos') { filter.pos = e.target.value; draw(); } });
    main.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, mode = f.mode.value, minutes = Math.round(+f.minutes.value), max = st.draft.pick_minutes;
      if (mode === 'after_minutes' && !(minutes >= 1 && (!max || minutes <= max))) { msg = `Enter minutes from 1${max ? ` to ${max}` : ''}.`; draw(); return; }
      try { await savePrefs(draft0.id, code, mode, minutes); st.prefs = { mode, minutes: mode === 'after_minutes' ? minutes : null }; msg = 'Saved.'; } catch (er) { fail(er); }
      draw();
    });
    // Drag to reorder the queue.
    let from = null;
    main.addEventListener('dragstart', e => { from = +e.target.closest?.('[data-i]')?.dataset.i; });
    main.addEventListener('dragover', e => { if (e.target.closest?.('#queue')) e.preventDefault(); });
    main.addEventListener('drop', e => {
      const to = +e.target.closest?.('[data-i]')?.dataset.i;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
      e.preventDefault();
      const n = queue(); n.splice(to, 0, n.splice(from, 1)[0]); from = null; setQueue(n);
    });

    draw();
    main.setAttribute('aria-busy', 'false');
    setInterval(() => { const c = document.getElementById('clock'); if (c && st.draft.pick_deadline) c.textContent = fmt(Math.max(0, new Date(st.draft.pick_deadline) - Date.now())); }, 1000);
    setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
}
