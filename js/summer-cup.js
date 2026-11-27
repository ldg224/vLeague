// The Summer Cup (S-51): an in-season cup, NBA Cup style. Chosen league matches also count for a cup group; the group winners and the best runner-up
// play cup-only semi-finals and a Final. String builders and sums only (no page code), so the tests can run them without a browser:
//
//   activeCup(season)                    the season's cup ({ key, name, look, colours, groups: { A: [codes] } }) or null
//   groupOf(cup, code)                   'A' | 'B' | ... or null
//   cupTag(fx, season)                   the small "Summer Cup · Group A" chip for a match row ('' for a match not in a cup)
//   cupLabel(fx, season)                 'Summer Cup · Group A' | 'Summer Cup semi-final' | 'Summer Cup Final' | null
//   cupInfo(fx, season)                  { name, short, group, emblem } for a badge, or null
//   groupTables(season, cup, opts)       { A: rows, ... } in group order; a row: { team, rank, p, w, d, l, gf, ga, gd, pts, ppg, next }
//   runnersUp(tables)                    the runners-up, best first (points per game, goal difference per game, goals), the first marked `through`
//   qualifiers(tables)                   the four going through, seeded 1 to 4 (group winners and the best runner-up, by the same order)
//   cupCard(season, ctx, opts)           the Table card in its Summer Cup view: the groups, the runners-up and the zone key
//   bracketCard(season, ctx, opts)       the knockouts: the two semi-finals and the Final (real fixtures once the office has added them,
//                                         else "if the groups ended now")
//   cupSwitch(view)                      the vLeague | Summer Cup pills (buttons with data-tview)
//
// Group rules (the user, 26 Nov 2026): 3 for a win, 1 for a draw. Level on points: head-to-head (a mini-table if three are level), then goal difference, then
// goals scored, then league position. Runners-up are compared on points per game (Group C plays four, A and B three), then goal difference per game, then goals.
// A cup group match is a league match carrying `cup`; a cup knockout carries `cup` and a stage (SF, GF) and never counts for the league table (js/scope.js).
// opts = { now, hidden: Set of fixture ids the viewer hasn't opened (they count as not played), mine: club code }
// ctx = { club(code) -> { name, short_name }, crest(code, px) -> html }
import { status, kickoff, byKickoff, matchUrl } from './dashboard-data.js';
import { tableRows } from './league-table.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const CUP_COLOURS = { A: '#ff6b4a', B: '#22b8b0', C: '#ffb627' };   // coral, surf, gold (the brand board)
export const EMBLEM = 'assets/summer-cup.svg';

export function activeCup(season) {
  const c = (season?.cups || [])[0];
  return c && Object.keys(c.groups || {}).length ? c : null;
}
export function groupOf(cup, code) {
  for (const [g, codes] of Object.entries(cup?.groups || {})) if (codes.includes(code)) return g;
  return null;
}
const cupFor = (fx, season) => (fx?.cup ? (season?.cups || []).find(c => c.key === fx.cup) || { key: fx.cup, name: 'Summer Cup', groups: {} } : null);

export function cupLabel(fx, season) {
  const cup = cupFor(fx, season);
  if (!cup) return null;
  if (fx.stage === 'SF') return `${cup.name} semi-final`;
  if (fx.stage === 'GF') return `${cup.name} Final`;
  const g = groupOf(cup, fx.home);
  return g ? `${cup.name} · Group ${g}` : cup.name;
}

