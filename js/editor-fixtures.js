// Editor → Fixtures (0.12, season planner 0.13): plan a season from a pattern (match windows with their own gaps), name
// rounds, pick a scoreboard look and a line-up lock rule per week, then set times, postpone or remove.
// Kick-off times are entered in Melbourne time and stored as an exact instant. The database checks everything again
// (supabase/migrations/0013_fixtures_results.sql, 0014_season_planner.sql). Since 0.14 each match can be simulated here
// (js/simulate.js): its result and match file are saved, and it can be played again or its result removed.
import { loadSeason } from './dashboard-data.js';

const ZONE = 'Australia/Melbourne';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const partsOf = d => Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
const whenFmt = new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Melbourne wall-clock ("2026-10-12", "19:30") to an ISO instant, correct across daylight saving.
export function melbourneToIso(date, time) {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 2; i++) {   // shift by however far Melbourne's clock reads from what we asked for
    const p = partsOf(new Date(t));
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return new Date(t).toISOString();
}
const toLocalInput = iso => { if (!iso) return ''; const p = partsOf(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMinutes = (time, mins) => { const [h, m] = time.split(':').map(Number); const t = h * 60 + m + mins; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

// Round robin by the circle method: every club plays every other once; an odd number of clubs gets a bye each week.
export function roundRobin(codes, double = false) {
  const teams = [...codes];
  if (teams.length % 2) teams.push(null);
  const n = teams.length, weeks = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i], b = teams[n - 1 - i];
      if (a && b) games.push(r % 2 ? [b, a] : [a, b]);   // home and away swap on alternate weeks, to keep it fair
    }
    weeks.push(games);
    teams.splice(1, 0, teams.pop());
  }
  return double ? [...weeks, ...weeks.map(w => w.map(([a, b]) => [b, a]))] : weeks;
}

// One week's games spread over the blocks in order. A block with games = 0 (and the last block) takes whatever is left.
// Each block starts on its weekday on or after `base`; its games are `gap` minutes apart.
export function placeWeek(games, base, wins) {
  const out = [], left = [...games], baseDay = new Date(`${base}T12:00:00Z`).getUTCDay();
  wins.forEach((w, i) => {
    const n = (w.games > 0 && i < wins.length - 1) ? Math.min(w.games, left.length) : left.length;
    const day = addDays(base, (w.day - baseDay + 7) % 7);
    left.splice(0, n).forEach(([h, a], k) => out.push({ h, a, win: i, at: melbourneToIso(day, addMinutes(w.time, k * w.gap)) }));
  });
  return out;
}

