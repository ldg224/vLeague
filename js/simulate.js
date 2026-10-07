// Simulate a fixture in the browser with the match engine (js/sim/hcl_sim, run by js/sim-worker.js with Pyodide).
// Office only: the Editor's Fixtures tab uses it (0.14).
//
//   const data = await simulateFixture(client, season, fixture, { onProgress, seed });
//   await saveResult(client, fixture, data);       // result summary into `results`, full match file into the `matches` bucket
//
// `season` is what loadSeason() returns (teams, players, fixtures with their results); `client` is the signed-in
// Supabase client. The engine (Pyodide, about 10 MB, cached by the browser) loads on the first call only.
// Each club plays its week's locked team sheet (formation, tactics, XI, set-piece takers); a club with no locked sheet
// gets the engine's own picks. Players suspended by a red card are left out. Finals (no week) use the engine's picks.

import { loadPress, pressFactors } from './press-data.js';

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
const BAN_MATCHES = 1;                       // games a red card or two yellows costs
const FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'];
const TACTICS = ['tempo', 'pressing', 'width', 'line_height', 'directness'];
let worker = null, readyPromise = null, jobSeq = 0;
const pending = new Map();

function start() {
  if (worker) return readyPromise;
  worker = new Worker(new URL('./sim-worker.js', import.meta.url));
  readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') return resolve();
      if (m.type === 'failed') { reject(new Error(`The match simulator couldn't start: ${m.message}`)); worker = null; return; }
      const job = pending.get(m.job);
      if (!job) return;
      if (m.type === 'progress') { job.onProgress?.(m.p); return; }
      pending.delete(m.job);
      if (m.type === 'result') job.resolve(JSON.parse(m.payload));
      else job.reject(new Error(`The simulation failed: ${m.message}`));
    };
    worker.onerror = e => reject(new Error(`The match simulator couldn't start: ${e.message || 'worker error'}`));
  });
  return readyPromise;
}

// Checks a team has a squad the engine can play; throws a readable error if not.
function checkSquad(season, code) {
  const team = season.teams.find(t => t.code === code);
  if (!team) throw new Error(`Club ${code} isn't in the league.`);
  const squad = (season.players || []).filter(p => p.team === code);
  if (squad.length < 11) throw new Error(`${team.name} has only ${squad.length} player${squad.length === 1 ? '' : 's'}; a club needs at least 11 to play a match.`);
  const missing = POSITIONS.filter(pos => !squad.some(p => (p.position || '').toUpperCase() === pos));
  if (missing.length) throw new Error(`${team.name} has no ${missing.join(', ')} in its squad. Each club needs at least one GK, DEF, MID and FWD.`);
  return { team, squad };
}

// A club's press-conference effect (0.30): ratings times a factor within 3% of 1, then kept inside 1 to 10.
const scale = (v, f = 1) => Math.min(10, Math.max(1, Math.round(v * f * 100) / 100));

const stamp = f => `${f.date || ''}T${f.time || ''}`;

// Players who miss each fixture: a red card or second yellow bans the player from the club's next game(s), in
// kick-off order, skipping postponed ones. Returns Map(fixture id -> [{ player, name, reason }]).
export function suspensions(season) {
  const out = new Map();
  const played = season.fixtures.filter(f => f.date && !f.postponed && !f.test);
  const clubGames = code => played.filter(f => f.home === code || f.away === code).sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const owner = id => season.players.find(p => String(p.id) === String(id))?.team;
  for (const f of season.fixtures) {
    if (!f.result || !f.date || f.test) continue;
    for (const c of f.result.cards || []) {
      if (c.card !== 'red' && c.card !== 'second_yellow') continue;
      const team = c.team || owner(c.player);
      if (!team) continue;
      const reason = `${c.card === 'red' ? 'Red card' : 'Two yellows'} v ${f.home === team ? f.away : f.home} (week ${f.week})`;
      clubGames(team).filter(g => stamp(g) > stamp(f)).slice(0, BAN_MATCHES).forEach(g => {
        if (!out.has(g.id)) out.set(g.id, []);
        out.get(g.id).push({ player: String(c.player), name: c.name, reason });
      });
    }
  }
  return out;
}

