// The match page's Predicted Lineup card (WR-32): both clubs' XIs on one pitch, the home side on the left half and the away side on the right
// (home above away on a phone), each player a kit shirt with the number and surname under it, a bar of crest, name, formation and team value
// above, and the coaches below.
//   loadLineups(fx, season, rows) -> { home, away, kits } once: each side is { sheet, locked }; kits are small shirt pictures (data URLs)
//   lineupCard(L, ctx)            -> the card's html. ctx = { season, club(code) -> clubs row | undefined, team(code) -> team, crest(team, px) -> html,
//                                  stats: Map of player id -> season totals (js/season-stats.js), view: 'rating' | 'contrib' | 'value' }
// Three views of the same pitch (WR-33), picked with the pills: Average rating (season average match rating as a badge, red under 5.0, orange under 7.0, green from 7.0,
// blue with a star for the standout), Contributions (goals and assists, nothing for zero) and Value (the editor's value under the shirt).
// LINEUP LOCK RULE (the user, 11 Oct 2026): a club's XI only appears once its line-up has locked (the week's deadline has passed and the
// locked sheet, week_sheets, exists). An unlocked club's half stays an empty half-pitch saying so; nothing it has picked is ever shown, and
// its formation and team value stay out too.
import { db } from './auth.js';
import { FORMATIONS, DEFAULT_FORMATION, autoLineup } from './pitch.js';
import { loadKits, matchKits } from './kits-data.js';
import { kitSprite, startDesign } from './kit.js';
import { onColour } from './club-colour.js';
import { esc } from './member.js';
import { icon } from './icons.js';
import { goalMark, assistMark, captainMark } from './match-marks.js';

const image = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
const filled = row => Boolean(row && row.lineup && Object.keys(row.lineup).length);

// fake (localhost preview only): a club with no locked sheet gets the best XI the squad can make, to look at the pitch with both halves full.
export async function loadLineups(fx, season, rows, { fake = false } = {}) {
  const c = await db(), now = new Date();
  const [dl, ws, kits] = await Promise.all([
    c.from('deadlines').select('week, locks_at, locked_at').eq('week', fx.week).maybeSingle().then(r => r.data || null).catch(() => null),
    c.from('week_sheets').select('club, formation, captain, lineup, kit').eq('week', fx.week).in('club', [fx.home, fx.away]).then(r => r.data || []).catch(() => []),
    loadKits(),
  ]);
  const open = Boolean(dl && (dl.locked_at || new Date(dl.locks_at) <= now));   // the week's line-ups have locked
  const known = new Set((season.players || []).map(p => String(p.id)));
  const sheetOf = code => { const r = open ? ws.find(x => x.club === code) : null; return filled(r) && Object.values(r.lineup).some(id => known.has(String(id))) ? r : null; };
  const made = (code, f) => ({ club: code, formation: f, lineup: autoLineup(f, (season.players || []).filter(p => p.team === code)) });
  const sides = season.demoSheets   // the demo (js/demo-match.js): every club has locked its team
    ? { home: season.demoSheets[fx.home] || null, away: season.demoSheets[fx.away] || null }
    : { home: sheetOf(fx.home) || (fake ? made(fx.home, '4-4-2') : null), away: sheetOf(fx.away) || (fake ? made(fx.away, '4-3-3') : null) };
  const colours = { [fx.home]: rows.find(r => r.code === fx.home)?.colour, [fx.away]: rows.find(r => r.code === fx.away)?.colour };
  const wear = matchKits(kits, fx.home, fx.away, colours, { [fx.home]: sides.home?.kit, [fx.away]: sides.away?.kit });
  const pics = {};
  await Promise.all(['home', 'away'].map(async side => {
    pics[side] = {};
    const code = fx[side];
    await Promise.all(['field', 'gk'].map(async role => {
      if (!sides[side]) return;   // nothing to dress for a club whose XI is not shown
      const k = wear[side][role] || (role === 'field' ? { design: startDesign({ code, colour: colours[code], name: code }) } : null);
      if (!k) return;
      try {
        const [art, logo] = await Promise.all([image(k.artUrl), image(k.logoUrl)]);
        pics[side][role] = kitSprite({ ...k.design, text: { name: '', number: '', colour: '' } }, { art, logo }, 96).toDataURL();
      } catch { /* a kit that won't draw falls back to the club-colour disc */ }
    }));
  }));
  return { home: { sheet: sides.home, locked: open }, away: { sheet: sides.away, locked: open }, kits: pics };
}