// The cup a match is in, for a badge (the Stakes cards): { name, short: 'Group A' | 'Semi-final' | 'Final' | '', group, emblem } or null.
export function cupInfo(fx, season) {
  const cup = cupFor(fx, season);
  if (!cup) return null;
  const group = fx.stage ? null : groupOf(cup, fx.home);
  return { name: cup.name, short: fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Final' : group ? `Group ${group}` : '', group, emblem: EMBLEM };
}

export function cupTag(fx, season) {
  const cup = cupFor(fx, season);
  if (!cup) return '';
  const g = fx.stage ? null : groupOf(cup, fx.home), short = fx.stage === 'SF' ? 'Semi-final' : fx.stage === 'GF' ? 'Final' : g ? `Group ${g}` : '';
  return `<span class="cup-tag"${g ? ` data-grp="${g}"` : ''} title="${esc(cupLabel(fx, season))}"><img src="${EMBLEM}" alt="" width="14" height="14"><span class="sr-only">${esc(cup.name)}, </span><b>${esc(short || cup.name)}</b></span>`;
}

// ---------- the group tables ----------
const PTS = { win: 3, draw: 1, loss: 0 };
const per = (n, p) => (p ? n / p : 0);
export const ppgText = r => (r.p ? r.ppg.toFixed(2) : '–');

function groupMatches(season, cup) { return season.fixtures.filter(f => f.cup === cup.key && !f.stage && !f.test); }

export function groupTables(season, cup, { now = new Date(), hidden = new Set() } = {}) {
  const all = groupMatches(season, cup), done = f => f.result && status(f, season, now) === 'ft' && !hidden.has(f.id);
  const played = all.filter(done).sort(byKickoff);
  let league = null;
  const leaguePos = code => {
    league ??= new Map(tableRows(season, { now, hidden }).map(r => [r.team.code, r.rank]));
    return league.get(code) ?? 99;
  };
  const out = {};
  for (const [g, codes] of Object.entries(cup.groups).sort(([a], [b]) => a.localeCompare(b))) {
    const rows = Object.fromEntries(codes.map(code => [code, { team: season.teams.find(t => t.code === code) || { code, name: code }, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [], next: null, left: 0 }]));
    const mine = played.filter(f => rows[f.home] && rows[f.away]);
    for (const f of mine) {
      for (const [r, gf, ga] of [[rows[f.home], f.result.home, f.result.away], [rows[f.away], f.result.away, f.result.home]]) {
        const o = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
        r.p++; r.gf += gf; r.ga += ga; r[o.toLowerCase()]++; r.pts += PTS[{ W: 'win', D: 'draw', L: 'loss' }[o]]; r.form.push(o);
      }
    }
    for (const f of all.filter(f => !done(f) && rows[f.home] && rows[f.away]).sort(byKickoff)) {
      for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
        const r = rows[f[side]]; r.left++;
        if (!r.next && !f.postponed && kickoff(f)) r.next = { code: f[opp], home: side === 'home', fx: f };
      }
    }
    const list = Object.values(rows).map(r => ({ ...r, gd: r.gf - r.ga, ppg: per(r.pts, r.p) }));
    // points, then head-to-head among the clubs level on points (a mini-table), then goal difference, goals, league position
    list.sort((a, b) => b.pts - a.pts);
    const ordered = [];
    for (let i = 0; i < list.length;) {
      let j = i + 1;
      while (j < list.length && list[j].pts === list[i].pts) j++;
      const level = list.slice(i, j);
      if (level.length > 1) {
        const codesLevel = new Set(level.map(r => r.team.code)), mini = Object.fromEntries(level.map(r => [r.team.code, { pts: 0, gf: 0, ga: 0 }]));
        for (const f of mine) {
          if (!codesLevel.has(f.home) || !codesLevel.has(f.away)) continue;
          const h = mini[f.home], a = mini[f.away], hg = f.result.home, ag = f.result.away;
          h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
          if (hg > ag) h.pts += 3; else if (hg < ag) a.pts += 3; else { h.pts++; a.pts++; }
        }
        level.sort((x, y) => {
          const m = mini[x.team.code], n = mini[y.team.code];
          return n.pts - m.pts || (n.gf - n.ga) - (m.gf - m.ga) || n.gf - m.gf || y.gd - x.gd || y.gf - x.gf || leaguePos(x.team.code) - leaguePos(y.team.code);
        });
      }
      ordered.push(...level);
      i = j;
    }
    ordered.forEach((r, i) => { r.rank = i + 1; r.group = g; });
    out[g] = ordered;
  }
  return out;
}

const byRecord = (a, b) => b.ppg - a.ppg || per(b.gd, b.p) - per(a.gd, a.p) || b.gf - a.gf || a.team.name.localeCompare(b.team.name);

export function runnersUp(tables) {
  const list = Object.values(tables).map(rows => rows[1]).filter(Boolean).sort(byRecord);
  return list.map((r, i) => ({ ...r, through: i === 0 }));
}

export function qualifiers(tables) {
  const winners = Object.values(tables).map(rows => rows[0]).filter(Boolean);
  const best = runnersUp(tables)[0];
  return [...winners, ...(best ? [best] : [])].sort(byRecord).map((r, i) => ({ ...r, seed: i + 1 }));
}

// ---------- the card ----------
const signed = n => (n > 0 ? `+${n}` : String(n));
const name = (ctx, r) => { const c = ctx.club(r.team.code); return { full: c?.name || r.team.name, short: c?.short_name || c?.name || r.team.name }; };

export const cupSwitch = view => {
  const b = (key, label) => `<button type="button" data-tview="${key}" aria-pressed="${view === key}">${label}</button>`;
  return `<nav class="sc-toggle cup-pills" aria-label="Which table">${b('league', 'vLeague')}${b('cup', '<img src="' + EMBLEM + '" alt="" width="16" height="16">Summer Cup')}</nav>`;
};

