// The Seasons tab (WR-24): a card for the season being played, then a card for every season in the league's history, newest first.
// String builders and sums only (no page code), so the tests can run them without a browser:
//
//   grandFinal(fixtures, { hidden })    { winner, runnerUp } (club codes) once the grand final (stage GF) is played and its result may be shown;
//                                        { hiddenFinal: true } when it is played but the viewer has hidden it; null while it is still to come
//   seasonsView(opts)                   the tab
//
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

function currentCard(o) {
  const f = o.final, decided = f?.winner;
  const comp = o.history?.comps?.[0]?.name || 'League';
  const cup = path => (path ? `<img class="ss-cup" src="${esc(o.trophy(path))}" alt="" loading="lazy">` : '');
  const art = o.history?.comps?.[0]?.winner_art;
  return `<section class="lg-card ss is-current" aria-label="${esc(o.current.label)}"><header class="ss-head"><h3>${esc(o.current.label)}</h3>`
    + `${o.current.live && !decided ? '<span class="ss-pill is-live">In progress</span>' : '<span class="ss-pill">Finished</span>'}</header>`
    + `<p class="ss-comp">${esc(comp)}</p><dl class="ss-rows">`
    + row('Winner', decided ? who(f.winner, o) : pending, decided ? cup(art) : '')
    + row('Runner-up', decided ? who(f.runnerUp, o) : pending) + '</dl></section>';
}

function pastCard(season, h, o) {
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
    + `${body || '<p class="ss-comp">No winners recorded yet</p>'}</section>`;
}

export function seasonsView(o) {
  const h = o.history, past = h ? h.seasons : [];
  const hid = o.hiddenCount ? `<p class="tb-hidden">${o.hiddenCount} result${o.hiddenCount === 1 ? '' : 's'} hidden, so the final isn’t shown. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const cards = currentCard({ ...o, final: o.final?.hiddenFinal ? null : o.final });
  return `<div class="sc-section"><div class="sc-head"><h2 class="sc-title">Seasons</h2></div>${hid}`
    + `<div class="sc-group"><div class="sc-grid">${cards}</div></div>`
    + (past.length ? `<div class="sc-group"><h3>Previous seasons</h3><div class="sc-grid">${past.map(s => pastCard(s, h, o)).join('')}</div></div>` : '')
    + '</div>';
}
