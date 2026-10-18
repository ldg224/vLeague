// Draft (0.21, a tab of the league page since WR-27): the manager's side of the limited-time draft. Three tabs: Board (the draft as a grid), Available players (with
// My queue and Auto-pick beside them) and Team values. A big status bar on top says where the draft stands; a budget bar under
// it shows the weekly cap used. The page shows once the office switches "Make page visible" on (0.32), even before the draft
// starts: managers can read everything and build their queues, and only picking waits for a live draft. Updates the moment a
// pick is made (realtime), with a 15 s poll as backup. Tap a player's name for their card; picks are confirmed in a small dialog.
import { snapshotInputs, restoreInputs } from './paint.js';
import { esc } from './member.js';
import { icon } from './icons.js';
import { openDraft, phase, loadDraft, saveQueue, savePrefs, makePick, quietState, describeQuiet } from './draft-data.js';
import { loadPlayers, forgetPlayers } from './players-data.js';
import { ago } from './places.js';
import { overall } from './names.js';
import { portrait } from './portrait.js';
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

// mountDraft(main, { club, season, sub, onGone }): draws the draft into `main` (an element of its own, so its listeners go with it) and returns
// { unmount(), setTab(sub) }. onGone() is called when the office has hidden the draft while the tab was open (the page used to reload).
// unmount() stops the clock, the 15 s poll, the live channel and the visibility listener; nothing of the draft runs once you leave the tab.
export async function mountDraft(main, { club, season, sub: sub0 = 'board', onGone, crest = () => '', colourOf = () => '', kitOf = () => null } = {}) {
  const code = club?.code;
  const clubName = new Map((season?.teams || []).map(t => [t.code, t.name]));
  const nameOf = c => (c === code && club?.name) || clubName.get(c) || c;
  const timers = [], every = (fn, ms) => timers.push(setInterval(fn, ms));
  let channel = null, channelClient = null, onVisible = null, dead = false;
  const draft0 = await openDraft();
  if (!draft0) {
    main.innerHTML = '<section class="lg-card"><div class="lg-card-head"><h2>Draft</h2></div><div class="sc-empty"><b>The draft isn’t open yet</b><span>It appears here as soon as the league office makes it visible.</span></div></section>'; return { unmount() {}, setTab() {} };
  } else {
    const tabOf = h => (h === 'queue' || h === 'auto' ? 'players' : TABS.some(t => t[0] === h) ? h : 'board');
    let tab = tabOf(sub0);
    // The draft plus, when it has quiet times, how the clock stands (so it can freeze while the timer is paused).
    const loadAll = async () => { const s = await loadDraft(draft0.id, code); s.qs = s.draft?.quiet?.length ? await quietState(draft0.id) : null; return s; };
    let st = await loadAll(), players = await loadPlayers({ fresh: true });
    let qSaves = 0, qChain = Promise.resolve(), failed = false;   // queue saves in flight
    let msg = '', sub = 'players';   // sub: which part of Available players shows on a phone (players, queue or auto-pick)
    const byId = () => new Map(players.map(p => [p.id, p]));
    // A player's portrait (js/portrait.js), in his club's colours once he has one. The name is always printed beside it, so it is decorative.
    const face = (p, px) => `<span class="dr-face">${portrait(p, kitOf(p.team), px, true)}</span>`;

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
    // The roster as four coloured chips (GK yellow, DEF red, MID purple, FWD blue): how many you have of the most allowed ("2/5"), or just the
    // rule when you have no club. A position you have filled is ticked off.
    const rosterChips = () => {
      const mx = st.draft.roster_max || {}, mn = st.draft.roster_min || {}, have = pos => players.filter(x => x.team === code && x.position === pos).length;
      const chips = ['GK', 'DEF', 'MID', 'FWD'].filter(k => mx[k] != null || mn[k] != null).map(k => {
        const top = mx[k] ?? mn[k], n = code ? have(k) : null, full = n != null && n >= top;
        return `<span class="dr-rchip pos-${k}${full ? ' full' : ''}" title="${esc(`${k}: ${mn[k] != null && mn[k] !== mx[k] ? `at least ${mn[k]}, ` : ''}${mx[k] != null ? `at most ${mx[k]}` : ''}`)}"><b>${k}</b>${n != null ? `${n}/${top}` : top}</span>`;
      });
      return chips.length ? `<span class="dr-roster">${chips.join('')}</span>` : '';
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
    const playerRow = (p, extra = '', attrs = '') => `<li class="dr-p"${attrs}><span class="pos pos-${esc(p.position)}">${esc(p.position)}</span>
      <span class="nm dr-pc">${face(p, 30)}<button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button></span><span class="rts">${chip(p.offense)}${chip(p.defense)}</span><span class="val">${money(p.value)}</span>${extra}</li>`;

    // What this club's squad is worth now.
    const squadValue = () => players.filter(p => p.team === code).reduce((n, p) => n + (p.value || 0), 0);
    // S-10: the full club value = players already picked + players in the queue, against the cap. A guide only: other clubs take
    // players and the queue may skip someone who no longer fits, so what you end up with can differ.
    const afterText = total => (total > CAP ? `over the cap by ${money(total - CAP)}` : `${money(CAP - total)} left`);

    // How much of the weekly cap this club's squad uses (the draft shows it; it doesn't block a pick).
    // Your club's strip at the foot of the hero: the roster (how many of each position you have, of the most allowed) and the weekly budget on one
    // line, the budget bar under it. With no club: just the roster limits.
    function youStrip() {
      const chips = rosterChips();
      if (!code) return chips ? `<div class="dr-you"><div class="dr-you-top"><b class="dr-you-l">Roster limits</b>${chips}</div></div>` : '';
      const used = squadValue(), pct = Math.min(100, used / CAP * 100), state = used > CAP ? ' over' : used >= CAP * 0.9 ? ' warn' : '';
      return `<div class="dr-you dr-budget${state}"><div class="dr-you-top"><b class="dr-you-l">Your squad</b>${chips}`
        + `<span class="dr-you-money"><b>${money(used)}</b> of ${money(CAP)}</span></div>`
        + `<div class="dr-bar" role="progressbar" aria-label="Weekly budget used: ${money(used)} of ${money(CAP)}, ${used > CAP ? `${money(used - CAP)} over` : `${money(CAP - used)} left`}" aria-valuemin="0" aria-valuemax="${CAP}" aria-valuenow="${used}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
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
        soon: ['Not started yet', 'Get ready', 'Build your queue now. Picking opens when the draft starts.', ''],
        opens: ['Opens soon', 'Get ready', `Opens <b>${esc(whenAt(d.opens_at))}</b>.`, `<small>Opens in</small><span id="clock" data-until="${esc(d.opens_at)}">${fmt(new Date(d.opens_at) - Date.now())}</span>`],
        live: ['Live', mine ? 'It’s your pick' : t ? `${who} is picking` : 'Draft complete', t ? `Pick ${t.pick_no} of ${n}${d.pick_deadline ? `, ends <b>${esc(whenAt(d.pick_deadline))}</b>` : ''}` : '',
          `<small>${mine ? 'Your time' : 'Time left'}</small><span id="clock">${fmt(clockMs())}</span>`],
        paused: ['Paused', 'The draft is paused', `${t ? `Pick ${t.pick_no} of ${n}, ${who} is up. ` : ''}It carries on when the office resumes it. You can still change your queue.`, ''],
        closed: ['Closed', 'The draft has closed', 'Picks can’t be made now.', ''],
        done: ['Finished', 'The draft is finished', `All ${n} picks are done.`, ''],
      }[ph];
      // Each piece is escaped here (the pause icon is markup, so the line itself is not escaped as a whole: that printed the icon's code, B-12).
      const paused = d.quiet?.length && inQuiet() && ph === 'live' ? `<span class="dr-paused">. Timer paused until ${esc(new Date(st.qs.quiet_until).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }))}</span>` : '';
      const made = st.picks.length, face = t && ['live', 'paused'].includes(ph) ? crest(t.club, 56) : '<img class="dr-st-crest" src="assets/brand/crest.svg" alt="">';
      const go = mine ? '<button class="dr-go" data-tab="players" type="button">Choose a player</button>' : '';
      const ghost = t && ['live', 'paused'].includes(ph) ? `<span class="dr-hollow" aria-hidden="true" style="--gl:${esc(colourOf(t.club, 'light'))};--gd:${esc(colourOf(t.club, 'dark'))}">${esc(nameOf(t.club))}</span>` : '';
      return `<section class="lg-card dr-status ph-${ph}${mine ? ' mine' : ''}${ph === 'live' && inQuiet() ? ' quiet' : ''}">${ghost}
        <div class="dr-st-main"><div class="dr-st-who">${face}<div class="dr-st-text">${ph === 'live' ? '' : `<p class="dr-st-line"><span class="dr-st-tag">${B[0]}</span></p>`}
          <h1 class="dr-st-big" tabindex="-1">${B[1]}</h1><p class="dr-st-sub">${B[2]}${paused}</p>${go}</div></div>
          ${B[3] ? `<div class="dr-clock">${B[3]}</div>` : ''}</div>
        ${youStrip()}</section>`;
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
      const pos = [['', 'All'], ['GK', 'GK'], ['DEF', 'DEF'], ['MID', 'MID'], ['FWD', 'FWD']];
      return `<div class="dr-filter"><label class="dr-search">${icon('search')}<input type="search" data-f="q" data-t="${t}" placeholder="Search players" aria-label="Search players" value="${esc(f.q)}"></label>
        <div class="dr-pos sc-toggle" role="group" aria-label="Position">${pos.map(([v, l]) => `<button type="button" data-fpos="${v}" aria-pressed="${f.pos === v}">${l}</button>`).join('')}</div>
        <label class="dr-max"><span>Max $</span><input type="number" inputmode="numeric" min="0" step="1000" data-f="max" data-t="avail" placeholder="Any" aria-label="Maximum value" value="${esc(f.max)}"></label>
        ${code ? `<label class="dr-fit"><input type="checkbox" data-f="fit" data-t="avail"${f.fit ? ' checked' : ''}><span>Fits my squad</span></label>` : ''}</div>
        <div class="dr-sortbar"><span class="dr-sortl">Sorted by</span>${s.map((x, i) => `<span class="dr-chip"><button data-t="${t}" data-sflip="${i}" title="Flip direction">${esc(col(t, x.key).long)} ${arrow(x.dir)}</button>${s.length > 1 ? `<button data-t="${t}" data-sdel="${i}" aria-label="Stop sorting by ${esc(col(t, x.key).long)}">${icon('x')}</button>` : ''}</span>`).join('')}
          ${unused.length ? `<label class="dr-then"><select data-sadd="${t}" aria-label="Then sort by"><option value="">Then by…</option>${unused.map(c => `<option value="${c.key}">${esc(c.long)}</option>`).join('')}</select>${icon('chevron-down')}</label>` : ''}
          ${s.length > 1 || s[0].key !== DEFAULT[t][0].key || s[0].dir !== DEFAULT[t][0].dir ? `<button class="dr-link" data-t="${t}" data-sreset>Reset</button>` : ''}</div>`;
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
        esc, clubName: nameOf, me: code, current: phase(st.draft) === 'live' ? st.draft.current_pick : null, made: st.picks.length, crest: c => crest(c, 28),
        who: x => { const p = map.get(x.pick?.player); return p ? `<span class="dr-pc">${face(p, 30)}<span><button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button> <small class="pos-${esc(p.position)}">${esc(p.position)}</small></span></span>` : '<i>skipped</i>'; },
      });
      return `<section class="lg-card dr-boardcard"><div class="lg-card-head"><h2>Draft board</h2>${st.picks.length ? '<button class="dr-ghost dr-export" data-export title="Download every pick so far as a spreadsheet">Download CSV</button>' : ''}</div>`
        + `${grid || '<div class="sc-empty"><b>No draft order yet</b><span>The board appears once the office sets the order.</span></div>'}</section>`;
    }

    // Players: the queue and auto-pick on the left, every available player on the right.
    function queuePanel() {
      if (!code) return '<p class="empty">Your account isn’t linked to a club.</p>';
      const map = byId(), q = queue();
      const picked = squadValue(), queued = q.reduce((n, id) => n + (map.get(id)?.value || 0), 0), end = picked + queued;
      return `<section class="lg-card dr-queue"><div class="lg-card-head"><h2>My queue</h2><span class="dr-count">${q.length}</span></div>
        ${q.length ? `<p class="dr-qsum${end > CAP ? ' over' : ''}">With your queue the squad would be worth <b>${money(end)}</b>, ${afterText(end)}.</p>` : ''}
        ${myTurn() && q.length ? `<button class="dr-b pick big" data-pick="${esc(q[0])}"${blocked(map.get(q[0])) ? ` disabled title="${esc(blocked(map.get(q[0])))}"` : ''}>Pick now: ${esc(map.get(q[0])?.name)}</button>` : ''}
        <ol class="dr-list" id="queue">${q.map((id, i) => playerRow(map.get(id), `<span class="mv"><button class="dr-b" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>${icon('chevron-up')}</button><button class="dr-b" data-down="${i}" aria-label="Move down"${i < q.length - 1 ? '' : ' disabled'}>${icon('chevron-down')}</button><button class="dr-b" data-rm="${i}" aria-label="Remove">${icon('x')}</button></span>`, ` draggable="true" data-i="${i}"`)).join('') || '<li class="dr-qempty">Add players with Queue in the list. Drag them, or use the arrows, to put your favourite first.</li>'}</ol></section>`;
    }
    function autoPanel() {
      if (!code) return '';
      const { mode, minutes, pick_how: how = 'queue' } = st.prefs, max = st.draft.pick_minutes;
      const head = '<div class="lg-card-head"><h2>Auto-pick</h2></div>';
      // The office has set one rule for everyone: nothing here to change.
      if (st.draft.auto_after_minutes) return `<section class="lg-card dr-autobox">${head}
        <p class="dr-locked">${icon('lock')}<span><b>Set by the league office.</b> Your queue picks for you ${esc(st.draft.auto_after_minutes)} minutes into your turn, whether or not you are online. Keep your queue up to date: with no queue you have the full ${esc(st.draft.pick_minutes ?? '')} minutes to pick yourself.</span></p></section>`;
      const radios = (name, list, cur) => list.map(([v, l, h]) => `<label class="dr-opt"><input type="radio" name="${name}" value="${v}"${cur === v ? ' checked' : ''}><span><b>${l}</b><small>${esc(h)}</small></span></label>`).join('');
      return `<section class="lg-card dr-autobox">${head}<form id="auto" class="dr-auto" novalidate>
          <fieldset><legend>What to pick</legend>${radios('how', HOW, how)}</fieldset>
          <fieldset><legend>When</legend>${radios('mode', MODES, mode)}</fieldset>
          <label class="dr-min"${mode === 'after_minutes' ? '' : ' hidden'}><span>Minutes into my turn${max ? ` (1 to ${max})` : ''}</span><input type="number" name="minutes" min="1"${max ? ` max="${max}"` : ''} value="${esc(minutes ?? '')}"></label>
          <p class="dr-note">Saves as you change it. The office can change it too.</p></form></section>`;
    }
    function playersTab(autoOpen) {
      const q = new Set(st.queue);
      const shown = sorted('avail', free().filter(p => passes('avail', p))).slice(0, 400);
      const qn = queue().length;
      return `<div class="dr-availwrap"><nav class="dr-sub sc-toggle" aria-label="Show">${[['players', 'Players'], ['queue', `My queue${qn ? ` (${qn})` : ''}`], ['auto', 'Auto-pick']].map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${sub === k}">${l}</button>`).join('')}</nav>
        <div class="dr-avail" data-sub="${sub}"><aside class="dr-side">${queuePanel()}${autoPanel()}</aside>
        <section class="lg-card dr-main"><div class="lg-card-head"><h2>Available players</h2><span class="dr-count">${free().length} left</span></div>${toolbar('avail')}
        ${table('avail', shown, p => `<tr><td class="c-position pos-${esc(p.position)}">${esc(p.position)}</td><td class="c-name"><span class="dr-pc">${face(p, 30)}<button class="dr-name" data-player="${esc(p.id)}">${esc(p.name)}</button></span></td><td class="c-number">${esc(p.number ?? '')}</td>${ratings(p)}
          <td class="c-act">${code ? `<button class="dr-b" data-add="${esc(p.id)}" aria-label="${q.has(p.id) ? 'In your queue' : `Add ${esc(p.name)} to your queue`}"${q.has(p.id) ? ' disabled' : ''}>${q.has(p.id) ? `${icon('check')}<span class="dr-bt">Queued</span>` : `${icon('plus')}<span class="dr-bt">Queue</span>`}</button>` : ''}${myTurn() ? `<button class="dr-b pick" data-pick="${esc(p.id)}"${blocked(p) ? ` disabled title="${esc(blocked(p))}"` : ''}>Pick</button>` : ''}</td></tr>`, 'No players match.')}</section></div></div>`;
    }

    // Team values: a box per club, up to six across, each with its total against the cap and every player it has drafted.
    const short = n => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : money(n));
    function valuesTab() {
      const by = new Map();
      for (const p of players) if (p.team) { if (!by.has(p.team)) by.set(p.team, []); by.get(p.team).push(p); }
      const clubs = [...by.entries()].map(([c, ps]) => ({ c, ps: ps.sort((a, b) => b.value - a.value), total: ps.reduce((s, p) => s + p.value, 0) }))
        .sort((a, b) => (a.c === code ? -1 : b.c === code ? 1 : b.total - a.total));
      const box = ({ c, ps, total }) => `<article class="dr-tbox${c === code ? ' me' : ''}${total > CAP ? ' over' : ''}">
          <header class="dr-thead">${crest(c, 28)}<b>${esc(nameOf(c))}</b></header>
          <p class="dr-tsum"><b>${money(total)}</b><span>${ps.length} player${ps.length === 1 ? '' : 's'}</span></p>
          <span class="dr-tbar" role="img" aria-label="${money(total)} of the ${money(CAP)} cap"><i style="width:${Math.min(100, total / CAP * 100).toFixed(1)}%"></i></span>
          <ol class="dr-tlist">${ps.map(p => `<li><span class="pos pos-${esc(p.position)}">${esc(p.position)}</span><span class="dr-pc">${face(p, 24)}<button class="dr-name" data-player="${esc(p.id)}" aria-label="${esc(p.name)}">${(([f, ...r]) => (r.length ? `<span class="dr-fn">${esc(f)} </span>${esc(r.join(' '))}` : esc(f)))(String(p.name).split(' '))}</button></span><span class="dr-tval">${short(p.value || 0)}</span></li>`).join('')}</ol></article>`;
      return `<section class="lg-card dr-teamscard"><div class="lg-card-head"><h2>Team values</h2><span class="dr-count">Cap ${money(CAP)} a week</span></div>`
        + `${clubs.length ? `<div class="dr-teams">${clubs.map(box).join('')}</div>` : '<div class="sc-empty"><b>No picks yet</b><span>Each club’s squad and what it costs appear here as the draft goes.</span></div>'}</section>`;
    }

    const pageHtml = autoOpen => `<div class="draft">${head()}<div class="dr-bar-row"><nav class="dr-tabs sc-toggle" aria-label="Draft">${TABS.map(([id, l]) => `<button type="button" data-tab="${id}" aria-pressed="${tab === id}">${l}</button>`).join('')}</nav><button class="dr-help" data-tour title="A step-by-step guide to this page" aria-label="How it works">${icon('circle-help')}<span>How it works</span></button></div>
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
      if (dead) return;
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
        if (!open) { if (!qSaves && !dead) onGone?.(); return; }
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
      return await sheet(`<div class="dr-card-top">${face(p, 72)}<div><h2>Pick ${esc(p.name)}?</h2><p class="dr-sub1">${esc(p.position)}${p.number != null ? ` · #${esc(p.number)}` : ''} for ${esc(nameOf(code))}</p></div></div>${bigRatings(p)}
        <p class="dr-line">Squad value <b>${money(used)}</b> → <b class="${after > CAP ? 'over' : ''}">${money(after)}</b> of ${money(CAP)}${after > CAP ? ' <span class="over">(over the cap)</span>' : ''}</p>
        <p class="dr-line">You’d have ${same} ${esc(p.position)}.</p>
        <div class="dr-btns"><button class="dr-b" data-close="">Cancel</button><button class="dr-b pick" data-close="ok">Pick ${esc(p.name)}</button></div>`) === 'ok';
    }
    async function playerCard(id) {
      const p = byId().get(id); if (!p) return;
      const k = st.picks.find(x => x.player === id), queued = st.queue.includes(id), why = !p.team && myTurn() ? blocked(p) : '';
      const status = p.team ? `Picked by <b>${esc(nameOf(p.team))}</b>${k ? ` (pick ${k.pick_no})` : ''}` : 'Available';
      // S-10: what your squad would be worth with this player added.
      const used = squadValue(), after = used + (p.value || 0);
      const worth = !p.team && code ? `<p class="dr-line">Your squad <b>${money(used)}</b> → <b class="${after > CAP ? 'over' : ''}">${money(after)}</b> of ${money(CAP)} with ${esc(p.name)}${after > CAP ? ' <span class="over">(over the cap)</span>' : ` (${afterText(after)})`}</p>` : '';
      const acts = [!p.team && code ? `<button class="dr-b" data-close="queue"${queued ? ' disabled' : ''}>${queued ? 'In your queue' : '+ Queue'}</button>` : '',
        !p.team && myTurn() ? `<button class="dr-b pick" data-close="pick"${why ? ` disabled title="${esc(why)}"` : ''}>Pick</button>` : ''].join('');
      const r = await sheet(`<div class="dr-card-top">${face(p, 72)}<div><h2>${esc(p.name)}</h2><p class="dr-sub1">${esc(p.position)}${p.number != null ? ` · #${esc(p.number)}` : ''} · ${status}</p></div></div>${bigRatings(p)}
        ${worth}${why ? `<p class="dr-line over">${esc(why)}</p>` : ''}<div class="dr-btns"><button class="dr-b" data-close="">Close</button>${acts}</div>`);
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
      if (d.tab) { tab = d.tab; location.hash = `draft/${tab}`; msg = ''; draw(); }
      else if (d.sort) { clickSort(d.t, d.sort, e.shiftKey); draw(); }
      else if (d.sflip !== undefined) { SORTS[d.t][+d.sflip].dir *= -1; draw(); }
      else if (d.sdel !== undefined) { SORTS[d.t].splice(+d.sdel, 1); draw(); }
      else if (d.sreset !== undefined) { SORTS[d.t] = DEFAULT[d.t].map(s => ({ ...s })); draw(); }
      else if (d.sub) { sub = d.sub; draw(); }
      else if (d.fpos !== undefined) { F.avail.pos = d.fpos; draw(); }
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
      { title: 'Welcome to the draft', text: 'This is where you pick the players for your club. This quick tour shows you each part of the page. It takes about a minute.', tip: 'Use Next or your arrow keys. Press Esc to leave at any time.' },
      { target: '.dr-status', tab: 'board', title: 'Who’s on the clock', text: () => ({
          soon: 'The top card says where the draft is. It <b>hasn’t started</b> yet, but you can look around and <b>build your queue</b> now.',
          opens: 'The top card says where the draft is. It <b>opens soon</b>, and the clock counts down to it. Build your queue in the meantime.',
          live: myTurn() ? 'It’s <b>your pick</b>. The clock on the right shows how long you have. Press <b>Choose a player</b> to go to the list.'
            : 'The top card shows <b>which club is picking</b>, which pick it is and when it ends. The clock on the right counts down their time.',
          paused: 'The top card says the draft is <b>paused</b> for now. You can still change your queue.',
          closed: 'The top card says the draft has <b>closed</b>, so picks can’t be made.',
          done: 'The top card says the draft is <b>finished</b>. Look at the board to see who went where.',
        })[phase(st.draft)],
        tip: 'Picks happen slowly over days, not all at once. The timer only runs in the office’s active times.' },
      { target: '.dr-you', optional: true, title: 'Your squad', text: 'Your roster and budget in one strip. Each coloured chip shows <b>how many you have of the most allowed</b>: GK in yellow, DEF in red, MID in purple, FWD in blue. On the right, what your squad costs against the weekly cap, with the bar under it.', tip: 'The bar turns <b>orange</b> when you’re close to the cap and <b>red</b> if you go over.' },
      { target: '.dr-tabs', title: 'Three views', text: '<b>Board</b> shows every pick so far. <b>Available players</b> is where you choose. <b>Team values</b> shows what each club has spent.' },
      { target: '.dg-wrap', tab: 'board', title: 'The board', text: 'A row for each round and a column for each club, with the crests along the top. Your column is shaded, and the pick on the clock is <b>outlined in blue</b>.', tip: 'Tap a player’s name to see their card.' },
      { target: ['.dr-filter', '.dr-sortbar'], tab: 'players', sub: 'players', title: 'Search, filter and sort', text: 'Search by name, pick a position, set a <b>maximum value</b>, or switch on <b>Fits my squad</b> to see only players you could take. Tap a column heading to sort by it, and again to flip it.' },
      { target: '.dr-main .dr-tablewrap', tab: 'players', sub: 'players', title: 'Available players', text: 'Everyone who hasn’t been taken. <b>OFF</b> is attack, <b>DEF</b> is defence, <b>OVR</b> is overall, and <b>Value</b> is what they add to your budget.' },
      { target: '[data-add]', optional: true, tab: 'players', sub: 'players', title: 'Add to your queue', text: 'Press <b>Queue</b> (a <b>+</b> on a phone) next to any player you like, so they’re ready when your turn comes.' },
      { target: '.dr-queue', tab: 'players', sub: 'queue', title: 'My queue', text: 'Your wish list, best player first. Drag players or use the arrows to rank them, and the cross to take one out. The line at the top shows what your squad would cost with them.' },
      { target: '.dr-autobox', optional: true, tab: 'players', sub: 'auto', title: 'Auto-pick', text: 'Can’t be online? Let the draft pick <b>for you</b>. Choose <b>what</b> to pick (from your queue, or anyone who fits) and <b>when</b> (straight away, after a few minutes, or only if you miss your turn). It saves as you change it.' },
      { target: '.dr-avail', tab: 'players', sub: 'players', title: 'Making a pick', text: () => (myTurn()
          ? 'It’s your turn, so every row has a <b>Pick</b> button, and your queue has <b>Pick now</b>. You’ll be asked to confirm, and shown what it does to your budget.'
          : 'When it’s your turn, every row gets a <b>Pick</b> button and your queue gets <b>Pick now</b>. You’ll be asked to confirm first.') },
      { target: '.dr-teams', tab: 'values', title: 'Team values', text: 'Each club with a bar against the weekly cap and its total. Tap a club to see its squad. Yours is at the top.' },
      { target: '.dr-help', tab: 'board', title: 'You’re ready', text: 'That’s everything. Tap <b>How it works</b> any time to see this tour again.' },
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
    every(() => {
      const c = document.getElementById('clock');
      if (c?.dataset.until) c.textContent = fmt(new Date(c.dataset.until) - Date.now()); else if (c && st.draft.pick_deadline) c.textContent = fmt(clockMs());
      // The open or close time has just passed: redraw so the bar and the Pick buttons change over.
      if (phase(st.draft) !== shown) { shown = phase(st.draft); if (!document.activeElement?.matches?.('input,select')) draw(); }
      // Quiet time has just started or ended: look again so the clock and the note change over.
      const q = st.qs, edge = q && [q.quiet_until, q.next_quiet].filter(Boolean).map(x => new Date(x).getTime()).find(x => x > q.at && x <= Date.now());
      if (edge && !flipping) { flipping = true; refresh().finally(() => { flipping = false; }); }
    }, 1000);
    every(refresh, 15000);   // backup: the live channel below does the real work
    // Live updates: hear about a pick or a clock change the moment it happens. If this can't connect, the 15 s poll still works.
    try {
      let soon = null;
      const kick = () => { clearTimeout(soon); soon = setTimeout(refresh, 250); };
      channelClient = await db();
      channel = channelClient.channel(`draft-${draft0.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft=eq.${draft0.id}` }, kick)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts', filter: `id=eq.${draft0.id}` }, kick)
        .subscribe();
    } catch { /* polling covers it */ }
    onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return {
      unmount() {
        dead = true;
        timers.forEach(clearInterval);
        document.removeEventListener('visibilitychange', onVisible);
        if (channel) channelClient?.removeChannel(channel);
        document.querySelectorAll('dialog.dr-dialog').forEach(x => x.close());
      },
      // The address changed to another part of the draft (#draft/players): show it, unless the page already does.
      setTab(s) { const t = tabOf(s); if (t !== tab && !dead) { tab = t; msg = ''; draw(); } },
    };
  }
}
