// The league page's frame (website revamp, WR-03): the header card (crest, name, season, Club / Settings / Editor) and the
// row of tabs, modelled on FotMob's league page. Each tab has its own address (league.html#fixtures), so refresh, the back
// button and shared links land on the right tab.
//   mountFrame(el, { office, draft, crest, onTab }) -> draws the frame into el and calls onTab(id, season, sub) now, on every tab
//                                                 change and when another season is picked (WR-05). A tab address can carry
//                                                 a part after a slash, league.html#stats/scorers: that is `sub` (WR-10)
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

export function mountFrame(el, { office = false, draft = false, crest = '', onTab } = {}) {
  const tabs = TABS.filter(t => !t.when || t.when({ draft }));
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
      <div class="lg-tabs-in">${tabs.map(t => `<a href="#${t.id}" data-tab="${t.id}">${esc(t.label)}${t.id === 'draft' ? ' <i class="lg-live">Live</i>' : ''}</a>`).join('')}
        <span class="lg-bar" aria-hidden="true"></span></div>
    </nav>`;
  // The phone's tab bar, fixed to the bottom of the screen (css/league-page.css shows it under 768 px and hides the row above).
  // It lives in the body, not the header card, so nothing clips it.
  const bottom = document.createElement('nav');
  bottom.className = 'lg-bottom';
  bottom.setAttribute('aria-label', 'League');
  bottom.innerHTML = tabs.map(t => `<a href="#${t.id}" data-tab="${t.id}"><span class="lg-bi">${icon(t.icon)}${t.id === 'draft' ? '<i class="lg-live-dot" title="Live"></i>' : ''}</span><span class="lg-bl">${esc(t.label)}</span></a>`).join('');
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
  const show = animate => {
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
  let shown = here();
  addEventListener('hashchange', () => {
    const now = here();
    show(true);
    if (now.id !== shown.id || now.sub.split('/')[0] !== shown.sub.split('/')[0]) scrollTo(0, 0);
    shown = now;
  });
  addEventListener('resize', relayout);
  document.fonts?.ready.then(relayout);
  show(false);
}
