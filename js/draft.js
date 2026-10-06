// Draft (0.21): the manager's side of the limited-time draft. Four tabs: Board, My queue, Auto-pick, Team values.
// Only reachable while a draft is live/paused inside its window; otherwise a short "no draft" note. Polls every 15 s.
import { enterPlace } from './shell.js';
import { esc } from './member.js';
import { openDraft, loadDraft, saveQueue, savePrefs, makePick } from './draft-data.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { ago } from './places.js';
import { overall } from './names.js';

// Auto-pick asks two things. WHAT to pick, then WHEN to do it.
const HOW = [
  ['queue', 'From my queue', 'The first player in my queue who is still free and fits the roster rules.'],
  ['random', 'A random player', 'Any free player who fits the roster rules, chosen at random.'],
];
const MODES = [
  ['always', 'The moment it’s my turn', 'Pick for me straight away.'],
  ['after_minutes', 'After a few minutes', 'Pick for me once my turn has lasted this long.'],
  ['on_miss', 'If I miss my turn', 'Pick for me only when my pick timer runs out.'],
  ['never', 'Never', 'I’ll pick myself. A missed turn is handled the way the office set.'],
];
// The board's columns. dir: 1 = low to high, -1 = high to low. `first` is the direction a first click sorts by.
const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
const COLS = [
  { key: 'position', label: 'Pos', long: 'Position', first: 1, val: p => POS_ORDER[p.position] ?? 9 },
  { key: 'name', label: 'Player', long: 'Name', first: 1, val: p => p.name.toLowerCase() },
  { key: 'number', label: '#', long: 'Number', first: 1, val: p => p.number ?? 0 },
  { key: 'offense', label: 'OFF', long: 'Offensive rating', first: -1, val: p => p.offense },
  { key: 'defense', label: 'DEF', long: 'Defensive rating', first: -1, val: p => p.defense },
  { key: 'overall', label: 'OVR', long: 'Overall rating', first: -1, val: p => overall(p) },
  { key: 'value', label: 'Value', long: 'Value', first: -1, val: p => p.value },
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

    // Sorting: a list of levels, most important first (for example Position, then Defensive rating high to low).
    let sort = [{ key: 'value', dir: -1 }];
    const col = k => COLS.find(c => c.key === k);
    const arrow = d => (d > 0 ? '▲' : '▼');
    const sorted = list => [...list].sort((a, b) => {
      for (const { key, dir } of sort) { const x = col(key).val(a), y = col(key).val(b); if (x !== y) return (x < y ? -1 : 1) * dir; }
      return a.name < b.name ? -1 : 1;
    });
    function clickSort(key, add) {
      const i = sort.findIndex(s => s.key === key);
      if (add) { if (i >= 0) sort[i].dir *= -1; else sort.push({ key, dir: col(key).first }); }
      else if (i === 0 && sort.length === 1) sort[0].dir *= -1;
      else sort = [{ key, dir: i === 0 ? sort[0].dir * -1 : col(key).first }];
    }

    function board() {
      const map = byId(), recent = st.picks.slice(-8).reverse(), q = new Set(st.queue);
      const list = sorted(free().filter(p => (!filter.pos || p.position === filter.pos) && (!filter.q || p.name.toLowerCase().includes(filter.q.toLowerCase())))).slice(0, 400);
      const unused = COLS.filter(c => !sort.some(s => s.key === c.key));
      return `<details class="dr-recent-wrap" open><summary>Recent picks</summary>${recent.length ? `<ol class="dr-recent">${recent.map(r => `<li${r.club === code ? ' class="me"' : ''}><b>#${r.pick_no}</b> ${esc(nameOf(r.club))} took ${esc(map.get(r.player)?.name || r.player)} <small>${r.made_at ? esc(ago(new Date(r.made_at))) : ''}</small></li>`).join('')}</ol>` : '<p class="empty">No picks yet.</p>'}</details>
        <section><h2>Available (${free().length})</h2>
        <div class="dr-filter"><input type="search" id="q" placeholder="Search players" value="${esc(filter.q)}"><select id="pos" aria-label="Position"><option value="">All positions</option>${['GK', 'DEF', 'MID', 'FWD'].map(p => `<option${filter.pos === p ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="dr-sortbar"><span>Sort by</span>${sort.map((s, i) => `<span class="dr-chip"><b>${i + 1}</b><button data-sflip="${i}" title="Flip direction">${esc(col(s.key).long)} ${arrow(s.dir)}</button><button data-sdel="${i}" aria-label="Stop sorting by ${esc(col(s.key).long)}"${sort.length > 1 ? '' : ' disabled'}>✕</button></span>`).join('')}
          ${unused.length ? `<select id="sadd" aria-label="Add a sort"><option value="">+ Then by…</option>${unused.map(c => `<option value="${c.key}">${esc(c.long)}</option>`).join('')}</select>` : ''}
          <button class="dr-b" data-sreset>Reset</button></div>
        <p class="quiet dr-hint">Tap a heading to sort by it. Shift-tap, or use “Then by…”, to add a second or third level.</p>
        <div class="dr-tablewrap"><table class="dr-table"><thead><tr>${COLS.map(c => { const i = sort.findIndex(s => s.key === c.key);
          return `<th class="c-${c.key}" aria-sort="${i < 0 ? 'none' : sort[i].dir > 0 ? 'ascending' : 'descending'}"><button data-sort="${c.key}" title="${esc(c.long)}">${esc(c.label)}${i < 0 ? '' : ` <span class="dr-ar">${arrow(sort[i].dir)}${sort.length > 1 ? `<sup>${i + 1}</sup>` : ''}</span>`}</button></th>`; }).join('')}<th></th></tr></thead>
          <tbody>${list.map(p => `<tr><td class="c-position">${esc(p.position)}</td><td class="c-name">${esc(p.name)}</td><td class="c-number">${esc(p.number ?? '')}</td><td>${p.offense}</td><td>${p.defense}</td><td>${overall(p).toFixed(1)}</td><td>${money(p.value)}</td>
            <td class="c-act">${code ? `<button class="dr-b" data-add="${esc(p.id)}"${q.has(p.id) ? ' disabled' : ''}>${q.has(p.id) ? 'Queued' : '+ Queue'}</button>` : ''}${myTurn() ? `<button class="dr-b pick" data-pick="${esc(p.id)}"${blocked(p) ? ` disabled title="${esc(blocked(p))}"` : ''}>Pick</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No players match.</td></tr>'}</tbody></table></div></section>`;
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
      const { mode, minutes, pick_how: how = 'queue' } = st.prefs, max = st.draft.pick_minutes;
      const radio = (name, list, cur) => list.map(([v, l, h]) => `<label class="dr-mode"><input type="radio" name="${name}" value="${v}"${cur === v ? ' checked' : ''}><span><b>${l}</b><br><small>${h}</small></span></label>`).join('');
      return `<section><h2>Auto-pick</h2><p class="quiet">Let the draft pick for you when you can’t be here. The office can change this too.</p>
        <form id="auto" class="dr-auto"><h3>What should it pick?</h3>${radio('how', HOW, how)}
        <h3>When should it pick?</h3>${radio('mode', MODES, mode)}
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
      else if (d.sort) { clickSort(d.sort, e.shiftKey); draw(); }
      else if (d.sflip !== undefined) { sort[+d.sflip].dir *= -1; draw(); }
      else if (d.sdel !== undefined) { sort.splice(+d.sdel, 1); draw(); }
      else if (d.sreset !== undefined) { sort = [{ key: 'value', dir: -1 }]; draw(); }
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
    main.addEventListener('change', e => {
      if (e.target.id === 'pos') { filter.pos = e.target.value; draw(); }
      if (e.target.id === 'sadd' && e.target.value) { sort.push({ key: e.target.value, dir: col(e.target.value).first }); draw(); }
    });
    main.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, mode = f.mode.value, how = f.how.value, minutes = Math.round(+f.minutes.value), max = st.draft.pick_minutes;
      if (mode === 'after_minutes' && !(minutes >= 1 && (!max || minutes <= max))) { msg = `Enter minutes from 1${max ? ` to ${max}` : ''}.`; draw(); return; }
      try { await savePrefs(draft0.id, code, mode, minutes, how); st.prefs = { mode, minutes: mode === 'after_minutes' ? minutes : null, pick_how: how }; msg = 'Saved.'; } catch (er) { fail(er); }
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
