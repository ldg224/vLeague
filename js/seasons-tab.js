// The Seasons tab (WR-24): a card for the season being played, then a card for every season in the league's history, newest first.
// String builders and sums only (no page code), so the tests can run them without a browser:
//
//   grandFinal(fixtures, { hidden })    { winner, runnerUp } (club codes) once the grand final (stage GF) is played and its result may be shown;
//                                        { hiddenFinal: true } when it is played but the viewer has hidden it; null while it is still to come
//   seasonsView(opts)                   the tab
//
// The league has run under more than one name (History, League names): previous seasons are grouped by the name they ran under, newest name first, and the
// current season sits first in the newest name's group. When the office has already recorded the current season in History (same name, newest league name),
// that record is the current season's card (shown once, with its winners once they are set; until then the card is the in-progress one). The newest name's heading is in vLeague blue, the earlier names' in green.
// The current season comes from the league page (its name and whether it is live); its winner and runner-up show "To be decided" until the grand
// final has a result. Past seasons come from History (Editor, History: js/history-data.js): for each competition that has an award in that season,
// the winner (with the competition's trophy picture) and the runner-up, a current club by its crest and name or a past team by its logo (its code on a badge until it has one).
// The current season's card also has the vLeague Shield (S-26): the club top of the table once every league match is played (opts.shield, from shield() in
// js/league-table.js), "To be decided" until then. Past seasons show the Shield only where the office recorded it as a competition in History.
// opts = { current: { label, live }, final: grandFinal(...) | null, shield: { winner } | null, history: loadHistory() | null, club(code) -> { name, short_name }, crest(code, px) -> html,
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
  return `<a class="cl ss-team" href="team.html?c=${esc(code)}">${o.crest(code, 28)}<b>${esc(c?.name || code)}</b></a>`;
}

const row = (label, html, cup = '') => `<div class="ss-row"><dt>${label}</dt><dd>${html}${cup}</dd></div>`;
const pending = '<span class="ss-tbd">To be decided</span>';

function currentCard(o) {
  const f = o.final, decided = f?.winner;   // (no trophy picture and no competition name here: those belong to the seasons recorded in History)
  return `<section class="lg-card ss is-current" aria-label="${esc(o.current.label)}"><header class="ss-head"><h3>${esc(o.current.label)}</h3>`
    + `${o.current.live && !decided ? '<span class="ss-pill is-live">In progress</span>' : '<span class="ss-pill">Finished</span>'}</header>`
    + `<p class="ss-comp">League</p><dl class="ss-rows">`
    + row('Winner', decided ? who(f.winner, o) : pending) + row('Runner-up', decided ? who(f.runnerUp, o) : pending) + '</dl>'
    + `<p class="ss-comp">vLeague Shield</p><dl class="ss-rows">${row('Winner', o.shield?.winner ? who(o.shield.winner, o) : pending)}</dl>`
    + `<p class="ss-comp">Wooden spoon</p><dl class="ss-rows">${row('Last place', o.spoon?.winner ? who(o.spoon.winner, o) : pending)}</dl></section>`;
}

function pastCard(season, h, o) {
  const at = (comp, place) => h.awards.find(a => a.season === season.id && a.competition === comp.id && a.place === place);
  const side = a => {
    if (!a) return '<span class="ss-tbd">Not recorded</span>';
    if (a.club) return who(a.club, o);
    const p = h.past.find(x => x.id === a.past_team) || { name: 'Unknown team' };
    const face = p.crest_path ? `<img class="ss-logo" src="${esc(o.trophy(p.crest_path))}" alt="" loading="lazy">` : `<span class="ss-badge" aria-hidden="true">${esc(p.code || initials(p.name))}</span>`;
    return `<span class="ss-team">${face}<b>${esc(p.name)}</b></span>`;
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
  const h = o.history, seasons = h ? h.seasons : [], leagues = h?.leagues || [];
  const hid = o.hiddenCount ? `<p class="tb-hidden">${o.hiddenCount} result${o.hiddenCount === 1 ? '' : 's'} hidden, so the final isn’t shown. <button type="button" data-reveal-all>Show all</button></p>` : '';
  const newest = leagues.at(-1);
  const leagueOf = s => leagues.find(l => l.id === s.league) || newest;   // a season with no league counts as the newest name
  const record = seasons.find(s => leagueOf(s) === newest && s.name === o.current.label);   // the current season, already recorded in History
  const decided = record && h.awards.some(a => a.season === record.id && a.place === 'winner');
  const current = decided ? pastCard(record, h, o) : currentCard({ ...o, final: o.final?.hiddenFinal ? null : o.final });
  const cardsOf = l => seasons.filter(s => leagueOf(s) === l && s !== record).map(s => pastCard(s, h, o));
  const group = (title, cards, tone) => `<div class="sc-group">${title ? `<h3 class="ss-league is-${tone}">${esc(title)}</h3>` : ''}<div class="sc-grid">${cards.join('')}</div></div>`;
  const groups = leagues.length
    ? [...leagues].reverse().map(l => [l, l === newest ? [current, ...cardsOf(l)] : cardsOf(l)]).filter(([, cards]) => cards.length).map(([l, cards]) => group(l.name, cards, l === newest ? 'now' : 'before'))
    : [group('', [current, ...seasons.filter(s => s !== record).map(s => pastCard(s, h, o))], 'now')];
  return `<div class="sc-section"><div class="sc-head"><h2 class="sc-title">Seasons</h2></div>${hid}${groups.join('')}</div>`;
}
