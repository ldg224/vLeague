// Editor → Fixtures (0.12): add a match, or generate a whole season, then set times, postpone or remove.
// Kick-off times are entered in Melbourne time and stored as an exact instant. The database checks everything again
// (supabase/migrations/0013_fixtures_results.sql); results are filled in by Simulate (0.13).

const ZONE = 'Australia/Melbourne';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const partsOf = d => Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));

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

export function fixturesView() {
  return '<h1>Fixtures</h1><div id="fx-root"><p class="quiet">Loading fixtures…</p></div>';
}

export async function mountFixtures(ctx) {
  const root = document.getElementById('fx-root');
  if (!root) return;
  const { esc, explain } = ctx;
  let fixtures = [];
  const clubs = () => ctx.clubs.filter(c => c.status === 'active');
  const name = code => ctx.clubs.find(c => c.code === code)?.name || code;
  const say = (el, t) => { if (el) el.textContent = t; };

  async function load() {
    const { data, error } = await (await ctx.db()).from('fixtures').select('id, week, home, away, starts_at, stage, postponed').order('week').order('starts_at').range(0, 1999);
    if (error) throw new Error(explain(error));
    fixtures = data;
  }
  const clubOpts = sel => clubs().map(c => `<option value="${esc(c.code)}" ${c.code === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const nextSat = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };

  function draw() {
    const weeks = [...new Set(fixtures.map(f => f.week))].sort((a, b) => a - b);
    root.innerHTML = `<p class="pl-sum"><b>${fixtures.length}</b> fixture${fixtures.length === 1 ? '' : 's'} over ${weeks.length} week${weeks.length === 1 ? '' : 's'}.</p>
      <form class="ed-invite" id="fx-gen"><h2>Generate a season</h2>
        <p class="ed-hint">Every active club (${clubs().length}) plays every other. With an odd number, one club rests each week. Times are Melbourne time.</p>
        <label>First week starts <input type="date" name="start" value="${nextSat()}" required></label>
        <label>Kick-off time <input type="time" name="time" value="19:00" required></label>
        <label>Rounds <select name="rounds"><option value="1">Everyone plays everyone once</option><option value="2">Home and away</option></select></label>
        <div class="ed-actions"><button class="btn" ${clubs().length < 2 ? 'disabled' : ''}>Create fixtures</button></div>
        <p class="ed-msg" role="status"></p></form>
      <details class="pl-paste"><summary>Add one match</summary><form class="ed-invite" id="fx-add">
        <label>Week <input type="number" name="week" min="1" max="99" value="${(weeks.at(-1) || 0) + 1}" required></label>
        <label>Home <select name="home">${clubOpts()}</select></label><label>Away <select name="away">${clubOpts(clubs()[1]?.code)}</select></label>
        <label>Date <input type="date" name="date"></label><label>Kick-off <input type="time" name="time" value="19:00"></label>
        <div class="ed-actions"><button class="btn">Add match</button></div><p class="ed-msg" role="status"></p></form></details>
      ${weeks.map(w => `<section class="fx-week"><h2>Week ${w}</h2>${fixtures.filter(f => f.week === w).map(f => `<div class="fx-row" data-id="${esc(f.id)}">
        <span class="fx-teams"><b>${esc(name(f.home))}</b> v <b>${esc(name(f.away))}</b>${f.stage ? ` <small>${esc(f.stage)}</small>` : ''}${f.postponed ? ' <small>postponed</small>' : ''}</span>
        <input type="datetime-local" value="${toLocalInput(f.starts_at)}" aria-label="Kick-off (Melbourne time)">
        <button class="btn ghost small" type="button" data-act="postpone">${f.postponed ? 'Restore' : 'Postpone'}</button>
        <button class="btn ghost small" type="button" data-act="del">Remove</button>
        <span class="ed-confirm" hidden>Remove this match and its result? <button class="btn small" type="button" data-act="del-yes">Yes</button> <button class="btn ghost small" type="button" data-act="del-no">Keep</button></span>
      </div>`).join('')}</section>`).join('')}
      <p class="ed-msg" id="fx-msg" role="status"></p>`;
  }

  const idFor = (w, h, a) => `w${w}-${h}-${a}`.toLowerCase();
  async function insertAll(rows, msg) {
    const c = await ctx.db();
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await c.from('fixtures').insert(rows.slice(i, i + 100));
      if (error) throw new Error(/duplicate|already exists/i.test(error.message) ? 'Some of those matches already exist.' : `${explain(error)} (${String(error.message).slice(0, 120)})`);
    }
    await load(); say(msg, '');
  }

  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = f.querySelector('.ed-msg'), btn = f.querySelector('button');
    btn.disabled = true; say(msg, 'Creating…');
    try {
      if (f.id === 'fx-gen') {
        const rows = [];
        roundRobin(clubs().map(c => c.code), f.elements.rounds.value === '2').forEach((games, w) => games.forEach(([h, a]) => rows.push({
          id: idFor(w + 1, h, a), week: w + 1, home: h, away: a, starts_at: melbourneToIso(addDays(f.elements.start.value, w * 7), f.elements.time.value) })));
        await insertAll(rows, msg);
      } else {
        const v = Object.fromEntries(new FormData(f));
        if (v.home === v.away) throw new Error('Pick two different clubs.');
        await insertAll([{ id: idFor(v.week, v.home, v.away), week: Number(v.week), home: v.home, away: v.away, starts_at: v.date ? melbourneToIso(v.date, v.time || '19:00') : null }], msg);
      }
      draw();
    } catch (err) { say(msg, err.message); btn.disabled = false; }
  });

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = b.closest('.fx-row'), f = fixtures.find(x => x.id === row.dataset.id), act = b.dataset.act;
    if (act === 'del' || act === 'del-no') { row.querySelector('[data-act="del"]').hidden = act === 'del'; row.querySelector('.ed-confirm').hidden = act === 'del-no'; return; }
    const c = await ctx.db();
    const { error } = act === 'del-yes' ? await c.from('fixtures').delete().eq('id', f.id) : await c.from('fixtures').update({ postponed: !f.postponed }).eq('id', f.id);
    if (error) return say(document.getElementById('fx-msg'), explain(error));
    await load(); draw();
  });

  root.addEventListener('change', async e => {
    const row = e.target.closest('.fx-row'); if (!row || e.target.type !== 'datetime-local') return;
    const [d, t] = e.target.value.split('T');
    const { error } = await (await ctx.db()).from('fixtures').update({ starts_at: d ? melbourneToIso(d, t || '19:00') : null }).eq('id', row.dataset.id);
    say(document.getElementById('fx-msg'), error ? explain(error) : '');
    if (!error) await load();
  });

  try { await load(); draw(); } catch (err) { root.innerHTML = `<p class="quiet">${esc(err.message)} <a href="#fixtures">Try again</a></p>`; }
}
