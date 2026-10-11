// The Seasons tab (WR-24): a card for the season being played, then a card for every season in the league's history, newest first.
// String builders and sums only (no page code), so the tests can run them without a browser:
//
//   grandFinal(fixtures, { hidden })    { winner, runnerUp } (club codes) once the grand final (stage GF) is played and its result may be shown;
//                                        { hiddenFinal: true } when it is played but the viewer has hidden it; null while it is still to come
//   seasonsView(opts)                   the tab
//
// The league has run under more than one name (History, League names): previous seasons are grouped by the name they ran under, newest name first, and the
// current season sits first in the newest name's group. When there is more than one name each card says its number overall, counting every season ever
// recorded (two seasons under the old name, then the rebrand's Season 1, is Season 3 overall).
// The current season comes from the league page (its name and whether it is live); its winner and runner-up show "To be decided" until the grand
// final has a result. Past seasons come from History (Editor, History: js/history-data.js): for each competition that has an award in that season,
// the winner (with the competition's trophy picture) and the runner-up, a current club by its crest and name or a past team by its code badge.
// opts = { current: { label, live }, final: grandFinal(...) | null, history: loadHistory() | null, club(code) -> { name, short_name }, crest(code, px) -> html,
//          trophy(path) -> url, hiddenCount }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function grandFinal(fixtures, { hidden = new Set() } = {}) {
  const gf = fixtures.find(f => f.stage === 'GF' && !f.test);
  if (!gf?.result || gf.result.home == null) return null;
  if (hidden.has(gf.id)) return { hiddenFinal: true };
  const { home, away } = gf.result;
  if (home === away) return null;   // a draw leaves it undecided here: the office records the winner in History
  return home > away ? { winner: gf.home, runnerUp: gf.away } : { winner: gf.away, runnerUp: gf.home };
}

const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('');

function who(code, o) {
  const c = o.club(code);
  return `<span class="ss-team">${o.crest(code, 28)}<b>${esc(c?.name || code)}</b></span>`;
}

const row = (label, html, cup = '') => `<div class="ss-row"><dt>${label}</dt><dd>${html}${cup}</dd></div>`;
const pending = '<span class="ss-tbd">To be decided</span>';

const overallLine = n => (n ? `<p class="ss-sub">Season ${n} overall</p>` : '');

function currentCard(o, overall) {
  const f = o.final, decided = f?.winner;   // (no trophy picture and no competition name here: those belong to the seasons recorded in History)
  return `<section class="lg-card ss is-current" aria-label="${esc(o.current.label)}"><header class="ss-head"><h3>${esc(o.current.label)}</h3>`
    + `${o.current.live && !decided ? '<span class="ss-pill is-live">In progress</span>' : '<span class="ss-pill">Finished</span>'}</header>`
    + `${overallLine(overall)}<p class="ss-comp">League</p><dl class="ss-rows">`
    + row('Winner', decided ? who(f.winner, o) : pending) + row('Runner-up', decided ? who(f.runnerUp, o) : pending) + '</dl></section>';
}

function pastCard(season, h, o, overall) {
  const at = (comp, place) => h.awards.find(a => a.season === season.id && a.competition === comp.id && a.place === place);
  const side = a => {
    if (!a) return '<span class="ss-tbd">Not recorded</span>';
    if (a.club) return who(a.club, o);
    const p = h.past.find(x => x.id === a.past_team) || { name: 'Unknown team' };
    return `<span class="ss-team"><span class="ss-badge" aria-hidden="true">${esc(p.code || initials(p.name))}</span><b>${esc(p.name)}</b></span>`;
  };
  const picture = (a, comp) => {
    const path = a.art_path || comp.winner_art;
    return path ? `<img class="ss-cup" src="${esc(o.trophy(path))}" alt="" loading="lazy">` : '';
  };
  const comps = h.comps.filter(c => at(c, 'winner') || at(c, 'runner_up'));
  const body = comps.map(c => `<p class="ss-comp">${esc(c.name)}</p><dl class="ss-rows">${row('Winner', side(at(c, 'winner')), at(c, 'winner') ? picture(at(c, 'winner'), c) : '')}${row('Runner-up', side(at(c, 'runner_up')))}</dl>`).join('');
  return `<section class="lg-card ss" aria-label="${esc(season.name)}"><header class="ss-head"><h3>${esc(season.name)}</h3><span class="ss-pill">Finished</span></header>`
    + `${overallLine(overall)}${body || '<p class="ss-comp">No winners recorded yet</p>'}</section>`;
}

export function seasonsView(o) {
  const h = o.history, seasons = h ? h.seasons : [], leagues = h?.leagues || [];
  const hid = o.hiddenCount ? `<p class="tb-hidden">${o.hiddenCount} result${o.hiddenCount === 1 ? '' : 's'} hidden, so the final isn’t shown. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const newest = leagues.at(-1), rank = l => (l ? leagues.indexOf(l) : leagues.length - 1);
  const leagueOf = s => leagues.find(l => l.id === s.league) || newest;   // a season with no league counts as the newest name
  // Number overall: oldest name first, then the order the office set within a name (a higher sort is more recent).
  const order = [...seasons].sort((a, b) => rank(leagueOf(a)) - rank(leagueOf(b)) || a.sort - b.sort || a.id - b.id);
  const overall = s => (leagues.length > 1 ? order.indexOf(s) + 1 : 0);
  const current = currentCard({ ...o, final: o.final?.hiddenFinal ? null : o.final }, leagues.length > 1 ? seasons.length + 1 : 0);
  const cardsOf = l => seasons.filter(s => leagueOf(s) === l).map(s => pastCard(s, h, o, overall(s)));
  const group = (title, cards) => `<div class="sc-group">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sc-grid">${cards.join('')}</div></div>`;
  const groups = leagues.length
    ? [...leagues].reverse().map(l => [l, l === newest ? [current, ...cardsOf(l)] : cardsOf(l)]).filter(([, cards]) => cards.length).map(([l, cards]) => group(l.name, cards))
    : [group('', [current, ...seasons.map(s => pastCard(s, h, o, 0))])];
  return `<div class="sc-section"><div class="sc-head"><h2 class="sc-title">Seasons</h2></div>${hid}${groups.join('')}</div>`;
}
