// The stat card (WR-09) and the full stat page (WR-10): HTML for one ranked stat, used by Overview, Player stats and Team stats.
// String builders (no page code), fed by js/season-stats.js:
//
//   statCard(card, rank(rows, card, 3), ctx, { kind: 'player' | 'team' })     the top 3, with a ">" link to the full page
//   statPage(card, ranked, ctx, opts)                                          the full page a card's ">" opens
//   listAddress(card) -> '#stats/scorers'                                       where a card's full page lives
//   wireStatPage(root, { go })                                                  the stat switcher menu (browser only)
//
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html, avatar?(code) -> html }, so the page decides where names,
// crests and kits come from. avatar draws the player's pill in the club's real kit; without it (or when it gives nothing) the pill is
// a plain capsule in the club colour.
// Look: FotMob's stat pages in vLeague's own style (css/stat-card.css): on the full page a banner in the leader's club colour says who
// leads, and every player is shown in their club's kit with the club crest on the corner.
import { onColour, isHex } from './club-colour.js';
import { format, matchesOf, POSITIONS } from './season-stats.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const colourOf = club => (isHex(club?.colour) ? club.colour : '#64748b');
const clubStyle = club => { const c = colourOf(club); return `--c:${c};--on:${onColour(c)}`; };
const svg = d => `<svg class="sc-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const CHEVRON = svg('m9 6 6 6-6 6'), BACK = svg('m15 6-6 6 6 6'), CARET = svg('m6 9 6 6 6-6'), TICK = svg('m5 12.5 4.5 4.5L19 7.5');

export const listAddress = (card, position) => `#stats/${card.id}${position && position !== 'all' ? `/${position}` : ''}`;

// A club with no logo yet: its colour as a disc, with the club code on it when there is room (the page's crest() draws a blank image).
export const initialsCrest = (club, code, px) => {
  const c = colourOf(club);
  return `<span class="crest none${px < 24 ? ' is-dot' : ''}" style="--s:${px}px;--c:${c};--on:${onColour(c)}"><i>${esc(String(code || '?').slice(0, 3))}</i></span>`;
};

const clubName = club => club?.short_name || club?.name || '';
const clubOf = (r, kind) => (kind === 'team' ? r.code : r.team);

// The avatar: a player in his club's kit (with the club crest on the corner when `badge`), or a club's crest.
function face(r, ctx, kind, px, big, badge) {
  if (kind === 'team') return ctx.crest(r.code, px);
  const kit = ctx.avatar?.(r.team) || '';
  return `<span class="sc-av${big ? ' is-big' : ''}${kit ? ' is-kit' : ''}" aria-hidden="true">${kit}${badge ? `<span class="sp-badge">${ctx.crest(r.team, 18)}</span>` : ''}</span>`;
}

// One row of a card: a player (avatar pill, name, crest and club) or a club (rank, crest, name), then the value.
function row({ row: r, value, rank }, card, ctx, kind, lead, big) {
  const club = ctx.club(clubOf(r, kind));
  const val = `<span class="sc-val${lead ? ' is-lead' : ''}">${esc(format(value, card))}</span>`;
  if (kind === 'team') {
    return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}"><span class="sc-rank">${rank}</span>${ctx.crest(r.code, 30)}`
      + `<span class="sc-who"><b class="sc-name">${esc(club?.name || r.code)}</b></span>${val}</li>`;
  }
  return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}">${face(r, ctx, kind, 0, big, false)}`
    + `<span class="sc-who"><b class="sc-name">${esc(r.name)}</b><span class="sc-club">${ctx.crest(r.team, 16)}<span>${esc(clubName(club))}</span></span></span>${val}</li>`;
}

const empty = (card, line, head = 'No matches played yet') => `<div class="sc-empty"><b>${esc(head)}</b><span>${esc(line || card.note || 'Fills in as the season is played.')}</span></div>`;

export function statCard(card, ranked, ctx, { kind = 'player' } = {}) {
  const top = ranked.slice(0, 3);
  const more = top.length ? `<a class="sc-more" href="${listAddress(card)}" aria-label="All: ${esc(card.title)}">${CHEVRON}</a>` : '';
  const body = top.length
    ? `<ol class="sc-rows">${top.map((x, i) => row(x, card, ctx, kind, i === 0, i === 0)).join('')}</ol>`
    : empty(card);
  return `<section class="lg-card sc${top.length ? '' : ' is-empty'}" aria-label="${esc(card.title)}"><div class="lg-card-head"><h2>${esc(card.title)}</h2>${more}</div>${body}</section>`;
}

