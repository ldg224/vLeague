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

export function loadMatchFile(fx) {
  if (memo.has(fx.id)) return memo.get(fx.id);
  const p = (async () => {
    if (fx.demoFile) return fx.demoFile;   // (no ball frames: the match viewer is not shown for it)
    if (!fx.result?.file) return null;
    const { data: blob, error } = await (await db()).storage.from('matches').download(fx.result.file);
    if (error || !blob) throw new Error(error?.message || 'The match file isn’t available yet.');
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const d = JSON.parse(text);
    d.byId = Object.fromEntries((d.players || []).map(x => [x.id, x]));
    prepare(d);
    return d;
  })();
  memo.set(fx.id, p);
  p.catch(() => memo.delete(fx.id));
  return p;
}
