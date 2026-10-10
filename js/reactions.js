// Live reactions (S-20A, 0.57.0): while a match is live, anyone watching the Game centre (guests too) can tap a few reactions and
// everyone watching sees them float up the side. Sent over a Supabase Realtime broadcast channel, one per match: nothing is stored,
// no database change, no chat. Each person is limited to a few taps a second; the screen never shows more than a handful at once.
import { db } from './auth.js';

const SET = [['❤️', 'Love it'], ['🔥', 'Fire'], ['👏', 'Applause'], ['⚽', 'Goal'], ['😮', 'Wow']];
const MAX_FLOATING = 24, MIN_GAP = 250;
let box = null, channel = null, fixture = null, lastSent = 0;

function float(emoji) {
  if (!box || document.hidden || box.querySelectorAll('.lr-fly').length >= MAX_FLOATING) return;
  if (document.documentElement.classList.contains('reduce-motion')) return;
  const el = document.createElement('span');
  el.className = 'lr-fly'; el.textContent = emoji; el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--x', `${Math.round(Math.random() * 40 - 20)}px`);
  el.style.setProperty('--d', `${2.4 + Math.random() * 1.2}s`);
  box.querySelector('.lr-sky').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

async function connect() {
  try {
    channel = (await db()).channel(`reactions-${fixture}`, { config: { broadcast: { self: true } } })
      .on('broadcast', { event: 'react' }, ({ payload }) => { const e = SET.find(s => s[0] === payload?.e); if (e) float(e[0]); })
      .subscribe();
  } catch { channel = null; }   // the buttons still float your own reaction
}

// Call with the match id and whether it is live; the bar appears while live and goes away afterwards.
export function liveReactions(id, isLive) {
  if (!isLive) { if (box) { box.remove(); box = null; channel?.unsubscribe?.(); channel = null; } return; }
  if (box && fixture === id) return;
  fixture = String(id);
  box = document.createElement('aside');
  box.className = 'lr'; box.setAttribute('aria-label', 'Live reactions');
  box.innerHTML = `<div class="lr-sky" aria-hidden="true"></div><div class="lr-bar" role="group" aria-label="React to the match">${SET.map(([e, n]) => `<button type="button" data-e="${e}" aria-label="${n}">${e}</button>`).join('')}</div>`;
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-e]');
    if (!b || Date.now() - lastSent < MIN_GAP) return;
    lastSent = Date.now();
    if (channel) channel.send({ type: 'broadcast', event: 'react', payload: { e: b.dataset.e } }).catch?.(() => float(b.dataset.e));
    else float(b.dataset.e);
  });
  document.body.appendChild(box);
  connect();
}
