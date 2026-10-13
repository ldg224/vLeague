// The look of the cards on the league page and the pages behind its header buttons (My club, Settings, Kits): each card gets its own
// splash and its own point in the silk's slide, and the slow animations are pinned to the document's clock (so a redrawn card is exactly
// where the old one was). Moved out of js/league.js (WR-45) so every page that has these cards looks the same.
const SLOW = new Set(['lg-silk-slide', 'lg-silk-breathe', 'lg-splash', 'sc-shine']);
export const pinClock = () => { for (const a of document.getAnimations()) if (SLOW.has(a.animationName) && a.startTime !== 0) a.startTime = 0; };
export const sheen = root => {
  root.querySelectorAll('.lg-card:not([data-sheen])').forEach((c, i) => {
  let h = 2166136261;
  for (const ch of (c.dataset.silk ?? `${c.querySelector('h2')?.textContent || ''}${i}`)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;   // mix the bits so similar titles still land in different places
  const r = n => ((h >>> n) & 255) / 255;
  c.dataset.sheen = '';
  // The splash starts at one random spot and wanders to another, each card at its own speed and its own point on the way.
  c.style.setProperty('--gx0', `${Math.round(r(0) * 100)}%`);
  c.style.setProperty('--gy0', `${Math.round(r(8) * 100)}%`);
  c.style.setProperty('--gx1', `${Math.round(r(16) * 100)}%`);
  c.style.setProperty('--gy1', `${Math.round(r(24) * 100)}%`);
  const sd = 12 + Math.round(r(2) * 34);
  c.style.setProperty('--sd', `${sd}s`);
  c.style.setProperty('--sp', `${-Math.round(r(10) * 40)}s`);
  // The silk: its own point in the slide and the breathing (negative delays start it part-way through), flipped or not, and a staggered fade-in.
  c.style.setProperty('--fph', `${-Math.round(r(3) * 56)}s`);
  c.style.setProperty('--fph2', `${-Math.round(r(11) * 24)}s`);
  c.style.setProperty('--fsx', r(19) < .5 ? '1' : '-1');
  c.style.setProperty('--fsy', r(27) < .5 ? '1' : '-1');
  c.style.setProperty('--fdl', `${Math.round(r(13) * 600)}ms`);
  });
  pinClock();
};
