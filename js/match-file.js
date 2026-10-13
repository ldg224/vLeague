// The saved match file (the engine's whole record of a match: events, periods, players, team stats, ball frames), read once per match for the match page's
// Facts, Lineup and Stats tabs (WR-38 to WR-40). It lives in the `matches` bucket as gzip JSON (about 2 MB), so it is only fetched when a tab needs it.
//   loadMatchFile(fx) -> Promise of the parsed file with `byId` (player id -> player) added, or null when the match has none (a demo match carries its own,
//                       js/demo-match.js); rejects if the download fails, and the next call tries again.
import { db } from './auth.js';

const memo = new Map();

export function loadMatchFile(fx) {
  if (memo.has(fx.id)) return memo.get(fx.id);
  const p = (async () => {
    if (fx.demoFile) return fx.demoFile;
    if (!fx.result?.file) return null;
    const { data: blob, error } = await (await db()).storage.from('matches').download(fx.result.file);
    if (error || !blob) throw new Error(error?.message || 'The match file isn’t available yet.');
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const d = JSON.parse(text);
    d.byId = Object.fromEntries((d.players || []).map(x => [x.id, x]));
    return d;
  })();
  memo.set(fx.id, p);
  p.catch(() => memo.delete(fx.id));
  return p;
}
