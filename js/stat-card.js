// The stat card (WR-09) and the full stat list (WR-10): HTML for one ranked stat, used by Overview, Player stats and Team stats.
// Pure string builders (no page code), fed by js/season-stats.js:
//
//   statCard(card, rank(rows, card, 3), ctx, { kind: 'player' | 'team' })     the top 3, with a ">" link to the full list
//   statList(card, rank(rows, card), ctx, { kind, back })                      the whole ranking (a card's ">" opens it)
//   listAddress(card) -> '#stats/scorers'                                       where a card's full list lives
//
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html }, so the page decides where names and crests come from.
// Look: FotMob's stat cards, in vLeague's own style (css/stat-card.css): the leader's value in a pill in their club's colour,
// readable on any club colour; a player's avatar is vLeague's own pill in the club's colour; clubs show their crest.
import { onColour, isHex } from './club-colour.js';
import { format } from './season-stats.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const colourOf = club => (isHex(club?.colour) ? club.colour : '#64748b');
const clubStyle = club => { const c = colourOf(club); return `--c:${c};--on:${onColour(c)}`; };
const CHEVRON = '<svg class="sc-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>';
const BACK = '<svg class="sc-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 6-6 6 6 6"/></svg>';

export const listAddress = card => `#stats/${card.id}`;

// A club with no logo yet: its colour as a disc, with the club code on it when there is room (the page's crest() draws a blank image).
export const initialsCrest = (club, code, px) => {
  const c = colourOf(club);
  return `<span class="crest none${px < 24 ? ' is-dot' : ''}" style="--s:${px}px;--c:${c};--on:${onColour(c)}"><i>${esc(String(code || '?').slice(0, 3))}</i></span>`;
};

const clubName = club => club?.short_name || club?.name || '';

// One row: a player (avatar pill, name, crest and club) or a club (rank, crest, name), then the value.
function row({ row: r, value, rank }, card, ctx, kind, lead, big) {
  const club = ctx.club(kind === 'team' ? r.code : r.team);
  const v = esc(format(value, card));
  const val = `<span class="sc-val${lead ? ' is-lead' : ''}">${v}</span>`;
  if (kind === 'team') {
    return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}"><span class="sc-rank">${rank}</span>${ctx.crest(r.code, 30)}`
      + `<span class="sc-who"><b class="sc-name">${esc(club?.name || r.code)}</b></span>${val}</li>`;
  }
  return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}"><span class="sc-av${big ? ' is-big' : ''}" aria-hidden="true"></span>`
    + `<span class="sc-who"><b class="sc-name">${esc(r.name)}</b><span class="sc-club">${ctx.crest(r.team, 16)}<span>${esc(clubName(club))}</span></span></span>${val}</li>`;
}

const empty = card => `<div class="sc-empty"><b>No matches played yet</b><span>${esc(card.note || 'Fills in as the season is played.')}</span></div>`;

export function statCard(card, ranked, ctx, { kind = 'player' } = {}) {
  const top = ranked.slice(0, 3);
  const more = top.length ? `<a class="sc-more" href="${listAddress(card)}" aria-label="All: ${esc(card.title)}">${CHEVRON}</a>` : '';
  const body = top.length
    ? `<ol class="sc-rows">${top.map((x, i) => row(x, card, ctx, kind, i === 0, i === 0)).join('')}</ol>`
    : empty(card);
  return `<section class="lg-card sc${top.length ? '' : ' is-empty'}" aria-label="${esc(card.title)}"><div class="lg-card-head"><h2>${esc(card.title)}</h2>${more}</div>${body}</section>`;
}

// The whole ranking. Everyone sharing the top rank gets the leader's pill.
export function statList(card, ranked, ctx, { kind = 'player', back = '#stats', backLabel = 'Back' } = {}) {
  const note = card.note ? `<p class="sc-note">${esc(card.note)}</p>` : '';
  const rows = ranked.length
    ? `<ol class="sc-rows is-full">${ranked.map(x => row(x, card, ctx, kind, x.rank === 1, false).replace('class="sc-row', `data-rank="${x.rank}" class="sc-row`)).join('')}</ol>`
    : empty(card);
  return `<section class="lg-card sc sc-list" aria-label="${esc(card.title)}"><div class="sc-list-head"><a class="sc-back" href="${esc(back)}" aria-label="${esc(backLabel)}">${BACK}<span>${esc(backLabel)}</span></a></div>`
    + `<div class="lg-card-head"><h2>${esc(card.title)}</h2><span class="sc-count">${ranked.length ? `${ranked.length} ${kind === 'team' ? (ranked.length === 1 ? 'club' : 'clubs') : (ranked.length === 1 ? 'player' : 'players')}` : ''}</span></div>${note}${rows}</section>`;
}
