// The league table (WR-11 to WR-14), on Overview: rows worked out from the season's results, and the card that shows them.
// String builders and sums only (no page code), so the tests can run them without a browser:
//
//   tableRows(season, { filter, now, hidden })   rows in table order: { team, rank, p, w, d, l, gf, ga, gd, pts, form, next }
//   tableCard(rows, ctx, opts)                    the card: title, filter pills, the table, the zone key
//   FILTERS                                       [['all', 'All'], ['home', 'Home'], ['away', 'Away'], ['last5', 'Last 5']]
//
// Which results count: league matches that have finished, with no Test, exhibition or finals matches (as ladder() in
// dashboard-data.js). `hidden` is the set of fixture ids the viewer has chosen not to see yet (spoiler-free): they count as
// not played, so the table never gives a score away. Form is always the last five league results; the filter changes only the sums.
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html, mine?: code }
import { status, kickoff, byKickoff } from './dashboard-data.js';

export const FILTERS = [['all', 'All'], ['home', 'Home'], ['away', 'Away'], ['last5', 'Last 5']];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

const counts = f => !f.test && !f.exhibition && !f.stage;
const FORM = 5;

// The zones follow the number of clubs: Finals is the top four (fewer in a small league, always leaving room for last place),
// Wooden spoon is last place. Nothing else.
export function zonesFor(n) {
  const finals = Math.min(4, Math.max(0, n - 2));
  return { finals, spoon: n >= 2 };
}

export function tableRows(season, { filter = 'all', now = new Date(), hidden = new Set() } = {}) {
  const pts = season.points || { win: 3, draw: 1, loss: 0 };
  const teams = season.teams.filter(t => !t.withdrawn);
  const rows = Object.fromEntries(teams.map(t => [t.code, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, games: [], form: [], next: null }]));
  const played = season.fixtures.filter(f => counts(f) && f.result && status(f, season, now) === 'ft' && !hidden.has(f.id)).sort(byKickoff);

  // Every club's games in order, as { home: bool, gf, ga }.
  for (const f of played) {
    const h = rows[f.home], a = rows[f.away];
    if (!h || !a) continue;
    h.games.push({ home: true, gf: f.result.home, ga: f.result.away });
    a.games.push({ home: false, gf: f.result.away, ga: f.result.home });
  }
  const outcome = g => (g.gf > g.ga ? 'W' : g.gf < g.ga ? 'L' : 'D');
  for (const r of Object.values(rows)) {
    r.form = r.games.slice(-FORM).map(outcome);
    const used = filter === 'home' ? r.games.filter(g => g.home) : filter === 'away' ? r.games.filter(g => !g.home) : filter === 'last5' ? r.games.slice(-FORM) : r.games;
    for (const g of used) {
      const o = outcome(g);
      r.p++; r.gf += g.gf; r.ga += g.ga;
      r[o.toLowerCase()]++;
      r.pts += o === 'W' ? pts.win : o === 'D' ? pts.draw : pts.loss;
    }
    delete r.games;
  }
  if (filter === 'all') for (const a of season.adjustments || []) if (rows[a.team]) rows[a.team].pts += a.points;

  // The next match for each club: its first league or finals match that isn't counted yet (not postponed, no Test or showcase games).
  const todo = season.fixtures.filter(f => !f.test && !f.exhibition && !f.postponed && kickoff(f) && !(f.result && status(f, season, now) === 'ft' && !hidden.has(f.id))).sort(byKickoff);
  for (const f of todo) {
    if (rows[f.home] && !rows[f.home].next) rows[f.home].next = { code: f.away, home: true };
    if (rows[f.away] && !rows[f.away].next) rows[f.away].next = { code: f.home, home: false };
  }

  const list = Object.values(rows).map(r => ({ ...r, gd: r.gf - r.ga }));
  list.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.name.localeCompare(b.team.name));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

// ---------- the card ----------
const signed = n => (n > 0 ? `+${n}` : String(n));
const clubName = c => c?.short_name || c?.name || '';