// ---- small pieces
export const money = v => {
  const n = Number(v) || 0;
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : `$${Math.round(n / 1e3)}K`;
};
export const surname = n => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? w.slice(1).join(' ') : w[0] || ''; };
export const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export const VIEWS = [['rating', 'Average rating'], ['contrib', 'Contributions'], ['value', 'Value']];
export const STAR = '<svg class="ml-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2.8 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.6l-5.6 3.2 1.3-6.2L3 9.3l6.3-.7z"/></svg>';
const avgOf = (stats, id) => { const r = stats?.get(String(id)); return r && r.apps ? r.ratingSum / r.apps : null; };

export const PITCH_H = '<svg class="ml-lines is-h" viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect x="1" y="1" width="103" height="66"/><line x1="52.5" y1="1" x2="52.5" y2="67"/><circle cx="52.5" cy="34" r="9.15"/>'
  + '<rect x="1" y="13.84" width="16.5" height="40.32"/><rect x="1" y="24.84" width="5.5" height="18.32"/><rect x="87.5" y="13.84" width="16.5" height="40.32"/><rect x="98.5" y="24.84" width="5.5" height="18.32"/></svg>';
export const PITCH_V = '<svg class="ml-lines is-v" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/><circle cx="34" cy="52.5" r="9.15"/>'
  + '<rect x="13.84" y="1" width="40.32" height="16.5"/><rect x="24.84" y="1" width="18.32" height="5.5"/><rect x="13.84" y="87.5" width="40.32" height="16.5"/><rect x="24.84" y="98.5" width="18.32" height="5.5"/></svg>';

// One side's players, placed on the whole pitch by --x (across) and --y (up the pitch from the own goal), as the team sheet's slots give them.
function players(side, L, ctx, cls, star) {
  const sheet = L[side].sheet;
  const formation = FORMATIONS[sheet.formation] ? sheet.formation : DEFAULT_FORMATION, slots = FORMATIONS[formation];
  const byId = new Map((ctx.season.players || []).map(p => [String(p.id), p]));
  const code = ctx.code[side], team = ctx.team(code), colour = ctx.club(code)?.colour || team.colour;
  return Object.entries(sheet.lineup).filter(([slot]) => slots[slot]).map(([slot, id]) => {
    const p = byId.get(String(id)); if (!p) return '';
    const gk = slots[slot].want === 'GK', pic = L.kits[side]?.[gk ? 'gk' : 'field'] || L.kits[side]?.field;
    const face = pic ? `<img src="${pic}" alt=""><i class="ml-sn">${esc(p.number ?? '')}</i>` : `<i class="ml-disc" style="--c:${esc(colour)};--on:${esc(onColour(colour))}">${esc(p.number ?? '')}</i>`;
    const cap = String(sheet.captain) === String(id) ? captainMark() : '';
    const st = ctx.stats?.get(String(id)), avg = avgOf(ctx.stats, id);
    let mark = '';
    if (ctx.view === 'rating' && avg != null) {
      const top = String(id) === star;
      mark = `<b class="ml-r is-${top ? 'star' : avg >= 7 ? 'hi' : avg >= 5 ? 'lo' : 'bad'}" aria-label="Average rating ${avg.toFixed(1)}${top ? ', the standout' : ''}">${avg.toFixed(1)}${top ? STAR : ''}</b>`;
    } else if (ctx.view === 'contrib' && st) {
      mark = `${st.a ? `<span class="ml-m is-a">${assistMark(st.a)}</span>` : ''}${st.g ? `<span class="ml-m is-g">${goalMark(st.g)}</span>` : ''}`;
    }
    const worth = ctx.view === 'value' ? `<b class="ml-v" aria-label="Value ${esc(money(p.value))}">${esc(money(p.value))}</b>` : '';
    return `<li class="ml-p ${cls}" style="--x:${slots[slot].x.toFixed(1)};--y:${slots[slot].y.toFixed(1)}" data-id="${esc(id)}"><span class="ml-av">${face}${mark}${worth}</span>`
      + `<span class="ml-n">${cap}${esc(surname(p.name))}</span></li>`;
  }).join('');
}

