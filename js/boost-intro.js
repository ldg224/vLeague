// Boosted captain's entrance (S-33, the user's idea, 4 Nov 2026): when a match's line-ups show a boosted captain, a gradient C grows to fill the screen over
// "BOOSTED CAPTAIN" and the player's name, then flies down and lands on the C beside his name on the pitch.
//   boostSides(L, players, clubName) -> [{ side, code, player, club }]: the boosted captains in these line-ups (loadLineups' result), home first
//   playBoostIntro(fixtureId, sides) -> plays each one every time the page is opened (the user, 4 Nov 2026), once per page load, so a redraw or a live tick doesn't start it again. A tap or Esc skips. Nothing plays with reduced motion on, or while the tab is hidden.
// It is a layer of its own on <body>, so a redraw of the page underneath can't break it (js/paint.js); the mark it lands on is looked up at the moment it flies.
const played = new Set();

export function boostSides(L, players, clubName) {
  return ['home', 'away'].flatMap(side => {
    const sheet = L?.[side]?.sheet;
    if (!sheet?.boost || sheet.captain == null) return [];
    const p = (players || []).find(x => String(x.id) === String(sheet.captain));
    return p ? [{ side, code: sheet.club, player: p.name, club: clubName(sheet.club) || '' }] : [];
  });
}

// The middle of a curve from a to b that rises towards the top of the screen first, as a thrown thing does. t is 0 to 1.
export const arcPoint = (a, b, t) => {
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 120 }, u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

const OUT = 'cubic-bezier(.16, 1, .3, 1)', BACK = 'cubic-bezier(.34, 1.56, .64, 1)';
let running = false;

export function playBoostIntro(fixtureId, sides) {
  if (running || !sides?.length || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const todo = sides.filter(s => !played.has(`${fixtureId}:${s.code}`));
  if (!todo.length) return;
  running = true;
  todo.forEach(s => played.add(`${fixtureId}:${s.code}`));
  for (const s of todo) document.body.classList.add(`bi-wait-${s.side}`);   // the mark stays empty until the C lands on it

  const root = document.createElement('div');
  root.className = 'bi';
  root.innerHTML = `<div class="bi-back"></div><p class="bi-say" role="status"></p>
    <div class="bi-stage"><i class="bi-wave"></i><i class="bi-wave"></i><div class="bi-disc"><i class="bi-ring"></i><i class="bi-core"></i><b>C</b></div></div>
    <div class="bi-words" aria-hidden="true"><strong>Boosted captain</strong><span></span></div>`;
  document.body.append(root);
  const $ = c => root.querySelector(c), live = new Set();
  const anim = (el, frames, options) => { const a = el.animate(frames, { fill: 'both', ...options }); live.add(a); a.finished.catch(() => {}).finally(() => live.delete(a)); return a; };

  let stopped = false;
  const finish = () => {
    if (!running) return;
    stopped = true; running = false;
    document.removeEventListener('keydown', onKey, true);
    live.forEach(a => a.cancel());
    root.remove();
    for (const s of ['home', 'away']) document.body.classList.remove(`bi-wait-${s}`);
  };
  const onKey = e => { if (e.key === 'Escape') finish(); };
  root.addEventListener('pointerdown', finish);
  document.addEventListener('keydown', onKey, true);

  const entrance = async (s, first) => {
    const disc = $('.bi-disc'), words = $('.bi-words'), title = $('.bi-words strong'), who = $('.bi-words span');
    root.getAnimations({ subtree: true }).forEach(a => a.cancel());   // the last captain's animations hold their end state, even once finished, so a second one starts clean
    $('.bi-say').textContent = `Boosted captain: ${s.player}, ${s.club}`;
    who.textContent = s.club ? `${s.player} · ${s.club}` : s.player;
    anim($('.bi-back'), [{ opacity: 0 }, { opacity: 1 }], { duration: first ? 350 : 250, easing: 'ease-out' });
    // The small C grows until it fills the screen, with waves of light going out behind it.
    anim(disc, [{ transform: 'scale(.08) rotate(-200deg)', opacity: 0 }, { opacity: 1, offset: .2 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { duration: 850, easing: BACK });
    anim($('.bi-ring'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1600, easing: 'linear', iterations: Infinity, fill: 'none' });
    root.querySelectorAll('.bi-wave').forEach((w, i) => anim(w, [{ transform: 'scale(.3)', opacity: .8 }, { transform: 'scale(2.1)', opacity: 0 }], { duration: 1200, delay: 420 + i * 240, easing: 'ease-out' }));
    anim(words, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 480, easing: OUT });
    anim(title, [{ letterSpacing: '.28em', clipPath: 'inset(0 50% 0 50%)' }, { letterSpacing: '.01em', clipPath: 'inset(0 -5% 0 -5%)' }], { duration: 620, delay: 480, easing: OUT });
    await anim(who, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 880, easing: 'ease-out' }).finished;
    await new Promise(r => setTimeout(r, 850));
    if (stopped) return;

    // Find the player's mark, bringing it into view under the dark layer if it is off the screen.
    const selector = `.ml-p.is-${s.side}.is-boosted .mk-cap.is-boost`;
    const mark = document.querySelector(selector);
    if (mark) {
      const box = mark.getBoundingClientRect();
      if (box.top < 60 || box.bottom > innerHeight - 60) mark.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    const to = document.querySelector(selector)?.getBoundingClientRect();
    anim(words, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 240, easing: 'ease-in' });
    anim($('.bi-back'), [{ opacity: 1 }, { opacity: 0 }], { duration: 650, delay: 260, easing: 'ease-in' });
    if (!to || !to.width) {   // the mark isn't on the page (a phone that hasn't laid out, a changed tab): just let the C fade away
      await anim(disc, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 320 }).finished;
      document.body.classList.remove(`bi-wait-${s.side}`);
      return;
    }

    // The flight: up and over, shrinking down to the size of the mark, spinning once, and the dark middle clearing to the mark's gradient.
    const from = disc.getBoundingClientRect(), a = { x: from.left + from.width / 2, y: from.top + from.height / 2 }, b = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
    const end = to.width / disc.offsetWidth, frames = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, p = arcPoint(a, b, t * t * (3 - 2 * t));
      frames.push({ transform: `translate(${p.x - a.x}px, ${p.y - a.y}px) rotate(${360 * t}deg) scale(${1 + (end - 1) * (t * t)})` });
    }
    anim($('.bi-core'), [{ opacity: 1 }, { opacity: 1, offset: .55 }, { opacity: 0 }], { duration: 820 });
    await anim(disc, frames, { duration: 820, easing: 'linear' }).finished;
    if (stopped) return;

    // It lands: the real mark takes over and a burst of light goes out from it.
    document.body.classList.remove(`bi-wait-${s.side}`);
    const burst = document.createElement('i');
    burst.className = 'bi-burst';
    Object.assign(burst.style, { left: `${b.x}px`, top: `${b.y}px` });
    root.append(burst);
    anim(disc, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
    await anim(burst, [{ transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%, -50%) scale(5)', opacity: 0 }], { duration: 620, easing: 'ease-out' }).finished;
    burst.remove();
  };

  (async () => {
    for (let i = 0; i < todo.length && !stopped; i++) await entrance(todo[i], i === 0);
  })().catch(() => {}).finally(finish);
}
