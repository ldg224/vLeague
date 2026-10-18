// The stat card (WR-09) and the full stat page (WR-10): HTML for one ranked stat, used by Overview, Player stats and Team stats.
// String builders (no page code), fed by js/season-stats.js:
//
//   statCard(card, rank(rows, card, 3), ctx, { kind: 'player' | 'team' })     the top 3, with a ">" link to the full page
//   statPage(card, ranked, ctx, opts)                                          the full page a card's ">" opens
//   listAddress(card) -> '#stats/scorers'                                       where a card's full page lives
//   wireStatPage(root, { go })                                                  the stat switcher menu (browser only)
//
// ctx = { club(code) -> { name, short_name, colour }, crest(code, px) -> html, avatar?(code) -> html, face?(playerId, club code, px) -> portrait html }, so the page decides where names,
// crests and kits come from. avatar draws the player's pill in the club's real kit; without it (or when it gives nothing) the pill is
// a plain capsule in the club colour.
// Look: FotMob's stat pages in vLeague's own style (css/stat-card.css): on the full page a banner in the leader's club colour says who
// leads, and every player is shown in their club's kit with the club crest on the corner.
import { onColour, isHex, accentFor } from './club-colour.js';
import { format, matchesOf, POSITIONS, POSITION_WORD } from './season-stats.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const colourOf = club => (isHex(club?.colour) ? club.colour : '#64748b');
const clubStyle = club => { const c = colourOf(club); return `--c:${c};--on:${onColour(c)};--cl:${accentFor(c, 'light')};--cd:${accentFor(c, 'dark')}`; };
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

// The avatar: a player's portrait with the club crest on its corner (just the crest until the players have loaded), or a club's crest.
function face(r, ctx, kind, px) {
  if (kind === 'team') return ctx.crest(r.code, px || 30);
  const pic = ctx.face?.(r.id, r.team, px || 30);
  return pic ? `<span class="sc-pf" style="--px:${px || 30}px">${pic}<span class="sc-pfc">${ctx.crest(r.team, Math.round((px || 30) * 0.5))}</span></span>` : ctx.crest(r.team, px || 30);
}

// One row of a card: a player (avatar pill, name, crest and club) or a club (rank, crest, name), then the value.
function row({ row: r, value, rank }, card, ctx, kind, lead, big) {
  const club = ctx.club(clubOf(r, kind));
  const val = `<span class="sc-val${lead ? ' is-lead' : ''}">${esc(format(value, card))}</span>`;
  if (kind === 'team') {
    return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}"><span class="sc-rank">${rank}</span><a class="cl sc-link" href="team.html?c=${esc(r.code)}">${ctx.crest(r.code, 30)}`
      + `<span class="sc-who"><b class="sc-name">${esc(club?.name || r.code)}</b></span></a>${val}</li>`;
  }
  return `<li class="sc-row${lead ? ' is-lead' : ''}" style="${clubStyle(club)}">${face(r, ctx, kind, 36)}`
    + `<span class="sc-who"><b class="sc-name">${esc(r.name)}</b><a class="cl sc-club" href="team.html?c=${esc(r.team)}">${esc(clubName(club))}</a></span>${val}</li>`;
}

const empty = (card, line, head = 'No matches played yet') => `<div class="sc-empty"><b>${esc(head)}</b><span>${esc(line || card.note || 'Fills in as the season is played.')}</span></div>`;

export function statCard(card, ranked, ctx, { kind = 'player' } = {}) {
  const top = ranked.slice(0, 3);
  const more = top.length ? `<a class="sc-more" href="${listAddress(card)}" aria-label="All: ${esc(card.title)}">${CHEVRON}</a>` : '';
  const body = top.length
    ? `<ol class="sc-rows">${top.map((x, i) => row(x, card, ctx, kind, i === 0, i === 0)).join('')}</ol>`
    : empty(card);
  const lead = top.length ? ` has-lead" style="${clubStyle(ctx.club(clubOf(top[0].row, kind)))}` : '';
  return `<section class="lg-card sc${top.length ? '' : ' is-empty'}${lead}" aria-label="${esc(card.title)}"><div class="lg-card-head"><h2>${esc(card.title)}</h2>${more}</div>${body}</section>`;
}

