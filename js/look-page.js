// An event's look on a whole page (the match page). Two layers, neither touching the page's contents:
//   - behind the cards, above the contour lines (.lg::before): what the look spills (confetti, snow...) and any fireworks, in a canvas fixed to the screen
//   - in the bottom corners, in front of the cards but never in the way of a tap: the look's props (the tree and presents, the kangaroo, the trophy), with the tree's lights flashing
//   startPageLook(look, theme, { paused }) : paused() says to hold still for now (a video is playing: see .mp-watching in css/match.css).
// Still when reduced motion is on. Stops drawing by itself while the tab is hidden (requestAnimationFrame does).
import { spillOf, pageSpillInk, SCENES } from './looks.js';
import { drawPageSpill, drawFireworks } from './viewer/look-canvas.js';

const FRAME_MS = 1000 / 30;

// On assets/looks/christmas_tree.png (fractions of the picture): its baubles, some more among the branches, and the star.
const TREE_LIGHTS = [[0.525, 0.34], [0.375, 0.49], [0.59, 0.525], [0.35, 0.75], [0.5, 0.685], [0.685, 0.75], [0.44, 0.42], [0.61, 0.42], [0.47, 0.56], [0.67, 0.61], [0.33, 0.62], [0.42, 0.8], [0.58, 0.8]];
const BULBS = ['#ff3b3b', '#ffd23f', '#3bff7a', '#3bb6ff', '#ff5ad1', '#ffffff'];

function drawTreeLights(c, size, t) {
  c.clearRect(0, 0, size, size);
  TREE_LIGHTS.forEach(([x, y], i) => {
    const colour = BULBS[(i + Math.floor(t * 1.5 + i * 0.37)) % BULBS.length], flash = 0.5 + 0.5 * Math.sin(t * 5 + i * 1.3);
    c.save(); c.globalAlpha = 0.45 + 0.55 * flash; c.fillStyle = colour; c.shadowColor = colour; c.shadowBlur = size * (0.03 + 0.05 * flash);
    c.beginPath(); c.arc(x * size, y * size, size * 0.024, 0, Math.PI * 2); c.fill(); c.restore();
  });
}

function mountProps(props) {
  const box = document.createElement('div'), lit = [];
  box.className = 'lg-props'; box.setAttribute('aria-hidden', 'true');
  for (const p of props) {
    const place = `height:calc(${p.h}px * var(--prop, 1));width:calc(${p.h}px * var(--prop, 1));${p.side}:calc(${p.x}px * var(--prop, 1))`;
    const img = new Image(); img.src = `assets/looks/${p.src}.png`; img.alt = ''; img.className = 'lg-prop'; img.style.cssText = place;
    box.append(img);
    if (p.lights) { const cv = document.createElement('canvas'); cv.className = 'lg-prop'; cv.width = cv.height = 512; cv.style.cssText = place; box.append(cv); lit.push(cv.getContext('2d')); }
  }
  document.body.append(box);
  return lit;
}

export function startPageLook(look, theme, { paused = () => false } = {}) {
  const kind = spillOf(look), scene = SCENES[look.key] || {}, lit = mountProps(scene.props || []);
  const hasBack = Boolean(kind || scene.fireworks);
  if (!hasBack && !lit.length) return;
  let c = null, cv = null;
  const ink = pageSpillInk(look, theme), snow = theme === 'light' ? '#9db4c8' : '#ffffff';
  if (hasBack) {
    cv = document.createElement('canvas'); cv.className = 'lg-spill'; cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv); c = cv.getContext('2d');
  }
  const props = document.querySelector('.lg-props');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion') || document.documentElement.classList.contains('lite');   // lite mode (B-33): the event's confetti and props hold still
  let t = 3, last = 0;
  const draw = () => {
    if (c) {
      const k = Math.min(devicePixelRatio || 1, 1.5);
      c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, innerWidth, innerHeight);
      if (scene.fireworks && !still) drawFireworks(c, innerWidth, innerHeight, t, theme !== 'light');
      if (kind) drawPageSpill(c, innerWidth, innerHeight, kind, ink, t, snow);
    }
    for (const l of lit) drawTreeLights(l, 512, t);
    // Most of the page's background is behind the cards, so fireworks also go off in the header's own sky. Found each time: a redraw of the header makes a new canvas.
    const sky = scene.fireworks && !still ? document.querySelector('.mh-fire') : null;
    if (sky?.clientWidth) {
      const w = sky.clientWidth, h = sky.clientHeight, k = Math.min(devicePixelRatio || 1, 1.5);
      if (sky.width !== Math.round(w * k)) { sky.width = Math.round(w * k); sky.height = Math.round(h * k); }
      const s = sky.getContext('2d'); s.setTransform(k, 0, 0, k, 0, 0); s.clearRect(0, 0, w, h);
      drawFireworks(s, w, h, t + 0.8, true);
    }
  };
  const size = () => { if (cv) { const k = Math.min(devicePixelRatio || 1, 1.5); cv.width = innerWidth * k; cv.height = innerHeight * k; } draw(); };
  addEventListener('resize', size);
  size();
  if (still) return;
  const tick = now => {
    requestAnimationFrame(tick);
    const gap = now - last;
    if (gap < FRAME_MS) return;
    last = now;
    const hold = paused();
    if (props) props.style.visibility = hold ? 'hidden' : '';   // the props would stand in front of the picture while it plays
    if (hold || gap > 500) return;   // back from a pause or a hidden tab: carry on from where it was, no jump
    t += gap / 1000;
    draw();
  };
  requestAnimationFrame(tick);
}
