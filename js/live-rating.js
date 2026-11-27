// Live match ratings (FU-05): every player's rating as it stands at match second `t`, worked out from the match file's events.
// It is the engine's own rating formula (js/sim/hcl_sim/rating.py, B-48: FotMob style) run on the events up to `t`, so at full time it
// gives the same numbers as the file's `stats.players[id].rating`. KEEP THE TWO IN STEP.
//   ratingsAt(data, t) -> { [player id]: rating 3.0..10.0 }
// The match result in the formula (+0.15 for a win, -0.15 for a loss) and a clean sheet are as they stand at `t`.
import { FORMATIONS, positionPenalty } from './pitch.js';

// Calibration, as in rating.py (BASE, NORM, GOAL, shape).
const BASE = 6.0, LOW = 3.0, HIGH = 10.0, ERROR_WINDOW = 10.0;
const NORM = { GK: -0.76, DEF: -0.48, MID: 0.00, FWD: 1.05 };
const GOAL = { GK: 1.5, DEF: 1.5, MID: 1.35, FWD: 1.25 };
const VOLUME = 0.7;   // how much the volume actions count (rating.py)
const shape = r => { if (r <= 6.8) return r; const v = 6.8 + 2.2 * (1 - Math.exp(-(r - 6.8) / 1.5)); return v <= 8.4 ? v : Math.min(HIGH, 8.4 + (v - 8.4) * 3.5); };
const blank = () => ({ goals: 0, own: 0, assists: 0, key: 0, xa: 0, xg: 0, sot: 0, passes: 0, done: 0, tackles: 0, inter: 0, clear: 0, blocks: 0,
  dribbles: 0, beaten: 0, aerials: 0, miscontrols: 0, fouls: 0, offsides: 0, yellow: 0, red: 0, saves: 0, conceded: 0, xgot_faced: 0,
  pen_missed: 0, pen_won: 0, pen_conceded: 0, err_shot: 0, err_goal: 0 });

export function tallies(data, t = Infinity) {
  const home = data.teams.home.code, S = {}, team = {}, gk = {};
  for (const p of data.players) { S[p.id] = blank(); team[p.id] = p.team; gk[p.id] = p.slot === 'GK'; }
  const left = {}, came = {};
  for (const e of data.events) {
    if (e.type === 'card' && e.card !== 'yellow') left[e.player] = e.t;
    if (e.type === 'substitution') { left[e.off] = e.t; came[e.player] = e.t; }
  }
  const onPitch = (id, at) => (came[id] ?? 0) <= at && at <= (left[id] ?? Infinity);
  const attacksRight = (code, at) => {
    const per = data.periods.filter(p => p.start_t <= at + 1e-6), p = per.length ? per[per.length - 1] : data.periods[0];
    const right = !p || p.home_attacks === 'right';
    return code === home ? right : !right;
  };
  const losses = [], errByShot = {}, score = [0, 0];
  for (const e of data.events) {
    if (e.t > t) break;
    const s = S[e.player];
    switch (e.type) {
      case 'pass':
        if (s) { s.passes++; if (e.outcome === 'complete') s.done++; else if (e.outcome === 'intercepted') losses.push(e); }
        break;
      case 'shot': {
        const pen = e.subtype === 'penalty';
        if (s) {
          if (e.outcome === 'goal' || e.outcome === 'saved') s.sot++;
          if (!pen) s.xg += e.xg || 0;
          if (pen && e.outcome !== 'goal' && e.outcome != null) s.pen_missed++;
        }
        const a = S[e.assist_candidate];
        if (a) { a.key++; a.xa += e.xg || 0; }
        if (e.outcome === 'goal' || e.outcome === 'saved') for (const q in S) if (gk[q] && team[q] !== e.team && onPitch(q, e.t)) S[q].xgot_faced += e.xg || 0;
        for (let i = losses.length - 1; i >= 0; i--) {
          const L = losses[i];
          if (e.t - L.t > ERROR_WINDOW) break;
          if (L.team !== e.team && (e.poss || 0) - (L.poss || 0) <= 1 && S[L.player]) { S[L.player].err_shot++; errByShot[e.id] = L.player; losses.splice(i, 1); break; }
        }
        break;
      }
      case 'goal':
        if (e.own_goal) { if (S[e.scorer]) S[e.scorer].own++; } else if (S[e.scorer]) S[e.scorer].goals++;
        if (S[e.assist]) S[e.assist].assists++;
        score[e.team === home ? 0 : 1]++;
        for (const q in S) if (team[q] !== e.team && onPitch(q, e.t)) S[q].conceded++;
        if (e.shot in errByShot) S[errByShot[e.shot]].err_goal++;
        break;
      case 'control': if (s && e.how === 'interception') s.inter++; break;
      case 'tackle': if (s && e.won) s.tackles++; break;
      case 'take_on': if (s) { s.dribbles++; if (S[e.opponent]) S[e.opponent].beaten++; } break;
      case 'clearance': if (s) s.clear++; break;
      case 'block': if (s) s.blocks++; break;
      case 'aerial_duel': if (s) s.aerials++; break;
      case 'foul': if (s) { s.fouls++; if (e.penalty) { s.pen_conceded++; if (S[e.on]) S[e.on].pen_won++; } } break;
      case 'card': if (s) { if (e.card === 'yellow') s.yellow++; else s.red++; } break;
      case 'offside': if (s) s.offsides++; break;
      case 'miscontrol': if (s) { s.miscontrols++; losses.push(e); } break;
      case 'save': if (s) s.saves++; break;
      default: break;
    }
    // keep only losses in the loser's own half
    if (losses.length && losses[losses.length - 1] === e && e.x != null && (e.x > 52.5) === attacksRight(e.team, e.t)) losses.pop();
  }
  return { S, score };
}

