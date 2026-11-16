// The saved match file (the engine's whole record of a match: events, periods, players, team stats, ball frames), read once per match for the match page's
// Facts, Lineup and Stats tabs (WR-38 to WR-40). It lives in the `matches` bucket as gzip JSON (about 2 MB), so it is only fetched when a tab needs it.
//   loadMatchFile(fx) -> Promise of the parsed file with `byId` (player id -> player) added, or null when the match has none (a demo match carries its own,
//                       js/demo-match.js); rejects if the download fails, and the next call tries again.
import { db } from './auth.js';

const memo = new Map();

export const prepareMatchFile = d => { d.byId = Object.fromEntries((d.players || []).map(x => [x.id, x])); prepare(d); return d; };   // for a match file read some other way (the localhost preview's ?file=)

// What the match viewer (js/viewer/player.js) reads besides the players: the frame columns by name, players by their slot index, and the goals.
function prepare(d) {
  if (d.frames?.fields) d.fi = Object.fromEntries(d.frames.fields.map((f, i) => [f, i]));
  d.byIdx = Object.fromEntries((d.players || []).map(p => [p.idx, p]));
  d.goals = (d.events || []).filter(e => e.type === 'goal');
}

// ---------- Which version of a match (B-42) ----------
// Playing a match again (after a problem) replaces its file under the same name. A page opened before that, or a copy the browser kept, can still hold the old version.
// The engine's seed, its version and the final score together name a version, on the file (d.engine, d.result) and on the result summary alike.
export const resultVersion = r => (r?.seed == null ? null : `${r.seed}|${r.engine ?? ''}|${r.home}-${r.away}`);
export const fileVersion = d => (d?.engine?.seed == null ? null : `${d.engine.seed}|${d.engine.version ?? ''}|${d.result?.home}-${d.result?.away}`);

// The version the database holds now (not the page's copy of the season); null when it can't tell.
export async function latestVersion(fixtureId) {
  try {
    const { data } = await (await db()).from('results').select('seed:summary->seed, engine:summary->engine, home:summary->home, away:summary->away').eq('fixture', fixtureId).maybeSingle();
    return resultVersion(data);
  } catch { return null; }
}

// Is this file older than the match it is shown for? (the page's result, or the database's newest when it was checked)
export const isStale = (fx, d) => {
  const v = fileVersion(d);
  if (!v || fx.demoFile) return false;
  const page = resultVersion(fx.result);
  return (page != null && page !== v) || (d.latest != null && d.latest !== v);
};

async function readFile(path, fresh) {
  const c = await db();
  let blob;
  if (fresh) {   // a link of its own, so the browser can't hand back the copy it kept
    const { data, error } = await c.storage.from('matches').createSignedUrl(path, 120);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'The match file isn’t available yet.');
    const res = await fetch(data.signedUrl, { cache: 'reload' });
    if (!res.ok) throw new Error(`The match file didn’t load (error ${res.status}).`);
    blob = await res.blob();
  } else {
    const r = await c.storage.from('matches').download(path);
    if (r.error || !r.data) throw new Error(r.error?.message || 'The match file isn’t available yet.');
    blob = r.data;
  }
  const d = JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text());
  d.byId = Object.fromEntries((d.players || []).map(x => [x.id, x]));
  prepare(d);
  return d;
}

// Forget the copy held for a match, so the next loadMatchFile reads it again (the "Load the new match" button).
export const forgetMatchFile = id => memo.delete(id);

export function loadMatchFile(fx) {
  if (memo.has(fx.id)) return memo.get(fx.id);
  const p = (async () => {
    if (fx.demoFile) return fx.demoFile;   // (no ball frames: the match viewer is not shown for it)
    if (!fx.result?.file) return null;
    let d = await readFile(fx.result.file, false);
    // Check the version against the database. If the browser handed back an old copy, read it again past the cache.
    const latest = await latestVersion(fx.id);
    if (latest && fileVersion(d) && fileVersion(d) !== latest) d = await readFile(fx.result.file, true).catch(() => d);
    d.latest = latest;
    return d;
  })();
  memo.set(fx.id, p);
  p.catch(() => memo.delete(fx.id));
  return p;
}

// The warning over a match whose file is an old version: warning tape top and bottom, what happened, and the way to the new one.
export const staleBanner = ({ busy = false } = {}) => `<section class="stale-tape" role="alert"><div class="stale-in">
  <div><b>You’re watching an old version of this match</b><p>It was played again after a problem. The score, stats and video may have changed.</p></div>
  <button type="button" class="stale-go" data-stale-reload${busy ? ' disabled' : ''}>${busy ? 'Loading…' : 'Load the new match'}</button></div></section>`;
