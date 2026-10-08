// The row of round buttons on League and Matches. It scrolls sideways on its own (swipe on a phone). Its scrollbar is hidden, so
// with a mouse there are ‹ › arrows (only shown when the rounds don't all fit) and the wheel over the row moves it too.
//   weekBar(buttonsHtml, label)     -> the markup: arrows around the tab row
//   wireWeekBar(main, savedScroll)  -> after drawing: restore or centre the scroll position, hook up the arrows and the wheel
//   weekBarArrow(main, e)           -> in a click handler: true if the click was an arrow (and it has moved the row)
export const weekBar = (buttonsHtml, label) => `<div class="weekbar"><button type="button" class="wk-arrow" data-wk="-1" aria-label="Earlier rounds">‹</button><div class="weektabs" role="tablist" aria-label="${label}">${buttonsHtml}</div><button type="button" class="wk-arrow" data-wk="1" aria-label="Later rounds">›</button></div>`;

export function wireWeekBar(main, saved) {
  const tabs = main.querySelector('.weektabs');
  if (!tabs) return;
  if (saved != null) tabs.scrollLeft = saved;
  else {
    const sel = tabs.querySelector('[aria-selected="true"]');
    if (sel) tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.offsetWidth) / 2;
  }
  const arrows = [...main.querySelectorAll('.wk-arrow')];
  const sync = () => {
    const over = tabs.scrollWidth > tabs.clientWidth + 1;
    arrows.forEach(a => { a.hidden = !over; });
    if (over) { arrows[0].disabled = tabs.scrollLeft <= 0; arrows[1].disabled = tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 1; }
  };
  tabs.addEventListener('scroll', sync, { passive: true });
  tabs.addEventListener('wheel', e => {
    if (tabs.scrollWidth <= tabs.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    tabs.scrollLeft += e.deltaY;
  }, { passive: false });
  sync();
}

export function weekBarArrow(main, e) {
  const arrow = e.target.closest('.wk-arrow');
  if (!arrow) return false;
  const tabs = main.querySelector('.weektabs');
  tabs?.scrollBy({ left: Number(arrow.dataset.wk) * tabs.clientWidth * 0.7, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return true;
}