function raw(s, pos, isGk, isDef, frac, mine, theirs, clean) {
  let r = BASE + (GOAL[pos] ?? 1.0) * s.goals + 0.75 * s.assists;
  let v = 0.5 * s.xg + 0.6 * s.xa + 0.12 * s.key + 0.08 * s.sot;
  v += 0.008 * s.done - 0.025 * (s.passes - s.done);
  v += 0.12 * s.dribbles + 0.12 * s.tackles + 0.08 * s.inter + 0.06 * s.blocks + 0.03 * s.clear + 0.04 * s.aerials;
  v -= 0.10 * s.beaten + 0.04 * s.miscontrols + 0.05 * s.fouls + 0.03 * s.offsides;
  v += 0.3 * s.pen_won - 0.6 * s.pen_conceded - 0.5 * s.pen_missed;
  v -= 0.35 * s.err_shot + 0.65 * s.err_goal;
  if (isGk) v += 0.25 * s.saves + 0.5 * (s.xgot_faced - s.conceded) - 0.15 * s.conceded + 0.4 * clean;
  else if (isDef) v += -0.12 * s.conceded + 0.3 * clean;
  r += VOLUME * v - (NORM[pos] ?? NORM.MID) * frac;
  r -= 0.3 * s.yellow + 1.2 * s.red + 0.8 * s.own;
  r += mine > theirs ? 0.15 : mine < theirs ? -0.15 : 0;
  return r;
}

const matchEnd = data => Math.max(...data.periods.map(p => p.end_t || 0), data.events.length ? data.events[data.events.length - 1].t : 0);

export function ratingsAt(data, t = Infinity) {
  const { S, score } = tallies(data, t), end = matchEnd(data), at = Math.min(t, end);
  const frac = Math.min(1, at / (end + 1e-9)) * (data.periods.length > 2 ? 4 / 3 : 1);   // 120 minutes after extra time (S-52)
  const home = data.teams.home, out = {};
  for (const p of data.players) {
    const side = p.team === home.code ? 0 : 1, formation = (side === 0 ? home : data.teams.away).formation;
    const want = FORMATIONS[formation]?.[p.slot]?.want, isGk = p.slot === 'GK', isDef = want === 'DEF', s = S[p.id];
    const clean = s.conceded === 0 && (isGk || isDef) ? frac : 0;
    const r = raw(s, p.position, isGk, isDef, frac, score[side], score[1 - side], clean);
    out[p.id] = Math.round(Math.min(HIGH, Math.max(LOW, shape(r) - positionPenalty(want, p.position))) * 10) / 10;
  }
  return out;
}
