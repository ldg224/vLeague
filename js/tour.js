// Guided tour (0.26): darkens the page, cuts a glowing spotlight round one thing at a time and explains it in a card.
// startTour(steps, { key, before }) -> resolves when the tour closes.
//   step: { target?: selector | [selectors] (omit to centre the card), title, text: string | () => string, tab?: any, tip?: string }
//   before(step): called before each step is shown (the draft page uses it to switch tab); may be async.
// The tour re-finds its target every frame, so it survives the page redrawing itself. It remembers it was seen in
// localStorage ('vleague-tours'). Honours reduced motion (both the in-app setting and the OS one).
const SEEN = 'vleague-tours';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch { return {}; } },
  set(k) { try { localStorage.setItem(SEEN, JSON.stringify({ ...store.get(), [k]: 1 })); } catch { /* storage blocked */ } },
};
export const tourSeen = key => !!store.get()[key];

const PAD = 8, GAP = 14;
const el = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const reduced = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startTour(steps, { key, before } = {}) {
  if (document.querySelector('.tour')) return Promise.resolve();
  return new Promise(done => {
    const prevFocus = document.activeElement;
    const root = el('div', 'tour'), spot = el('div', 'tour-spot'), card = el('div', 'tour-card');
    root.append(spot, card);
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-live', 'polite');
    document.body.append(root);
    document.documentElement.classList.add('tour-open');

    let i = -1, gone = false, shown = null, box = null;
    const targets = s => [].concat(s.target || []).map(q => document.querySelector(q)).filter(Boolean);
    // One rectangle round every matching element, clipped to the screen.
    const rectOf = els => {
      if (!els.length) return null;
      let t = 1e9, l = 1e9, b = -1e9, r = -1e9;
      for (const e of els) { const k = e.getBoundingClientRect(); t = Math.min(t, k.top); l = Math.min(l, k.left); b = Math.max(b, k.bottom); r = Math.max(r, k.right); }
      t = Math.max(t - PAD, 6); l = Math.max(l - PAD, 6); b = Math.min(b + PAD, innerHeight - 6); r = Math.min(r + PAD, innerWidth - 6);
      return { top: t, left: l, width: Math.max(r - l, 24), height: Math.max(b - t, 24) };
    };

    function place() {
      if (gone) return;
      const s = steps[i]; if (!s) { frame = requestAnimationFrame(place); return; }
      const els = targets(s), want = rectOf(els);
      // Move the spotlight (a plain box; its huge shadow is the dark screen).
      if (want) {
        const n = JSON.stringify(want);
        if (n !== box) {
          box = n;
          Object.assign(spot.style, { top: `${want.top}px`, left: `${want.left}px`, width: `${want.width}px`, height: `${want.height}px` });
        }
        spot.classList.add('on'); spot.classList.remove('none');
      } else { spot.classList.remove('on'); spot.classList.add('none'); box = null; }
      // Put the card below the spotlight, or above it if there is no room. Centred when there's nothing to point at.
      const cw = card.offsetWidth, ch = card.offsetHeight, small = innerWidth < 640;
      let top, left;
      if (!want) { top = (innerHeight - ch) / 2; left = (innerWidth - cw) / 2; card.dataset.side = 'mid'; }
      else if (small) {
        left = (innerWidth - cw) / 2;
        const below = innerHeight - (want.top + want.height);
        top = below >= ch + GAP + 8 ? want.top + want.height + GAP : want.top >= ch + GAP + 8 ? want.top - ch - GAP : innerHeight - ch - 12;
        card.dataset.side = top > want.top ? 'below' : 'above';
      } else {
        const below = innerHeight - (want.top + want.height), above = want.top, right = innerWidth - (want.left + want.width), leftRoom = want.left;
        if (below >= ch + GAP + 8) { top = want.top + want.height + GAP; left = want.left + want.width / 2 - cw / 2; card.dataset.side = 'below'; }
        else if (above >= ch + GAP + 8) { top = want.top - ch - GAP; left = want.left + want.width / 2 - cw / 2; card.dataset.side = 'above'; }
        else if (right >= cw + GAP + 8) { left = want.left + want.width + GAP; top = want.top + want.height / 2 - ch / 2; card.dataset.side = 'right'; }
        else if (leftRoom >= cw + GAP + 8) { left = want.left - cw - GAP; top = want.top + want.height / 2 - ch / 2; card.dataset.side = 'left'; }
        else { top = innerHeight - ch - 16; left = (innerWidth - cw) / 2; card.dataset.side = 'mid'; }   // target fills the screen: card floats over it
      }
      left = Math.min(Math.max(left, 10), innerWidth - cw - 10); top = Math.min(Math.max(top, 10), innerHeight - ch - 10);
      card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      // The little pointer on the card points at the middle of the spotlight.
      if (want) card.style.setProperty('--arrow', `${Math.round(Math.min(Math.max(want.left + want.width / 2 - left, 22), cw - 22))}px`);
      frame = requestAnimationFrame(place);
    }
    let frame = requestAnimationFrame(place);

    async function show(n, dir = 1) {
      if (n < 0) return;
      if (n >= steps.length) return end(true);
      i = n; const s = steps[i];
      if (before) await before(s);
      // Skip a step whose target isn't on the page (for example "Pick" when it isn't your turn and there are no rows).
      if (s.target && !targets(s).length && s.optional) return show(n + dir, dir);
      const e = targets(s)[0];
      if (e) e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      const total = steps.length, text = typeof s.text === 'function' ? s.text() : s.text;
      card.classList.remove('in'); void card.offsetWidth;
      card.innerHTML = `<div class="tour-count">${i + 1} of ${total}</div>
        <h2 class="tour-title" tabindex="-1">${s.title}</h2><p class="tour-text">${text}</p>${s.tip ? `<p class="tour-tip">${s.tip}</p>` : ''}
        <div class="tour-dots" aria-hidden="true">${steps.map((_, k) => `<i class="${k === i ? 'now' : k < i ? 'was' : ''}"></i>`).join('')}</div>
        <div class="tour-btns"><button type="button" class="tour-skip" data-skip>${i === total - 1 ? '' : 'Skip tour'}</button>
          <span><button type="button" class="tour-back" data-back${i ? '' : ' hidden'}>Back</button><button type="button" class="tour-next" data-next>${i === total - 1 ? 'Got it' : 'Next'}</button></span></div>`;
      card.classList.add('in');
      card.querySelector('[data-next]').focus({ preventScroll: true });
    }

    function end(finished) {
      if (gone) return; gone = true;
      cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey, true);
      store.set(key || 'tour');
      root.classList.add('out');
      const rm = () => { root.remove(); document.documentElement.classList.remove('tour-open'); try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* gone */ } done(finished); };
      reduced() ? rm() : setTimeout(rm, 260);
    }

    card.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-next')) show(i + 1); else if (b.hasAttribute('data-back')) show(i - 1, -1); else if (b.hasAttribute('data-skip')) end(false);
    });
    root.addEventListener('click', e => { if (e.target === root || e.target === spot) card.querySelector('[data-next]')?.classList.add('nudge'), setTimeout(() => card.querySelector('[data-next]')?.classList.remove('nudge'), 500); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); end(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter' && !e.target.closest?.('button')) { e.preventDefault(); show(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1, -1); }
      else if (e.key === 'Tab') {   // keep keyboard focus inside the card
        const bs = [...card.querySelectorAll('button:not([hidden])')].filter(b => b.textContent.trim());
        if (!bs.length) return; const a = bs.indexOf(document.activeElement);
        if (e.shiftKey && a <= 0) { e.preventDefault(); bs[bs.length - 1].focus(); } else if (!e.shiftKey && a === bs.length - 1) { e.preventDefault(); bs[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    show(0);
  });
}