// ---------- the full page ----------
const list = names => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The banner in the leader's club colour: who leads, in a sentence. A tie at the top names everyone who shares it.
function banner(card, ranked, ctx, kind, seasonLine) {
  if (!ranked.length) return '';
  const lead = ranked[0], tied = ranked.filter(x => x.rank === 1), club = ctx.club(clubOf(lead.row, kind));
  const value = format(lead.value, card), name = x => (kind === 'team' ? ctx.club(x.row.code)?.name || x.row.code : x.row.name);
  const shown = tied.slice(0, 3).map(x => `<b>${esc(name(x))}</b>`);
  const sentence = tied.length > 1
    ? `${list(tied.length > 3 ? [...shown.slice(0, 2), `${tied.length - 2} others`] : shown)} share the top spot with ${esc(value)}`
    : `<b>${esc(name(lead))}</b> ${esc(card.say ? card.say(value) : `leads with ${value}`)}`;
  return `<div class="sp-banner" style="${clubStyle(club)}">${face(lead.row, ctx, kind, 56, true, true)}`
    + `<div class="sp-says"><p>${sentence}</p><span>${esc(seasonLine)}</span></div></div>`;
}

// The stat switcher: the stat's title as a button opening a menu of every stat of this kind, grouped like the cards.
function switcher(card, cards) {
  const groups = [...new Set(cards.map(c => c.group))];
  const items = groups.map(g => `<p class="sp-group">${esc(g)}</p>${cards.filter(c => c.group === g).map(c => `<a role="menuitemradio" aria-checked="${c.id === card.id}" href="${listAddress(c)}">`
    + `<span>${esc(c.title)}</span>${TICK}</a>`).join('')}`).join('');
  return `<div class="sp-pick"><button type="button" class="sp-stat" aria-haspopup="menu" aria-expanded="false"><h2>${esc(card.title)}</h2>${CARET}</button>`
    + `<div class="sp-menu" role="menu" hidden>${items}</div></div>`;
}

// opts: kind, title ('Player stats'), back ('#stats'), cards (all cards of this kind), position ('all' | 'FWD'...), seasonLine.
export function statPage(card, ranked, ctx, { kind = 'player', title = 'Stats', back = '#stats', cards = [card], position = 'all', seasonLine = '' } = {}) {
  const pills = kind === 'player'
    ? `<nav class="sp-pills" aria-label="Position">${POSITIONS.map(([key, label]) => `<a href="${listAddress(card, key)}"${key === position ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`
    : '';
  const rows = ranked.length
    ? `<ol class="sc-rows is-full">${ranked.map(x => {
      const club = ctx.club(clubOf(x.row, kind)), sub = [kind === 'team' ? '' : clubName(club), card.sub ? card.sub(x.row) : matchesOf(x.row)].filter(Boolean).join(' · ');
      return `<li class="sc-row" data-rank="${x.rank}" style="${clubStyle(club)}"><span class="sp-rank">${x.rank}</span>${face(x.row, ctx, kind, 40, false, true)}`
        + `<span class="sc-who"><b class="sc-name">${esc(kind === 'team' ? club?.name || x.row.code : x.row.name)}</b><span class="sc-sub">${esc(sub)}</span></span>`
        + `<span class="sc-val">${esc(format(x.value, card))}</span></li>`;
    }).join('')}</ol>`
    : (position !== 'all' ? empty(card, 'Nobody in this position qualifies yet.', 'No players to show') : empty(card));
  const note = card.note ? `<p class="sc-note">${esc(card.note)}</p>` : '';
  return `<div class="sp-top"><a class="sp-back" href="${esc(back)}" aria-label="Back">${BACK}</a><b>${esc(title)}</b></div>`
    + banner(card, ranked, ctx, kind, seasonLine)
    + `<section class="lg-card sc sc-list" aria-label="${esc(card.title)}">${switcher(card, cards)}${note}${pills}${rows}</section>`;
}

// The stat switcher menu: opens on its button, closes on Escape, a tap elsewhere or a choice. `go(href)` changes the address
// (the page replaces the entry, so the back button still returns to where the page was opened from).
export function wireStatPage(root, { go } = {}) {
  const close = () => {
    const menu = root.querySelector('.sp-menu'), btn = root.querySelector('.sp-stat');
    if (menu && !menu.hidden) { menu.hidden = true; btn?.setAttribute('aria-expanded', 'false'); }
  };
  root.addEventListener('click', e => {
    const btn = e.target.closest('.sp-stat');
    if (btn) {
      const menu = root.querySelector('.sp-menu'), open = menu.hidden;
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('[aria-checked="true"]')?.focus();
      return;
    }
    const link = e.target.closest('.sp-menu a, .sp-pills a');
    if (link && go) { e.preventDefault(); close(); go(link.getAttribute('href')); return; }
    if (!e.target.closest('.sp-pick')) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); root.querySelector('.sp-stat')?.focus(); }
    const menu = root.querySelector('.sp-menu');
    if (!menu || menu.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('a')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
}
