// The match page's Lineup tab for a played or live match (WR-39): the Predicted Lineup's pitch (js/match-lineup.js) with what happened. Each player wears
// this match's rating (orange under 7.0, green from 7.0, blue with a star for the best on the pitch), small marks for goals, assists and cards, the minute a
// red card sent them off, and the captain's "C". Pills switch between Average rating (this match), Contributions (goals and assists only) and Value.
// Numbers come from the saved result (`fx.result.players`, js/simulate.js summariseMatch); while a match is live they are worked out from the match file up to
// the minute reached (js/live-rating.js), so nothing from later shows. Nobody is substituted in this league, so the bench is simply the squad that was not picked,
// and a red card is the only way off the pitch.
//   playedCard(fx, L, ctx) -> the card's html. L = loadLineups() result (kits, locked sheets), ctx = match-lineup's ctx plus
//                             { file?: match file (live only), horizon: match seconds seen so far (Infinity once it is over), live: bool }
import { FORMATIONS, DEFAULT_FORMATION } from './pitch.js';
import { onColour } from './club-colour.js';
import { esc } from './member.js';
import { icon } from './icons.js';
import { ratingsAt } from './live-rating.js';
import { VIEWS, money, surname, initials, STAR, PITCH_H, PITCH_V, coach } from './match-lineup.js';

const POS = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

// Who did what: id -> { r, g, a, yc, rc, off }.
function facts(fx, ctx) {
  const out = {};
  if (ctx.live && ctx.file) {
    const r = ratingsAt(ctx.file, ctx.horizon);
    for (const p of ctx.file.players) out[p.id] = { r: r[p.id] ?? null, g: 0, a: 0, yc: 0, rc: 0, off: null };
    for (const e of ctx.file.events) {
      if (e.t > ctx.horizon) break;
      if (e.type === 'goal' && !e.own_goal && out[e.scorer]) { out[e.scorer].g++; if (e.assist && out[e.assist]) out[e.assist].a++; }
      if (e.type === 'card' && out[e.player]) { if (e.card === 'yellow') out[e.player].yc++; else { out[e.player].rc++; out[e.player].off = e.minute; } }
    }
    return out;
  }
  const off = new Map((fx.result?.cards || []).filter(c => c.card !== 'yellow').map(c => [String(c.player), c.minute]));
  for (const [id, p] of Object.entries(fx.result?.players || {})) out[id] = { r: p.r ?? null, g: p.g || 0, a: p.a || 0, yc: p.yc || 0, rc: p.rc || 0, off: p.rc ? off.get(String(id)) ?? null : null };
  return out;
}

// The XI as played: who stood in which slot, and the formation those slots make.
function xiOf(fx, ctx, code) {
  const src = ctx.live && ctx.file
    ? ctx.file.players.filter(p => p.team === code).map(p => ({ id: p.id, slot: p.slot, name: p.name }))
    : Object.entries(fx.result?.players || {}).filter(([, p]) => p.team === code).map(([id, p]) => ({ id, slot: p.slot, name: p.name }));
  const slots = new Set(src.map(p => p.slot));
  const formation = Object.keys(FORMATIONS).find(f => { const k = Object.keys(FORMATIONS[f]); return k.length === slots.size && k.every(s => slots.has(s)); }) || DEFAULT_FORMATION;
  return { formation, list: src.filter(p => FORMATIONS[formation][p.slot]) };
}

const tone = r => (r >= 7 ? 'hi' : 'lo');