function bar(side, L, ctx) {
  const code = ctx.code[side], team = ctx.team(code), sheet = L[side].sheet;
  const value = sheet ? (ctx.season.players || []).filter(p => Object.values(sheet.lineup).map(String).includes(String(p.id))).reduce((s, p) => s + (Number(p.value) || 0), 0) : null;
  const name = ctx.club(code)?.short_name || ctx.club(code)?.name || team.name;
  const chip = value != null ? `<span class="ml-chip" title="Team value">${esc(money(value))}</span>` : '';
  const form = sheet ? `<span class="ml-form">${esc(FORMATIONS[sheet.formation] ? sheet.formation : DEFAULT_FORMATION)}</span>` : '';
  return `<div class="ml-side is-${side}">${side === 'home' ? `${chip}${ctx.crest(team, 32)}<b>${esc(name)}</b>${form}` : `${form}<b>${esc(name)}</b>${ctx.crest(team, 32)}${chip}`}</div>`;
}

export function coach(side, ctx) {
  const code = ctx.code[side], name = ctx.club(code)?.manager_name || '';
  if (!name) return '<span></span>';
  const colour = ctx.club(code)?.colour || ctx.team(code).colour;
  return `<span class="ml-coach is-${side}"><i class="ml-disc" style="--c:${esc(colour)};--on:${esc(onColour(colour))}" aria-hidden="true">${esc(initials(name))}</i><b>${esc(name)}</b></span>`;
}

export function lineupCard(L, ctx) {
  ctx = { ...ctx, code: ctx.code };
  // The standout: the best average rating among the players shown on the pitch (blue, with a star).
  const shown = ['home', 'away'].flatMap(s => (L[s].sheet ? Object.values(L[s].sheet.lineup).map(String) : []));
  const best = shown.map(id => [id, avgOf(ctx.stats, id)]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1])[0];
  const star = best ? best[0] : null;
  const pills = `<nav class="ml-pills sc-toggle" aria-label="Lineup view">${VIEWS.map(([k, l]) => `<button type="button" data-lview="${k}" aria-pressed="${k === ctx.view}">${esc(l)}</button>`).join('')}</nav>`;
  const half = side => (L[side].sheet ? '' : `<div class="ml-empty is-${side}">${icon('lock')}<b>Lineup not submitted yet</b><span>It shows once the club locks its team.</span></div>`);
  return `<section class="lg-card ml" aria-labelledby="ml-h">
    <div class="ml-bar">${bar('home', L, ctx)}<h2 id="ml-h">Predicted lineup</h2>${bar('away', L, ctx)}</div>
    ${pills}
    <div class="ml-pitch" role="group" aria-label="Predicted line-ups on a pitch">${PITCH_H}${PITCH_V}
      <ul class="ml-xi">${L.home.sheet ? players('home', L, ctx, 'is-home', star) : ''}${L.away.sheet ? players('away', L, ctx, 'is-away', star) : ''}</ul>
      ${half('home')}${half('away')}
    </div>
    <div class="ml-coaches">${coach('home', ctx)}<b>Coach</b>${coach('away', ctx)}</div>
  </section>`;
}