// ---------- the full page ----------
const list = names => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// A tie at the top, in words that mean something and vary a little so the lists don't all read the same. Which wording a list gets depends only on the stat and
// the names, so it never changes between redraws.
const TIE_PLURAL = { scorers: 'goals', assists: 'assists', ga: 'goals and assists', rating: 'average ratings', trating: 'average ratings', minutes: 'minutes played' };
const TIE_METRIC = { scorers: 'goals', assists: 'assists', ga: 'goals and assists', rating: 'average rating', minutes: 'minutes played', savepct: 'save percentage' };
const metricOf = card => TIE_METRIC[card.id] || card.title.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase());
function tieSentence(card, names, value, plural) {
  const m = metricOf(card), among = plural ? ` among ${plural}` : '', pl = TIE_PLURAL[card.id];
  const options = [
    `${names} are level on ${m}${among}, with ${value}`,
    `${names} are tied on ${m}${among}, with ${value} each`,
    `${names} have the same ${m}${among}, with ${value}`,
    `${names} are equal on ${m}${among}, with ${value} each`,
    ...(pl ? [`${names} have equal ${pl}${among}, with ${value}`, `${names} have matching ${pl}${among}, with ${value}`] : []),
  ];
  let h = 5381;
  for (const ch of `${card.id}|${names}`) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

// The line under the sentence: how many matches the leader has played (a club: how many the club has). A tie shows the one number if they share it, else the range.
function playedLine(tied) {
  const n = tied.map(x => x.row.apps ?? x.row.p ?? 0), lo = Math.min(...n), hi = Math.max(...n);
  return `${lo === hi ? lo : `${lo}–${hi}`} ${hi === 1 ? 'match' : 'matches'} played`;
}

// The banner in the leader's club colour: who leads, in a sentence that says what they lead at and, when a position is picked, in which position
// ("Ryan Zane is the top rated midfielder, with an average rating of 7.7"). A tie at the top names everyone who shares it.
function banner(card, ranked, ctx, kind, position = 'all') {
  if (!ranked.length) return '';
  const lead = ranked[0], tied = ranked.filter(x => x.rank === 1), club = ctx.club(clubOf(lead.row, kind));
  const value = format(lead.value, card), name = x => (kind === 'team' ? ctx.club(x.row.code)?.name || x.row.code : x.row.name);
  const word = kind === 'player' ? POSITION_WORD[position] : null;   // [singular, plural] or null for everyone
  const shown = tied.slice(0, 3).map(x => `<b>${esc(name(x))}</b>`);
  let sentence;
  if (tied.length > 1) {
    const names = list(tied.length > 3 ? [...shown.slice(0, 2), `${tied.length - 2} others`] : shown);
    sentence = tieSentence(card, names, esc(value), word?.[1] || '');
  } else {
    const say = card.say ? card.say(value, card.sayPos ? word?.[0] || '' : '') : `leads with ${value}`;
    sentence = `${word && !card.sayPos ? `Among ${word[1]}, ` : ''}<b>${esc(name(lead))}</b> ${esc(say)}`;
  }
  return `<div class="sp-banner" style="${clubStyle(club)}">${face(lead.row, ctx, kind, 56)}`
    + `<div class="sp-says"><p>${sentence}</p><span>${esc(playedLine(tied))}</span></div></div>`;
}

// The stat switcher: the stat's title as a button opening a menu of every stat of this kind, grouped like the cards.
function switcher(card, cards) {
  const groups = [...new Set(cards.map(c => c.group))];
  const items = groups.map(g => `<p class="sp-group">${esc(g)}</p>${cards.filter(c => c.group === g).map(c => `<a role="menuitemradio" aria-checked="${c.id === card.id}" href="${listAddress(c)}">`
    + `<span>${esc(c.title)}</span>${TICK}</a>`).join('')}`).join('');
  return `<div class="sp-pick"><button type="button" class="sp-stat" aria-haspopup="menu" aria-expanded="false"><h2>${esc(card.title)}</h2>${CARET}</button>`
    + `<div class="sp-menu" role="menu" hidden>${items}</div></div>`;
}

// opts: kind, title ('Player stats'), back ('#stats'), cards (all cards of this kind), position ('all' | 'FWD'...).
export function statPage(card, ranked, ctx, { kind = 'player', title = 'Stats', back = '#stats', cards = [card], position = 'all' } = {}) {
  const pills = kind === 'player'
    ? `<nav class="sp-pills" aria-label="Position">${POSITIONS.map(([key, label]) => `<a href="${listAddress(card, key)}"${key === position ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`
    : '';
  const rows = ranked.length
    ? `<ol class="sc-rows is-full">${ranked.map(x => {
      const club = ctx.club(clubOf(x.row, kind)), sub = card.sub ? card.sub(x.row) : matchesOf(x.row), team = kind === 'team' ? '' : `<span class="sc-club">${esc(clubName(club))}</span>`;
      return `<li class="sc-row" data-rank="${x.rank}" style="${clubStyle(club)}"><span class="sp-rank">${x.rank}</span>${face(x.row, ctx, kind, 40)}`
        + `<span class="sc-who"><b class="sc-name">${esc(kind === 'team' ? club?.name || x.row.code : x.row.name)}</b><span class="sc-sub">${team}${team && sub ? ' · ' : ''}${esc(sub)}</span></span>`
        + `<span class="sc-val">${esc(format(x.value, card))}</span></li>`;
    }).join('')}</ol>`
    : (position !== 'all' ? empty(card, 'Nobody in this position qualifies yet.', 'No players to show') : empty(card));
  const note = card.note ? `<p class="sc-note">${esc(card.note)}</p>` : '';
  return `<div class="sp-top"><a class="sp-back" href="${esc(back)}" aria-label="Back">${BACK}</a><b>${esc(title)}</b></div>`
    + banner(card, ranked, ctx, kind, position)
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
