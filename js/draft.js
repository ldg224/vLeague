// Draft (0.21): the manager's side of the limited-time draft. Three tabs: Board (the draft as a grid), Available players (with
// My queue and Auto-pick beside them) and Team values. A big status bar on top says where the draft stands; a budget bar under
// it shows the weekly cap used. The page shows once the office switches "Make page visible" on (0.32), even before the draft
// starts: managers can read everything and build their queues, and only picking waits for a live draft. Updates the moment a
// pick is made (realtime), with a 15 s poll as backup. Tap a player's name for their card; picks are confirmed in a small dialog.
import { snapshotInputs, restoreInputs } from './paint.js';
import { enterPlace } from './shell.js';
import { esc } from './member.js';
import { icon } from './icons.js';
import { openDraft, phase, loadDraft, saveQueue, savePrefs, makePick, quietState, describeQuiet } from './draft-data.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { ago } from './places.js';
import { overall } from './names.js';
import { gridOf, renderGrid } from './draft-grid.js';
import { startTour, tourSeen } from './tour.js';
import { db } from './auth.js';

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
const TABS = [['board', 'Board'], ['players', 'Available players'], ['values', 'Team values']];
const CAP = 125000;   // the weekly cap per team: $125,000 from 0.39.1 (was $100,000, supabase/migrations/0010_cap_100k_prices.sql set the prices)
const money = n => `$${Number(n || 0).toLocaleString('en-AU')}`;
const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`; };

const ctx = await enterPlace('draft');
if (ctx) {
  const { main, club } = ctx, code = club?.code;
  const clubName = new Map((ctx.season?.teams || []).map(t => [t.code, t.name]));
  const nameOf = c => (c === code && club?.name) || clubName.get(c) || c;
  const draft0 = await openDraft();
  if (!draft0) {
    main.innerHTML = '<h1 class="page-title" tabindex="-1">Draft</h1><p class="empty">The draft page isn’t open yet. It will appear here as soon as the league office makes it visible.</p><p><a class="btn ghost" href="club.html">Set your team sheet meanwhile</a></p>';
    main.setAttribute('aria-busy', 'false');
  } else {
    let tab = (() => { const h = location.hash.slice(1); return h === 'queue' || h === 'auto' ? 'players' : TABS.some(t => t[0] === h) ? h : 'board'; })();
    // The draft plus, when it has quiet times, how the clock stands (so it can freeze while the timer is paused).
    const loadAll = async () => { const s = await loadDraft(draft0.id, code); s.qs = s.draft?.quiet?.length ? await quietState(draft0.id) : null; return s; };
    let st = await loadAll(), players = await loadPlayers({ fresh: true });
    let qSaves = 0, qChain = Promise.resolve(), failed = false;   // queue saves in flight
    let msg = '', sub = 'players';   // sub: which part of Available players shows on a phone (players, queue or auto-pick)
    const byId = () => new Map(players.map(p => [p.id, p]));

    const turn = () => st.order.find(o => o.pick_no === st.draft.current_pick) || null;
    const myTurn = () => phase(st.draft) === 'live' && turn()?.club === code;
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
      const madeNo = new Set(st.picks.map(k => k.pick_no));
      const left = st.order.filter(o => o.club === code && o.pick_no !== st.draft.current_pick && !madeNo.has(o.pick_no)).length;
      const needed = Object.keys(mn).reduce((n, k) => n + Math.max(0, mn[k] - have(k) - (k === p.position ? 1 : 0)), 0);
      return needed > left ? 'Taking this player would leave too few picks to fill every position.' : '';
    };
    const playerRow = (p, extra = '', attrs = '') => `<li class="dr-p"${attrs}><span class="pos">${esc(p.position)}</span>
      <span class="nm"><button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button></span><span class="rts">${chip(p.offense)}${chip(p.defense)}</span><span class="val">${money(p.value)}</span>${extra}</li>`;

    // What this club's squad is worth now.
    const squadValue = () => players.filter(p => p.team === code).reduce((n, p) => n + (p.value || 0), 0);
    // The queue with a running total (S-10): what the squad would be worth, and what is left under the cap, as each queued player is
    // added in order. A guide only: other clubs take players and the queue may skip someone who no longer fits, so it can differ.
    const afterText = total => (total > CAP ? `over the cap by ${money(total - CAP)}` : `${money(CAP - total)} left`);
    function queueRunning(q, map) {
      let run = squadValue();
      return q.map(id => { run += map.get(id)?.value || 0; return run; });
    }

    // How much of the weekly cap this club's squad uses (the draft shows it; it doesn't block a pick).
    function budget() {
      if (!code) return '';
      const mine = players.filter(p => p.team === code), used = squadValue(), pct = Math.min(100, used / CAP * 100);
      const state = used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : '';
      return `<div class="dr-budget${state}"><div class="dr-budget-text"><b>Weekly budget</b><span>${money(used)} of ${money(CAP)} used · ${used > CAP ? `${money(used - CAP)} over the cap` : `${money(CAP - used)} left`} · ${mine.length} player${mine.length === 1 ? '' : 's'}</span></div>
        <div class="dr-bar" role="progressbar" aria-label="Weekly budget used" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
    }

    // Active times: the pick timer runs only inside them (drafts.quiet holds them; 0040) (managers can still pick). The clock shows ACTIVE time left, frozen while it's quiet.
    const inQuiet = () => !!st.qs?.quiet_until && Date.now() < new Date(st.qs.quiet_until);
    const clockMs = () => {
      const d = st.draft; if (!d.pick_deadline) return 0;
      const q = st.qs; if (!q || q.active_left == null) return Math.max(0, new Date(d.pick_deadline) - Date.now());
      return inQuiet() ? q.active_left * 1000 : Math.max(0, q.active_left * 1000 - (Date.now() - q.at));
    };
    // The big status bar: where the draft stands, whose turn it is and the clock, in one glance. Rules and quiet times sit
    // underneath in small print.
    const whenAt = iso => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    function head() {
      const d = st.draft, t = turn(), ph = phase(d), mine = myTurn(), n = st.order.length;
      const who = t ? `${esc(nameOf(t.club))}${t.club === code ? ' (you)' : ''}` : '';
      const B = {
        soon: ['Not started yet', 'Get ready', 'Read the rules, look through the players and build your queue. You can pick as soon as the draft starts.', ''],
        opens: ['Opens soon', 'Get ready', `Opens ${esc(whenAt(d.opens_at))}. Build your queue and set auto-pick now.`, `<small>Opens in</small><span id="clock" data-until="${esc(d.opens_at)}">${fmt(new Date(d.opens_at) - Date.now())}</span>`],
        live: ['Live', mine ? 'It’s your pick' : t ? `${who} is picking` : 'Draft complete', t ? `Pick ${t.pick_no} of ${n}${mine ? '. Choose any player before the clock runs out.' : '.'}${d.pick_deadline ? ` The pick ends <b>${esc(whenAt(d.pick_deadline))}</b>${d.quiet?.length ? ', counting only active times' : ''}. The clock runs even when nobody has the page open.` : ''}` : '',
          `${mine ? '<small>Your time</small>' : '<small>Time left</small>'}<span id="clock">${fmt(clockMs())}</span>`],
        paused: ['Paused', 'The draft is paused', `${t ? `Pick ${t.pick_no} of ${n}, ${who} is up. ` : ''}It carries on when the office resumes it. You can still change your queue.`, ''],
        closed: ['Closed', 'The draft has closed', 'Picks can’t be made now.', ''],
        done: ['Finished', 'The draft is finished', `All ${n} picks are done.`, ''],
      }[ph];
      const quiet = d.quiet?.length ? (inQuiet() && ph === 'live' ? `${icon('pause')} Outside active times: the timer is paused until ${new Date(st.qs.quiet_until).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' })}. You can still pick.` : `The pick timer runs ${describeQuiet(d.quiet)}, and is paused at other times. You can still pick whenever you’re online.`) : '';
      const small = [rulesText() && `Roster rules: ${rulesText()}`, quiet].filter(Boolean);
      return `<section class="dr-status ph-${ph}${mine ? ' mine' : ''}${ph === 'live' && inQuiet() ? ' quiet' : ''}"><div class="dr-st-main"><div><span class="dr-st-tag">${B[0]}</span><p class="dr-st-name">${esc(d.name || 'Draft')}</p>
        <h1 class="page-title dr-st-big" tabindex="-1">${B[1]}</h1><p class="dr-st-sub">${B[2]}</p></div>
        ${B[3] ? `<div class="dr-clock">${B[3]}</div>` : ''}</div>
        ${small.length ? `<p class="dr-st-small">${small.map(esc).join(' · ')}</p>` : ''}</section>${budget()}`;
    }

    // ---- the table of available players, with its filters and sort levels.
    const F = { avail: { q: '', pos: '', max: '', fit: false } };
    const DEFAULT = { avail: [{ key: 'value', dir: -1 }] };
    const SORTS = { avail: DEFAULT.avail.map(s => ({ ...s })) };
    const colsOf = () => COLS;
    const col = (t, k) => colsOf(t).find(c => c.key === k);
    const arrow = d => (d > 0 ? icon('chevron-up') : icon('chevron-down'));
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
    const passes = (t, r) => { const f = F[t]; return (!f.pos || r.position === f.pos) && (!f.q || r.name.toLowerCase().includes(f.q.toLowerCase()))
      && (!+f.max || r.value <= +f.max) && (!f.fit || !blocked(r)); };

    function toolbar(t) {
      const f = F[t], s = SORTS[t], unused = colsOf(t).filter(c => !s.some(x => x.key === c.key));
      return `<div class="dr-filter"><input type="search" data-f="q" data-t="${t}" placeholder="Search players" value="${esc(f.q)}">
        <select data-f="pos" data-t="${t}" aria-label="Position"><option value="">All positions</option>${['GK', 'DEF', 'MID', 'FWD'].map(p => `<option${f.pos === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
        <input type="number" inputmode="numeric" min="0" step="1000" data-f="max" data-t="avail" placeholder="Max value $" aria-label="Maximum value" value="${esc(f.max)}">${code ? `<label class="dr-fit"><input type="checkbox" data-f="fit" data-t="avail"${f.fit ? ' checked' : ''}> Fits my squad</label>` : ''}</div>
        <div class="dr-sortbar"><span>Sort by</span>${s.map((x, i) => `<span class="dr-chip"><b>${i + 1}</b><button data-t="${t}" data-sflip="${i}" title="Flip direction">${esc(col(t, x.key).long)} ${arrow(x.dir)}</button><button data-t="${t}" data-sdel="${i}" aria-label="Stop sorting by ${esc(col(t, x.key).long)}"${s.length > 1 ? '' : ' disabled'}>${icon('x')}</button></span>`).join('')}
          ${unused.length ? `<select data-sadd="${t}" aria-label="Add a sort"><option value="">+ Then by…</option>${unused.map(c => `<option value="${c.key}">${esc(c.long)}</option>`).join('')}</select>` : ''}
          <button class="dr-b" data-t="${t}" data-sreset>Reset</button></div>
        <p class="quiet dr-hint">Tap a heading to sort by it. Shift-tap, or use “Then by…”, to sort by a second or third thing, for example Position, then Defensive rating.</p>`;
    }
    function table(t, rows, rowHtml, empty) {
      const cols = colsOf(t), s = SORTS[t];
      return `<div class="dr-tablewrap"><table class="dr-table dt-${t}"><thead><tr>${cols.map(c => { const i = s.findIndex(x => x.key === c.key);
        return `<th class="c-${c.key}" aria-sort="${i < 0 ? 'none' : s[i].dir > 0 ? 'ascending' : 'descending'}"><button data-t="${t}" data-sort="${c.key}" title="${esc(c.long)}">${esc(c.label)}${i < 0 ? '' : ` <span class="dr-ar">${arrow(s[i].dir)}${s.length > 1 ? `<sup>${i + 1}</sup>` : ''}</span>`}</button></th>`; }).join('')}${t === 'avail' ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.map(rowHtml).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
    }
    // Ratings use the app's red-to-green chips (css/site.css .rt) so strong and weak players stand out at a glance.
    const chip = (v, dec) => { const n = Number(v) || 0; return `<span class="rt rt-${Math.min(10, Math.max(1, Math.round(n)))}">${dec ? n.toFixed(1) : n}</span>`; };
    const ratings = p => `<td class="c-offense">${chip(p.offense)}</td><td class="c-defense">${chip(p.defense)}</td><td class="c-overall">${chip(overall(p), 1)}</td><td class="c-value">${money(p.value)}</td>`;
    const HOWS = { manual: 'Picked', queue: 'Queue', auto: 'Auto', office: 'Office', skip: 'Skipped' };

    // Board: the draft as a grid, a row per round and a column per club. The only thing on it.
    function boardTab() {
      const map = byId();
      const grid = renderGrid(gridOf(st.order, st.picks), {
        esc, clubName: nameOf, me: code, current: phase(st.draft) === 'live' ? st.draft.current_pick : null, made: st.picks.length,
        who: x => { const p = map.get(x.pick?.player); return p ? `<button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button> <small>${esc(p.position)}</small>` : '<i>skipped</i>'; },
      });
      return `<section><h2>Draft board <small class="dr-count">${st.picks.length} of ${st.order.length} picks made</small>${st.picks.length ? ' <button class="dr-b dr-export" data-export title="Download every pick so far as a spreadsheet">Download CSV</button>' : ''}</h2>${grid || '<p class="empty">The pick order hasn’t been set yet.</p>'}</section>`;
    }

    // Players: the queue and auto-pick on the left, every available player on the right.
    function queuePanel() {
      if (!code) return '<p class="empty">Your account isn’t linked to a club.</p>';
      const map = byId(), q = queue(), run = queueRunning(q, map);
      const end = run.length ? run[run.length - 1] : null;
      return `<section class="dr-queue"><h2>My queue <small>${q.length}</small></h2>
        ${end != null ? `<p class="dr-qsum${end > CAP ? ' over' : ''}">If your queue is picked in order, your squad is worth <b>${money(end)}</b>: ${afterText(end)}.</p>` : ''}
        ${myTurn() && q.length ? `<button class="dr-b pick big" data-pick="${esc(q[0])}"${blocked(map.get(q[0])) ? ` disabled title="${esc(blocked(map.get(q[0])))}"` : ''}>Pick now: ${esc(map.get(q[0])?.name)}</button>` : ''}
        <ol class="dr-list" id="queue">${q.map((id, i) => playerRow(map.get(id), `<span class="q-after${run[i] > CAP ? ' over' : ''}" title="Your squad's value after this player if your queue is picked in order">${money(run[i])} · ${afterText(run[i])}</span><span class="mv"><button class="dr-b" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>${icon('chevron-up')}</button><button class="dr-b" data-down="${i}" aria-label="Move down"${i < q.length - 1 ? '' : ' disabled'}>${icon('chevron-down')}</button><button class="dr-b" data-rm="${i}" aria-label="Remove">${icon('x')}</button></span>`, ` draggable="true" data-i="${i}"`)).join('') || '<li class="empty">Add players with “+ Queue”. Drag or use the arrows to rank them.</li>'}</ol></section>`;
    }
    function autoPanel(open) {
      if (!code) return '';
      const { mode, minutes, pick_how: how = 'queue' } = st.prefs, max = st.draft.pick_minutes;
      const hint = [...HOW, ...MODES].find(x => x[0] === how)?.[2], when = MODES.find(x => x[0] === mode)?.[2];
      // The office has set one rule for everyone: nothing here to change.
      if (st.draft.auto_after_minutes) return `<details class="dr-autobox"${open ? ' open' : ''}><summary>Auto-pick</summary>
        <p class="dr-locked">${icon('lock')} <b>Set by the league office.</b> Your queue picks for you ${esc(st.draft.auto_after_minutes)} minutes into your turn, whether or not you are online. Keep your queue up to date: with no queue you have the full ${esc(st.draft.pick_minutes >= 60 && st.draft.pick_minutes % 60 === 0 ? st.draft.pick_minutes / 60 + ' hour' + (st.draft.pick_minutes > 60 ? 's' : '') : st.draft.pick_minutes + ' minutes')} and then a player is picked for you.</p></details>`;
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
      const qn = queue().length;
      return `<div class="dr-availwrap"><nav class="dr-sub" aria-label="Show">${[['players', 'Players'], ['queue', `My queue${qn ? ` (${qn})` : ''}`], ['auto', 'Auto-pick']].map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${sub === k}">${l}</button>`).join('')}</nav>
        <div class="dr-avail" data-sub="${sub}"><aside class="dr-side">${queuePanel()}${autoPanel(autoOpen)}</aside>
        <section class="dr-main"><h2>Available players (${free().length})</h2>${toolbar('avail')}
        ${table('avail', shown, p => `<tr><td class="c-position">${esc(p.position)}</td><td class="c-name"><button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button></td><td class="c-number">${esc(p.number ?? '')}</td>${ratings(p)}
          <td class="c-act">${code ? `<button class="dr-b" data-add="${esc(p.id)}"${q.has(p.id) ? ' disabled' : ''}>${q.has(p.id) ? 'Queued' : '+ Queue'}</button>` : ''}${myTurn() ? `<button class="dr-b pick" data-pick="${esc(p.id)}"${blocked(p) ? ` disabled title="${esc(blocked(p))}"` : ''}>Pick</button>` : ''}</td></tr>`, 'No players match.')}</section></div></div>`;
    }

    function valuesTab() {
      const by = new Map();
      for (const p of players) if (p.team) { if (!by.has(p.team)) by.set(p.team, []); by.get(p.team).push(p); }
      const clubs = [...by.entries()].map(([c, ps]) => ({ c, ps: ps.sort((a, b) => b.value - a.value), total: ps.reduce((s, p) => s + p.value, 0) }))
        .sort((a, b) => (a.c === code ? -1 : b.c === code ? 1 : b.total - a.total));
      return `<section><h2>Team values</h2><p class="quiet">Each club’s drafted players and what they cost, against the ${money(CAP)} weekly cap.</p><div class="dr-teams">${clubs.map(({ c, ps, total }) => `<details class="dr-team${c === code ? ' me' : ''}"${c === code ? ' open' : ''}><summary><b>${esc(nameOf(c))}</b><span>${ps.length} players · ${money(total)} of ${money(CAP)}</span></summary>
        <ul class="dr-list">${ps.map(p => playerRow(p)).join('')}</ul></details>`).join('') || '<p class="empty">No club has a player yet.</p>'}</div></section>`;
    }

    const pageHtml = autoOpen => `<div class="draft">${head()}<nav class="dr-tabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${l}</button>`).join('')}<button class="dr-help" data-tour title="A step-by-step guide to this page"><b>?</b> How it works</button></nav>
        <p class="dr-msg" role="status">${esc(msg)}</p>${tab === 'players' ? playersTab(autoOpen) : { board: boardTab, values: valuesTab }[tab]()}</div>`;

    // Typing in a search or filter box: update everything around the box but never the box itself, so it keeps the cursor
    // (and a phone keeps its keyboard open). Falls back to a full redraw if the page's shape changed.
    function softDraw() {
      const active = document.activeElement, wraps = [...main.querySelectorAll('.dr-tablewrap')].map(w => w.scrollTop);
      const tmp = document.createElement('div');
      tmp.innerHTML = pageHtml(main.querySelector('.dr-autobox')?.open ?? true);
      const sync = (cur, next) => {
        if (cur === active) return true;
        if (!cur.contains(active)) { cur.replaceWith(next); return true; }
        if (cur.children.length !== next.children.length) return false;
        const nk = [...next.children];
        return [...cur.children].every((c, i) => sync(c, nk[i]));
      };
      if (!active || !main.contains(active) || !sync(main, tmp)) return draw();
      main.querySelectorAll('.dr-tablewrap').forEach((w, i) => { w.scrollTop = wraps[i] || 0; });
    }

    function draw() {
      const y = window.scrollY, wraps = [...main.querySelectorAll('.dr-tablewrap')].map(w => w.scrollTop), side = main.querySelector('.dr-side')?.scrollTop || 0;
      const open = [...main.querySelectorAll('details.dr-team')].map(d => d.open), autoOpen = main.querySelector('.dr-autobox')?.open ?? true;
      const snap = snapshotInputs(main);
      main.innerHTML = pageHtml(autoOpen);
      restoreInputs(main, snap);   // a filter or search you typed survives a pick by someone else
      if (tab === 'values') main.querySelectorAll('details.dr-team').forEach((d, i) => { if (i in open) d.open = open[i]; });
      // A redraw (a refresh, a pick, a sort) must not throw you back to the top of a long table.
      main.querySelectorAll('.dr-tablewrap').forEach((w, i) => { w.scrollTop = wraps[i] || 0; });
      const sd = main.querySelector('.dr-side'); if (sd) sd.scrollTop = side;
      if (window.scrollY !== y) window.scrollTo(0, y);
    }

    // What the page shows, boiled down, so a refresh that found nothing new doesn't redraw (and disturb) the page.
    const sig = () => JSON.stringify([phase(st.draft), st.draft.status, st.draft.current_pick, st.draft.pick_deadline, st.draft.quiet, st.draft.pick_started, st.picks.map(k => `${k.pick_no}:${k.player}:${k.club}`).join(), st.order.map(o => o.club).join(), st.queue, st.prefs,
      st.qs?.quiet_until, st.qs?.next_quiet, players.length, players.filter(p => p.team).length, players.reduce((n, p) => n + (p.value || 0), 0)]);
    async function refresh() {
      try {
        // Only a successful read that finds no visible draft means it was hidden. A failed read (offline, a renewing session) is
        // ignored: reloading then wiped a queue being edited. And never reload with a save in flight.
        const open = await openDraft(undefined, true);
        if (!open) { if (!qSaves) location.reload(); return; }
        const sel = window.getSelection?.(), typing = document.activeElement?.matches?.('input,select,textarea') || Boolean(sel && !sel.isCollapsed && main.contains(sel.anchorNode)), before = sig(), mine = st.queue;
        forgetPlayers();
        [st, players] = await Promise.all([loadAll(), loadPlayers({ fresh: true })]);
        if (qSaves) st.queue = mine;   // a save is in flight: what the server says now is out of date, so keep what I just set
        if (!typing && sig() !== before) draw();
      } catch { /* try again next time */ }
    }

    // ---- a small in-page dialog (instead of the browser's plain popup), used for confirming a pick and for a player's card
    function sheet(html) {
      return new Promise(res => {
        const dlg = document.createElement('dialog');
        dlg.className = 'dr-dialog';
        dlg.innerHTML = html;
        dlg.addEventListener('close', () => { dlg.remove(); res(dlg.returnValue); });
        dlg.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) dlg.close(b.dataset.close); else if (e.target === dlg) dlg.close(''); });
        document.body.append(dlg);
        dlg.showModal();
        dlg.querySelector('[data-close="ok"], [data-close]')?.focus();
      });
    }
    const bigRatings = p => `<div class="dr-rt3"><span><small>OFF</small>${chip(p.offense)}</span><span><small>DEF</small>${chip(p.defense)}</span><span><small>OVR</small>${chip(overall(p), 1)}</span><span><small>Value</small><b>${money(p.value)}</b></span></div>`;
    async function confirmPick(p) {
      const mine = players.filter(x => x.team === code), used = mine.reduce((n, x) => n + (x.value || 0), 0), after = used + (p.value || 0);
      const same = mine.filter(x => x.position === p.position).length + 1;
      return await sheet(`<h2>Pick ${esc(p.name)}?</h2><p class="dr-sub1">${esc(p.position)}${p.number != null ? ` · #${esc(p.number)}` : ''} for ${esc(nameOf(code))}</p>${bigRatings(p)}
        <p class="dr-line">Squad value <b>${money(used)}</b> → <b class="${after > CAP ? 'over' : ''}">${money(after)}</b> of ${money(CAP)}${after > CAP ? ' <span class="over">(over the cap)</span>' : ''}</p>
        <p class="dr-line">You’d have ${same} ${esc(p.position)}.</p>
        <div class="dr-btns"><button class="dr-b" data-close="">Cancel</button><button class="dr-b pick" data-close="ok">Pick ${esc(p.name)}</button></div>`) === 'ok';
    }
    async function playerCard(id) {
      const p = byId().get(id); if (!p) return;
      const k = st.picks.find(x => x.player === id), queued = st.queue.includes(id), why = !p.team && myTurn() ? blocked(p) : '';
      const status = p.team ? `Picked by <b>${esc(nameOf(p.team))}</b>${k ? ` (pick ${k.pick_no})` : ''}` : 'Available';
      const acts = [!p.team && code ? `<button class="dr-b" data-close="queue"${queued ? ' disabled' : ''}>${queued ? 'In your queue' : '+ Queue'}</button>` : '',
        !p.team && myTurn() ? `<button class="dr-b pick" data-close="pick"${why ? ` disabled title="${esc(why)}"` : ''}>Pick</button>` : ''].join('');
      const r = await sheet(`<h2>${esc(p.name)}</h2><p class="dr-sub1">${esc(p.position)}${p.number != null ? ` · #${esc(p.number)}` : ''} · ${status}</p>${bigRatings(p)}
        ${why ? `<p class="dr-line over">${esc(why)}</p>` : ''}<div class="dr-btns"><button class="dr-b" data-close="">Close</button>${acts}</div>`);
      if (r === 'queue') await addToQueue(id); else if (r === 'pick') await pickPlayer(id);
    }
    const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    function exportBoard() {
      const map = byId();
      const rows = [['Pick', 'Club', 'Position', 'Player', 'Number', 'Offence', 'Defence', 'Overall', 'Value', 'How'],
        ...st.picks.map(k => { const p = map.get(k.player); return [k.pick_no, nameOf(k.club), p?.position || '', p?.name || '(skipped)', p?.number ?? '', p?.offense ?? '', p?.defense ?? '',
          p ? overall(p).toFixed(1) : '', p?.value ?? '', HOWS[k.how] || k.how]; })];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
      a.download = `${(st.draft.name || 'draft').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-board.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    const fail = e => { msg = /isn.t your pick|not your turn/i.test(e.message) ? 'It isn’t your turn.' : /isn.t available|taken|already/i.test(e.message) ? 'That player has just been taken.' : `That didn’t work: ${e.message}`; };
    // Saves go one at a time, in order, so the last change always wins; a refresh while one is in flight keeps my queue (see refresh).
    async function setQueue(list) {
      st.queue = list; qSaves++; draw();
      qChain = qChain.then(() => saveQueue(draft0.id, code, list)).then(() => { msg = ''; }, e => { fail(e); failed = true; });
      await qChain;
      if (!--qSaves && failed) { failed = false; await refresh(); }   // a save failed: show what the server really has, with the error
      draw();
    }

    const addToQueue = id => setQueue([...queue(), id]);
    async function pickPlayer(id, btn) {
      const p = byId().get(id);
      if (!p || !(await confirmPick(p))) return;
      if (btn) btn.disabled = true;
      try { await makePick(draft0.id, id); msg = `You picked ${p.name}.`; await refresh(); } catch (er) { fail(er); }
      draw();
    }
    main.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const q = queue(), d = b.dataset;
      if (d.tour !== undefined) { tour(); return; }
      if (d.tab) { tab = d.tab; location.hash = tab; msg = ''; draw(); }
      else if (d.sort) { clickSort(d.t, d.sort, e.shiftKey); draw(); }
      else if (d.sflip !== undefined) { SORTS[d.t][+d.sflip].dir *= -1; draw(); }
      else if (d.sdel !== undefined) { SORTS[d.t].splice(+d.sdel, 1); draw(); }
      else if (d.sreset !== undefined) { SORTS[d.t] = DEFAULT[d.t].map(s => ({ ...s })); draw(); }
      else if (d.sub) { sub = d.sub; draw(); }
      else if (d.export !== undefined) exportBoard();
      else if (d.player) playerCard(d.player);
      else if (d.add) addToQueue(d.add);
      else if (d.rm) setQueue(q.filter((_, i) => i !== +d.rm));
      else if (d.up || d.down) {
        const i = +(d.up ?? d.down), j = d.up ? i - 1 : i + 1, n = [...q];
        [n[i], n[j]] = [n[j], n[i]]; setQueue(n);
      } else if (d.pick) pickPlayer(d.pick, b);
    });
    main.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.f === 'q' || t.dataset.f === 'max') {
        F[t.dataset.t][t.dataset.f] = t.value; softDraw();
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
      if (t.dataset.f && t.dataset.t) { F[t.dataset.t][t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; draw(); }
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

    // ---- the guided tour (js/tour.js). Each step may switch tab first; what it says depends on whether it's your turn.
    const STEPS = () => [
      { title: 'Welcome to the draft', text: 'This is where you pick the players for your club. This quick tour shows you every part of the page, one bit at a time. It takes about a minute.', tip: 'Use the Next button or your arrow keys. Press Esc to leave at any time.' },
      { target: '.dr-status', tab: 'board', title: 'The status bar', text: () => ({
          soon: 'This bar tells you where the draft is. Right now it <b>hasn’t started</b>, but you can already look around and <b>build your queue</b>, so you’re ready the moment it begins.',
          opens: 'This bar tells you where the draft is. It <b>opens soon</b>, and the clock counts down to it. Until then you can look around and <b>build your queue</b>.',
          live: myTurn() ? 'This bar tells you where the draft is. Right now it’s <b>your pick</b>. The clock counts down how long you have, and you can pick any time before it hits zero.'
            : 'This bar tells you where the draft is: whose pick it is, how far through we are, and the clock. When it says <b>It’s your pick</b>, it’s you.',
          paused: 'This bar tells you where the draft is. It’s <b>paused</b> for now. You can still change your queue.',
          closed: 'This bar tells you where the draft is. It has <b>closed</b>, so picks can’t be made.',
          done: 'This bar tells you where the draft is. It’s <b>finished</b>. Have a look at the board to see who went where.',
        })[phase(st.draft)],
        tip: 'Picks happen slowly over days, not all at once. Come back whenever you like.' },
      { target: '.dr-st-small', optional: true, tab: 'board', title: 'Rules and active times', text: 'The small print in the bar shows the <b>roster rules</b> (how many of each position you can have) and the <b>active times</b>, when the pick timer runs. At other times it pauses. <b>You can still make a pick</b> whenever you’re online.' },
      { target: '.dr-budget', title: 'Your weekly budget', text: 'Every player has a value. Your squad’s values add up against a weekly cap. The bar fills as you pick, turns <b>orange</b> when you’re close and <b>red</b> if you go over.', tip: 'It’s a guide only. It won’t stop you making a pick.' },
      { target: '.dr-tabs', title: 'Three tabs', text: '<b>Board</b> shows every pick so far. <b>Available players</b> is where you choose. <b>Team values</b> shows what every club has spent.' },
      { target: '.dg-wrap', tab: 'board', title: 'The board', text: 'The whole draft at a glance: a row for each round and a column for each club. Each box shows the pick number and who was taken. The pick on the clock is <b>outlined</b> and your own club’s column is <b>tinted</b>.', tip: 'It updates the moment someone picks. Tap a name for the player’s card. “Download CSV” saves it as a spreadsheet.' },
      { target: ['.dr-filter', '.dr-sortbar'], tab: 'players', sub: 'players', title: 'Search, filter and sort', text: 'Type a name, or choose a position to narrow the list. <b>Tap any column heading</b> to sort by it, and tap again to flip it.', tip: 'Want the best defenders? Sort by Position, then add “Then by… Defensive rating”.' },
      { target: '.dr-main .dr-tablewrap', tab: 'players', sub: 'players', title: 'Available players', text: 'Everyone who hasn’t been taken yet. <b>OFF</b> is attack, <b>DEF</b> is defence, <b>OVR</b> is the overall rating, and <b>Value</b> is what they cost against your cap. The colours run from red (weak) to green (outstanding).', tip: 'Tap a player’s name for their card. “Fits my squad” and “Max value” narrow the list further.' },
      { target: '[data-add]', optional: true, tab: 'players', sub: 'players', title: 'Add to your queue', text: 'Press <b>+ Queue</b> next to any player you like. It adds them to your queue so you don’t have to hunt for them later.' },
      { target: '.dr-queue', tab: 'players', sub: 'queue', title: 'My queue', text: 'Your wish list, best player first. Drag players or use the <b>' + icon('chevron-up') + ' ' + icon('chevron-down') + '</b> arrows to rank them, and <b>' + icon('x') + '</b> to remove one. If someone else takes a player, they drop off by themselves.', tip: 'Fill it with plenty of players so you’re never stuck.' },
      { target: '.dr-autobox', optional: true, tab: 'players', sub: 'auto', title: 'Auto-pick', text: 'Can’t be online? Let the draft pick <b>for you</b>. Choose <b>what</b> to pick (from your queue, or at random) and <b>when</b> (straight away, after a few minutes, or only if you miss your turn).', tip: 'It saves as you change it. Nothing to press.' },
      { target: '.dr-avail', tab: 'players', sub: 'players', title: 'Making a pick', text: () => myTurn()
          ? 'It’s your turn, so every row has a <b>Pick</b> button, and your queue has a big <b>Pick now</b> button. You’ll be asked to confirm, and shown what it does to your budget.'
          : 'When it’s your turn, a <b>Pick</b> button appears on every row, and your queue gets a big <b>Pick now</b> button. You’ll be asked to confirm first.' },
      { target: '.dr-teams', tab: 'values', title: 'Team values', text: 'Tap a club to open its squad and see what it has spent against the cap. Your club is at the top and already open.' },
      { target: '.dr-help', tab: 'board', title: 'You’re ready', text: 'That’s everything. If you ever get stuck, tap <b>How it works</b> and the tour will start again.' },
    ];
    async function tour() {
      const was = tab, wasSub = sub;
      await startTour(STEPS(), {
        key: 'draft',
        before: async s => {
          if ((s.tab && tab !== s.tab) || (s.sub && sub !== s.sub)) { if (s.tab) tab = s.tab; if (s.sub) sub = s.sub; msg = ''; draw(); await new Promise(r => requestAnimationFrame(r)); }
        },
      });
      if (tab !== was || sub !== wasSub) { tab = was; sub = wasSub; draw(); }
      main.querySelector('.dr-help')?.classList.remove('glow');
    }

    draw();
    main.setAttribute('aria-busy', 'false');
    if (!tourSeen('draft') && code) setTimeout(tour, 600);
    else if (!tourSeen('draft')) main.querySelector('.dr-help')?.classList.add('glow');
    let flipping = false, shown = phase(st.draft);
    setInterval(() => {
      const c = document.getElementById('clock');
      if (c?.dataset.until) c.textContent = fmt(new Date(c.dataset.until) - Date.now()); else if (c && st.draft.pick_deadline) c.textContent = fmt(clockMs());
      // The open or close time has just passed: redraw so the bar and the Pick buttons change over.
      if (phase(st.draft) !== shown) { shown = phase(st.draft); if (!document.activeElement?.matches?.('input,select')) draw(); }
      // Quiet time has just started or ended: look again so the clock and the note change over.
      const q = st.qs, edge = q && [q.quiet_until, q.next_quiet].filter(Boolean).map(x => new Date(x).getTime()).find(x => x > q.at && x <= Date.now());
      if (edge && !flipping) { flipping = true; refresh().finally(() => { flipping = false; }); }
    }, 1000);
    setInterval(refresh, 15000);   // backup: the live channel below does the real work
    // Live updates: hear about a pick or a clock change the moment it happens. If this can't connect, the 15 s poll still works.
    try {
      let soon = null;
      const kick = () => { clearTimeout(soon); soon = setTimeout(refresh, 250); };
      (await db()).channel(`draft-${draft0.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft=eq.${draft0.id}` }, kick)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts', filter: `id=eq.${draft0.id}` }, kick)
        .subscribe();
    } catch { /* polling covers it */ }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
}