// { CODE: sheet } for a week, or an error saying why Simulate has to wait.
async function weekSheets(c, week) {
  const dl = await c.from('deadlines').select('locks_at, locked_at').eq('week', week).maybeSingle();
  if (dl.error) throw new Error(`Couldn't read week ${week}'s line-ups. Try again.`);
  if (!dl.data) throw new Error(`Week ${week} has no line-up deadline yet. Add a kick-off to the week and it gets one.`);
  if (!dl.data.locked_at) {
    const at = new Date(dl.data.locks_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    throw new Error(`Week ${week}'s line-ups lock ${at}. Simulate after that.`);
  }
  const rows = await c.from('week_sheets').select('*').eq('week', week);
  if (rows.error) throw new Error(`Couldn't read week ${week}'s line-ups. Try again.`);
  return Object.fromEntries(rows.data.map(r => [r.club, r]));
}

// The engine's tactics input for one club, using only players who are available for this match.
// Chosen players who are suspended or no longer in the squad are dropped; the engine fills their slots.
function sheetTactics(sheet, available) {
  const ok = id => id != null && available.has(String(id));
  const t = {};
  if (FORMATIONS.includes(sheet.formation)) t.formation = sheet.formation;
  for (const k of TACTICS) {
    const v = Number(sheet.tactics?.[k]);
    if (sheet.tactics?.[k] != null && Number.isFinite(v)) t[k] = Math.min(1, Math.max(0, v));
  }
  if (t.formation && sheet.lineup && typeof sheet.lineup === 'object') {
    t.lineup = Object.fromEntries(Object.entries(sheet.lineup).filter(([, id]) => ok(id)).map(([slot, id]) => [slot, String(id)]));
  }
  for (const k of ['captain', 'penalties', 'freekicks', 'corners']) if (ok(sheet[k])) t[k] = String(sheet[k]);
  return t;
}

// The engine's league format, built from the two clubs and their players. Suspended players (`out`) are left out.
function toLeague(season, codes, out = new Set(), sheets = {}, factor = {}) {
  const teams = {}, players = {}, tactics = {};
  for (const code of codes) {
    const { team, squad } = checkSquad(season, code);
    const available = squad.filter(p => !out.has(String(p.id)));
    if (available.length < 7) throw new Error(`${team.name} has only ${available.length} players available after suspensions; at least 7 are needed.`);
    teams[code] = { code, name: team.name, manager: team.manager || '', colour: team.colour || '#888888' };
    tactics[code] = sheetTactics(sheets[code] || {}, new Set(available.map(p => String(p.id))));
    for (const p of available) {
      players[p.id] = {
        id: String(p.id), name: p.name, team: code, position: (p.position || 'MID').toUpperCase(),
        offense: scale(Number(p.offense) || 5, factor[code]), defense: scale(Number(p.defense) || 5, factor[code]),
      };
    }
  }
  return { teams, players, attributes: {}, tactics, schedule: [] };
}

// { CODE: factor } from both clubs' press-conference answers; nothing is changed if the press tables aren't there yet.
async function pressFor(c, fixture) {
  if (!fixture.id) return {};
  try {
    const { bank, answers } = await loadPress([fixture.id]);
    return bank.length ? pressFactors(bank, answers, fixture.home, fixture.away) : {};
  } catch { return {}; }
}

export async function simulateFixture(c, season, fixture, { onProgress, seed } = {}) {
  if (!fixture?.home || !fixture?.away) throw new Error('The fixture needs a home and an away club.');
  if (fixture.home === fixture.away) throw new Error('A club can\'t play itself.');
  const suspended = (suspensions(season).get(fixture.id) || []).map(s => ({ player: s.player, reason: s.reason }));
  const out = new Set(suspended.map(s => s.player));
  toLeague(season, [fixture.home, fixture.away], out);   // validates both squads before loading anything
  const sheets = fixture.week != null && !fixture.stage ? await weekSheets(c, fixture.week) : {};
  const factor = await pressFor(c, fixture);
  const league = toLeague(season, [fixture.home, fixture.away], out, sheets, factor);
  return runEngine(league, fixture.home, fixture.away, seed, { fixture_id: fixture.id || null, week: fixture.week ?? null, date: fixture.date || null, time: fixture.time || null, stage: fixture.stage || null, suspended }, onProgress);
}

// Hands a league (two clubs and their players) to the engine in its worker and waits for the match file.
async function runEngine(league, home, away, seed, info, onProgress) {
  await start();
  const job = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(job, { resolve, reject, onProgress });
    worker.postMessage({ job, league: JSON.stringify(league), home, away, seed: seed ?? null, info });
  });
}

