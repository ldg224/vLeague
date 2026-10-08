// Live match ratings (FU-05): every player's rating as it stands at match second `t`, worked out from the match file's events.
// It is the engine's own rating formula (js/sim/hcl_sim/output.py, `_rating`) run on the events up to `t` instead of the whole match,
// so at full time it gives the same numbers as the file's `stats.players[id].rating`. Keep the two in step.
//   ratingsAt(data, t) -> { [player id]: rating 3.0..9.9 }
// The match result in the formula (+0.2 for a win, -0.2 for a loss) is the score at `t`, so it moves as goals go in.
import { lineOfSlot } from './lineup-pitch.js';

const DEF = 1;   // the defensive line (see lineOfSlot)

// Diminishing returns above 7: a good game is 7.5 to 8.5, and 10 is out of reach.
const shape = r => (r <= 7 ? r : Math.min(9.9, 7 + 3 * (1 - Math.exp(-(r - 7) / 2.2))));

export function ratingsAt(data, t) {
  const home = data.teams.home, S = {}, info = {};
  for (const p of data.players) {
    S[p.id] = { goals: 0, own: 0, assists: 0, key: 0, sot: 0, passes: 0, done: 0, tackles: 0, inter: 0, clear: 0, blocks: 0, takeOns: 0, aerials: 0, miscontrols: 0, fouls: 0, yellow: 0, red: 0, saves: 0, conceded: 0 };
    const formation = (p.team === home.code ? home : data.teams.away).formation;
    info[p.id] = { side: p.team === home.code ? 0 : 1, team: p.team, gk: p.slot === 'GK', def: lineOfSlot(formation, p.slot) === DEF };
  }
  const score = [0, 0];
  for (const e of data.events) {
    if (e.t > t) continue;
    const s = S[e.player];
    switch (e.type) {
      case 'pass': if (s) { s.passes++; if (e.outcome === 'complete') s.done++; } break;
      case 'shot':
        if (s) { if (e.outcome === 'goal' || e.outcome === 'saved') s.sot++; }
        if (e.assist_candidate && S[e.assist_candidate]) S[e.assist_candidate].key++;
        break;
      case 'goal':
        if (e.own_goal) { if (S[e.scorer]) S[e.scorer].own++; } else if (S[e.scorer]) S[e.scorer].goals++;
        if (e.assist && S[e.assist]) S[e.assist].assists++;
        score[e.team === home.code ? 0 : 1]++;
        for (const id in info) if (info[id].team !== e.team && (info[id].gk || info[id].def)) S[id].conceded++;
        break;
      case 'control': if (s && e.how === 'interception') s.inter++; break;
      case 'tackle': if (s && e.won) s.tackles++; break;
      case 'take_on': if (s) s.takeOns++; break;
      case 'clearance': if (s) s.clear++; break;
      case 'block': if (s) s.blocks++; break;
      case 'aerial_duel': if (s) s.aerials++; break;
      case 'foul': if (s) s.fouls++; break;
      case 'card': if (s) { if (e.card === 'yellow') s.yellow++; else s.red++; } break;
      case 'miscontrol': if (s) s.miscontrols++; break;
      case 'save': if (s) s.saves++; break;
      default: break;
    }
  }
  const out = {};
  for (const id in S) {
    const s = S[id], i = info[id], mine = score[i.side], theirs = score[1 - i.side];
    let r = 6.0;
    r += 1.0 * s.goals + 0.7 * s.assists + 0.25 * s.key + 0.15 * s.sot;
    r += 0.012 * s.done - 0.035 * (s.passes - s.done);
    r += 0.12 * s.tackles + 0.1 * s.inter + 0.05 * s.clear + 0.1 * s.blocks;
    r += 0.1 * s.takeOns + 0.05 * s.aerials - 0.05 * s.miscontrols;
    r -= 0.05 * s.fouls + 0.3 * s.yellow + 1.5 * s.red + 0.8 * s.own;
    if (i.gk) r += 0.3 * s.saves - 0.25 * s.conceded;
    else if (i.def) r -= 0.1 * s.conceded;
    r += mine > theirs ? 0.2 : mine < theirs ? -0.2 : 0;
    out[id] = Math.round(Math.max(3.0, shape(r)) * 10) / 10;
  }
  return out;
}
