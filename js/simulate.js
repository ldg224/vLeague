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

const stamp = f => `${f.date || ''}T${f.time || ''}`;

// Players who miss each fixture: a red card or second yellow bans the player from the club's next game(s), in
// kick-off order, skipping postponed ones. Returns Map(fixture id -> [{ player, name, reason }]).
export function suspensions(season) {
  const out = new Map();
  const played = season.fixtures.filter(f => f.date && !f.postponed);
  const clubGames = code => played.filter(f => f.home === code || f.away === code).sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const owner = id => season.players.find(p => String(p.id) === String(id))?.team;
  for (const f of season.fixtures) {
    if (!f.result || !f.date) continue;
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
function toLeague(season, codes, out = new Set(), sheets = {}) {
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
        offense: Number(p.offense) || 5, defense: Number(p.defense) || 5,
      };
    }
  }
  return { teams, players, attributes: {}, tactics, schedule: [] };
}

export async function simulateFixture(c, season, fixture, { onProgress, seed } = {}) {
  if (!fixture?.home || !fixture?.away) throw new Error('The fixture needs a home and an away club.');
  if (fixture.home === fixture.away) throw new Error('A club can\'t play itself.');
  const suspended = (suspensions(season).get(fixture.id) || []).map(s => ({ player: s.player, reason: s.reason }));
  const out = new Set(suspended.map(s => s.player));
  toLeague(season, [fixture.home, fixture.away], out);   // validates both squads before loading anything
  const sheets = fixture.week != null && !fixture.stage ? await weekSheets(c, fixture.week) : {};
  const league = toLeague(season, [fixture.home, fixture.away], out, sheets);
  await start();
  const job = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(job, { resolve, reject, onProgress });
    worker.postMessage({
      job, league: JSON.stringify(league), home: fixture.home, away: fixture.away,
      seed: seed ?? null,
      info: { fixture_id: fixture.id || null, week: fixture.week ?? null, date: fixture.date || null, time: fixture.time || null, stage: fixture.stage || null, suspended },
    });
  });
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