function side(fx, L, ctx, F, star, which) {
  const code = fx[which], xi = xiOf(fx, ctx, code), sheet = L?.[which]?.sheet, team = ctx.team(code), colour = ctx.club(code)?.colour || team.colour;
  const byId = new Map((ctx.season.players || []).map(p => [String(p.id), p]));
  const slots = FORMATIONS[xi.formation];
  const html = xi.list.map(({ id, slot, name }) => {
    const p = byId.get(String(id)), f = F[id] || {}, gk = slots[slot].want === 'GK';
    const pic = L?.kits?.[which]?.[gk ? 'gk' : 'field'] || L?.kits?.[which]?.field;
    const num = p?.number != null && p.number !== '' ? p.number : '';
    const face = pic ? `<img src="${pic}" alt="">${num !== '' ? `<i class="ml-sn">${esc(num)}</i>` : ''}` : `<i class="ml-disc" style="--c:${esc(colour)};--on:${esc(onColour(colour))}">${esc(num)}</i>`;
    const cap = sheet && String(sheet.captain) === String(id) ? '<b class="ml-cap" aria-label="Captain">C</b>' : '';
    let marks = '';
    if (ctx.view === 'rating' && f.r != null) {
      const top = String(id) === star;
      marks += `<b class="ml-r is-${top ? 'star' : tone(f.r)}" aria-label="Rating ${f.r.toFixed(1)}${top ? ', the best on the pitch' : ''}">${f.r.toFixed(1)}${top ? STAR : ''}</b>`;
    }
    if (ctx.view !== 'value') {
      if (f.a) marks += `<b class="ml-m is-a" aria-label="${f.a} ${f.a === 1 ? 'assist' : 'assists'}">${icon('assist')}${f.a > 1 ? f.a : ''}</b>`;
      if (f.g) marks += `<b class="ml-m is-g" aria-label="${f.g} ${f.g === 1 ? 'goal' : 'goals'}">${icon('ball')}${f.g > 1 ? f.g : ''}</b>`;
      if (ctx.view === 'rating' && (f.rc || f.yc)) {
        marks += f.rc
          ? `<b class="ml-off" aria-label="Sent off${f.off ? ` in the ${f.off} minute` : ''}"><i class="ml-cd is-red"></i>${f.off ? `${esc(f.off)}′` : ''}</b>`
          : '<b class="ml-off" aria-label="Yellow card"><i class="ml-cd is-yellow"></i></b>';
      }
    } else if (p) marks += `<b class="ml-v" aria-label="Value ${esc(money(p.value))}">${esc(money(p.value))}</b>`;
    return `<li class="ml-p is-${which}" style="--x:${slots[slot].x.toFixed(1)};--y:${slots[slot].y.toFixed(1)}"><span class="ml-av">${face}${cap}${marks}</span>`
      + `<span class="ml-n">${esc(surname(name))}</span></li>`;
  }).join('');
  const rated = xi.list.map(p => F[p.id]?.r).filter(r => r != null);
  return { html, formation: xi.formation, avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null, ids: new Set(xi.list.map(p => String(p.id))) };
}

function bar(which, S, ctx, fx) {
  const code = fx[which], team = ctx.team(code), name = ctx.club(code)?.short_name || ctx.club(code)?.name || team.name, s = S[which];
  const chip = s.avg != null ? `<span class="ml-chip" title="Team average rating">${s.avg.toFixed(2)}</span>` : '';
  const form = `<span class="ml-form">${esc(s.formation)}</span>`;
  return `<div class="ml-side is-${which}">${which === 'home' ? `${chip}${ctx.crest(team, 32)}<b>${esc(name)}</b>${form}` : `${form}<b>${esc(name)}</b>${ctx.crest(team, 32)}${chip}`}</div>`;
}

// The squad that was not picked: goalkeepers first, then by line and number.
function bench(which, S, ctx, fx) {
  const code = fx[which], colour = ctx.club(code)?.colour || ctx.team(code).colour;
  const rows = (ctx.season.players || []).filter(p => p.team === code && !S[which].ids.has(String(p.id)))
    .sort((a, b) => (POS[a.position] ?? 9) - (POS[b.position] ?? 9) || (Number(a.number) || 99) - (Number(b.number) || 99));
  if (!rows.length) return `<ul class="mp-bench is-${which}"><li class="mp-none">No one on the bench.</li></ul>`;
  return `<ul class="mp-bench is-${which}">${rows.map(p => `<li><i class="ml-disc" style="--c:${esc(colour)};--on:${esc(onColour(colour))}">${esc(p.number ?? initials(p.name))}</i>`
    + `<span class="mp-nm"><b>${esc(p.name)}</b><small>${esc(p.position || '')}</small></span></li>`).join('')}</ul>`;
}

export function playedCard(fx, L, ctx) {
  const F = facts(fx, ctx), S = {};
  const best = Object.entries(F).map(([id, f]) => [id, f.r]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1])[0];
  const star = best ? best[0] : null;
  for (const w of ['home', 'away']) S[w] = side(fx, L, ctx, F, star, w);
  const pills = `<nav class="ml-pills sc-toggle" aria-label="Lineup view">${VIEWS.map(([k, l]) => `<button type="button" data-lview="${k}" aria-pressed="${k === ctx.view}">${esc(l)}</button>`).join('')}</nav>`;
  return `<section class="lg-card ml mp" aria-labelledby="ml-h">
    <div class="ml-bar">${bar('home', S, ctx, fx)}<h2 id="ml-h">Lineup</h2>${bar('away', S, ctx, fx)}</div>
    ${pills}
    <div class="ml-pitch" role="group" aria-label="Line-ups as played, on a pitch">${PITCH_H}${PITCH_V}<ul class="ml-xi">${S.home.html}${S.away.html}</ul></div>
    <div class="ml-coaches">${coach('home', ctx)}<b>Coach</b>${coach('away', ctx)}</div>
    <div class="mp-subs"><h3>Substitutes</h3><p class="mp-note">Nobody is substituted in this league, so the bench stays unused.</p>
      <div class="mp-cols">${bench('home', S, ctx, fx)}${bench('away', S, ctx, fx)}</div></div>
  </section>`;
}
