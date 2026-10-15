// Goal of the week (S-05): which goals of a round are worth showing. Pure functions over a saved match file, no page and no database.
//   goalMoments(file, fx)       every open-play goal of a match as { key, fixture, id, t, minute, team, scorer, assist, wow, ...facts }
//   shortlist(moments, n = 15)  the n highest-scoring goals of a round, best first (at most 3 from one match, so one big game can't fill the list)
//   CLIP_BEFORE, CLIP_AFTER     the clip is the 5 seconds of match time from t - CLIP_BEFORE to t + CLIP_AFTER
//   clipWindow(m)               [from, to] of that clip
// The wow score is out of about 100. A goal scores for being unlikely (low xG), far out, struck hard, hit as a volley or a header from a cross, for the move
// behind it (passes in the same spell of possession, defenders beaten), and for what it did to the match (an equaliser, the lead, or a late one). Penalties and own goals
// are never in it.

export const CLIP_BEFORE = 4, CLIP_AFTER = 1;
export const clipWindow = m => [m.t - CLIP_BEFORE, m.t + CLIP_AFTER];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GOAL_Y = 34, LENGTH = 105;

export function goalMoments(file, fx) {
  const ev = file?.events || [], shots = new Map(ev.filter(e => e.type === 'shot').map(e => [e.id, e]));
  const names = file?.byId || Object.fromEntries((file?.players || []).map(p => [p.id, p]));
  const out = [];
  for (const g of ev) {
    if (g.type !== 'goal' || g.own_goal) continue;
    const shot = shots.get(g.shot);
    if (!shot || shot.subtype === 'penalty') continue;
    const before = ev.filter(e => e.poss === shot.poss && e.t <= shot.t);
    const passes = before.filter(e => e.type === 'pass' && e.team === g.team).length;
    const takeOns = before.filter(e => e.type === 'take_on' && e.team === g.team && e.won).length;
    const gx = g.x > LENGTH / 2 ? LENGTH : 0, dist = Math.hypot(shot.x - gx, shot.y - GOAL_Y);
    const home = g.team === fx.home, [h, a] = g.score || [0, 0];
    const mine = home ? h : a, theirs = home ? a : h;   // the score after the goal, the scorer's side first
    const level = mine === theirs, lead = mine - theirs === 1;
    const xg = shot.xg ?? 0.3, speed = shot.speed ?? 20;
    const parts = {
      rare: clamp((0.4 - xg) / 0.4, 0, 1) * 34,
      range: clamp((dist - 12) / 22, 0, 1) * 14,
      power: clamp((speed - 22) / 14, 0, 1) * 8,
      style: shot.subtype === 'volley' ? 10 : shot.body === 'head' ? (xg < 0.2 ? 6 : 2) : 0,
      move: clamp(passes, 0, 12) / 12 * 10 + clamp(takeOns, 0, 2) * 5,
      moment: (level ? 5 : lead ? 4 : 0) + (parseInt(g.minute, 10) >= 80 ? 3 : 0),
    };
    const wow = Math.round(Object.values(parts).reduce((s, v) => s + v, 0) * 10) / 10;
    out.push({
      key: `${fx.id}:${g.id}`, fixture: fx.id, id: g.id, t: g.t, minute: g.minute, team: g.team, home: fx.home, away: fx.away,
      scorer: g.scorer, scorerName: names[g.scorer]?.name || '', assist: g.assist ?? null, score: g.score, wow, xg, dist: Math.round(dist), body: shot.body, subtype: shot.subtype, passes, takeOns,
    });
  }
  return out;
}

export function shortlist(moments, n = 15, perMatch = 3) {
  const used = new Map(), out = [];
  for (const m of [...moments].sort((a, b) => b.wow - a.wow || a.t - b.t)) {
    if ((used.get(m.fixture) || 0) >= perMatch) continue;
    used.set(m.fixture, (used.get(m.fixture) || 0) + 1);
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

// A one-line description for the card and the caption: "31 m, left foot, 0.03 xG".
export const describe = m => [`${m.dist} m`, m.subtype === 'volley' ? 'volley' : m.body === 'head' ? 'header' : null, m.passes >= 6 ? `${m.passes}-pass move` : null, `${m.xg.toFixed(2)} xG`].filter(Boolean).join(', ');
