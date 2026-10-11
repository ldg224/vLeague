// The league page's frame (website revamp, WR-03): the header card (crest, name, season, Club / Settings / Editor) and the
// row of tabs, modelled on FotMob's league page. Each tab has its own address (league.html#table), so refresh, the back
// button and shared links land on the right tab.
//   mountFrame(el, { office, draft, onTab })  -> draws the frame into el and calls onTab(id) now and on every change
//   TABS                                       -> the tabs in order
import { esc } from './member.js';
import { icon } from './icons.js';

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'table', label: 'Table' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'player-stats', label: 'Player stats' },
  { id: 'team-stats', label: 'Team stats' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'news', label: 'News' },
  { id: 'draft', label: 'Draft', when: o => o.draft },
];

// One season for now (WR-05 makes this a real choice).
const SEASON = 'Season 1';

export function mountFrame(el, { office = false, draft = false, onTab } = {}) {
  const tabs = TABS.filter(t => !t.when || t.when({ draft }));
  el.innerHTML = `<div class="lg-head">
      <div class="lg-id">
        <img class="lg-crest" src="assets/brand/crest.svg" alt="">
        <div class="lg-name">
          <h1 class="lg-title">v<b>LEAGUE</b></h1>
          <button type="button" class="lg-season" aria-label="Season: ${esc(SEASON)}">${esc(SEASON)}${icon('chevron-down')}</button>
        </div>
      </div>
      <nav class="lg-tools" aria-label="Your club and account">
        <a class="lg-tool is-club" href="club.html">${icon('shield')}<span>Club</span></a>
        <a class="lg-tool" href="settings.html">${icon('settings-2')}<span>Settings</span></a>
        ${office ? `<a class="lg-tool" href="editor.html">${icon('pencil')}<span>Editor</span></a>` : ''}
      </nav>
    </div>
    <nav class="lg-tabs" aria-label="League">
      <div class="lg-tabs-in">${tabs.map(t => `<a href="#${t.id}" data-tab="${t.id}">${esc(t.label)}${t.id === 'draft' ? ' <i class="lg-live">Live</i>' : ''}</a>`).join('')}
        <span class="lg-bar" aria-hidden="true"></span></div>
    </nav>`;

  const strip = el.querySelector('.lg-tabs-in'), bar = el.querySelector('.lg-bar');
  const current = () => {
    const id = location.hash.slice(1);
    return tabs.some(t => t.id === id) ? id : tabs[0].id;
  };
  // The underline sits under the active tab and slides to the next one you pick (no slide on first paint).
  const place = (link, animate) => {
    bar.classList.toggle('still', !animate);
    bar.style.width = `${link.offsetWidth}px`;
    bar.style.transform = `translateX(${link.offsetLeft}px)`;
  };
  const show = animate => {
    const id = current();
    let active = null;
    for (const a of strip.querySelectorAll('a')) {
      const on = a.dataset.tab === id;
      if (on) { a.setAttribute('aria-current', 'page'); active = a; } else a.removeAttribute('aria-current');
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
    onTab?.(id);
  };
  addEventListener('hashchange', () => show(true));
  addEventListener('resize', () => place(strip.querySelector('[aria-current]'), false));
  document.fonts?.ready.then(() => place(strip.querySelector('[aria-current]'), false));
  show(false);
}