const groupHead = (g, n) => `<tr class="cup-ghead" data-grp="${g}"><th colspan="10" scope="colgroup"><span class="cup-gname"><i aria-hidden="true"></i>Group ${g}</span><small>${n} cup ${n === 1 ? 'match' : 'matches'} each${n === 4 ? ', home and away' : ''}</small></th></tr>`;

function row(r, ctx, mine, zone) {
  const n = name(ctx, r), opp = r.next ? ctx.club(r.next.code) : null;
  const next = r.next ? `<a class="tb-next" href="${esc(matchUrl(r.next.fx))}" title="Next cup match: ${r.next.home ? 'vs' : 'at'} ${esc(opp?.name || r.next.code)}">${ctx.crest(r.next.code, 22)}</a>` : '<span class="tb-none">–</span>';
  return `<tr data-code="${esc(r.team.code)}"${mine === r.team.code ? ' class="is-mine"' : ''}${zone ? ` data-zone="${zone}"` : ''}>`
    + `<td class="tb-pos">${r.rank}</td>`
    + `<th scope="row" class="tb-club"><a class="cl" href="team.html?c=${esc(r.team.code)}">${ctx.crest(r.team.code, 24)}<b class="tb-full">${esc(n.full)}</b><b class="tb-short">${esc(n.short)}</b></a></th>`
    + `<td>${r.p}</td><td class="t-wdl">${r.w}</td><td class="t-wdl">${r.d}</td><td class="t-wdl">${r.l}</td><td class="t-pm">${r.gf}-${r.ga}</td><td>${signed(r.gd)}</td><td class="tb-pts">${r.pts}</td><td class="t-next">${next}</td></tr>`;
}

const HEAD = '<thead><tr><th class="tb-pos" scope="col"><abbr title="Position">#</abbr></th><th scope="col" class="tb-club">Club</th>'
  + '<th scope="col"><abbr title="Played">PL</abbr></th><th scope="col" class="t-wdl"><abbr title="Won">W</abbr></th><th scope="col" class="t-wdl"><abbr title="Drawn">D</abbr></th><th scope="col" class="t-wdl"><abbr title="Lost">L</abbr></th>'
  + '<th scope="col" class="t-pm"><abbr title="Goals for and against">+/-</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col"><abbr title="Points">PTS</abbr></th><th scope="col" class="t-next">Next</th></tr></thead>';

export function cupCard(season, ctx, { now = new Date(), hidden = new Set(), mine = null, switcher = '' } = {}) {
  const cup = activeCup(season);
  if (!cup) return '';
  const tables = groupTables(season, cup, { now, hidden }), ru = runnersUp(tables), bestRu = ru[0]?.team.code;
  const games = codes => Math.max(...codes.map(c => groupMatches(season, cup).filter(f => f.home === c || f.away === c).length), 0);
  const body = Object.entries(tables).map(([g, rows]) => groupHead(g, games(cup.groups[g]))
    + rows.map(r => row(r, ctx, mine, r.rank === 1 ? 'winner' : r.team.code === bestRu ? 'best' : '')).join('')).join('');
  const ruRows = ru.map((r, i) => {
    const n = name(ctx, r);
    return `<tr data-code="${esc(r.team.code)}"${mine === r.team.code ? ' class="is-mine"' : ''}${r.through ? ' data-zone="best"' : ''}><td class="tb-pos">${i + 1}</td>`
      + `<th scope="row" class="tb-club"><a class="cl" href="team.html?c=${esc(r.team.code)}">${ctx.crest(r.team.code, 24)}<b class="tb-full">${esc(n.full)}</b><b class="tb-short">${esc(n.short)}</b></a></th>`
      + `<td><span class="cup-gchip" data-grp="${r.group}">${r.group}</span></td><td>${r.p}</td><td>${signed(r.gd)}</td><td>${r.pts}</td><td class="tb-pts">${ppgText(r)}</td></tr>`;
  }).join('');
  const hid = hidden.size ? `<p class="tb-hidden">${hidden.size} cup result${hidden.size === 1 ? '' : 's'} hidden, so the groups leave ${hidden.size === 1 ? 'it' : 'them'} out. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const left = groupMatches(season, cup).filter(f => !(f.result && status(f, season, now) === 'ft')).length;
  const lede = left ? 'Group stage · Rounds 6 to 14 · every cup match counts for the league and your group' : 'Group stage complete';
  return `<section class="lg-card lg-table cup-card" aria-label="${esc(cup.name)}"><div class="lg-card-head"><h2 class="cup-title"><img src="${EMBLEM}" alt="" width="26" height="26">${esc(cup.name)}</h2>${switcher}</div>`
    + `<p class="cup-lede">${lede}</p>${hid}`
    + `<div class="tb-scroll"><table class="tb cup-tb">${HEAD}<tbody>${body}</tbody></table></div>`
    + `<h3 class="cup-sub">Best runner-up<small>On points per game, as Group C plays one more match</small></h3>`
    + `<div class="tb-scroll"><table class="tb cup-ru"><thead><tr><th class="tb-pos" scope="col">#</th><th scope="col" class="tb-club">Club</th><th scope="col"><abbr title="Group">GRP</abbr></th><th scope="col"><abbr title="Played">PL</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col"><abbr title="Points">PTS</abbr></th><th scope="col"><abbr title="Points per game">PPG</abbr></th></tr></thead><tbody>${ruRows}</tbody></table></div>`
    + `<ul class="tb-key cup-key"><li data-zone="winner">Group winner: into the semi-finals</li><li data-zone="best">Best runner-up: into the semi-finals</li></ul></section>`;
}

