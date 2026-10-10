// Inbox (0.5): read-only news for this club, from the league's season posts and the app's own news (crest reveals).
// A post counts as read once it's opened; "Mark all read" clears the lot. Read state follows the account (inbox-data.js).
import { snapshotInputs, restoreInputs } from './paint.js';
import { enterPlace, badge } from './shell.js';
import { esc, crestUrl, safeColour } from './member.js';
import { db } from './auth.js';
import { inboxItems, readIds, markRead } from './inbox-data.js';
import { dismissPosts, restorePosts } from './prefs.js';
import { loadReactions, setReaction, EMOJI } from './news-reactions.js';
import { kickoff } from './dashboard-data.js';
import { markdown, inline, ago, day, time } from './places.js';
import { newsBody } from './news-card.js';
import { icon, REACTION } from './icons.js';

const ctx = await enterPlace('inbox');
if (ctx) {
  const { main, club, season } = ctx;
  const code = club?.code;
  const vars = { team: club?.name || 'your club', manager: club?.manager_name || ctx.me.profile?.display_name || 'manager' };

  const sbNews = await db().then(c => c.from('news').select('*').order('created_at', { ascending: false }).limit(50))
    .then(r => r.data || []).catch(() => []);
  let items = inboxItems(season, sbNews, code);
  let read = readIds(code);

  // Reactions (0.30) load after the list, so the Inbox shows at once.
  let reactions = new Map();
  const reactTargets = () => items.flatMap(i => (i.src === 'sb' ? [`news:${i.row.id}`] : []));

  // The manager's phone number (0.10): private to this club and the office, saved through save_my_phone().
  let phone = code ? await db().then(c => c.from('manager_phones').select('phone').eq('club', code).maybeSingle())
    .then(r => r.data?.phone || '').catch(() => '') : '';
  const phoneForm = () => `<form class="ph-form" novalidate>
      <label>Your phone number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="0412 345 678" value="${esc(phone)}"></label>
      <button class="mark-all" type="submit">${phone ? 'Change' : 'Save'}</button>
      <p class="ph-msg" role="status">${phone ? 'Saved. The league office can see it.' : ''}</p></form>`;

  // A post's deadline in words ({due}); due is local { date, time }, no time = end of that day.
  function dueText(post) {
    const k = post.due?.date ? kickoff({ date: post.due.date, time: post.due.time || '23:59' }) : null;
    return k ? `${day(k).replace(/^(Today|Tomorrow|Yesterday)$/, m => m.toLowerCase())} at ${time(k)}` : 'the deadline';
  }

  function s3Body(post) {
    const pv = { ...vars, due: dueText(post) };
    return (post.blocks || []).map(b => {
      if (b.type === 'embed') {
        const fields = (b.fields || []).filter(f => f.name || f.value)
          .map(f => `<p><b>${inline(esc(f.name || ''))}</b><br>${inline(esc(f.value || ''))}</p>`).join('');
        return `${b.title && b !== post.blocks.find(x => x.type === 'embed') ? `<h3>${inline(esc(b.title))}</h3>` : ''}${markdown(b.description, pv)}${fields}`;
      }
      if (b.type === 'poll') return `<div class="poll">${b.question ? `<b>${esc(b.question)}</b>` : ''}<ul>${(b.options || []).map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>`;
      return '';
    }).join('');
  }

  // One row of reaction buttons. Pressing your own emoji again takes it back.
  const reactBar = target => {
    const r = reactions.get(target) || { counts: {}, mine: null };
    return `<div class="rx" role="group" aria-label="React">${EMOJI.map(e => `<button type="button" class="rx-b${r.mine === e ? ' on' : ''}" data-rx="${esc(target)}" data-e="${e}" aria-pressed="${r.mine === e}" aria-label="${REACTION[e].label}" title="${REACTION[e].label}">${icon(REACTION[e].name)}${r.counts[e] ? `<span>${r.counts[e]}</span>` : ''}</button>`).join('')}</div>`;
  };

  function view(i) {
    if (i.src === 'sb') {
      const r = i.row, d = r.data || {};
      if (r.kind === 'crest_reveal') {
        const src = d.crest_path ? crestUrl(d.crest_path) : '';
        return { title: r.title, from: 'vLeague',
          body: `<div class="reveal" style="--rc:${esc(safeColour(d.colour))}">${src ? `<img src="${esc(src)}" alt="">` : ''}
            <b>${esc(d.name || '')}</b>${d.motto ? `<i>${esc(d.motto)}</i>` : ''}</div>${markdown(r.body, vars)}` };
      }
      return { title: r.title, from: 'vLeague', body: newsBody(r, vars) + (d.form === 'phone' ? phoneForm() : '') + reactBar(`news:${r.id}`) };
    }
    const embed = (i.post.blocks || []).find(b => b.type === 'embed') || {};
    return { title: embed.title || embed.author?.name || 'League update',
      from: embed.author?.name || 'vLeague', body: s3Body(i.post) };
  }

  // What the delete buttons may remove: not the phone-number post until a number is saved.
  const clearable = i => !(i.src === 'sb' && i.row.data?.form === 'phone' && !phone);
  let toast = null;

  function draw() {
    const opened = new Set([...main.querySelectorAll('details.ib-post[open]')].map(d => d.dataset.id));
    const snap = snapshotInputs(main);   // a half-typed phone number survives a reaction or a delete elsewhere in the list
    const unread = items.filter(i => !read.has(i.id)).length;
    badge('inbox', unread);
    main.innerHTML = `<div class="inbox">
      <div class="inbox-head"><h1 class="page-title" tabindex="-1">Inbox</h1><span class="ib-actions">${unread ? `<button class="mark-all" type="button">Mark all read</button>` : ''}${items.some(clearable) ? `<button class="mark-all" type="button" data-clear-all>Clear all</button>` : ''}</span></div>
      ${toast ? `<p class="ib-toast" role="status">${esc(toast.text)} <button type="button" class="ib-undo" data-undo>Undo</button></p>` : ''}
      ${items.length ? `<ul class="ib-list">${items.map(i => {
        const v = view(i), isNew = !read.has(i.id);
        return `<li>${clearable(i) ? `<button type="button" class="ib-del" data-del="${esc(i.id)}" aria-label="Delete “${esc(v.title)}”" title="Delete">${icon('x')}</button>` : ''}<details class="ib-post${isNew ? ' new' : ''}" data-id="${esc(i.id)}"${opened.has(i.id) ? ' open' : ''}>
          <summary><span class="dot" aria-hidden="true"></span>
            <span class="ib-title">${esc(v.title)}</span>
            <span class="ib-meta">${isNew ? '<span class="sr-only">Unread. </span>' : ''}${i.pinned ? '<span class="pin">Pinned</span>' : ''}${[v.from !== 'vLeague' && esc(v.from), i.at && esc(ago(i.at))].filter(Boolean).join(' · ')}</span></summary>
          <div class="ib-body">${v.body}</div>
        </details></li>`;
      }).join('')}</ul>` : '<div class="empty-state"><p>No messages yet. League news and club decisions land here.</p><a class="btn ghost" href="home.html">Back to Home</a></div>'}
    </div>`;
    restoreInputs(main, snap);
  }

  main.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches?.('details.ib-post') || !d.open || read.has(d.dataset.id)) return;
    read = markRead(code, [d.dataset.id]);
    d.classList.remove('new');
    d.querySelector('.sr-only')?.remove();
    const left = items.filter(i => !read.has(i.id)).length;
    badge('inbox', left);
    if (!left) main.querySelector('.mark-all')?.remove();
  }, true);
  main.addEventListener('submit', async e => {
    const form = e.target.closest('.ph-form');
    if (!form) return;
    e.preventDefault();
    const msg = form.querySelector('.ph-msg'), btn = form.querySelector('button'), value = form.phone.value.trim();
    const digits = value.replace(/\D/g, '').length;
    if (!/^\+?[0-9 ()-]{8,20}$/.test(value) || digits < 8 || digits > 15) { msg.textContent = 'Enter a phone number with 8 to 15 digits, like 0412 345 678.'; form.phone.focus(); return; }
    btn.disabled = true; msg.textContent = 'Saving…';
    const { error } = await (await db()).rpc('save_my_phone', { p_phone: value });
    btn.disabled = false;
    if (error) { msg.textContent = /digits|Sign in|linked/.test(error.message) ? error.message : 'That didn’t save. Check your connection and try again.'; return; }
    phone = value;
    btn.textContent = 'Change';
    msg.textContent = 'Saved. The league office can see it.';
  });
  // Delete one post, or clear them all. Only this manager's Inbox changes; Undo brings them back.
  async function remove(ids, text) {
    await dismissPosts(ids);
    items = items.filter(i => !ids.includes(i.id));
    toast = { text, ids };
    draw();
    main.querySelector('.page-title')?.focus();
  }
  main.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-del]')) return remove([t.closest('[data-del]').dataset.del], 'Post deleted.');
    if (t.closest('[data-clear-all]')) { const ids = items.filter(clearable).map(i => i.id); return remove(ids, ids.length === 1 ? 'Post deleted.' : `${ids.length} posts deleted.`); }
    if (t.closest('[data-undo]') && toast) {
      const { ids } = toast; toast = null;
      await restorePosts(ids);
      items = inboxItems(season, sbNews, code);
      draw(); return;
    }
    const rx = t.closest('[data-rx]');
    if (rx) {
      const target = rx.dataset.rx, r = reactions.get(target) || { counts: {}, mine: null };
      try {
        const next = await setReaction(target, rx.dataset.e, r.mine);
        if (r.mine) r.counts[r.mine] = Math.max(0, (r.counts[r.mine] || 1) - 1);
        if (next) r.counts[next] = (r.counts[next] || 0) + 1;
        r.mine = next; reactions.set(target, r); draw();
      } catch { /* leave the buttons as they were */ }
      return;
    }
    if (!t.closest('.mark-all') || t.closest('.ph-form')) return;
    read = markRead(code, items.map(i => i.id));
    draw();
    main.querySelector('.page-title')?.focus();
  });

  if (!code) main.innerHTML = '<h1 class="page-title">Inbox</h1><p class="empty">Your account isn’t linked to a club yet.</p>';
  else {
    draw();
    // Reactions arrive a moment later and the list redraws once.
    loadReactions(reactTargets()).then(r => { reactions = r; draw(); }).catch(() => {});
  }
  main.setAttribute('aria-busy', 'false');
}
