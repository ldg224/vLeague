// The league page's frame (website revamp, WR-03): the header card (crest, name, season, Club / Settings / Editor) and the
// row of tabs, modelled on FotMob's league page. Each tab has its own address (league.html#fixtures), so refresh, the back
// button and shared links land on the right tab.
//   mountFrame(el, { office, draft, crest, onTab }) -> draws the frame into el and calls onTab(id, season) now, on every tab
//                                                 change and when another season is picked (WR-05)
//   SEASONS                                    -> the seasons the toggle offers, newest first; the first is the current one
//   TABS                                       -> the tabs in order
import { esc } from './member.js';
import { icon } from './icons.js';

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'stats', label: 'Stats' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'news', label: 'News' },
  { id: 'draft', label: 'Draft', when: o => o.draft },
];

// Every tab reads the season it's given, so a past season only needs adding here (fixtures have no season column yet:
// everything in the database is the current season).
export const SEASONS = [{ id: 1, label: 'Season 1' }];

export function mountFrame(el, { office = false, draft = false, crest = '', onTab } = {}) {
  const tabs = TABS.filter(t => !t.when || t.when({ draft }));
  el.innerHTML = `<div class="lg-head">
      <div class="lg-id">
        <img class="lg-crest" src="assets/brand/crest.svg" alt="">
        <div class="lg-name">
          <h1 class="lg-title">v<b>LEAGUE</b></h1>
          <label class="lg-season"><select aria-label="Season">${SEASONS.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>${icon('chevron-down')}</label>
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
    onTab?.(id, season);
  };
  let season = SEASONS[0];
  el.querySelector('.lg-season select').addEventListener('change', e => {
    season = SEASONS.find(s => String(s.id) === e.target.value);
    onTab?.(current(), season);
  });
  const relayout = () => place(strip.querySelector('[aria-current]'), false);
  addEventListener('hashchange', () => show(true));
  addEventListener('resize', relayout);
  document.fonts?.ready.then(relayout);
  show(false);
}
