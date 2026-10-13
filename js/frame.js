// The league page's frame (website revamp, WR-03): the header card (crest, name, season, Club / Settings / Editor) and the
// row of tabs, modelled on FotMob's league page. Each tab has its own address (league.html#fixtures), so refresh, the back
// button and shared links land on the right tab.
//   mountFrame(el, { office, draft, crest, onTab }) -> draws the frame into el and calls onTab(id, season, sub) now, on every tab
//                                                 change and when another season is picked (WR-05). A tab address can carry
//                                                 a part after a slash, league.html#stats/scorers: that is `sub` (WR-10)
//   draft / draftLive: the Draft tab shows only while a draft is visible (draft), with a Live marker while picks are being made (draftLive);
//   mountFrame returns { setDraft({ visible, live }), setBadge(tabId, n) }: a small count on a tab (the News tab's unread posts); 0 or less removes it
//   mountSubFrame(el, { office, crest, here, title }) -> the same header card for the pages behind the header buttons (My club, Settings, Kits):
//                                                 the Club or Settings button is the current one (here: 'club' | 'settings'), and a row with a way back to
//                                                 the league replaces the tabs
//   SEASONS                                    -> the seasons the toggle offers, newest first; the first is the current one
//   TABS                                       -> the tabs in order. Wide screens show them in a row under the header; on a phone
//                                                 (under 768 px) the same tabs are a bar fixed to the bottom, with icons
import { esc } from './member.js';
import { icon } from './icons.js';

export const TABS = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'fixtures', label: 'Fixtures', icon: 'calendar-days' },
  { id: 'stats', label: 'Stats', icon: 'chart-column' },
  { id: 'seasons', label: 'Seasons', icon: 'trophy' },
  { id: 'news', label: 'News', icon: 'newspaper' },
  { id: 'draft', label: 'Draft', icon: 'list-ordered', when: o => o.draft },
];

// Every tab reads the season it's given, so a past season only needs adding here (fixtures have no season column yet:
// everything in the database is the current season).
export const SEASONS = [{ id: 1, label: 'Season 1', live: true }];
// A season still being played gets a small "In progress" marker; a finished one shows nothing extra.
const status = s => s.live ? '<span class="lg-season-live">In progress</span>' : '';

