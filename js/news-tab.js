// The News tab (WR-25): the old Inbox inside the league page's frame. This file only builds HTML from the tab's state (the page, js/league.js, loads the
// data and handles the clicks), so the tests can run it without a browser.
//
//   newsHtml(state, o)   the whole tab: one card, a title row with "Mark all read" and "Clear all", then the posts, each opening in place
//   state = { items (inboxItems), read: Set, reactions: Map, phone, toast: { text } | null, opened: Set of item ids, loading, code }
//   o     = { vars: { team, manager } }
// Looks: FotMob-style rows split by hairlines in one card; an unread post has a dot in the club colour and a bold title; a picture on a post
// shows big, the full width of the post. Buttons carry data-nw="..." (markall, clear, del, undo, rx) for the page's one click handler.
import { SUPABASE_URL } from './config.js';
import { markdown, inline, ago, day, time } from './places.js';
import { newsBody } from './news-card.js';
import { kickoff } from './dashboard-data.js';
import { icon, REACTION } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
const safeColour = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#64748b');
const crestUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/crests/${path}` : '');
export const EMOJI = ['👍', '🔥', '😂', '👏', '😮'];

// A post's deadline in words ({due}); due is local { date, time }, no time = end of that day.
function dueText(post) {
  const k = post.due?.date ? kickoff({ date: post.due.date, time: post.due.time || '23:59' }) : null;
  return k ? `${day(k).replace(/^(Today|Tomorrow|Yesterday)$/, m => m.toLowerCase())} at ${time(k)}` : 'the deadline';
}

// A post from the older season file (blocks of text and polls).
function seasonBody(post, vars) {
  const pv = { ...vars, due: dueText(post) };
  return (post.blocks || []).map(b => {
    if (b.type === 'embed') {
      const fields = (b.fields || []).filter(f => f.name || f.value).map(f => `<p><b>${inline(esc(f.name || ''))}</b><br>${inline(esc(f.value || ''))}</p>`).join('');
      return `${b.title && b !== post.blocks.find(x => x.type === 'embed') ? `<h3>${inline(esc(b.title))}</h3>` : ''}${markdown(b.description, pv)}${fields}`;
    }
    if (b.type === 'poll') return `<div class="poll">${b.question ? `<b>${esc(b.question)}</b>` : ''}<ul>${(b.options || []).map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>`;
    return '';
  }).join('');
}

const phoneForm = phone => `<form class="ph-form" novalidate>
    <label>Your phone number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="0412 345 678" value="${esc(phone)}"></label>
    <button class="nw-btn" type="submit">${phone ? 'Change' : 'Save'}</button>
    <p class="ph-msg" role="status">${phone ? 'Saved. The league office can see it.' : ''}</p></form>`;

// One row of reaction buttons. Pressing your own again takes it back.
const reactBar = (target, reactions) => {
  const r = reactions.get(target) || { counts: {}, mine: null };
  return `<div class="rx" role="group" aria-label="React">${EMOJI.map(e => `<button type="button" class="rx-b${r.mine === e ? ' on' : ''}" data-nw="rx" data-rx="${esc(target)}" data-e="${e}" aria-pressed="${r.mine === e}" aria-label="${REACTION[e].label}" title="${REACTION[e].label}">${icon(REACTION[e].name)}${r.counts[e] ? `<span>${r.counts[e]}</span>` : ''}</button>`).join('')}</div>`;
};

export function viewOf(i, st, vars) {
  if (i.src === 'sb') {
    const r = i.row, d = r.data || {};
    if (r.kind === 'crest_reveal') {
      const src = d.crest_path ? crestUrl(d.crest_path) : '';
      return { title: r.title, from: 'vLeague', body: `<div class="reveal" style="--rc:${esc(safeColour(d.colour))}">${src ? `<img src="${esc(src)}" alt="">` : ''}<b>${esc(d.name || '')}</b>${d.motto ? `<i>${esc(d.motto)}</i>` : ''}</div>${markdown(r.body, vars)}` };
    }
    return { title: r.title, from: 'vLeague', body: newsBody(r, vars) + (d.form === 'phone' ? phoneForm(st.phone) : '') + reactBar(`news:${r.id}`, st.reactions) };
  }
  const embed = (i.post.blocks || []).find(b => b.type === 'embed') || {};
  return { title: embed.title || embed.author?.name || 'League update', from: embed.author?.name || 'vLeague', body: seasonBody(i.post, vars) };
}

// The phone-number post can't be cleared until a number is saved.
export const clearable = (i, st) => !(i.src === 'sb' && i.row.data?.form === 'phone' && !st.phone);

export function newsHtml(st, o) {
  const items = st.items || [], unread = items.filter(i => !st.read.has(i.id)).length;
  const acts = `<span class="nw-acts">${unread ? '<button class="nw-btn" type="button" data-nw="markall">Mark all read</button>' : ''}${items.some(i => clearable(i, st)) ? '<button class="nw-btn" type="button" data-nw="clear">Clear all</button>' : ''}</span>`;
  const head = `<div class="lg-card-head"><h2>News</h2>${acts}</div>`;
  if (!st.code) return `<section class="lg-card nw" aria-label="News">${head}<div class="sc-empty"><b>No club yet</b><span>Your account isn’t linked to a club yet, so there is no news for it.</span></div></section>`;
  const toast = st.toast ? `<p class="nw-toast" role="status">${esc(st.toast.text)} <button type="button" class="nw-undo" data-nw="undo">Undo</button></p>` : '';
  const list = items.length ? `<ul class="nw-list">${items.map(i => {
    const v = viewOf(i, st, o.vars), isNew = !st.read.has(i.id);
    const meta = [v.from !== 'vLeague' && esc(v.from), i.at && esc(ago(i.at))].filter(Boolean).join(' · ');
    return `<li>${clearable(i, st) ? `<button type="button" class="nw-del" data-nw="del" data-del="${esc(i.id)}" aria-label="Delete “${esc(v.title)}”" title="Delete">${icon('x')}</button>` : ''}`
      + `<details class="nw-post${isNew ? ' new' : ''}" data-id="${esc(i.id)}"${st.opened?.has(i.id) ? ' open' : ''}><summary><span class="dot" aria-hidden="true"></span><span class="nw-title">${esc(v.title)}</span>`
      + `<span class="nw-meta">${isNew ? '<span class="sr-only">Unread. </span>' : ''}${i.pinned ? '<span class="nw-pin">Pinned</span>' : ''}${meta}</span></summary><div class="nw-body">${v.body}</div></details></li>`;
  }).join('')}</ul>` : `<div class="sc-empty"><b>${st.loading ? 'Loading…' : 'No messages yet'}</b><span>${st.loading ? 'Getting the latest news.' : 'League news and club decisions land here.'}</span></div>`;
  return `<section class="lg-card nw" aria-label="News">${head}${toast}${list}</section>`;
}