// ---------- the knockouts ----------
function side(ctx, code, seedText) {
  if (!code) return `<span class="ko-team is-tbc"><i class="ko-blank" aria-hidden="true"></i><b>${esc(seedText)}</b></span>`;
  const c = ctx.club(code);
  return `<span class="ko-team">${ctx.crest(code, 24)}<b class="tb-full">${esc(c?.name || code)}</b><b class="tb-short">${esc(c?.short_name || c?.name || code)}</b>${seedText ? `<small>${esc(seedText)}</small>` : ''}</span>`;
}
function tie(season, ctx, title, when, home, away, fx, { now, hidden }) {
  const st = fx ? status(fx, season, now) : null, hid = fx && hidden.has(fx.id);
  const score = fx?.result && st === 'ft' && !hid ? `<strong class="ko-score">${fx.result.home}<i>–</i>${fx.result.away}${fx.result.pens ? `<small>${fx.result.pens.home}-${fx.result.pens.away} pens</small>` : ''}</strong>` : '';
  const inner = `<span class="ko-when"><b>${esc(title)}</b>${esc(when)}</span>${side(ctx, home?.code, home?.label)}${side(ctx, away?.code, away?.label)}${score}`;
  return fx ? `<li class="ko-tie"><a href="${esc(matchUrl(fx))}">${inner}</a></li>` : `<li class="ko-tie">${inner}</li>`;
}

export function bracketCard(season, ctx, { now = new Date(), hidden = new Set() } = {}) {
  const cup = activeCup(season);
  if (!cup) return '';
  const ko = season.fixtures.filter(f => f.cup === cup.key && f.stage).sort(byKickoff);
  const semis = ko.filter(f => f.stage === 'SF'), final = ko.find(f => f.stage === 'GF');
  const day = f => (f && kickoff(f) ? kickoff(f).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const tables = groupTables(season, cup, { now, hidden }), q = qualifiers(tables);
  const played = Object.values(tables).some(rows => rows.some(r => r.p));
  const seedLabel = r => (r ? (r.rank === 1 ? `Winner, Group ${r.group}` : `Runner-up, Group ${r.group}`) : '');
  const opts = { now, hidden };
  let ties;
  if (semis.length) {
    ties = semis.map((f, i) => tie(season, ctx, `Semi-final ${i + 1}`, day(f), { code: f.home }, { code: f.away }, f, opts));
  } else if (played && q.length === 4) {
    ties = [[q[0], q[3]], [q[1], q[2]]].map(([h, a], i) => tie(season, ctx, `Semi-final ${i + 1}`, 'Week of 12 Jan', { code: h.team.code, label: seedLabel(h) }, { code: a.team.code, label: seedLabel(a) }, null, opts));
  } else {
    ties = [['Best qualifier', '4th best qualifier'], ['2nd best qualifier', '3rd best qualifier']].map(([h, a], i) => tie(season, ctx, `Semi-final ${i + 1}`, 'Week of 12 Jan', { label: h }, { label: a }, null, opts));
  }
  const fin = final ? tie(season, ctx, 'Final', day(final), { code: final.home }, { code: final.away }, final, opts)
    : tie(season, ctx, 'Final', 'Mid-January, date TBC', { label: 'Winner, semi-final 1' }, { label: 'Winner, semi-final 2' }, null, opts);
  const note = !semis.length && played && q.length === 4 ? '<p class="cup-lede">If the groups ended now. The higher seed plays at home.</p>'
    : '<p class="cup-lede">Cup-only matches: they don\'t count for the league. Level after 90 minutes: extra time, then penalties.</p>';
  return `<section class="lg-card cup-ko" aria-label="${esc(cup.name)} knockouts"><div class="lg-card-head"><h2>Knockouts</h2></div>${note}<ol class="ko-list">${ties.join('')}${fin}</ol></section>`;
}
