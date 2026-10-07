// Highlights (0.35): the moments worth replaying, found from a match file's events. No page code.
//
//   buildHighlights(data, upTo) -> [{ kind, t, from, to, title, sub, team, minute }] in match order, only moments up to `upTo` seconds
//     (so a live match never shows what hasn't happened yet).
// Kinds: 'goal' (with the build-up), 'penalty', 'red' (a red card or second yellow), 'chance' (a big chance: a high xG shot, a save
// from a good chance, the woodwork). Clips that overlap are joined into one, keeping the most important kind.
const RANK = { goal: 4, penalty: 3, red: 3, chance: 1 };
const LEAD = { goal: 9, penalty: 4, red: 4, chance: 6 }, TAIL = { goal: 5, penalty: 4, red: 4, chance: 3 };

export function buildHighlights(data, upTo = Infinity) {
  if (!data) return [];
  const names = id => data.byId?.[id]?.name || '';
  const end = data.frames.data[data.frames.data.length - 1][0] / 10;
  const evs = data.events.filter(e => e.t <= upTo), clips = [];
  const chainStart = e => { let t = e.t; for (const x of evs) if (x.poss != null && x.poss === e.poss && x.t < t && e.t - x.t < 14) t = x.t; return t; };
  for (const e of evs) {
    let kind = null, title = '', sub = '';
    if (e.type === 'goal') { kind = 'goal'; title = e.own_goal ? 'Own goal' : 'Goal'; sub = `${names(e.scorer)}${e.assist ? `, assist ${names(e.assist)}` : ''}`; }
    else if (e.type === 'penalty') { kind = 'penalty'; title = 'Penalty'; sub = names(e.player); }
    else if (e.type === 'card' && e.card !== 'yellow') { kind = 'red'; title = 'Red card'; sub = names(e.player); }
    else if (e.type === 'shot' && e.outcome !== 'goal' && ((e.xg || 0) >= 0.3 || (e.outcome === 'woodwork') || (e.on_target && (e.xg || 0) >= 0.18))) {
      kind = 'chance'; title = e.outcome === 'woodwork' ? 'Off the woodwork' : e.outcome === 'saved' ? 'Great save' : 'Big chance'; sub = names(e.player);
    }
    if (!kind) continue;
    // A goal starts where its attack began (never more than 14 seconds before); the others get a few seconds of lead-up.
    const from = kind === 'goal' ? Math.min(chainStart(e) - 1, e.t - 5) : e.t - LEAD[kind];
    clips.push({ kind, t: e.t, from: Math.max(0, from, e.t - 14), to: Math.min(end, e.t + TAIL[kind]), title, sub, team: e.team, minute: e.minute, xg: e.xg || 0, score: e.score || null });
  }
  clips.sort((a, b) => a.from - b.from);
  const out = [];
  for (const c of clips) {
    const last = out[out.length - 1];
    if (last && c.from <= last.to + 1) {
      last.to = Math.max(last.to, c.to);
      if (RANK[c.kind] > RANK[last.kind] || (RANK[c.kind] === RANK[last.kind] && c.xg > last.xg)) Object.assign(last, { kind: c.kind, title: c.title, sub: c.sub, team: c.team, minute: c.minute, t: c.t, score: c.score || last.score });
    } else out.push({ ...c });
  }
  // keep every goal, penalty and red card, and the best few chances, in match order
  const chances = out.filter(c => c.kind === 'chance').sort((a, b) => b.xg - a.xg).slice(0, 6);
  return out.filter(c => c.kind !== 'chance' || chances.includes(c)).sort((a, b) => a.from - b.from);
}
