// The match page's Stats tab ("All stats", WR-40): every team number the match file holds, side by side, in groups. The home value sits on the left, the label in the
// middle and the away value on the right; the better value of each row wears a pill in that club's colour (for fouls, cards and offsides the lower one is better).
// Numbers are the saved team totals (`file.stats.teams`, the same ones the Facts tab's Top stats use); while a match is live they are counted from the events up to the
// minute reached, without possession and distance, which need the whole match.
//   statsView(fx, file, ctx) -> html. ctx = { team(code), club(code), crest(team, px), accent(code) -> '#rrggbb' | '', horizon, live }
// Under each row a split bar shows the share of the two values: the better side in its club's colour, the other muted, so a glance down the card shows who had the match.
import { esc } from './member.js';
import { onColour } from './club-colour.js';
import { xgSplit } from './match-shotmap.js';

// [label, key, decimals, unit, lowerIsBetter]
const GROUPS = [
  ['Top stats', [['Ball possession', 'possession', 0, '%'], ['Expected goals (xG)', 'xg', 2], ['Total shots', 'shots', 0], ['Shots on target', 'shots_on_target', 0], ['Big chances', 'big_chances', 0], ['Corners', 'corners', 0]]],
  ['Expected goals (xG)', [['Expected goals (xG)', 'xg', 2], ['xG open play', 'xg_open', 2], ['xG set play', 'xg_set', 2], ['Non-penalty xG', 'xg_np', 2], ['xG on target (xGOT)', 'xgot', 2]]],
  ['Passes', [['Passes', 'passes', 0], ['Accurate passes', 'passes_completed', 0], ['Pass accuracy', 'pass_accuracy', 0, '%'], ['Crosses', 'crosses', 0]]],
  ['Defending', [['Tackles won', 'tackles_won', 0], ['Interceptions', 'interceptions', 0], ['Clearances', 'clearances', 0], ['Blocks', 'blocks', 0], ['Saves', 'saves', 0]]],
  ['Discipline', [['Fouls', 'fouls', 0, '', true], ['Yellow cards', 'yellow_cards', 0, '', true], ['Red cards', 'red_cards', 0, '', true], ['Offsides', 'offsides', 0, '', true]]],
  ['Physical', [['Distance covered', 'distance_km', 1, ' km']]],
];

// What the events show so far for one side (a live match).
function counted(fx, file, ctx, code) {
  const mine = file.events.filter(e => e.t <= ctx.horizon && e.team === code), n = type => mine.filter(e => e.type === type).length;
  const shots = mine.filter(e => e.type === 'shot'), passes = mine.filter(e => e.type === 'pass'), done = passes.filter(e => e.outcome === 'complete').length;
  const cards = mine.filter(e => e.type === 'card');
  return {
    xg: shots.reduce((s, e) => s + (e.xg || 0), 0), shots: shots.length, shots_on_target: shots.filter(e => e.on_target || e.outcome === 'goal' || e.outcome === 'saved').length,
    big_chances: shots.filter(e => (e.xg || 0) >= 0.3).length, corners: n('corner'), passes: passes.length, passes_completed: done, pass_accuracy: passes.length ? 100 * done / passes.length : 0,
    crosses: passes.filter(e => e.subtype === 'cross').length, tackles_won: mine.filter(e => e.type === 'tackle' && e.won).length,
    interceptions: mine.filter(e => e.type === 'control' && e.how === 'interception').length, clearances: n('clearance'), blocks: n('block'), saves: n('save'),
    fouls: n('foul'), yellow_cards: cards.filter(e => e.card === 'yellow').length, red_cards: cards.filter(e => e.card !== 'yellow').length, offsides: n('offside'),
  };
}

export function statsView(fx, file, ctx) {
  const T = file.stats?.teams;
  if (!ctx.live && !T) return '<section class="lg-card mh-soon"><p class="empty">No team stats for this match.</p></section>';
  const split = code => (file.events?.some(e => e.type === 'shot') ? xgSplit(file, fx, code, ctx.horizon) : {});   // xG by type of play, from the shots (the xG on target is an estimate, see js/match-shotmap.js)
  const h = { ...(ctx.live ? counted(fx, file, ctx, fx.home) : T.home), ...split(fx.home) }, a = { ...(ctx.live ? counted(fx, file, ctx, fx.away) : T.away), ...split(fx.away) };
  const pill = code => { const c = ctx.accent(code); return c ? ` style="--k:${esc(c)};--on:${esc(onColour(c))}"` : ''; };
  const num = (v, dp, unit) => `${dp ? Number(v).toFixed(dp) : Math.round(Number(v))}${unit || ''}`;
  const groups = GROUPS.map(([title, rows]) => {
    const list = rows.filter(([, key]) => h[key] != null && a[key] != null).map(([label, key, dp, unit = '', low]) => {
      const l = Number(h[key]), r = Number(a[key]), better = l === r ? 0 : (l > r) !== Boolean(low) ? 1 : -1;
      const cell = (v, code, lead) => `<b class="ts-v${lead ? ' is-lead' : ''}"${lead ? pill(code) : ''}>${num(v, dp, unit)}</b>`;
      const total = l + r, share = total ? 100 * l / total : 50, bar = `<i class="st-bar" aria-hidden="true"><em class="is-h${better === 1 ? ' is-lead' : ''}" style="width:${share.toFixed(1)}%${better === 1 && ctx.accent(fx.home) ? `;background:${esc(ctx.accent(fx.home))}` : ''}"></em><em class="is-a${better === -1 ? ' is-lead' : ''}"${better === -1 && ctx.accent(fx.away) ? ` style="background:${esc(ctx.accent(fx.away))}"` : ''}></em></i>`;
      return `<li>${cell(l, fx.home, better === 1)}<span>${esc(label)}</span>${cell(r, fx.away, better === -1)}${bar}</li>`;
    });
    return list.length ? `<div class="st-group"><h3>${esc(title)}</h3><ul class="ts-rows st-rows">${list.join('')}</ul></div>` : '';
  }).join('');
  const side = (code, cls) => { const t = ctx.team(code), c = ctx.club(code); return `<span class="st-team ${cls}">${cls === 'is-home' ? `${ctx.crest(t, 28)}<b>${esc(c?.short_name || c?.name || t.name)}</b>` : `<b>${esc(c?.short_name || c?.name || t.name)}</b>${ctx.crest(t, 28)}`}</span>`; };
  return `<section class="lg-card st" aria-labelledby="st-h"><div class="st-head"><h2 id="st-h" class="st-title">Stats</h2><div class="st-teams">${side(fx.home, 'is-home')}${side(fx.away, 'is-away')}</div></div>${groups}</section>`;
}
