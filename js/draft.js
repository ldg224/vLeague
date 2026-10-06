// Draft (0.21): the manager's side of the limited-time draft. Three tabs: Board (every pick so far), Available players (with
// My queue and Auto-pick beside them) and Team values. A budget bar under the roster rules shows the weekly cap used.
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
// Extra columns the Board's table has over the Available table.
const EXTRA = {
  pick: { key: 'pick', label: '#', long: 'Pick', first: 1, val: r => r.pick_no },
  club: { key: 'club', label: 'Club', long: 'Club', first: 1, val: r => r.clubName.toLowerCase() },
  how: { key: 'how', label: 'How', long: 'How picked', first: 1, val: r => r.how },
};
const TABS = [['board', 'Board'], ['players', 'Available players'], ['values', 'Team values']];
const CAP = 100000;   // the weekly cap per team (supabase/migrations/0010_cap_100k_prices.sql)
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
    let tab = (() => { const h = location.hash.slice(1); return h === 'queue' || h === 'auto' ? 'players' : TABS.some(t => t[0] === h) ? h : 'board'; })();
    let st = await loadDraft(draft0.id, code), players = await loadPlayers({ fresh: true });
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
      if (!p) return '';
      const mx = st.draft.roster_max || {}, mn = st.draft.roster_min || {}, have = pos => players.filter(x => x.team === code && x.position === pos).length;
      if (mx[p.position] != null && have(p.position) >= mx[p.position]) return `You already have the most ${p.position} allowed (${mx[p.position]}).`;
      const left = st.order.filter(o => o.club === code && o.pick_no > st.draft.current_pick).length;
      const needed = Object.keys(mn).reduce((n, k) => n + Math.max(0, mn[k] - have(k) - (k === p.position ? 1 : 0)), 0);
      return needed > left ? 'Taking this player would leave too few picks to fill every position.' : '';
    };
    const playerRow = (p, extra = '', attrs = '') => `<li class="dr-p"${attrs}><span class="pos">${esc(p.position)}</span>
      <span class="nm">${esc(p.name)}</span><span class="rt">${p.offense}/${p.defense}</span><span class="val">${money(p.value)}</span>${extra}</li>`;

    // How much of the weekly cap this club's squad uses (the draft shows it; it doesn't block a pick).
    function budget() {
      if (!code) return '';
      const mine = players.filter(p => p.team === code), used = mine.reduce((n, p) => n + (p.value || 0), 0), pct = Math.min(100, used / CAP * 100);
      const state = used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : '';
      return `<div class="dr-budget${state}"><div class="dr-budget-text"><b>Weekly budget</b><span>${money(used)} of ${money(CAP)} used · ${used > CAP ? `${money(used - CAP)} over the cap` : `${money(CAP - used)} left`} · ${mine.length} player${mine.length === 1 ? '' : 's'}</span></div>
        <div class="dr-bar" role="progressbar" aria-label="Weekly budget used" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
    }

    function head() {
      const d = st.draft, t = turn();
      const clock = d.status === 'paused' ? 'Paused' : d.status !== 'live' ? '' : `<span id="clock">${fmt(Math.max(0, d.pick_deadline ? new Date(d.pick_deadline) - Date.now() : 0))}</span>`;
      return `<div class="dr-head"><div><h1 class="page-title" tabindex="-1">${esc(d.name || 'Draft')}</h1>
        <p class="quiet">${t ? `Pick ${t.pick_no} of ${st.order.length}: <b>${esc(nameOf(t.club))}</b>${t.club === code ? ' (you)' : ''}` : 'Draft complete'}</p>${rulesText() ? `<p class="quiet">Roster rules: ${esc(rulesText())}</p>` : ''}</div>
        <div class="dr-clock${myTurn() ? ' mine' : ''}">${myTurn() ? '<small>Your pick</small>' : ''}${clock}</div></div>${budget()}`;
    }

    // ---- tables. Two of them (picked players, available players), each with its own filters and sort levels.
    const F = { avail: { q: '', pos: '' }, board: { q: '', pos: '', club: '' } };
    const DEFAULT = { avail: [{ key: 'value', dir: -1 }], board: [{ key: 'pick', dir: 1 }] };
    const SORTS = { avail: DEFAULT.avail.map(s => ({ ...s })), board: DEFAULT.board.map(s => ({ ...s })) };
    const colsOf = t => (t === 'board' ? [EXTRA.pick, EXTRA.club, ...COLS, EXTRA.how] : COLS);
    const col = (t, k) => colsOf(t).find(c => c.key === k);
    const arrow = d => (d > 0 ? '▲' : '▼');
    const sorted = (t, list) => [...list].sort((a, b) => {
      for (const { key, dir } of SORTS[t]) { const x = col(t, key).val(a), y = col(t, key).val(b); if (x !== y) return (x < y ? -1 : 1) * dir; }
      return a.name < b.name ? -1 : 1;
    });
    function clickSort(t, key, add) {
      const s = SORTS[t], i = s.findIndex(x => x.key === key);
      if (add) { if (i >= 0) s[i].dir *= -1; else s.push({ key, dir: col(t, key).first }); }
      else if (i === 0 && s.length === 1) s[0].dir *= -1;
      else SORTS[t] = [{ key, dir: i === 0 ? s[0].dir * -1 : col(t, key).first }];
    }
    const passes = (t, r) => { const f = F[t]; return (!f.pos || r.position === f.pos) && (!f.club || r.club === f.club)
      && (!f.q || `${r.name} ${r.clubName || ''}`.toLowerCase().includes(f.q.toLowerCase())); };

    function toolbar(t) {
      const f = F[t], s = SORTS[t], unused = colsOf(t).filter(c => !s.some(x => x.key === c.key));
      const clubs = [...new Set(st.order.map(o => o.club))].sort((a, b) => (a === code ? -1 : b === code ? 1 : nameOf(a) < nameOf(b) ? -1 : 1));
      return `<div class="dr-filter"><input type="search" data-f="q" data-t="${t}" placeholder="${t === 'board' ? 'Search players or clubs' : 'Search players'}" value="${esc(f.q)}">
        <select data-f="pos" data-t="${t}" aria-label="Position"><option value="">All positions</option>${['GK', 'DEF', 'MID', 'FWD'].map(p => `<option${f.pos === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
        ${t === 'board' ? `<select data-f="club" data-t="board" aria-label="Club"><option value="">All clubs</option>${clubs.map(c => `<option value="${esc(c)}"${f.club === c ? ' selected' : ''}>${esc(nameOf(c))}${c === code ? ' (you)' : ''}</option>`).join('')}</select>` : ''}</div>
        <div class="dr-sortbar"><span>Sort by</span>${s.map((x, i) => `<span class="dr-chip"><b>${i + 1}</b><button data-t="${t}" data-sflip="${i}" title="Flip direction">${esc(col(t, x.key).long)} ${arrow(x.dir)}</button><button data-t="${t}" data-sdel="${i}" aria-label="Stop sorting by ${esc(col(t, x.key).long)}"${s.length > 1 ? '' : ' disabled'}>✕</button></span>`).join('')}
          ${unused.length ? `<select data-sadd="${t}" aria-label="Add a sort"><option value="">+ Then by…</option>${unused.map(c => `<option value="${c.key}">${esc(c.long)}</option>`).join('')}</select>` : ''}
          <button class="dr-b" data-t="${t}" data-sreset>Reset</button></div>
        <p class="quiet dr-hint">Tap a heading to sort by it. Shift-tap, or use “Then by…”, to sort by a second or third thing, for example Position, then Defensive rating.</p>`;
    }
    function table(t, rows, rowHtml, empty) {
      const cols = colsOf(t), s = SORTS[t];
      return `<div class="dr-tablewrap"><table class="dr-table dr-${t}"><thead><tr>${cols.map(c => { const i = s.findIndex(x => x.key === c.key);
        return `<th class="c-${c.key}" aria-sort="${i < 0 ? 'none' : s[i].dir > 0 ? 'ascending' : 'descending'}"><button data-t="${t}" data-sort="${c.key}" title="${esc(c.long)}">${esc(c.label)}${i < 0 ? '' : ` <span class="dr-ar">${arrow(s[i].dir)}${s.length > 1 ? `<sup>${i + 1}</sup>` : ''}</span>`}</button></th>`; }).join('')}${t === 'avail' ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.map(rowHtml).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
    }
    const ratings = p => `<td>${p.offense}</td><td>${p.defense}</td><td>${overall(p).toFixed(1)}</td><td>${money(p.value)}</td>`;
    const HOWS = { manual: 'Picked', queue: 'Queue', auto: 'Auto', office: 'Office', skip: 'Skipped' };

    // Board: every pick made so far, as a spreadsheet.
    function boardTab() {
      const map = byId();
      const rows = st.picks.map(k => { const p = map.get(k.player);
        return { ...(p || { name: '— skipped —', position: '', number: null, offense: 0, defense: 0, value: 0 }), pick_no: k.pick_no, club: k.club, clubName: nameOf(k.club), how: k.how, skipped: !p }; });
      const shown = sorted('board', rows.filter(r => passes('board', r)));
      return `<section><h2>Picked players (${st.picks.length} of ${st.order.length} picks made)</h2>${toolbar('board')}
        ${table('board', shown, r => `<tr class="${r.club === code ? 'me' : ''}${r.skipped ? ' skipped' : ''}"><td class="c-pick">${r.pick_no}</td><td class="c-club">${esc(r.clubName)}</td><td class="c-position">${esc(r.position)}</td><td class="c-name">${esc(r.name)}</td><td class="c-number">${esc(r.number ?? '')}</td>${r.skipped ? '<td></td><td></td><td></td><td></td>' : ratings(r)}<td class="c-how">${esc(HOWS[r.how] || r.how)}</td></tr>`,
          st.picks.length ? 'No picks match.' : 'No picks yet.')}</section>`;
    }

    // Players: the queue and auto-pick on the left, every available player on the right.
    function queuePanel() {
      if (!code) return '<p class="empty">Your account isn’t linked to a club.</p>';
      const map = byId(), q = queue();
      return `<section class="dr-queue"><h2>My queue <small>${q.length}</small></h2>
        ${myTurn() && q.length ? `<button class="dr-b pick big" data-pick="${esc(q[0])}"${blocked(map.get(q[0])) ? ` disabled title="${esc(blocked(map.get(q[0])))}"` : ''}>Pick now: ${esc(map.get(q[0])?.name)}</button>` : ''}
        <ol class="dr-list" id="queue">${q.map((id, i) => playerRow(map.get(id), `<span class="mv"><button class="dr-b" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>▲</button><button class="dr-b" data-down="${i}" aria-label="Move down"${i < q.length - 1 ? '' : ' disabled'}>▼</button><button class="dr-b" data-rm="${i}" aria-label="Remove">✕</button></span>`, ` draggable="true" data-i="${i}"`)).join('') || '<li class="empty">Add players with “+ Queue”. Drag or use the arrows to rank them.</li>'}</ol></section>`;
    }
    function autoPanel(open) {
      if (!code) return '';
      const { mode, minutes, pick_how: how = 'queue' } = st.prefs, max = st.draft.pick_minutes;
      const hint = [...HOW, ...MODES].find(x => x[0] === how)?.[2], when = MODES.find(x => x[0] === mode)?.[2];
      return `<details class="dr-autobox"${open ? ' open' : ''}><summary>Auto-pick</summary>
        <form id="auto" class="dr-auto" novalidate>
          <label>What to pick<select name="how">${HOW.map(([v, l]) => `<option value="${v}"${how === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label><small>${esc(hint)}</small>
          <label>When<select name="mode">${MODES.map(([v, l]) => `<option value="${v}"${mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label><small>${esc(when)}</small>
          <label class="dr-min"${mode === 'after_minutes' ? '' : ' hidden'}>Minutes into my turn <input type="number" name="minutes" min="1"${max ? ` max="${max}"` : ''} value="${esc(minutes ?? '')}"> ${max ? `<small>(1 to ${max})</small>` : ''}</label>
          <small>Saves as you change it. The office can change it too.</small></form></details>`;
    }
    function playersTab(autoOpen) {
      const q = new Set(st.queue);
      const shown = sorted('avail', free().filter(p => passes('avail', p))).slice(0, 400);
      return `<div class="dr-avail"><aside class="dr-side">${queuePanel()}${autoPanel(autoOpen)}</aside>
        <section class="dr-main"><h2>Available players (${free().length})</h2>${toolbar('avail')}
        ${table('avail', shown, p => `<tr><td class="c-position">${esc(p.position)}</td><td class="c-name">${esc(p.name)}</td><td class="c-number">${esc(p.number ?? '')}</td>${ratings(p)}
          <td class="c-act">${code ? `<button class="dr-b" data-add="${esc(p.id)}"${q.has(p.id) ? ' disabled' : ''}>${q.has(p.id) ? 'Queued' : '+ Queue'}</button>` : ''}${myTurn() ? `<button class="dr-b pick" data-pick="${esc(p.id)}"${blocked(p) ? ` disabled title="${esc(blocked(p))}"` : ''}>Pick</button>` : ''}</td></tr>`, 'No players match.')}</section></div>`;
    }

    function valuesTab() {
      const by = new Map();
      for (const p of players) if (p.team) { if (!by.has(p.team)) by.set(p.team, []); by.get(p.team).push(p); }
      const clubs = [...by.entries()].map(([c, ps]) => ({ c, ps: ps.sort((a, b) => b.value - a.value), total: ps.reduce((s, p) => s + p.value, 0) }))
        .sort((a, b) => (a.c === code ? -1 : b.c === code ? 1 : b.total - a.total));
      return `<section><h2>Team values</h2><p class="quiet">Each club’s drafted players and what they cost, against the ${money(CAP)} weekly cap.</p><div class="dr-teams">${clubs.map(({ c, ps, total }) => `<details class="dr-team${c === code ? ' me' : ''}"${c === code ? ' open' : ''}><summary><b>${esc(nameOf(c))}</b><span>${ps.length} players · ${money(total)} of ${money(CAP)}</span></summary>
        <ul class="dr-list">${ps.map(p => playerRow(p)).join('')}</ul></details>`).join('') || '<p class="empty">No club has a player yet.</p>'}</div></section>`;
    }

    function draw() {
      const open = [...main.querySelectorAll('details.dr-team')].map(d => d.open), autoOpen = main.querySelector('.dr-autobox')?.open ?? true;
      main.innerHTML = `<div class="draft">${head()}<nav class="dr-tabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${l}</button>`).join('')}</nav>
        <p class="dr-msg" role="status">${esc(msg)}</p>${tab === 'players' ? playersTab(autoOpen) : { board: boardTab, values: valuesTab }[tab]()}</div>`;
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
      else if (d.sort) { clickSort(d.t, d.sort, e.shiftKey); draw(); }
      else if (d.sflip !== undefined) { SORTS[d.t][+d.sflip].dir *= -1; draw(); }
      else if (d.sdel !== undefined) { SORTS[d.t].splice(+d.sdel, 1); draw(); }
      else if (d.sreset !== undefined) { SORTS[d.t] = DEFAULT[d.t].map(s => ({ ...s })); draw(); }
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
      const t = e.target;
      if (t.dataset.f === 'q') {
        F[t.dataset.t].q = t.value; const s = t.selectionStart; draw();
        const i = main.querySelector(`[data-f="q"][data-t="${t.dataset.t}"]`); i.focus(); i.setSelectionRange(s, s);
      }
    });
    // Auto-pick saves as it changes. "After a few minutes" waits for a valid number of minutes.
    async function saveAuto(f) {
      const mode = f.mode.value, how = f.how.value, minutes = Math.round(+f.minutes.value) || null, max = st.draft.pick_minutes;
      st.prefs = { mode, minutes: mode === 'after_minutes' ? minutes : null, pick_how: how };
      if (mode === 'after_minutes' && !(minutes >= 1 && (!max || minutes <= max))) { msg = `Enter minutes from 1${max ? ` to ${max}` : ''} to save this.`; draw(); return; }
      try { await savePrefs(draft0.id, code, mode, minutes, how); msg = 'Auto-pick saved.'; } catch (er) { fail(er); }
      draw();
    }
    main.addEventListener('change', e => {
      const t = e.target;
      if (t.form?.id === 'auto') { saveAuto(t.form); return; }
      if (t.dataset.f && t.dataset.t) { F[t.dataset.t][t.dataset.f] = t.value; draw(); }
      else if (t.dataset.sadd && t.value) { SORTS[t.dataset.sadd].push({ key: t.value, dir: col(t.dataset.sadd, t.value).first }); draw(); }
    });
    main.addEventListener('submit', e => e.preventDefault());
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