export function fixturesView() {
  return '<h1>Fixtures</h1><div id="fx-sim" class="fx-sim" role="status" hidden></div><div id="fx-root"><p class="quiet">Loading fixtures…</p></div>';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LOCKS = [[60, '1 hour'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days']];
// Patterns: blocks of games. games 0 = "all the rest".
const PATTERNS = {
  saturday: ['Saturday night', [{ day: 6, time: '19:00', games: 0, gap: 90 }]],
  weekend: ['Saturday and Sunday', [{ day: 6, time: '15:00', games: 3, gap: 100 }, { day: 0, time: '14:00', games: 0, gap: 100 }]],
  fri_sat: ['Friday night + Saturday', [{ day: 5, time: '19:30', games: 1, gap: 90 }, { day: 6, time: '15:00', games: 0, gap: 100 }]],
  midweek: ['Midweek', [{ day: 3, time: '19:30', games: 0, gap: 90 }]],
};

export async function mountFixtures(ctx) {
  const root = document.getElementById('fx-root');
  if (!root) return;
  const { esc, explain } = ctx;
  let fixtures = [], results = new Map(), busy = false, rounds = [], looks = [], pattern = 'saturday', rows = structuredClone(PATTERNS.saturday[1]);
  const clubs = () => ctx.clubs.filter(c => c.status === 'active');
  const name = code => ctx.clubs.find(c => c.code === code)?.name || code;
  const colour = code => { const c = ctx.clubs.find(x => x.code === code); return c && ctx.accent ? ctx.accent(c) : '#64b5f6'; };   // the club's colour, lifted so it reads
  const say = (el, t) => { if (el) el.textContent = t; };
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const lookOpts = sel => opts(looks.map(l => [l.key, l.name]), sel);

  async function load() {
    const c = await ctx.db();
    const [fx, rd, lk, rs] = await Promise.all([
      c.from('fixtures').select('id, week, home, away, starts_at, stage, postponed, window_id').order('week').order('starts_at').range(0, 1999),
      c.from('rounds').select('*').order('week'), c.from('looks').select('key, name').order('name'),
      c.from('results').select('fixture, summary').range(0, 1999),
    ]);
    if (fx.error) throw new Error(explain(fx.error));
    fixtures = fx.data; results = new Map((rs.data || []).map(r => [r.fixture, r.summary])); rounds = rd.data || []; looks = lk.data?.length ? lk.data : [{ key: 'classic', name: 'Classic' }];
  }
  const round = w => rounds.find(r => r.week === w) || { week: w, name: null, kind: 'regular', look: 'classic', lock_minutes_before: 180, lock_at_override: null };
  const clubOpts = sel => clubs().map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const nextMon = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); };
  const lockText = w => {
    const first = fixtures.filter(f => f.week === w && f.starts_at && !f.postponed).map(f => f.starts_at).sort()[0], r = round(w);
    if (r.lock_at_override) return `Line-ups lock ${whenFmt.format(new Date(r.lock_at_override))}`;
    return first ? `Line-ups lock ${whenFmt.format(new Date(new Date(first).getTime() - r.lock_minutes_before * 60000))}` : 'No kick-off set yet';
  };

  function windowRows() {
    return rows.map((r, i) => `<div class="fx-win" data-i="${i}">
      <label>Day <select data-k="day">${opts(DAYS.map((d, k) => [k, d]), r.day)}</select></label>
      <label>First game <input type="time" data-k="time" value="${esc(r.time)}"></label>
      <label>Games <input type="number" data-k="games" min="0" max="20" value="${r.games}" title="0 = all the rest"></label>
      <label>Gap (min) <input type="number" data-k="gap" min="0" max="600" step="5" value="${r.gap}"></label>
      <button type="button" class="btn ghost small" data-act="win-del" ${rows.length < 2 ? 'hidden' : ''} aria-label="Remove this block">✕</button></div>`).join('');
  }

  function draw() {
    const weeks = [...new Set(fixtures.map(f => f.week))].sort((a, b) => a - b);
    root.innerHTML = `<p class="pl-sum"><b>${fixtures.length}</b> fixture${fixtures.length === 1 ? '' : 's'} over ${weeks.length} week${weeks.length === 1 ? '' : 's'}.
        ${weeks.length ? `<button class="btn small" type="button" data-act="sim-all" ${todo().length ? '' : 'disabled'}>Simulate all unplayed (${todo().length})</button>
        <button class="btn ghost small" type="button" data-act="clear-all">Clear everything</button>
        <span class="ed-confirm" hidden>Delete all ${fixtures.length} fixtures, their results and every round? <button class="btn small" type="button" data-act="clear-all-yes">Yes, clear all</button> <button class="btn ghost small" type="button" data-act="clear-no">Keep</button></span>` : ''}</p>
      <form class="ed-invite" id="fx-gen"><h2>Plan a season</h2>
        <p class="ed-hint">Pick a pattern for each week. Games are spread over the blocks below in order; a week can have several blocks, each with its own start and gap (0 games = all the rest). Times are Melbourne time.</p>
        <label>Pattern <select name="pattern">${opts([...Object.entries(PATTERNS).map(([k, v]) => [k, v[0]]), ['custom', 'My own']], pattern)}</select></label>
        <div id="fx-wins">${windowRows()}</div>
        <div><button type="button" class="btn ghost small" data-act="win-add">+ Add a block</button></div>
        <label>First week begins <input type="date" name="start" value="${nextMon()}" required></label>
        <label>Line-ups lock <select name="lock">${opts(LOCKS, 180)}</select> before the week's first game</label>
        <details><summary>More options</summary>
          <label>Rounds <select name="rounds"><option value="1">Everyone plays everyone once</option><option value="2">Home and away</option></select></label>
          <label>Days between weeks <input type="number" name="every" min="1" max="60" value="7"></label>
          <label>Scoreboard look <select name="look">${lookOpts('classic')}</select></label></details>
        <p class="ed-hint">${clubs().length} active clubs${clubs().length % 2 ? ': one rests each week' : ''}.</p>
        <div class="ed-actions"><button class="btn" ${clubs().length < 2 ? 'disabled' : ''}>Create fixtures</button></div>
        <p class="ed-msg" role="status"></p></form>
      <details class="pl-paste"><summary>Add one match</summary><form class="ed-invite" id="fx-add">
        <label>Week <input type="number" name="week" min="1" max="99" value="${(weeks.at(-1) || 0) + 1}" required></label>
        <label>Home <select name="home">${clubOpts()}</select></label><label>Away <select name="away">${clubOpts(clubs()[1]?.code)}</select></label>
        <label>Date <input type="date" name="date"></label><label>Kick-off <input type="time" name="time" value="19:00"></label>
        <div class="ed-actions"><button class="btn">Add match</button></div><p class="ed-msg" role="status"></p></form></details>
      ${weeks.map(w => { const r = round(w); return `<section class="fx-week" data-week="${w}"><div class="fx-head">
        <h2>Week ${w}</h2><input class="fx-rname" value="${esc(r.name || '')}" placeholder="Name this round (optional)" maxlength="40" aria-label="Round name">
        <select data-r="look" aria-label="Scoreboard look">${lookOpts(r.look)}</select>
        <select data-r="lock_minutes_before" aria-label="Lock line-ups before the first game">${opts(LOCKS, r.lock_minutes_before)}</select></div>
        <button class="btn small" type="button" data-act="sim-week" ${todo(w).length ? '' : 'disabled'}>Simulate week (${todo(w).length})</button>
        <button class="btn ghost small" type="button" data-act="clear-week">Clear week</button>
        <span class="ed-confirm" hidden>Delete all ${fixtures.filter(f => f.week === w).length} fixtures in week ${w} and their results? <button class="btn small" type="button" data-act="clear-week-yes">Yes, clear</button> <button class="btn ghost small" type="button" data-act="clear-no">Keep</button></span>
        <p class="fx-lock">${esc(lockText(w))}</p>
        ${fixtures.filter(f => f.week === w).map(f => `<div class="fx-row" data-id="${esc(f.id)}">
        <span class="fx-teams"><b class="fx-team" style="--club:${esc(colour(f.home))}">${esc(name(f.home))}</b> v <b class="fx-team" style="--club:${esc(colour(f.away))}">${esc(name(f.away))}</b>${f.stage ? ` <small>${esc(f.stage)}</small>` : ''}${f.postponed ? ' <small>postponed</small>' : ''}${results.has(f.id) ? ` <b class="fx-score">${results.get(f.id).home}–${results.get(f.id).away}</b>` : ''}</span>
        <input type="datetime-local" value="${toLocalInput(f.starts_at)}" aria-label="Kick-off (Melbourne time)">
        ${f.postponed ? '' : results.has(f.id)
          ? '<button class="btn ghost small" type="button" data-act="again">Play again</button><button class="btn ghost small" type="button" data-act="unplay">Remove result</button>'
          : '<button class="btn small" type="button" data-act="sim">Simulate</button>'}
        <button class="btn ghost small" type="button" data-act="postpone">${f.postponed ? 'Restore' : 'Postpone'}</button>
        <button class="btn ghost small" type="button" data-act="del">Remove</button>
        <span class="ed-confirm" hidden>Remove this match and its result? <button class="btn small" type="button" data-act="del-yes">Yes</button> <button class="btn ghost small" type="button" data-act="del-no">Keep</button></span>
        <span class="ed-confirm" data-res hidden><span></span> <button class="btn small" type="button" data-act="res-yes">Yes</button> <button class="btn ghost small" type="button" data-act="res-no">Keep</button></span>
      </div>`).join('')}</section>`; }).join('')}
      <p class="ed-msg" id="fx-msg" role="status"></p>`;
  }

  // Matches still to play, in kick-off order (a red card in one game can rule a player out of the next).
  const todo = week => fixtures.filter(f => !f.postponed && !results.has(f.id) && (week == null || f.week === week));

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
        what.textContent = `${name(f.home)} v ${name(f.away)} · week ${f.week}${list.length > 1 ? ` (${done + 1} of ${list.length})` : ''}`;
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

  const idFor = (w, h, a) => `w${w}-${h}-${a}`.toLowerCase();
  async function insertAll(list, msg) {
    const c = await ctx.db();
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await c.from('fixtures').insert(list.slice(i, i + 100));
      if (error) throw new Error(/duplicate|already exists/i.test(error.message) ? 'Some of those matches already exist.' : `${explain(error)} (${String(error.message).slice(0, 120)})`);
    }
    say(msg, '');
  }

  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = f.querySelector('.ed-msg'), btn = f.querySelector('.ed-actions .btn');
    btn.disabled = true; say(msg, 'Creating…');
    try {
      const c = await ctx.db();
      if (f.id === 'fx-gen') {
        const start = f.elements.start.value, every = Number(f.elements.every.value) || 7, lock = Number(f.elements.lock.value), look = f.elements.look.value;
        const plan = roundRobin(clubs().map(x => x.code), f.elements.rounds.value === '2');
        const wk0 = Math.max(0, ...fixtures.map(x => x.week));
        if (wk0 + plan.length > 99) throw new Error('That would go past week 99.');
        const up = await c.from('rounds').upsert(plan.map((_, w) => ({ week: wk0 + w + 1, name: `Round ${wk0 + w + 1}`, look, lock_minutes_before: lock })));
        if (up.error) throw new Error(explain(up.error));
        const all = [];
        for (let w = 0; w < plan.length; w++) {
          const week = wk0 + w + 1, placed = placeWeek(plan[w], addDays(start, w * every), rows);
          const blocks = rows.map((r, i) => ({ r, i, first: placed.filter(p => p.win === i).map(p => p.at).sort()[0] })).filter(b => b.first);
          const wi = await c.from('match_windows').insert(blocks.map(b => ({ week, label: `${DAYS[b.r.day]} ${b.r.time}`, starts_at: b.first, gap_minutes: b.r.gap }))).select('id, starts_at');
          if (wi.error) throw new Error(explain(wi.error));
          const idOf = win => { const b = blocks.find(x => x.i === win); return wi.data.find(x => new Date(x.starts_at).getTime() === new Date(b.first).getTime())?.id ?? null; };
          placed.forEach(p => all.push({ id: idFor(week, p.h, p.a), week, home: p.h, away: p.a, starts_at: p.at, window_id: idOf(p.win) }));
        }
        await insertAll(all, msg);
      } else {
        const v = Object.fromEntries(new FormData(f));
        if (v.home === v.away) throw new Error('Pick two different clubs.');
        if (!rounds.some(r => r.week === Number(v.week))) { const r = await c.from('rounds').upsert({ week: Number(v.week), name: `Round ${v.week}` }); if (r.error) throw new Error(explain(r.error)); }
        await insertAll([{ id: idFor(v.week, v.home, v.away), week: Number(v.week), home: v.home, away: v.away, starts_at: v.date ? melbourneToIso(v.date, v.time || '19:00') : null }], msg);
      }
      await load(); draw();
    } catch (err) { say(msg, err.message); btn.disabled = false; }
  });

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'sim-all') return simulate(todo());
    if (act === 'sim-week') return simulate(todo(Number(b.closest('.fx-week').dataset.week)));
    if (act === 'win-add') { rows.push({ day: 6, time: '19:00', games: 0, gap: 90 }); pattern = 'custom'; return draw(); }
    if (act === 'win-del') { rows.splice(Number(b.closest('.fx-win').dataset.i), 1); pattern = 'custom'; return draw(); }
    if (act.startsWith('clear-')) {
      const box = b.closest('.fx-week, .pl-sum');
      if (act === 'clear-all' || act === 'clear-week') { b.hidden = true; box.querySelector('.ed-confirm').hidden = false; return; }
      if (act === 'clear-no') { box.querySelector('[data-act="clear-all"], [data-act="clear-week"]').hidden = false; box.querySelector('.ed-confirm').hidden = true; return; }
      const week = act === 'clear-week-yes' ? Number(box.dataset.week) : null, c = await ctx.db();
      b.disabled = true;
      let q = c.from('fixtures').delete(); q = week ? q.eq('week', week) : q.gte('week', 0);
      let r = await q;
      if (!r.error) { q = c.from('rounds').delete(); r = await (week ? q.eq('week', week) : q.gte('week', 0)); }   // rounds take their match blocks with them
      if (r.error) { b.disabled = false; return say(document.getElementById('fx-msg'), explain(r.error)); }
      await load(); return draw();
    }
    const row = b.closest('.fx-row'), f = fixtures.find(x => x.id === row.dataset.id);
    if (act === 'sim') return simulate([f]);
    if (act === 'again' || act === 'unplay') {
      const box = row.querySelector('[data-res]');
      box.dataset.then = act; box.hidden = false;
      box.firstElementChild.textContent = act === 'again' ? 'Replace its result with a new match?' : 'Remove this result and its match file?';
      return;
    }
    if (act === 'res-no') { row.querySelector('[data-res]').hidden = true; return; }
    if (act === 'res-yes') {
      const then = row.querySelector('[data-res]').dataset.then;
      if (then === 'again') return simulate([f]);
      try { await (await import('./simulate.js')).removeResult(await ctx.db(), f); } catch (err) { return say(document.getElementById('fx-msg'), err.message); }
      results.delete(f.id); return draw();
    }
    if (act === 'del' || act === 'del-no') { row.querySelector('[data-act="del"]').hidden = act === 'del'; row.querySelector('.ed-confirm').hidden = act === 'del-no'; return; }
    const c = await ctx.db();
    const { error } = act === 'del-yes' ? await c.from('fixtures').delete().eq('id', f.id) : await c.from('fixtures').update({ postponed: !f.postponed }).eq('id', f.id);
    if (error) return say(document.getElementById('fx-msg'), explain(error));
    await load(); draw();
  });

  root.addEventListener('change', async e => {
    const t = e.target, msg = document.getElementById('fx-msg');
    if (t.name === 'pattern') { pattern = t.value; if (PATTERNS[pattern]) rows = structuredClone(PATTERNS[pattern][1]); return draw(); }
    const win = t.closest('.fx-win');
    if (win) { const k = t.dataset.k; rows[Number(win.dataset.i)][k] = k === 'time' ? t.value : Number(t.value); pattern = 'custom'; root.querySelector('[name=pattern]').value = 'custom'; return; }
    const head = t.closest('.fx-head');
    if (head) {
      const week = Number(head.closest('.fx-week').dataset.week), c = await ctx.db();
      const patch = t.classList.contains('fx-rname') ? { name: t.value.trim() || null } : { [t.dataset.r]: t.dataset.r === 'look' ? t.value : Number(t.value) };
      const { error } = await c.from('rounds').upsert({ ...round(week), ...patch });
      say(msg, error ? explain(error) : '');
      if (!error) { await load(); head.closest('.fx-week').querySelector('.fx-lock').textContent = lockText(week); }
      return;
    }
    const row = t.closest('.fx-row'); if (!row || t.type !== 'datetime-local') return;
    const [d, tm] = t.value.split('T');
    const { error } = await (await ctx.db()).from('fixtures').update({ starts_at: d ? melbourneToIso(d, tm || '19:00') : null }).eq('id', row.dataset.id);
    say(msg, error ? explain(error) : '');
    if (!error) { await load(); const wk = row.closest('.fx-week'); wk.querySelector('.fx-lock').textContent = lockText(Number(wk.dataset.week)); }
  });

  try { await load(); draw(); } catch (err) { root.innerHTML = `<p class="quiet">${esc(err.message)} <a href="#fixtures">Try again</a></p>`; }
}
