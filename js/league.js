// The league page (website revamp): one FotMob-style page with a header and tabs (js/frame.js). WR-03 builds the frame;
// each tab's content comes in its own card (the table WR-11 to 14 lives on Overview, Fixtures WR-15 to 17, Overview WR-18 to 21, Stats WR-22/23 (players and teams in one tab),
// Seasons WR-24, News WR-25, Draft WR-27). Until then a tab shows where its content will go.
// Local preview (screenshots only, never on the live site): http://localhost:8767/league.html?preview&club=%23c8102e&theme=light&office
// Made-up results to look at the stats pages before a match is played: add `&demo` (six rounds) or `&demo=3` (three; 0 for none).
// Works on localhost and for the office only; it is never real data and the pages say so. `&now=2026-10-16T12:00` picks the moment the demo is viewed at
// (default: after every demo match), to see upcoming matches.
import { enterPlace, paintClub } from './shell.js';
import { mountFrame } from './frame.js';
import { watchLineupDue } from './lineup-due.js';
import { esc, crestUrl, clubs } from './member.js';
import { finished, logoUrl } from './dashboard-data.js';
import { crest as crestHtml, useClubs } from './places.js';
import { loadKits } from './kits-data.js';
import { kitSprite, startDesign } from './kit.js';
import { countedFixtures, totals, rank, PLAYER_CARDS, TEAM_CARDS } from './season-stats.js';
import { statCard, statPage, wireStatPage, initialsCrest } from './stat-card.js';
import { demoSeason } from './demo-season.js';
import { tableRows, tableCard, rowTops, reshuffle } from './league-table.js';
import { paint, quietly, busy, snapshotInputs, restoreInputs } from './paint.js';
import { spoilerHidden, revealScore, fmtTime } from './prefs.js';
import { fixturesView, parseSub, roundWidget, rounds } from './league-fixtures.js';
import { teamOfWeekCard } from './team-of-week.js';
import { loadPlayers } from './players-data.js';
import { instagramCard } from './instagram.js';
import { seasonsView, grandFinal } from './seasons-tab.js';
import { newsHtml, clearable } from './news-tab.js';
import { inboxItems, readIds, markRead } from './inbox-data.js';
import { dismissPosts, restorePosts } from './prefs.js';
import { loadReactions, setReaction } from './news-reactions.js';
import { loadHistory, trophyUrl } from './history-data.js';
import { mountDraft } from './draft.js';
import { accentFor, isHex } from './club-colour.js';
import { openDraft, phase as draftPhase } from './draft-data.js';
import { db } from './auth.js';
import { winChance, percents } from './match-model.js';
import { VERSION } from './version.js';
import { sheen, pinClock } from './silk.js';

const params = new URLSearchParams(location.search);
const preview = ['localhost', '127.0.0.1'].includes(location.hostname) && params.has('preview');

// The contour lines and the silk in the cards fade in once their pictures are loaded, instead of popping in half way through the page loading.
Promise.all(['assets/img/topo.png', 'assets/img/fabric.png'].map(src => { const i = new Image(); i.src = src; return i.decode().catch(() => {}); }))
  .then(() => requestAnimationFrame(() => document.body.classList.add('topo-ready')));

let ctx;
if (preview) {
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
  if (params.get('font') === 'old') document.body.classList.add('font-old');
  const colour = params.get('club');
  if (colour) paintClub({ colour });
  ctx = { me: { profile: { role: params.has('office') ? 'office' : 'manager' } }, club: colour ? { colour, code: params.get('mine') || undefined } : null, main: document.getElementById('main') };
} else {
  ctx = await enterPlace('league');
}

document.getElementById('version').textContent = `v${VERSION}`;