// ---------------------------------------------------------------- test match (0.39)
// A made-up match for trying the broadcast, Game centre and highlights without touching the season: two random active clubs get
// random made-up squads (in memory only; no real player or club is changed), the match is played by the engine, saved as a
// fixture in week 99 (a "Test match" round that doesn't count for the table, the top players or any manager's page), and set to
// kick off right now so it plays out live. The deadline row the database makes for the week is removed, so no reminder or
// line-up lock ever fires for it. `removeTestMatches` takes it all away again.
export const TEST_WEEK = 99;
const melb = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const throwOn = (r, what) => { if (r.error) throw new Error(`${what} (${r.error.message})`); return r; };

export async function startTestMatch(c, clubs, { look = 'random', looks = [], onProgress, onStatus = () => {} } = {}) {
  const active = clubs.filter(x => x.status === 'active');
  if (active.length < 2) throw new Error('A test match needs at least two active clubs.');
  const [home, away] = [...active].sort(() => Math.random() - 0.5);
  const pickLook = look === 'random' ? (looks.length ? looks[Math.floor(Math.random() * looks.length)].key : 'classic') : look;

  // Two random squads of 16: made-up names and ratings, with a different overall strength each so the match isn't a coin flip.
  onStatus('Making up the squads…');
  const { generate } = await import('./names.js');
  const mean = () => 4.8 + Math.random() * 1.5;
  const sqA = generate(16, [], { mean: mean(), spread: 1.3 }), sqB = generate(16, sqA.map(p => p.name), { mean: mean(), spread: 1.3 });
  const players = {}, tag = (list, base) => list.forEach((p, i) => { const id = String(base + i + 1); players[id] = { id, name: p.name, team: base === 9000 ? home.code : away.code, position: p.position, offense: p.offense, defense: p.defense }; });
  tag(sqA, 9000); tag(sqB, 9100);   // ids 9001 to 9016 and 9101 to 9116: the shirt number is the last two digits
  const team = x => ({ code: x.code, name: x.name, manager: '', colour: x.colour || '#888888' });
  const league = { teams: { [home.code]: team(home), [away.code]: team(away) }, players, attributes: {}, tactics: { [home.code]: {}, [away.code]: {} }, schedule: [] };

  // The test round and fixture (kick-off set last, once the match exists).
  onStatus('Setting up the test round…');
  const round = { week: TEST_WEEK, name: 'Test match', kind: 'special', look: pickLook, lock_minutes_before: 0, numbered: false, counts_for_ladder: false };
  let r = await c.from('rounds').upsert(round, { onConflict: 'week' });
  if (r.error) r = await c.from('rounds').upsert({ week: TEST_WEEK, name: 'Test match', kind: 'special', look: pickLook, lock_minutes_before: 0 }, { onConflict: 'week' });   // older databases without the newer columns
  throwOn(r, 'The test round couldn’t be made');
  const id = `test-${home.code}-${away.code}-${Date.now().toString(36)}`.toLowerCase();
  throwOn(await c.from('fixtures').insert({ id, week: TEST_WEEK, home: home.code, away: away.code, starts_at: null }), 'The test match couldn’t be made');
  try {
    const now = melb(new Date());
    const data = await runEngine(league, home.code, away.code, Math.floor(Math.random() * 2 ** 31), { fixture_id: id, week: TEST_WEEK, date: now.date, time: now.time, stage: null, suspended: [], test: true }, onProgress);
    onStatus('Saving…');
    const summary = await saveResult(c, { id }, data);
    // Kick off now (a few seconds ago, so the clocks of a computer and the server can't make it start "later").
    throwOn(await c.from('fixtures').update({ starts_at: new Date(Date.now() - 3000).toISOString() }).eq('id', id), 'The kick-off time couldn’t be set');
    await c.from('deadlines').delete().eq('week', TEST_WEEK);   // the database made a line-up deadline for the week; there is nothing to lock
    return { id, home, away, look: pickLook, score: [summary.home, summary.away] };
  } catch (e) {
    await c.from('fixtures').delete().eq('id', id);
    await c.storage.from('matches').remove([`${id}.json.gz`]);
    throw e;
  }
}