function chips(form) {
  if (!form.length) return '<span class="tb-none">–</span>';
  const label = { W: 'Won', D: 'Drew', L: 'Lost' };
  return `<span class="tb-form" role="img" aria-label="Last ${form.length}: ${form.map(o => label[o]).join(', ')}">${form.map((o, i) => `<abbr class="res-${o}${i === form.length - 1 ? ' is-latest' : ''}" title="${label[o]}">${o}</abbr>`).join('')}</span>`;
}

// opts: filter ('all' | 'home' | 'away' | 'last5'), filters (show the pills), hiddenCount (results the viewer hasn't opened yet).
export function tableCard(rows, ctx, { filter = 'all', filters = true, hiddenCount = 0, title = 'Table' } = {}) {
  const zones = zonesFor(rows.length), anyPlayed = rows.some(r => r.p > 0);
  const pills = filters
    ? `<nav class="tb-pills" aria-label="Table filter">${FILTERS.map(([key, label]) => `<button type="button" data-tfilter="${key}"${key === filter ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${esc(label)}</button>`).join('')}</nav>`
    : '';
  const body = rows.map(r => {
    const club = ctx.club(r.team.code), zone = !anyPlayed ? '' : r.rank <= zones.finals ? 'finals' : zones.spoon && r.rank === rows.length ? 'spoon' : '';
    const opp = r.next ? ctx.club(r.next.code) : null;
    const next = r.next ? `<span class="tb-next" title="Next: ${r.next.home ? 'vs' : 'at'} ${esc(opp?.name || r.next.code)}">${ctx.crest(r.next.code, 22)}</span>` : '<span class="tb-none">–</span>';
    return `<tr${ctx.mine === r.team.code ? ' class="is-mine"' : ''}${zone ? ` data-zone="${zone}"` : ''}>`
      + `<td class="tb-pos">${r.rank}</td>`
      + `<th scope="row" class="tb-club"><span>${ctx.crest(r.team.code, 24)}<b>${esc(clubName(club) || r.team.name)}</b></span></th>`
      + `<td>${r.p}</td><td class="t-wdl">${r.w}</td><td class="t-wdl">${r.d}</td><td class="t-wdl">${r.l}</td>`
      + `<td class="t-pm">${r.gf}-${r.ga}</td><td>${signed(r.gd)}</td><td class="tb-pts">${r.pts}</td>`
      + `<td class="tb-formcell">${chips(r.form)}</td><td class="t-next">${next}</td></tr>`;
  }).join('');
  const key = anyPlayed
    ? `<ul class="tb-key">${zones.finals ? '<li data-zone="finals">Finals</li>' : ''}${zones.spoon ? '<li data-zone="spoon">Wooden spoon</li>' : ''}</ul>`
    : '';
  const hid = hiddenCount
    ? `<p class="tb-hidden">${hiddenCount} result${hiddenCount === 1 ? '' : 's'} hidden, so the table leaves ${hiddenCount === 1 ? 'it' : 'them'} out. <button type="button" data-reveal-all>Show all</button></p>`
    : '';
  const empty = !rows.length ? '<div class="sc-empty"><b>No clubs yet</b><span>The table fills in as clubs join and matches are played.</span></div>' : '';
  const table = rows.length
    ? `<div class="tb-scroll"><table class="tb"><thead><tr><th class="tb-pos" scope="col"><abbr title="Position">#</abbr></th><th scope="col" class="tb-club">Club</th>`
      + `<th scope="col"><abbr title="Played">PL</abbr></th><th scope="col" class="t-wdl"><abbr title="Won">W</abbr></th><th scope="col" class="t-wdl"><abbr title="Drawn">D</abbr></th><th scope="col" class="t-wdl"><abbr title="Lost">L</abbr></th>`
      + `<th scope="col" class="t-pm"><abbr title="Goals for and against">+/-</abbr></th><th scope="col"><abbr title="Goal difference">GD</abbr></th><th scope="col"><abbr title="Points">PTS</abbr></th>`
      + `<th scope="col">Form</th><th scope="col" class="t-next">Next</th></tr></thead><tbody>${body}</tbody></table></div>`
    : empty;
  return `<section class="lg-card lg-table" aria-label="${esc(title)}"><div class="lg-card-head"><h2>${esc(title)}</h2></div>${pills}${hid}${table}${key}</section>`;
}