if (ctx) {
  const office = ctx.me?.profile?.role === 'office';
  document.body.classList.toggle('has-club', Boolean(ctx.club));
  const main = ctx.main;
  main.removeAttribute('aria-busy');

  // A card waiting for its content: just its title for now.
  const card = title => `<section class="lg-card lg-empty"><div class="lg-card-head"><h2>${esc(title)}</h2></div></section>`;

  // ---- Stats (WR-08 to WR-10) ----
  const demo = params.has('demo') && (preview || office) ? Number(params.get('demo') || 6) : null;
  let season = ctx.season, kitPics = {}, realClubs = false;
  if (demo != null) {
    // The league's real clubs (names, colours, crests) and their real home kits, with made-up players and results.
    // Kits and clubs are readable by anyone with the public key. If they don't load, the demo uses invented clubs.
    const image = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    const [rows, kits] = await Promise.all([clubs().catch(() => []), loadKits()]);
    const active = rows.filter(r => r.status === 'active' && r.colour);
    season = demoSeason({ rounds: demo, clubs: active.length >= 4 ? active : undefined });
    if (active.length >= 4) {
      realClubs = true;
      useClubs(active);
      for (const t of season.teams) t.crest_path = active.find(r => r.code === t.code)?.crest_path;
      await Promise.all(season.teams.map(async t => {
        const k = kits[t.code]?.home;   // a club with no kit yet wears the default one, made from its colours
        try {
          const [art, logo] = await Promise.all([image(k?.artUrl), image(k?.logoUrl)]);
          kitPics[t.code] = kitSprite({ ...(k?.design || startDesign(t)), text: { name: '', number: '', colour: '' } }, { art, logo }, 128).toDataURL();
        } catch { /* a kit that won't draw falls back to the plain capsule */ }
      }));
    }
  }
  const teamOf = code => season?.teams.find(t => t.code === code) || { code, name: code, colour: '#64748b' };
  // A club's logo when it has one, else its colour (the page's crest() would draw a blank image for a club without a logo).
  const sctx = {
    club: teamOf,
    crest: (code, px) => (teamOf(code).crest_path || !logoUrl(code).startsWith('data:') ? crestHtml(teamOf(code), px) : initialsCrest(teamOf(code), code, px)),
    avatar: code => (kitPics[code] ? `<img src="${kitPics[code]}" alt="">` : ''),
  };
  const played = () => (!season ? [] : demo != null ? countedFixtures(season.fixtures) : countedFixtures(finished(season)));
  const KINDS = { player: PLAYER_CARDS, team: TEAM_CARDS };
  // Address changes made by the page itself replace the entry (a stat switched, a position picked), so "Back" still goes to where the
  // full page was opened from: `moved` counts the changes that added an entry.
  let moved = 0, replacing = false;
  addEventListener('hashchange', () => { if (!replacing) moved++; replacing = false; });
  const go = href => { replacing = true; location.replace(href); };

  const grid = (kind, data) => {
    const groups = [...new Set(KINDS[kind].map(c => c.group))];
    return groups.map(g => `<div class="sc-group${g === 'Pinned' ? ' is-pinned' : ''}"><h3>${esc(g)}</h3><div class="sc-grid">${KINDS[kind].filter(c => c.group === g)
      .map(c => statCard(c, rank(data[kind === 'team' ? 'teams' : 'players'], c, 3), sctx, { kind })).join('')}</div></div>`).join('');
  };
  const stats = (sub, picked) => {
    const data = totals(played());
    const [cardId, position = 'all'] = sub.split('/');
    const found = ['player', 'team'].map(kind => [kind, KINDS[kind].find(c => c.id === cardId)]).find(x => x[1]);
    if (found) {
      const [kind, c] = found, rows = kind === 'team' ? data.teams : data.players;
      return statPage(c, rank(kind === 'team' || position === 'all' ? rows : rows.filter(r => r.pos === position), c), sctx, {
        kind, title: kind === 'team' ? 'Team stats' : 'Player stats', back: '#stats', cards: KINDS[kind], position,
      });
    }
    const note = demo != null ? `<p class="sc-demo"><b>Demo data</b> ${realClubs ? 'Real clubs and kits, made-up players and results' : 'Made-up clubs, players and results'}, ${demo} ${demo === 1 ? 'round' : 'rounds'} (try <code>demo=0</code> to <code>demo=6</code>). Not real.</p>` : '';
    if (!data.players.length && demo == null) {
      return `<section class="lg-card sc-none"><div class="sc-empty"><b>No matches played yet</b><span>Player and team stats appear here as the season is played.</span></div></section>`;
    }
    const team = sub === 'team', kind = team ? 'team' : 'player';
    const toggle = `<nav class="sc-toggle" aria-label="Stats of"><a href="#stats"${team ? '' : ' aria-current="true"'}>Player</a><a href="#stats/team"${team ? ' aria-current="true"' : ''}>Team</a></nav>`;
    return `${note}<div class="sc-section"><div class="sc-head"><h2 class="sc-title">${team ? 'Team stats' : 'Player stats'}</h2>${toggle}</div>${grid(kind, data)}</div>`;
  };

  // A hardly-there splash of vLeague blue on every card (css/league-page.css, --sheen): each card gets its own spot, picked from its title so the
  // same card always looks the same.
  // Every redraw (a tab, an arrow, a filter) makes new card elements, whose animations would start again from the beginning. So every card's
  // slow animations (silk slide and breathing, the splash, the leaders' ring) are pinned to the document's clock (startTime 0) instead of to
  // the moment the element was made: a redrawn card is exactly where the old one was, whatever caused the redraw. The silk fades in only the
  // first time (`silk-seen` goes on once that fade is over).
  setTimeout(() => document.body.classList.add('silk-seen'), 3500);
  // ---- The table (WR-11 to WR-14) ----
  let tableFilter = 'all';
  const tableNow = () => (demo != null ? new Date(params.get('now') || '2027-01-01T00:00:00') : new Date());   // demo matches are dated in the coming days: treat them as played (or pick the moment: &now=2026-10-16T12:00)
  const tableHtml = () => {
    if (!season) return tableCard([], sctx, { filter: tableFilter });
    const now = tableNow(), counted = season.fixtures.filter(f => f.result && !f.test && !f.exhibition && !f.stage);
    const hiddenIds = counted.filter(f => spoilerHidden(f, season, now)).map(f => f.id);
    return tableCard(tableRows(season, { filter: tableFilter, now, hidden: new Set(hiddenIds) }), { ...sctx, mine: ctx.club?.code }, { filter: tableFilter, hiddenCount: hiddenIds.length });
  };
  // ---- The Fixtures tab (WR-15 to WR-17) ----
  let current = null;   // the tab on screen: [id, picked, sub]
  let stadiums = null;   // club code -> ground, read once from the clubs table
  let widgetWeek = null;   // the round the Overview widget shows (null = the current one)
  const fixturesCtx = () => {
    const now = tableNow();
    const hidden = new Set(season ? season.fixtures.filter(f => f.result && !f.test && spoilerHidden(f, season, now)).map(f => f.id) : []);
    // The win chance never sees a result the viewer has hidden, so it can't give one away.
    const seen = hidden.size ? { ...season, fixtures: season.fixtures.map(f => (hidden.has(f.id) ? { ...f, result: null } : f)) } : season, memo = new Map();
    const chance = fx => {
      if (!memo.has(fx.id)) { try { const [h, d, a] = percents(winChance(seen, fx, { now })); memo.set(fx.id, { h, d, a }); } catch { memo.set(fx.id, null); } }
      return memo.get(fx.id);
    };
    return { ...sctx, now, hidden, mine: ctx.club?.code, time: fmtTime, chance, venue: code => stadiums?.[code] || '' };
  };
  const fixturesHtml = sub => fixturesView(season, fixturesCtx(), parseSub(sub));
  // Team of the week (WR-21): the best XI of a round, from the matches the viewer may see (results hidden by spoiler-free mode stay out).
  // Shirt numbers come from the players list (read once, a moment after the page; the demo's made-up players get a number worked out from their id).
  let numbers = null;
  const shirt = id => numbers?.get(String(id)) ?? (demo != null ? String(1 + [...String(id)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 99, 7)) : undefined);
  let twWeek = null;   // the round shown (null = the latest played)
  const teamHtml = () => {
    if (!season) return teamOfWeekCard([], sctx);
    const now = tableNow(), all = played(), seen = all.filter(f => !spoilerHidden(f, season, now)), labels = new Map(rounds(season).map(r => [r.week, r.label]));
    return teamOfWeekCard(seen, { ...sctx, mine: ctx.club?.code, number: shirt }, { week: twWeek, labelOf: w => labels.get(w) || `Round ${w}`, hiddenCount: all.length - seen.length });
  };
  // The three leader cards under the table (WR-19): the top three of each stat, each with its ">" link to the full list.
  const leaders = () => {
    const data = totals(played());
    return ['rating', 'scorers', 'assists'].map(id => { const c = PLAYER_CARDS.find(x => x.id === id); return statCard(c, rank(data.players, c, 3), sctx, { kind: 'player' }); }).join('');
  };
  // One way to put a view on the page. paint() draws only when the HTML really changed, so a timed refresh that finds nothing new touches
  // nothing; and a timed one (`timed`) also waits while the person is pressing, typing, selecting or has a menu open (js/paint.js), trying
  // again on the next tick. This is what stops the page redrawing under someone's hand.
  const draw = (html, timed = false) => {
    const y = scrollY, snap = snapshotInputs(main), did = timed ? quietly(() => paint(main, html)) : paint(main, html);   // half-typed fields (the phone number) survive a redraw
    if (did) { sheen(main); restoreInputs(main, snap); scrollTo(0, y); }
    return did;
  };
  // Overview is built in pieces (slots), each painted on its own, so a click on one card (a round arrow, a filter, a Team of the week pick) or a live minute
  // redraws only that card, and the Instagram embed is never reloaded by them. A card swapped in keeps its silk look (the same style values).
  const SKELETON = `<div class="lg-cols" data-view="overview"><div class="lg-main"><div class="lg-slot" data-slot="table"></div><div class="lg-slot" data-slot="trio"></div><div class="lg-slot" data-slot="ig"></div></div>`
    + '<aside class="lg-side"><div class="lg-slot" data-slot="round"></div><div class="lg-slot" data-slot="tw"></div></aside></div>';
  const overviewParts = () => ({ table: tableHtml(), trio: `<div class="lg-trio">${leaders()}</div>`, round: roundWidget(season, fixturesCtx(), widgetWeek), tw: teamHtml() });
  let social = null, socialLoaded = false;   // the league's Instagram row (WR-30), read once
  const igHtml = () => (socialLoaded ? instagramCard(social) : '');
  const fillSlot = (el, html, timed) => {
    const looks = [...el.querySelectorAll('.lg-card')].map(c => c.getAttribute('style'));
    const did = timed ? quietly(() => paint(el, html)) : paint(el, html);
    if (did) el.querySelectorAll('.lg-card').forEach((c, i) => { if (looks[i]) { c.setAttribute('style', looks[i]); c.dataset.sheen = ''; } });
    return did;
  };
  const patchOverview = (timed = false) => {
    const cols = main.querySelector('.lg-cols[data-view="overview"]');
    if (!cols) return false;
    const y = scrollY;
    let did = false;
    for (const [name, html] of Object.entries({ ...overviewParts(), ig: igHtml() })) did = fillSlot(cols.querySelector(`[data-slot="${name}"]`), html, timed) || did;
    if (did) { sheen(main); scrollTo(0, y); }
    return did;
  };
  const showOverview = () => { paint(main, SKELETON); patchOverview(false); };
  const rerender = (timed = false) => (!current ? false : current[0] === 'overview' ? patchOverview(timed) : draw(VIEWS[current[0]](current[2], current[1]), timed));
  // The Seasons tab (WR-24): this season's card from the league page, the others from History (read once, a moment after the page).
  let honours = null, clubRows = null;   // (not `history`: that is the browser's)
  const seasonsHtml = (sub, picked) => {
    const now = tableNow(), all = season ? season.fixtures : [], hidden = new Set(all.filter(f => f.result && !f.test && spoilerHidden(f, season, now)).map(f => f.id));
    const gf = all.find(f => f.stage === 'GF' && !f.test && f.result);
    return seasonsView({
      current: { label: picked?.label || 'Season 1', live: picked?.live !== false }, final: grandFinal(all.filter(f => f.result), { hidden }), history: honours,
      club: code => clubRows?.get(code) || sctx.club(code), crest: sctx.crest, trophy: trophyUrl, hiddenCount: gf && hidden.has(gf.id) ? 1 : 0,
    });
  };
  loadHistory().then(h => { honours = h; drawInSoon(); }).catch(() => {});

  // The News tab (WR-25): the old Inbox. Loaded once at the start (so the tab can show an unread count), drawn by news-tab.js.
  const club = ctx.club, code = club?.code;
  const nw = { items: [], read: new Set(), reactions: new Map(), phone: '', toast: null, opened: new Set(), loading: true, code, sbNews: [] };
  const newsVars = () => ({ team: club?.name || 'your club', manager: club?.manager_name || ctx.me?.profile?.display_name || 'manager' });
  let frameApi = null;
  const newsBadge = () => frameApi?.setBadge('news', nw.items.filter(i => !nw.read.has(i.id)).length);
  const newsHtmlNow = () => newsHtml(nw, { vars: newsVars() });
  const loadNews = async () => {
    if (!code) { nw.loading = false; return; }
    try {
      const c = await db();
      nw.sbNews = await c.from('news').select('*').order('created_at', { ascending: false }).limit(50).then(r => r.data || []).catch(() => []);
      nw.phone = await c.from('manager_phones').select('phone').eq('club', code).maybeSingle().then(r => r.data?.phone || '').catch(() => '');
    } catch { /* an empty list */ }
    nw.items = inboxItems(season, nw.sbNews, code); nw.read = readIds(code); nw.loading = false;
    newsBadge(); drawInSoon();
    loadReactions(nw.items.flatMap(i => (i.src === 'sb' ? [`news:${i.row.id}`] : []))).then(r => { nw.reactions = r; drawInSoon(); }).catch(() => {});
  };
  loadNews();

  // Things that arrive a moment after the page (the grounds, the shirt numbers) are drawn in when nobody is mid-tap, trying again a few times if someone is.
  const drawInSoon = () => {
    let tries = 0;
    // Draw once, unless the person is busy with the page, and then try again a little later (never just because nothing changed: that would redraw a post they have just opened).
    const put = () => {
      if (!['fixtures', 'overview', 'seasons', 'news'].includes(current?.[0])) return;
      if (busy(main) && ++tries < 8) { setTimeout(put, 1500); return; }
      rerender(true);
    };
    put();
  };
  // The league's Instagram: read a moment after the page and drawn in without interrupting a tap.
  (async () => { try { const { data } = await (await db()).from('league_social').select('*').eq('id', 1).maybeSingle(); social = data || null; if (preview && params.get('ig')) social = { ...social, instagram_posts: params.get('ig').split(',').map(c => `https://www.instagram.com/p/${c}/`), followers: 1250, posts: 48 }; } catch { /* the card still shows the follow button */ } socialLoaded = true; drawInSoon(); })();

  clubs().then(rows => { clubRows = new Map(rows.map(c => [c.code, c])); stadiums = Object.fromEntries(rows.filter(c => c.stadium).map(c => [c.code, c.stadium])); drawInSoon(); }).catch(() => {});
  if (demo == null) loadPlayers().then(list => { numbers = new Map(list.filter(p => p.number != null).map(p => [String(p.id), p.number])); drawInSoon(); }).catch(() => {});

  // The Draft tab (WR-27): shown only while the office has made a draft visible, with LIVE while picks can be made. The draft itself (js/draft.js) is mounted into
  // an element of its own when you open the tab and unmounted (clock, poll and live channel stopped) when you leave it.
  let draftApi = null;
  const showDraft = sub => {
    if (draftApi && main.querySelector('.lg-draft')) { draftApi.setTab(sub); return; }
    paint(main, '<div class="lg-draft"></div>');
    const root = main.querySelector('.lg-draft');
    draftApi = null;
    mountDraft(root, { club: ctx.club, season, sub, crest: (c, px) => sctx.crest(c, px), colourOf: (c, theme) => { const col = (clubRows?.get(c) || sctx.club(c))?.colour; return isHex(col) ? accentFor(col, theme) : ''; }, onGone: () => { frameApi?.setDraft({ visible: false, live: false }); if (current?.[0] === 'draft') location.replace('#overview'); } })
      .then(api => { if (current?.[0] === 'draft' && root.isConnected) draftApi = api; else api.unmount(); })
      .catch(() => { if (root.isConnected) root.innerHTML = '<section class="lg-card"><div class="lg-card-head"><h2>Draft</h2></div><div class="sc-empty"><b>The draft didn’t load</b><span>Check your connection and refresh the page.</span></div></section>'; });
  };
  // Every minute: has a draft been made visible or hidden, or started or finished? Only the tab changes; a read that fails changes nothing.
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const d = await openDraft(undefined, true);
      frameApi?.setDraft({ visible: Boolean(d), live: Boolean(d) && draftPhase(d) === 'live' });
      if (!d && current?.[0] === 'draft') location.replace('#overview');
    } catch { /* try again next minute */ }
  }, 60000);

  // News: opening a post marks it read; the buttons are data-nw; the phone number form saves through save_my_phone().
  main.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches?.('details.nw-post')) return;
    if (d.open) nw.opened.add(d.dataset.id); else nw.opened.delete(d.dataset.id);
    if (!d.open || nw.read.has(d.dataset.id)) return;
    nw.read = markRead(code, [d.dataset.id]);
    d.classList.remove('new'); d.querySelector('.sr-only')?.remove();
    newsBadge();
    if (!nw.items.some(i => !nw.read.has(i.id))) main.querySelector('[data-nw="markall"]')?.remove();
  }, true);
  main.addEventListener('submit', async e => {
    const form = e.target.closest('.ph-form');
    if (!form) return;
    e.preventDefault();
    const msg = form.querySelector('.ph-msg'), btn = form.querySelector('button'), value = form.phone.value.trim(), digits = value.replace(/\D/g, '').length;
    if (!/^\+?[0-9 ()-]{8,20}$/.test(value) || digits < 8 || digits > 15) { msg.textContent = 'Enter a phone number with 8 to 15 digits, like 0412 345 678.'; form.phone.focus(); return; }
    btn.disabled = true; msg.textContent = 'Saving…';
    const { error } = await (await db()).rpc('save_my_phone', { p_phone: value });
    btn.disabled = false;
    if (error) { msg.textContent = /digits|Sign in|linked/.test(error.message) ? error.message : 'That didn’t save. Check your connection and try again.'; return; }
    nw.phone = value; btn.textContent = 'Change'; msg.textContent = 'Saved. The league office can see it.';
  });
  const removePosts = async (ids, text) => {
    await dismissPosts(ids);
    nw.items = nw.items.filter(i => !ids.includes(i.id)); nw.toast = { text, ids };
    newsBadge(); rerender();
  };
  main.addEventListener('click', async e => {
    const act = e.target.closest('[data-nw]');
    if (act) {
      const what = act.dataset.nw;
      if (what === 'markall') { nw.read = markRead(code, nw.items.map(i => i.id)); newsBadge(); rerender(); return; }
      if (what === 'del') { await removePosts([act.dataset.del], 'Post deleted.'); return; }
      if (what === 'clear') { const ids = nw.items.filter(i => clearable(i, nw)).map(i => i.id); await removePosts(ids, ids.length === 1 ? 'Post deleted.' : `${ids.length} posts deleted.`); return; }
      if (what === 'undo' && nw.toast) {
        const { ids } = nw.toast; nw.toast = null;
        await restorePosts(ids); nw.items = inboxItems(season, nw.sbNews, code); newsBadge(); rerender(); return;
      }
      if (what === 'rx') {
        const target = act.dataset.rx, r = nw.reactions.get(target) || { counts: {}, mine: null };
        try {
          const next = await setReaction(target, act.dataset.e, r.mine);
          if (r.mine) r.counts[r.mine] = Math.max(0, (r.counts[r.mine] || 1) - 1);
          if (next) r.counts[next] = (r.counts[next] || 0) + 1;
          r.mine = next; nw.reactions.set(target, r); rerender();
        } catch { /* leave the buttons as they were */ }
        return;
      }
    }
    const menuBtn = e.target.closest('[data-twmenu]'), twPick = e.target.closest('[data-tw]');
    if (menuBtn) { const menu = menuBtn.nextElementSibling, open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); if (open) (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild)?.focus(); return; }
    if (twPick) {
      const dir = twPick.dataset.dir;
      twWeek = Number(twPick.dataset.tw); rerender();
      (dir && main.querySelector(`.tw-arrow[data-dir="${dir}"]`) || main.querySelector('[data-twmenu]'))?.focus({ preventScroll: true });   // focus stays where the person was
      return;
    }
    const step = e.target.closest('[data-wround]');
    if (step) { widgetWeek = Number(step.dataset.wround); rerender(); main.querySelector('.fx-widget [data-wround]')?.focus({ preventScroll: true }); return; }
    const pill = e.target.closest('[data-tfilter]'), all = e.target.closest('[data-reveal-all]'), go2 = e.target.closest('[data-fxgo]');
    if (go2?.getAttribute('href')) { e.preventDefault(); go(go2.getAttribute('href')); return; }   // week, round, club and view changes replace the entry, so Back leaves the tab
    if (!pill && !all) return;
    if (pill) tableFilter = pill.dataset.tfilter;
    if (all) await revealScore(season.fixtures.filter(f => f.result && spoilerHidden(f, season, tableNow())).map(f => f.id)).catch(() => {});
    const el = current?.[0] === 'overview' ? main.querySelector('.lg-table') : null, before = el && pill ? rowTops(el) : null;
    rerender();
    if (pill) {
      const fresh = main.querySelector('.lg-table');
      fresh?.querySelector(`[data-tfilter="${tableFilter}"]`)?.focus();
      if (fresh && before) reshuffle(fresh, before);
    }
  });
  // The round menu closes on Escape, a tap elsewhere or a scroll, and the arrow keys move through it.
  const closeTw = () => main.querySelectorAll('.tw-menu:not([hidden])').forEach(m => { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  document.addEventListener('click', e => { if (!e.target.closest('.tw-pick')) closeTw(); });
  addEventListener('scroll', closeTw, { passive: true });
  document.addEventListener('keydown', e => {
    const menu = main.querySelector('.tw-menu:not([hidden])');
    if (!menu) return;
    if (e.key === 'Escape') { closeTw(); main.querySelector('[data-twmenu]')?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  // A live match moves on its own: the Fixtures tab redraws every 15 seconds while one is showing.
  setInterval(() => { if (!document.hidden && ['fixtures', 'overview'].includes(current?.[0]) && main.querySelector('.fx-row.is-live')) rerender(true); }, 15000);

  const VIEWS = {
    overview: () => SKELETON,   // filled slot by slot (showOverview, patchOverview)
    fixtures: sub => fixturesHtml(sub),
    stats,
    seasons: seasonsHtml,
    news: newsHtmlNow,
    draft: () => '',   // mounted by showDraft
  };

  wireStatPage(main, { go });
  const draftNow = await openDraft().catch(() => null);
  frameApi = mountFrame(document.getElementById('frame'), {
    office,
    draft: Boolean(draftNow), draftLive: Boolean(draftNow) && draftPhase(draftNow) === 'live',
    crest: preview ? params.get('crest') || '' : ctx.club?.crest_path ? crestUrl(ctx.club.crest_path) : '',
    // Each view gets the season picked in the header (WR-05); they all show the current one until a past season exists.
    onTab: (id, picked, sub) => {
      const left = current?.[0];
      current = [id, picked, sub];
      if (left === 'draft' && id !== 'draft') { draftApi?.unmount(); draftApi = null; }
      if (id === 'overview') showOverview(); else if (id === 'draft') showDraft(sub); else draw(VIEWS[id](sub, picked));
      // "Back" on a full list returns to the tab it was opened from (Overview or Stats), else to the Stats tab.
      main.querySelector('.sp-back')?.addEventListener('click', e => { if (moved) { e.preventDefault(); history.back(); } });
    },
  });
  if (!preview) watchLineupDue(ctx.club?.code);
}