export function mountFrame(el, { office = false, draft = false, draftLive = false, crest = '', onTab } = {}) {
  let tabs = TABS.filter(t => !t.when || t.when({ draft })), live = draftLive;
  const topLink = t => `<a href="#${t.id}" data-tab="${t.id}">${esc(t.label)}${t.id === 'draft' && live ? ' <i class="lg-live">Live</i>' : ''}</a>`;
  const bottomLink = t => `<a href="#${t.id}" data-tab="${t.id}"><span class="lg-bi">${icon(t.icon)}${t.id === 'draft' && live ? '<i class="lg-live-dot" title="Live"></i>' : ''}</span><span class="lg-bl">${esc(t.label)}</span></a>`;
  el.innerHTML = `<div class="lg-head">
      <div class="lg-id">
        <img class="lg-crest" src="assets/brand/crest.svg" alt="">
        <div class="lg-name">
          <h1 class="lg-title">v<b>LEAGUE</b></h1>
          <div class="lg-season">
            <button type="button" class="lg-season-btn" aria-haspopup="menu" aria-expanded="false"></button>
            <div class="lg-season-menu" role="menu" hidden>
              <p class="lg-season-head">Seasons</p>
              ${SEASONS.map(s => `<button type="button" role="menuitemradio" data-season="${s.id}">
                <span class="lg-season-name">${esc(s.label)}</span>${status(s)}${icon('check')}</button>`).join('')}
              <a class="lg-season-all" href="#seasons" role="menuitem">All seasons${icon('chevron-right')}</a>
            </div>
          </div>
        </div>
      </div>
      <nav class="lg-tools" aria-label="Your club and account">
        <a class="lg-tool is-club" href="club.html">${crest ? `<img class="lg-tool-crest" src="${esc(crest)}" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(this.dataset.alt))" data-alt="${esc(icon('shield'))}">` : icon('shield')}<span>Club</span></a>
        <a class="lg-tool" href="settings.html">${icon('settings-2')}<span>Settings</span></a>
        ${office ? `<a class="lg-tool" href="editor.html">${icon('pencil')}<span>Editor</span></a>` : ''}
      </nav>
    </div>
    <nav class="lg-tabs" aria-label="League">
      <div class="lg-tabs-in">${tabs.map(topLink).join('')}
        <span class="lg-bar" aria-hidden="true"></span></div>
    </nav>`;
  // The phone's tab bar, fixed to the bottom of the screen (css/league-page.css shows it under 768 px and hides the row above).
  // It lives in the body, not the header card, so nothing clips it.
  const bottom = document.createElement('nav');
  bottom.className = 'lg-bottom';
  bottom.setAttribute('aria-label', 'League');
  bottom.innerHTML = tabs.map(bottomLink).join('');
  document.body.append(bottom);

  const strip = el.querySelector('.lg-tabs-in'), bar = el.querySelector('.lg-bar');
  const here = () => {
    const [id, ...rest] = location.hash.slice(1).split('/');
    return { id: tabs.some(t => t.id === id) ? id : tabs[0].id, sub: rest.join('/') };
  };
  // The underline sits under the active tab and slides to the next one you pick (no slide on first paint).
  const place = (link, animate) => {
    bar.classList.toggle('still', !animate);
    bar.style.width = `${link.offsetWidth}px`;
    bar.style.transform = `translateX(${link.offsetLeft}px)`;
  };
  // Mark the current tab (underline, aria-current, keeping it in view) without drawing its content.
  const mark = animate => {
    const { id, sub } = here();
    let active = null;
    for (const a of [...strip.querySelectorAll('a'), ...bottom.querySelectorAll('a')]) {
      const on = a.dataset.tab === id;
      if (on) { a.setAttribute('aria-current', 'page'); if (strip.contains(a)) active = a; } else a.removeAttribute('aria-current');
    }
    place(active, animate);
    // On a phone the row scrolls sideways: keep the active tab in view.
    // Only the tab row moves (never the page), and only when the tab is partly out of view.
    const nav = strip.parentElement, left = active.offsetLeft - 16, right = active.offsetLeft + active.offsetWidth + 16;
    const target = Math.max(0, Math.min(nav.scrollWidth - nav.clientWidth, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2));
    if ((left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) && Math.abs(target - nav.scrollLeft) > 1) {
      if (animate) nav.scrollTo({ left: target, behavior: 'smooth' }); else nav.scrollLeft = target;
    }
    return { id, sub };
  };
  const show = animate => {
    const { id, sub } = mark(animate);
    document.title = `${tabs.find(t => t.id === id).label} | vLeague`;
    onTab?.(id, season, sub);
  };
  // The Seasons toggle: a pill showing the chosen season, opening a small menu of every season.
  let season = SEASONS[0];
  const pill = el.querySelector('.lg-season-btn'), menu = el.querySelector('.lg-season-menu');
  document.body.append(menu);   // out of the header card, whose stacking would paint the tabs over the menu
  const paintSeason = () => {
    pill.innerHTML = `<span class="lg-season-name">${esc(season.label)}</span>${status(season)}${icon('chevron-down')}`;
    pill.setAttribute('aria-label', `Season: ${season.label}`);
    for (const b of menu.querySelectorAll('[data-season]')) b.setAttribute('aria-checked', String(b.dataset.season === String(season.id)));
  };
  const openMenu = open => {
    menu.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
    // Fixed to the screen under the pill: the header card clips anything that overflows it.
    if (open) {
      const r = pill.getBoundingClientRect();
      menu.style.top = `${r.bottom + 8}px`;
      menu.style.left = `${Math.max(12, Math.min(r.left, innerWidth - menu.offsetWidth - 12))}px`;
    }
    if (open) menu.querySelector('[aria-checked="true"]')?.focus();
  };
  pill.addEventListener('click', () => openMenu(menu.hidden));
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-season]');
    if (e.target.closest('a')) return openMenu(false);
    if (!b) return;
    openMenu(false);
    pill.focus();
    if (b.dataset.season === String(season.id)) return;
    season = SEASONS.find(s => String(s.id) === b.dataset.season);
    paintSeason();
    onTab?.(here().id, season, here().sub);
  });
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('[role^="menuitem"]')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); pill.focus(); } });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.lg-season, .lg-season-menu')) openMenu(false); });
  addEventListener('scroll', () => { if (!menu.hidden) openMenu(false); }, { passive: true });
  paintSeason();
  const relayout = () => place(strip.querySelector('[aria-current]'), false);
  // A new tab or a new stat starts at the top; switching position or season on the same stat page keeps your place.
  // Leaving a full stat list (Back, or the arrow in the browser) returns to where the page was scrolled before it was opened.
  let shown = here(), lastY = scrollY;
  const spots = new Map(), key = h => `${h.id}/${h.sub}`, isList = h => h.id === 'stats' && !['', 'team'].includes(h.sub.split('/')[0]);
  addEventListener('scroll', () => { lastY = scrollY; }, { passive: true });
  addEventListener('hashchange', () => {
    const now = here();
    spots.set(key(shown), lastY);
    show(true);
    if (isList(shown) && !isList(now) && spots.has(key(now))) {
      const y = spots.get(key(now));
      scrollTo(0, y);
      requestAnimationFrame(() => scrollTo(0, y));
    } else if (now.id !== shown.id || now.sub.split('/')[0] !== shown.sub.split('/')[0]) scrollTo(0, 0);
    lastY = scrollY;
    shown = now;
  });
  addEventListener('resize', relayout);
  document.fonts?.ready.then(relayout);
  show(false);
  // The Draft tab appears and disappears with the Editor's "visible" switch, and shows Live while picks can be made. Only the tab links are
  // rebuilt (the content on screen is left alone); the page decides what to do if the tab you are on has gone.
  const setDraft = ({ visible, live: nowLive }) => {
    const had = tabs.some(t => t.id === 'draft');
    if (had === visible && live === nowLive) return;
    live = nowLive;
    tabs = TABS.filter(t => !t.when || t.when({ draft: visible }));
    strip.querySelectorAll('a').forEach(a => a.remove());
    bar.before(...tabs.map(t => { const tpl = document.createElement('template'); tpl.innerHTML = topLink(t); return tpl.content.firstElementChild; }));
    bottom.innerHTML = tabs.map(bottomLink).join('');
    if (tabs.some(t => t.id === here().id)) mark(false);
    for (const [k, v] of Object.entries(badges)) setBadge(k, v);
  };
  const badges = {};   // kept so a rebuilt tab row can show them again
  const setBadge = (id, n) => {
    badges[id] = n;
    for (const a of [...strip.querySelectorAll('a'), ...bottom.querySelectorAll('a')]) {
      if (a.dataset.tab !== id) continue;
      a.querySelector('.lg-count')?.remove();
      if (n > 0) { const i = document.createElement('i'); i.className = 'lg-count'; i.textContent = n > 99 ? '99+' : String(n); i.setAttribute('aria-label', `${n} unread`); (a.querySelector('.lg-bi') || a).append(i); }
    }
    relayout();
  };
  return { setBadge, setDraft };
}

// The pages behind the header buttons (WR-26): the same header card as the league page, with the page's name where the season pill sits and a back link to
// the league in place of the tab row (which would make no sense here). The button of the page you are on is marked as current.
export function mountSubFrame(el, { office = false, crest = '', here = 'club', title = '', back = null } = {}) {   // back: { href, label } where the way back isn't the league (the match page: Matches)
  // The Editor has its own header (13 Oct 2026, the user): no Club and Settings buttons and no back row, just a back button and the page's name.
  if (here === 'editor') {
    el.innerHTML = `<div class="lg-head ed-hero">
      <a class="ed-back" href="league.html">${icon('arrow-left')}<span>League</span></a>
      <div class="ed-hero-id">
        <img class="ed-hero-crest" src="assets/brand/crest.svg" alt="">
        <div class="ed-hero-name"><p class="ed-hero-kicker">vLeague office</p><h1 class="ed-hero-title">Editor</h1></div>
      </div>
      <span class="ed-hero-ghost" aria-hidden="true">vLeague</span>
    </div>`;
    return;
  }
  const tool = (id, href, inner, extra = '') => `<a class="lg-tool${extra}" href="${href}"${here === id ? ' aria-current="page"' : ''}>${inner}</a>`;
  el.innerHTML = `<div class="lg-head">
      <div class="lg-id">
        <img class="lg-crest" src="assets/brand/crest.svg" alt="">
        <div class="lg-name">
          <h1 class="lg-title">v<b>LEAGUE</b></h1>
          ${title ? `<p class="lg-page">${esc(title)}</p>` : ''}
        </div>
      </div>
      <nav class="lg-tools" aria-label="Your club and account">
        ${tool('club', 'club.html', `${crest ? `<img class="lg-tool-crest" src="${esc(crest)}" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(this.dataset.alt))" data-alt="${esc(icon('shield'))}">` : icon('shield')}<span>Club</span>`, ' is-club')}
        ${tool('settings', 'settings.html', `${icon('settings-2')}<span>Settings</span>`)}
        ${office ? tool('editor', 'editor.html', `${icon('pencil')}<span>Editor</span>`) : ''}
      </nav>
    </div>
    <nav class="lg-backbar" aria-label="Back"><a class="lg-backlink" href="${esc(back?.href || 'league.html')}">${icon('arrow-left')}<span>${esc(back?.label || 'League')}</span></a></nav>`;
}