// Takes every test match away: its result, its match file, the fixtures, the week's deadline and the test round.
export async function removeTestMatches(c) {
  const { data, error } = await c.from('fixtures').select('id').eq('week', TEST_WEEK);
  if (error) throw new Error(`The test matches couldn’t be listed (${error.message}).`);
  const ids = (data || []).map(f => f.id);
  if (ids.length) {
    await c.storage.from('matches').remove(ids.map(i => `${i}.json.gz`));
    throwOn(await c.from('results').delete().in('fixture', ids), 'The test results couldn’t be removed');
    throwOn(await c.from('fixtures').delete().in('id', ids), 'The test fixtures couldn’t be removed');
  }
  await c.from('deadlines').delete().eq('week', TEST_WEEK);
  await c.from('rounds').delete().eq('week', TEST_WEEK);
  return ids.length;
}

// The compact result kept in the `results` table: score, goals, cards, team stats, player ratings, Man of the Match.
// Same shape the s3 site used, so the pages that read results didn't change.
export function summariseMatch(d) {
  const names = Object.fromEntries(d.players.map(p => [p.id, p.name]));
  const slot = Object.fromEntries(d.players.map(p => [p.id, p.slot]));
  const team = Object.fromEntries(d.players.map(p => [p.id, p.team]));
  const goals = d.events.filter(e => e.type === 'goal').map(e => ({
    t: e.t, minute: e.minute, team: e.team, scorer: e.scorer, scorer_name: names[e.scorer] ?? null,
    assist: e.assist ?? null, assist_name: e.assist ? names[e.assist] ?? null : null, own_goal: !!e.own_goal,
  }));
  const cards = d.events.filter(e => e.type === 'card').map(e => ({ t: e.t, minute: e.minute, team: e.team, player: e.player, name: names[e.player] ?? null, card: e.card }));
  const players = {};
  for (const [id, s] of Object.entries(d.stats.players)) {
    players[id] = {
      name: names[id], team: team[id], slot: slot[id], min: s.minutes, g: s.goals, a: s.assists, og: s.own_goals,
      sh: s.shots, sot: s.shots_on_target, xg: s.xg, kp: s.key_passes, pas: s.passes, pc: s.passes_completed,
      tk: s.tackles_won, int: s.interceptions, clr: s.clearances, blk: s.blocks, sv: s.saves, gc: s.goals_conceded,
      yc: s.yellow, rc: s.red, km: s.distance_km, r: s.rating,
    };
  }
  const motm = Object.keys(players).reduce((best, id) => (!best || players[id].r > players[best].r ? id : best), null);
  const fr = d.frames.data;
  return {
    home: d.result.home, away: d.result.away, duration_t: fr[fr.length - 1][0] / 10, periods: d.periods,
    goals, cards, stats: d.stats.teams, players, motm, engine: d.engine.version, seed: d.engine.seed,
  };
}

// Saves a played match: the full file first (private `matches` bucket, readable only from kick-off), then the result.
// Playing a fixture again replaces both.
export async function saveResult(c, fixture, data) {
  const file = `${fixture.id}.json.gz`;
  const gz = await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const up = await c.storage.from('matches').upload(file, gz, { upsert: true, contentType: 'application/gzip' });
  if (up.error) throw new Error(/bucket not found/i.test(up.error.message) ? 'The match file store isn’t set up yet (run migration 0015).' : `The match file didn’t save (${up.error.message}).`);
  const summary = summariseMatch(data);
  const row = await c.from('results').upsert({ fixture: fixture.id, summary, file });
  if (row.error) throw new Error(`The result didn’t save (${row.error.message}).`);
  return summary;
}

export async function removeResult(c, fixture) {
  const r = await c.from('results').delete().eq('fixture', fixture.id);
  if (r.error) throw new Error(`The result wasn’t removed (${r.error.message}).`);
  await c.storage.from('matches').remove([`${fixture.id}.json.gz`]);
}
