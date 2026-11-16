// The Office notice on the league page's Overview (16 Nov 2026, the user: "a popup on the overview page saying trade requests and stuff").
// A small floating card in the corner listing what a manager should know from the Office: trade offers waiting for them, answers to their own offers
// (accepted, rejected, countered) and the transfer window being open. Each thing shows once: closing the card, or opening the Office from it,
// remembers what was seen (in this browser), and the card only comes back when there is something new. It lives outside the page's views,
// so the page's own redraws never touch it. Nothing here can change anything; it only reads.
//   alertItems({ incoming, answered, window }, nameOf) -> [{ key, text, kind }]   (pure, tested)
//   mountOfficeAlert({ club, nameOf, data? })   data: made-up rows for the localhost preview
import { db } from './auth.js';
import { esc } from './member.js';
import { icon } from './icons.js';
import { windowFromSettings, windowText } from './office-model.js';

const KEY = 'vl-office-seen';
const ANSWER = { accepted: 'accepted your trade offer', rejected: 'turned down your trade offer', countered: 'answered your offer with a counter-offer' };

export function alertItems({ incoming = [], answered = [], window = null } = {}, nameOf = c => c) {
  const items = [];
  for (const o of incoming) items.push({ key: `in:${o.id}`, kind: 'in', text: `<b>${esc(nameOf(o.from_club))}</b> sent you a trade offer` });
  for (const o of answered) if (ANSWER[o.status]) items.push({ key: `ans:${o.id}:${o.status}`, kind: o.status, text: `<b>${esc(nameOf(o.to_club))}</b> ${ANSWER[o.status]}` });
  if (window?.status === 'open') items.push({ key: `win:${window.closes_at || 'open'}`, kind: 'window', text: `<b>Transfer window open.</b> ${esc(windowText(window).replace(/^Window open,?\s*/, '').replace(/^closes/, 'Closes'))}`.trim() });
  return items;
}

const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const remember = keys => { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), ...keys])].slice(-200))); } catch { /* storage blocked: it shows again next visit */ } };

async function load(club) {
  const c = await db();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();   // answers from the last fortnight
  const [inc, ans, set] = await Promise.all([
    c.from('office_offers').select('id, from_club, created_at').eq('to_club', club).eq('status', 'pending').order('created_at'),
    c.from('office_offers').select('id, to_club, status, decided_at').eq('from_club', club).in('status', ['accepted', 'rejected', 'countered']).gte('decided_at', since).order('decided_at'),
    c.from('office_settings').select('window_open, opens_at, closes_at').eq('id', 1).maybeSingle(),
  ]);
  if (inc.error && ans.error) return null;   // the Office isn't there (or can't be read): no notice
  return { incoming: inc.data || [], answered: ans.data || [], window: set.data ? windowFromSettings(set.data) : null };
}

export async function mountOfficeAlert({ club, nameOf = c => c, data = null } = {}) {
  if (!club) return;
  let d = data;
  if (!d) { try { d = await load(club); } catch { return; } }
  if (!d) return;
  const items = alertItems(d, nameOf), old = seen(), fresh = items.filter(i => !old.has(i.key));
  if (!fresh.length) return;
  const offers = d.incoming.length;
  const el = document.createElement('aside');
  el.className = 'oa';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'oa-h');
  el.innerHTML = `<div class="oa-head"><span class="oa-ic" aria-hidden="true">${icon('briefcase')}</span><h2 id="oa-h">From the Office</h2>
      <button type="button" class="oa-x" data-oa="close" aria-label="Close">${icon('x')}</button></div>
    <ul class="oa-list">${items.map(i => `<li class="is-${i.kind}${old.has(i.key) ? '' : ' is-new'}">${i.text}</li>`).join('')}</ul>
    <a class="oa-go" data-oa="go" href="office.html${offers ? '#trade' : ''}">${offers ? `See ${offers === 1 ? 'the offer' : `${offers} offers`}` : 'Open the Office'}</a>`;
  const close = () => { remember(items.map(i => i.key)); el.remove(); removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', e => { const a = e.target.closest('[data-oa]'); if (!a) return; if (a.dataset.oa === 'close') close(); else remember(items.map(i => i.key)); });
  addEventListener('keydown', onKey);
  (document.querySelector('.lg') || document.body).append(el);   // inside .lg, where the type sizes and the club's theme colour are set
}
